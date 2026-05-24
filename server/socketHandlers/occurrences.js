// socketHandlers/occurrences.js — update_occurrence + break_link + request_textmap
import Occurrence from "../models/Occurrence.js";
import Transaction from "../models/Transaction.js";
import { nanoid } from "nanoid";
import { compressTextmap, decompressTextmap } from "../utils/textmapCompression.js";

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

  socket.on("update_occurrence", async ({ occurrence, expectedUpdatedAt } = {}) => {
    try {
      if (!userId) return;
      const uc = await getUc();
      const id = occurrence?.id;
      if (!id) return;

      const prev = uc.occurrencesById[id] || {};

      // ── Stale-write check (#26 cheapest-level conflict resolution) ──
      // When the client sends `expectedUpdatedAt`, compare against the
      // cached `updatedAt`. If the server's stored copy is newer than
      // what the client last saw, REJECT — another window already
      // landed a more recent edit. Emit `occurrence_stale` back to the
      // originator with the current state so it can re-sync + toast.
      // Skip when client didn't send expectedUpdatedAt (legacy path /
      // optimistic-only writes / op-driven internal updates).
      if (expectedUpdatedAt != null && prev.updatedAt) {
        const prevMs = new Date(prev.updatedAt).getTime();
        const expectedMs = new Date(expectedUpdatedAt).getTime();
        if (Number.isFinite(prevMs) && Number.isFinite(expectedMs) && prevMs > expectedMs) {
          // Stale write — server has a newer copy. Send the current
          // state back so the originator's UI re-syncs. Don't broadcast
          // anything else (other windows already have the newer state).
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
      if (textmap !== undefined) next.textmap = textmap; // keep raw (decompressed) textmap in cache
      uc.occurrencesById[id] = next;

      // Compress textmap before persisting to DB
      const dbDoc = textmap !== undefined
        ? { ...next, textmap: compressTextmap(textmap) }
        : next;

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
        // `{ new: true, upsert: true }` returns the doc AFTER the write so
        // we can re-stamp `updatedAt` into the cache for next-write stale
        // checks (#26).
        savedDoc = await Occurrence.findOneAndUpdate({ id, userId }, dbDoc, { upsert: true, new: true });
      } catch (upsertErr) {
        // E11000: a concurrent create/update with this id already inserted before
        // our upsert filter could match. Fall back to id-only $set so we still
        // persist the change. Without this, the parent.occurrences[] $push later
        // never runs and the slot ends up orphaned (visible only after reload).
        if (upsertErr.code === 11000) {
          savedDoc = await Occurrence.findOneAndUpdate({ id }, { $set: dbDoc }, { new: true });
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

      // Broadcast includes textmap so other windows get it. Include
      // updatedAt so receivers can keep their local copies in sync for
      // future stale-write checks.
      const broadcastOcc = textmap !== undefined ? { ...next, textmap } : next;
      socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: broadcastOcc });

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
            await Occurrence.findOneAndUpdate({ id: linked.id, userId }, linkedDbDoc, { upsert: true });
          } catch (upsertErr) {
            if (upsertErr.code === 11000) {
              await Occurrence.findOneAndUpdate({ id: linked.id }, { $set: linkedDbDoc });
            } else {
              throw upsertErr;
            }
          }
          socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: updatedLinked });
          socket.emit("occurrence_updated", { occurrence: updatedLinked });
        }
      }
    } catch (err) {
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
