// socketHandlers/occurrences.js — update_occurrence + break_link + request_textmap
import { setMaxListeners } from "node:events";
import Occurrence from "../models/Occurrence.js";
import Transaction from "../models/Transaction.js";
import { nanoid } from "nanoid";
import { compressTextmap, decompressTextmap } from "../utils/textmapCompression.js";
import { recordDoc } from "../utils/txRecorder.js";

export function registerOccurrenceHandlers(socket, {
  io, ensureUserCache, userCacheReady, loadUserIntoCache,
  userRoom,
}) {
  const userId = socket.userId;
  const getUc = async () => {
    const gId = socket.data.activeGridId;
    if (!userCacheReady(userId, gId)) await loadUserIntoCache(userId, gId);
    return ensureUserCache(userId, gId);
  };

  // Cancel in-flight Mongo round-trips when the socket disconnects.
  // Without this an `update_occurrence` upsert can hold a connection
  // pool slot for 30–75s on Atlas Serverless, blocking the next
  // socket's `request_full_state`. Mongoose 9 honors `signal` on
  // every query/write — `.abort()` immediately rejects the await.
  let disconnected = false;
  const abortController = new AbortController();
  // One signal is shared across every Mongoose query for this socket's
  // lifetime (so a single disconnect cancels all in-flight round-trips).
  // A write burst legitimately attaches many concurrent 'abort' listeners,
  // which trips Node's default-10 leak heuristic (MaxListenersExceededWarning).
  // These aren't a leak — they clear when each query settles — so set to 0
  // (unlimited per Node docs) instead of an arbitrary ceiling.
  setMaxListeners(0, abortController.signal);
  socket.on("disconnect", () => {
    disconnected = true;
    abortController.abort();
  });

  socket.on("update_occurrence", async (payload = {}) => {
    const { occurrence, expectedUpdatedAt, expectedFieldUpdatedAt } = payload;
    try {
      if (!userId) return;
      const uc = await getUc();
      const id = occurrence?.id;
      if (!id) return;

      const prev = uc.occurrencesById[id] || {};
      // Snapshot the prior state for undo BEFORE anything mutates it. This one
      // handler carries field edits AND textmap edits, which is what makes doc
      // history work at all — nothing else records textmaps.
      const undoBefore = uc.occurrencesById[id] ? { ...prev } : null;

      // Track the LAST socket to successfully write each occurrence. A stale
      // baseline only signals a real conflict when a DIFFERENT client landed
      // the newer write. The common false positive: one client makes several
      // writes to the SAME occurrence in one tick (e.g. a date switch writes
      // the page's filterOverride, then an op it triggered writes that same
      // page's meta/fields) — the later writes carry a baseline from before
      // the persist ack round-tripped, so they look "stale" against the write
      // this very client just made. That's self-succession, not a collision.
      if (!uc._lastWriterByOcc) uc._lastWriterByOcc = {};
      const lastWriterSocketId = uc._lastWriterByOcc[id];
      // If THIS socket is the only one in the user's room, there's literally
      // no other window/tab/device to conflict with — the whole conflict-
      // detection machinery is pure overhead with no benefit. Treat every
      // write as self-succession so the cheap + medium tier checks are
      // bypassed. A second socket joining the room later will start triggering
      // the real checks again; until then, single-window users pay nothing
      // for multi-window sync they aren't using.
      const userSockets = io.sockets.adapter.rooms.get(userRoom(userId));
      const isSoloSocket = !userSockets || userSockets.size <= 1;
      const isSelfSuccession = isSoloSocket
        || (lastWriterSocketId != null && lastWriterSocketId === socket.id);
      // Mark ourselves as the last writer SYNCHRONOUSLY (before any await).
      // Two writes from the same socket queued in the same tick (e.g. a
      // filterOverride write + the op-fired meta write it triggers) both
      // run their handler bodies before either's persist awaits resolve;
      // setting the marker post-persist (which is what we used to do) left
      // a race window where the second handler read `lastWriterSocketId`
      // BEFORE the first handler wrote it, so isSelfSuccession came back
      // false and the stale guard rejected the second write as a false
      // positive cross-window collision. Setting it here closes that race.
      uc._lastWriterByOcc[id] = socket.id;

      // ── #26 medium-tier conflict resolution: per-field auto-merge ──
      // When the client sends `expectedFieldUpdatedAt: { [fieldId]: ts }`
      // alongside a `fields` patch, compare each field's incoming write
      // against the cached `fieldUpdatedAt` map. Fields whose stored
      // timestamp is newer than what the client expected are CONFLICTS
      // (some other window edited the same field). Fields the client
      // doesn't claim a baseline for AND fields whose baselines match
      // are accepted. Conflicting fields are stripped from the patch
      // and reported back via `occurrence_field_conflict` so the user
      // can decide; everything else auto-merges atomically.
      //
      // This is the "different-field auto-merge" case the cheap tier
      // couldn't handle: two windows each editing distinct fields no
      // longer trample each other (cheap tier rejected the second
      // writer wholesale).
      const incomingFields = occurrence?.fields && typeof occurrence.fields === "object" ? occurrence.fields : null;
      const prevFieldTs = (prev.fieldUpdatedAt && typeof prev.fieldUpdatedAt === "object") ? prev.fieldUpdatedAt : {};
      const conflictedFields = {};
      if (incomingFields && expectedFieldUpdatedAt && typeof expectedFieldUpdatedAt === "object") {
        const filteredFields = {};
        for (const [fid, fval] of Object.entries(incomingFields)) {
          const storedTs = Number(prevFieldTs[fid]) || 0;
          const expectedTs = Number(expectedFieldUpdatedAt[fid]) || 0;
          if (storedTs > expectedTs && !isSelfSuccession) {
            // Same-field collision — keep server's value; report to client.
            conflictedFields[fid] = { mine: fval, theirs: prev.fields?.[fid] ?? null, storedTs, expectedTs };
          } else {
            filteredFields[fid] = fval;
          }
        }
        if (Object.keys(conflictedFields).length > 0) {
          // Tell the originator which fields didn't land + the server's
          // current values for them. Don't touch the bulk patch path
          // for non-conflict fields; they still flow through below.
          socket.emit("occurrence_field_conflict", {
            occurrenceId: id,
            conflicts: conflictedFields,
            occurrence: prev,
          });
        }
        // Rewrite the patch so only non-conflict fields are applied.
        // If every incoming field conflicted AND the rest of the
        // payload is empty, short-circuit — nothing to write.
        occurrence = { ...occurrence, fields: filteredFields };
        const restKeys = Object.keys(occurrence).filter(k => k !== "id" && k !== "fields" && k !== "userId" && k !== "gridId");
        if (Object.keys(filteredFields).length === 0 && restKeys.length === 0) return;
      }

      // ── Stale-write check (#26 cheapest-level conflict resolution) ──
      // When the client sends `expectedUpdatedAt`, compare against the
      // cached `updatedAt`. If the server's stored copy is newer than
      // what the client last saw, REJECT — another window already
      // landed a more recent edit. Emit `occurrence_stale` back to the
      // originator with the current state so it can re-sync + toast.
      // Skip when client didn't send expectedUpdatedAt (legacy path /
      // optimistic-only writes / op-driven internal updates). The
      // medium-tier field-level check above is preferred when both
      // hints are sent; this outer-doc check still catches non-fields
      // collisions (textmap, parentId, occurrences[], etc.).
      if (expectedUpdatedAt != null && prev.updatedAt && !expectedFieldUpdatedAt) {
        const prevMs = new Date(prev.updatedAt).getTime();
        const expectedMs = new Date(expectedUpdatedAt).getTime();
        if (Number.isFinite(prevMs) && Number.isFinite(expectedMs) && prevMs > expectedMs && !isSelfSuccession) {
          // Stale write — a DIFFERENT client has a newer copy. Send the
          // current state back so the originator's UI re-syncs. Don't
          // broadcast anything else (other windows already have it).
          socket.emit("occurrence_stale", { occurrence: prev, attempted: occurrence });
          return;
        }
      }

      // Store occurrence in cache — keep decompressed textmap so full_state can serve it
      const { textmap, ...occWithoutTextmap } = occurrence;
      // gridId fallback chain: client payload → cached prev → active socket grid.
      // Without this the MeasureOp Transaction below threw `gridId required` on
      // partial-shape updates from FieldRenderer, the outer catch bailed out, and
      // the field change never persisted (looked like "nothing is being saved").
      const txGridId = occurrence.gridId || prev.gridId || socket.data.activeGridId;
      const next = { ...prev, ...occWithoutTextmap, id, userId, ...(txGridId ? { gridId: txGridId } : {}) };
      // Bump fieldUpdatedAt for every field we actually accepted into
      // this write so the next collision check sees the latest stamps.
      if (occurrence.fields && Object.keys(occurrence.fields).length > 0) {
        const nowMs = Date.now();
        const nextFieldTs = { ...(prev.fieldUpdatedAt || {}) };
        for (const fid of Object.keys(occurrence.fields)) nextFieldTs[fid] = nowMs;
        next.fieldUpdatedAt = nextFieldTs;
      }
      if (textmap !== undefined) next.textmap = textmap; // keep raw (decompressed) textmap in cache

      // ── Reject child ids that name no occurrence ───────────────────────────
      // A parent's occurrences[] is a list of REAL children. A client can send a
      // stale one — it holds whatever the last full_state gave it, and a write
      // echoes the whole array back — so a single bad array becomes permanent
      // and self-restoring: sweep the database and the next client write puts it
      // straight back (observed 2026-07-29, 42 refs that survived four repairs).
      //
      // The server is the only place that can settle this, because it is the
      // only party that knows what exists. Keep an id when the occurrence is
      // known, or when it is the one being created RIGHT NOW (create emits its
      // parent link before the child row lands, and the create handler does its
      // own atomic $push afterwards).
      if (Array.isArray(next.occurrences) && next.occurrences.length) {
        const known = (cid) => cid === id || !!uc.occurrencesById?.[cid];
        const kept = next.occurrences.filter(known);
        if (kept.length !== next.occurrences.length) {
          const dropped = next.occurrences.length - kept.length;
          console.log(`🧹 update_occurrence ${id}: dropped ${dropped} unknown child id(s)`);
          next.occurrences = kept;
        }
      }

      uc.occurrencesById[id] = next;

      // Compress textmap before persisting to DB. Computed BEFORE the undo
      // snapshot so the snapshot can reuse it — gzip dominates snapshot cost,
      // and compressing the same bytes for both the DB write and the snapshot
      // was doubling it on every doc edit.
      const compressedTextmap = textmap !== undefined ? compressTextmap(textmap) : undefined;
      const dbDoc = compressedTextmap !== undefined
        ? { ...next, textmap: compressedTextmap }
        : next;

      // Undo snapshot. `__actionId` groups this write with the user action that
      // caused it, so a drop and its ~40 tracker writes are ONE undo step.
      try {
        recordDoc({
          userId, gridId: txGridId || socket.data.activeGridId,
          actionId: payload?.__actionId || null,
          model: "occurrence", id, before: undoBefore, after: next,
          compressedTextmap,
          broadcast: (txJson) => {
            socket.emit("transaction_created", { transaction: txJson });
            socket.to(userRoom(userId)).emit("transaction_created", { transaction: txJson });
          },
        });
      } catch (recErr) {
        console.error("update_occurrence undo-record failed (continuing):", recErr?.message || recErr);
      }

      // Create MeasureOp transaction when fields change. Isolate from the
      // persistence path: a transaction-write failure (e.g. validation, race)
      // must not roll back the occurrence write — the user's edit takes
      // priority over the audit trail.
      if (occurrence.fields && Object.keys(occurrence.fields).length > 0 && txGridId) {
        const ops = [];
        for (const [fieldId, fieldValue] of Object.entries(occurrence.fields)) {
          const prevFieldVal = prev.fields?.[fieldId];
          const newVal = fieldValue?.value ?? fieldValue;
          const oldVal = prevFieldVal?.value ?? prevFieldVal;
          const flow = fieldValue?.flow || "in";
          ops.push({ type: "measure", measure: { occurrenceId: id, fieldId, value: newVal, previousValue: oldVal, flow } });
        }
        if (ops.length > 0) {
          try {
            const tx = new Transaction({
              id: nanoid(12), userId, gridId: txGridId,
              type: "MeasureOp", timestamp: new Date(),
              operations: ops, state: "applied",
            });
            await tx.save();
            const txJson = tx.toJSON();
            socket.emit("transaction_created", { transaction: txJson });
            socket.to(userRoom(userId)).emit("transaction_created", { transaction: txJson });
          } catch (txErr) {
            console.error("update_occurrence transaction save failed (continuing with persist):", txErr?.message || txErr);
          }
        }
      }

      let savedDoc;
      try {
        // `{ returnDocument: "after", upsert: true }` returns the doc AFTER the write so
        // we can re-stamp `updatedAt` into the cache for next-write stale
        // checks (#26). `signal` aborts the round-trip if the socket
        // disconnects mid-write — frees the Atlas pool slot for the
        // next socket immediately.
        savedDoc = await Occurrence.findOneAndUpdate(
          { id, userId },
          dbDoc,
          { upsert: true, returnDocument: "after", signal: abortController.signal }
        );
      } catch (upsertErr) {
        if (disconnected && (upsertErr?.name === "AbortError" || /aborted/i.test(upsertErr?.message || ""))) return;
        // E11000: a concurrent create/update with this id already inserted before
        // our upsert filter could match. Fall back to id-only $set so we still
        // persist the change. Without this, the parent.occurrences[] $push later
        // never runs and the slot ends up orphaned (visible only after reload).
        if (upsertErr.code === 11000) {
          savedDoc = await Occurrence.findOneAndUpdate(
            { id },
            { $set: dbDoc },
            { returnDocument: "after", signal: abortController.signal }
          );
        } else {
          throw upsertErr;
        }
      }
      // Stamp the fresh updatedAt into the cache so subsequent stale
      // checks compare against the actual DB write timestamp.
      if (savedDoc?.updatedAt) {
        next.updatedAt = savedDoc.updatedAt;
        uc.occurrencesById[id] = next;
      }
      // (last-writer marker was set synchronously above, before any await,
      // so concurrent handlers from this socket see it without a race.)

      // Broadcast includes textmap so other windows get it. Include
      // updatedAt so receivers can keep their local copies in sync for
      // future stale-write checks.
      const broadcastOcc = textmap !== undefined ? { ...next, textmap } : next;
      socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: broadcastOcc });

      // Targeted ack to the ORIGINATOR with just the fresh timestamps.
      // The originator already applied its write optimistically — it does
      // NOT need the full broadcast payload (which would fire MeasureOp
      // dedup paths needlessly). It DOES need the new `updatedAt` so its
      // next stale-write check (`expectedUpdatedAt` in CommitHelpers.
      // updateOccurrence) compares against the actual DB timestamp.
      // Without this ack the originator's cache keeps a stale updatedAt
      // forever — every subsequent write on the same occurrence trips the
      // stale guard, server emits `occurrence_stale`, client toasts
      // "another window had a newer edit" even when no other window
      // exists.
      if (next.updatedAt) {
        socket.emit("occurrence_persisted", {
          id,
          updatedAt: next.updatedAt,
          ...(next.fieldUpdatedAt ? { fieldUpdatedAt: next.fieldUpdatedAt } : {}),
        });
      }

      // Propagate to copy-linked occurrences
      if (next.linkedGroupId) {
        const linkedOccs = Object.values(uc.occurrencesById || {}).filter(
          o => o.linkedGroupId === next.linkedGroupId && o.id !== id
        );
        for (const linked of linkedOccs) {
          const patch = {};
          if (occurrence.fields && Object.keys(occurrence.fields).length > 0) {
            patch.fields = { ...(linked.fields || {}), ...occurrence.fields };
          }
          if (textmap !== undefined) patch.textmap = textmap;
          if (Object.keys(patch).length === 0) continue;
          const updatedLinked = { ...linked, ...patch };
          const { textmap: linkedTextmap, ...linkedWithoutTextmap } = updatedLinked;
          // Keep decompressed textmap in cache
          uc.occurrencesById[linked.id] = linkedTextmap !== undefined
            ? { ...linkedWithoutTextmap, textmap: linkedTextmap }
            : linkedWithoutTextmap;
          const linkedDbDoc = linkedTextmap !== undefined
            ? { ...linkedWithoutTextmap, textmap: compressTextmap(linkedTextmap) }
            : linkedWithoutTextmap;
          try {
            await Occurrence.findOneAndUpdate(
              { id: linked.id, userId },
              linkedDbDoc,
              { upsert: true, signal: abortController.signal }
            );
          } catch (upsertErr) {
            if (disconnected && (upsertErr?.name === "AbortError" || /aborted/i.test(upsertErr?.message || ""))) return;
            if (upsertErr.code === 11000) {
              await Occurrence.findOneAndUpdate(
                { id: linked.id },
                { $set: linkedDbDoc },
                { signal: abortController.signal }
              );
            } else {
              throw upsertErr;
            }
          }
          if (disconnected) return;
          socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: updatedLinked });
          socket.emit("occurrence_updated", { occurrence: updatedLinked });
        }
      }
    } catch (err) {
      if (disconnected && (err?.name === "AbortError" || err?.name === "MongoServerSelectionError" || /aborted/i.test(err?.message || ""))) {
        return; // expected: disconnect aborted in-flight write
      }
      console.error("update_occurrence error:", err);
      socket.emit("server_error", "Failed to update occurrence");
    }
  });

  // Lazy textmap fetch — client requests textmaps for specific occurrence IDs
  // (e.g. when a doc container comes into view for the first time)
  socket.on("request_textmap", async ({ occurrenceIds } = {}) => {
    try {
      if (!userId || !Array.isArray(occurrenceIds) || occurrenceIds.length === 0) return;
      const docs = await Occurrence.find({ id: { $in: occurrenceIds }, userId })
        .select("id textmap").lean();
      const result = docs
        .filter(o => o.textmap)
        .map(o => ({ id: o.id, textmap: decompressTextmap(o.textmap) }));
      if (result.length > 0) socket.emit("textmaps_loaded", result);
    } catch (err) {
      console.error("request_textmap error:", err);
    }
  });

  socket.on("break_link", async ({ occurrenceId } = {}) => {
    try {
      if (!userId || !occurrenceId) return;
      const uc = await getUc();
      const occ = await Occurrence.findOne({ id: occurrenceId, userId });
      if (!occ) return socket.emit("server_error", "Occurrence not found");
      occ.linkedGroupId = null;
      await occ.save();
      const occObj = occ.toObject();
      if (occObj.textmap) occObj.textmap = decompressTextmap(occObj.textmap);
      uc.occurrencesById[occurrenceId] = { ...uc.occurrencesById[occurrenceId], ...occObj, id: occurrenceId };
      io.to(userRoom(userId)).emit("occurrence_updated", { occurrence: occObj });
    } catch (err) {
      console.error("break_link error:", err);
      socket.emit("server_error", "Failed to break link");
    }
  });
}
