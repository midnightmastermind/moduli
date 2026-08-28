// utils/txRecorder.js
//
// Assembles undo/redo transactions from before/after document SNAPSHOTS.
//
// WHY SNAPSHOTS (2026-08-01): the previous design reversed each change by
// computing an inverse, and it silently did nothing for most of the app —
// the move inverse wrote `containerId`/`panelId`, which are not fields on
// Occurrence (placement is `parentId` + the parent's `occurrences[]`), so
// Mongoose strict mode dropped both. A type with no inverse fails SILENTLY,
// which is the worst possible failure mode for undo. A snapshot is one code
// path for every entity type, and a textmap edit needs no special design.
//
// WHY IT IS CHEAP: every write handler already holds the prior state — the
// warm per-user cache is read immediately before each write (`setupGenericCRUD`
// merges `{ ...uc[cacheKey][id], ...entity }`; `update_occurrence` loads `prev`).
// So `before` and `after` are both in hand with no extra DB read.
//
// GROUPING: one user action = one undo step. The client mints an `actionId`
// (helpers/actionScope.js) and carries it on every socket write, so a drop that
// fans out into ~40 tracker writes buffers into ONE transaction. Writes with no
// actionId (scheduler, feed sync) get their own transaction marked
// `meta.derived` so the undo stack can skip them.

import { nanoid } from "nanoid";
import Transaction from "../models/Transaction.js";
import { compressTextmap, isCompressed } from "./textmapCompression.js";

// How long a buffer may sit idle before it flushes on its own. This is the
// BACKSTOP for a close that never arrives (crash, dropped socket) — a stranded
// buffer means undo silently loses the action.
const IDLE_FLUSH_MS = 1500;

// How long after the client's explicit `close_action` we actually flush.
// NOT zero, deliberately: socket.io preserves message ORDER, but each write
// handler awaits (cache load, Mongo round trip) before it reaches recordDoc, so
// the close handler's body can run BEFORE a preceding write has recorded. A
// short grace window lets those land in the same transaction. Until this
// existed, the 1500ms idle timer was the ONLY flush path, so an undo pressed
// within 1.5s of an edit targeted the PREVIOUS transaction.
const CLOSE_FLUSH_MS = 250;

// Server-stamped bookkeeping that changes on every single write. A document
// whose only difference is one of these did not change anything the user can
// see — and recording it makes Ctrl+Z a visible no-op. Measured on the live
// grid before this existed: 4 of the last 14 recorded docs differed ONLY by
// `updatedAt`, so roughly a third of undo steps did nothing on screen.
const VOLATILE_KEYS = new Set(["updatedAt", "createdAt", "__v", "_id"]);

/**
 * Comparable form of a snapshot: volatile keys dropped, top-level keys sorted
 * so key ORDER can't read as a change.
 */
function meaningfulJson(doc) {
  if (doc == null) return "null";
  const out = {};
  for (const k of Object.keys(doc).sort()) {
    if (VOLATILE_KEYS.has(k)) continue;
    out[k] = doc[k];
  }
  return JSON.stringify(out);
}

// Retention per (user, grid). Matches OperationRunLog's cap in spirit: history
// is for undo + a readable trail, not an archive.
const KEEP_PER_GRID = 200;

// ── AND THE HISTORY-ONLY TRANSACTIONS NEED THEIR OWN RETENTION ─────────────
//
// The cap above prunes by `sequence`, which ONLY the snapshot transactions this
// file writes ever carry. `MeasureOp` rows — written by the occurrence handler
// on every field change — have none, so the prune could never see them and they
// accumulated for ever. Measured on poms grid 2026-08-28:
//
//     37,840 transactions across 49.6 days · 87.7 MB   (the grid itself is 43 MB)
//       prunable (sequenced)                    812
//       NEVER pruned (unsequenced MeasureOp) 37,028   ~746/day -> ~272,000/year
//
// The predicate is "carries no `docs`" rather than `type: "MeasureOp"`, because
// what actually matters is that the undo stack can never use it — `STACK_FILTER`
// (socketHandlers/transactions.js) requires a non-empty `docs`. Keying on the
// capability rather than on a type name means a future doc-less transaction type
// is covered without anyone remembering to add it.
//
// SAFE BECAUSE NOTHING COMPUTES FROM THEM, grepped rather than assumed: the only
// readers are the history panel (`get_transactions`, limit 100) and the undo
// stack (snapshots only). Trackers and aggregations walk `$allItems` live.
//
// A WINDOW ALONE DOES NOT BOUND IT, which the distribution says outright.
// Measured 2026-08-28 on a 31,285-row collection:
//
//     older than  1 day   22,547        <- so 8,738 rows landed in ONE day
//     older than  3 days   4,986        <- 17,561 of them are 1-3 days old
//     older than  7 days   3,373
//     older than 30 days       0
//
// The long-run average is ~746/day; an ACTIVE day is 8,000-22,000. A period is a
// promise about how far back the trail reaches, and on a quiet week it prunes
// nothing while a single busy day adds 20,000 rows. So there are two limits and
// the tighter one wins: the window states the retention promise, the per-grid
// cap bounds a burst. Each is one number.
const KEEP_HISTORY_DAYS = 7;    // the user's call, 2026-08-28: "do it after a week"
const KEEP_HISTORY_PER_GRID = 1000;

/** actionId -> buffer */
const buffers = new Map();
/** `${userId}:${gridId}` -> last allocated sequence (seeded lazily from the DB) */
const seqByGrid = new Map();

/**
 * Snapshot a document for storage.
 * - Deep-cloned: the warm cache is mutated in place, so holding a live ref
 *   would let `before` drift into `after` before the flush.
 * - `textmap` normalized to COMPRESSED: the cache holds textmaps DECOMPRESSED
 *   (loadUserIntoCache decompresses on read) but the DB stores them compressed,
 *   so undo's `$set` has to write the compressed form or this one row ends up
 *   shaped unlike every other.
 * - `_id`/`__v` stripped: `$set: { _id }` on restore is rejected by Mongo.
 */
export function snapshotDoc(doc, precompressedTextmap) {
  if (!doc) return null;
  const plain = typeof doc.toObject === "function" ? doc.toObject() : doc;
  // Clone WITHOUT the textmap, then attach the compressed form. Cloning a
  // decompressed textmap and then throwing it away is pure waste — on a
  // 310KB imported article that alone was ~1ms per snapshot.
  const { textmap, ...rest } = plain;
  let clone;
  try {
    clone = structuredClone(rest);
  } catch {
    clone = JSON.parse(JSON.stringify(rest));
  }
  delete clone._id;
  delete clone.__v;
  if (textmap != null) {
    // gzip DOMINATES snapshot cost (measured: 4.4ms of 5.5ms on a 310KB
    // textmap). `precompressedTextmap` lets the caller hand over a compressed
    // form it already has — the `before`/`after` pair of a field-only write
    // share one textmap object, and update_occurrence already compresses for
    // its own DB write. Without it the same bytes were gzipped up to 3× per
    // write.
    clone.textmap = precompressedTextmap !== undefined
      ? precompressedTextmap
      : (isCompressed(textmap) ? textmap : compressTextmap(textmap));
  }
  return clone;
}

// Seeding is async, so two concurrent flushes could both await the same lookup
// and both compute the same "next" — observed on the live grid, where two
// transactions were written with sequence 1. A duplicated sequence breaks the
// total order the undo stack sorts on, so a step can be skipped or repeated.
// The seed promise is cached and awaited by every caller; the increment itself
// is SYNCHRONOUS after it, so it cannot interleave.
const seqSeeding = new Map();

async function nextSequence(userId, gridId) {
  const key = `${userId}:${gridId}`;
  if (!seqByGrid.has(key)) {
    if (!seqSeeding.has(key)) {
      seqSeeding.set(key, Transaction.findOne({ userId, gridId })
        .sort({ sequence: -1 }).select({ sequence: 1 }).lean()
        .then(latest => {
          // Another caller may have seeded while we awaited — never regress.
          if (!seqByGrid.has(key)) seqByGrid.set(key, latest?.sequence || 0);
          seqSeeding.delete(key);
        })
        .catch(() => { seqSeeding.delete(key); seqByGrid.set(key, 0); }));
    }
    await seqSeeding.get(key);
  }
  const next = (seqByGrid.get(key) || 0) + 1;
  seqByGrid.set(key, next);   // synchronous — no await between read and write
  return next;
}

function bufferFor({ userId, gridId, actionId, label, broadcast }) {
  let buf = buffers.get(actionId);
  if (!buf) {
    buf = { userId, gridId, actionId, label, broadcast, docs: new Map(), timer: null };
    buffers.set(actionId, buf);
  }
  // Keep the first label — it names the user's action, not the cascade's tail.
  if (!buf.label && label) buf.label = label;
  if (!buf.broadcast && broadcast) buf.broadcast = broadcast;
  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(() => { flushAction(actionId).catch(() => {}); }, IDLE_FLUSH_MS);
  return buf;
}

/**
 * Buffer one document change. Repeated writes to the SAME document inside one
 * action collapse: the FIRST `before` and the LATEST `after` win, so undoing a
 * cascade that touched a tracker six times restores its original value once.
 */
export function recordDoc({ userId, gridId, actionId, model, id, before, after, label, broadcast, compressedTextmap }) {
  if (!userId || !gridId || !model || !id) return;
  const key = actionId || `auto-${nanoid(10)}`;
  const buf = bufferFor({ userId, gridId, actionId: key, label, broadcast });
  if (!actionId) buf.derived = true;

  // A write that does not touch the textmap leaves `before` and `after`
  // pointing at the SAME textmap object (handlers build `next` by spreading
  // `prev`). Compress once and reuse — that is the overwhelmingly common case
  // (every field edit), and it halves the gzip bill for it.
  const sharedTextmap = before && after && before.textmap === after.textmap;

  const docKey = `${model}:${id}`;
  const existing = buf.docs.get(docKey);
  if (existing) {
    existing.after = snapshotDoc(after, compressedTextmap);   // latest wins
  } else {
    const beforeSnap = snapshotDoc(before, sharedTextmap ? compressedTextmap : undefined);
    const afterSnap = snapshotDoc(
      after,
      sharedTextmap ? beforeSnap?.textmap : compressedTextmap,
    );
    buf.docs.set(docKey, { model, id, before: beforeSnap, after: afterSnap });
  }

  // A write with no action behind it is its own transaction — flush on the
  // idle timer rather than holding it open indefinitely.
  return key;
}

/**
 * A write that changed nothing is not an undo step — and "nothing" has to
 * ignore the timestamps the server bumps on every write, or every no-op save
 * becomes a step that visibly does nothing when undone.
 */
function changedSomething(d) {
  if (d.before === null && d.after === null) return false;
  return meaningfulJson(d.before) !== meaningfulJson(d.after);
}

/**
 * Fold a later flush of the SAME action into the transaction it already made.
 *
 * Same collapse `recordDoc` applies inside one buffer: the FIRST `before` is
 * where undo has to return to, the LATEST `after` is what is stored now.
 */
async function mergeIntoTransaction(tx, incoming) {
  const byKey = new Map();
  for (const d of tx.docs || []) byKey.set(`${d.model}:${d.id}`, d);
  for (const d of incoming) {
    const key = `${d.model}:${d.id}`;
    const prev = byKey.get(key);
    if (prev) prev.after = d.after;
    else byKey.set(key, d);
  }
  const merged = [...byKey.values()].filter(changedSomething);
  if (!merged.length) {
    // The action netted back to where it started. Keeping an empty step would
    // make Ctrl+Z a visible no-op, which is the very thing VOLATILE_KEYS and
    // the filter above exist to prevent.
    await Transaction.deleteOne({ id: tx.id });
    return null;
  }
  tx.docs = merged;
  // The `after` above is mutated in place on a subdocument, which Mongoose
  // does not detect on its own.
  tx.markModified?.("docs");
  await tx.save();
  return tx.toJSON();
}

/** Write the buffered docs as ONE transaction. No-op when nothing buffered. */
export async function flushAction(actionId) {
  const buf = buffers.get(actionId);
  if (!buf) return null;
  buffers.delete(actionId);
  if (buf.timer) clearTimeout(buf.timer);

  const docs = [...buf.docs.values()].filter(changedSomething);
  if (!docs.length) return null;

  try {
    // ── A LATE WRITE JOINS THE TRANSACTION ITS ACTION ALREADY CREATED ──────
    //
    // `closeAction` debounces 250ms and this function then DELETES the buffer,
    // so the next write carrying the same actionId opened a fresh one and
    // became a second transaction. A tracker cascade runs ~30 SECONDS with
    // pauses far longer than 250ms, so one gesture flushed over and over.
    // Measured on the live grid, one checkbox tick: **1 distinct action id and
    // 29 undoable transactions, 28 of them holding a single document.**
    //
    // That is what "undo is broken" actually was — Ctrl+Z popped the last
    // FRAGMENT of the cascade (a tracker tile) instead of the row the user
    // ticked, and redo then answered "Nothing to redo" because a later
    // fragment had already superseded the branch.
    //
    // Fixed HERE rather than on the timer: raising CLOSE_FLUSH_MS is a picked
    // constant racing a cascade whose length is data-dependent, and it would
    // still be wrong for the next slower grid. Keyed on the indexed `actionId`
    // rather than an in-memory map, so nothing leaks and no window has to be
    // guessed.
    //
    // `state: "applied"` is the guard that matters: merging into a step the
    // user has already UNDONE would silently change what redo replays and
    // resurrect a reversal.
    if (!buf.derived) {
      const existing = await Transaction.findOne({
        actionId, userId: buf.userId, gridId: buf.gridId, state: "applied",
      });
      // The redo branch is NOT re-superseded — the first flush already did it,
      // and re-running it would also kill anything undone in between.
      if (existing) return await mergeIntoTransaction(existing, docs);
    }
    const sequence = await nextSequence(buf.userId, buf.gridId);
    const tx = new Transaction({
      id: nanoid(12),
      userId: buf.userId,
      gridId: buf.gridId,
      type: "SnapshotOp",
      actionId: buf.derived ? null : actionId,
      timestamp: new Date(),
      docs,
      sequence,
      state: "applied",
      description: buf.label || describeDocs(docs),
      meta: buf.derived ? { derived: true } : {},
    });
    await tx.save();
    const json = tx.toJSON();
    // A real user action kills the redo branch. DERIVED writes must NOT — the
    // op sweep that runs right after an undo (sync_state → full_state → onLoad)
    // is derived, and if it superseded the branch, redo would be dead the
    // instant you pressed undo.
    if (!buf.derived) await supersedeRedoBranch(buf.userId, buf.gridId);
    try { buf.broadcast?.(json); } catch { /* a broadcast failure must not lose the write */ }
    pruneLater(buf.userId, buf.gridId);
    return json;
  } catch (err) {
    // The audit trail must never roll back the user's actual edit.
    console.error("txRecorder flush failed:", err?.message || err);
    return null;
  }
}

/**
 * Retire the redo branch: everything currently `undone` for this (user, grid)
 * can no longer be redone, because the user has since done something new.
 * Marked rather than deleted so the history panel keeps showing it.
 */
async function supersedeRedoBranch(userId, gridId) {
  try {
    await Transaction.updateMany(
      { userId, gridId, state: "undone" },
      { $set: { state: "superseded", supersededAt: new Date() } },
    );
  } catch (err) {
    // Housekeeping — never fail the user's write over it.
    console.error("supersedeRedoBranch failed:", err?.message || err);
  }
}

/** actionId -> pending close timer (see CLOSE_FLUSH_MS). */
const pendingClose = new Map();

/**
 * The client says its action scope closed. Flush soon rather than waiting out
 * the idle timer, so the transaction is undoable almost immediately.
 * Safe to call before the buffer exists — the timer is keyed by actionId, and
 * flushAction on a missing buffer is a no-op.
 */
export function closeAction(actionId, delayMs = CLOSE_FLUSH_MS) {
  if (!actionId) return;
  const existing = pendingClose.get(actionId);
  if (existing) clearTimeout(existing);
  pendingClose.set(actionId, setTimeout(() => {
    pendingClose.delete(actionId);
    flushAction(actionId).catch(() => {});
  }, delayMs));
}

/** Flush everything (socket disconnect / shutdown) so no action is stranded. */
export async function flushAll() {
  const ids = [...buffers.keys()];
  for (const id of ids) await flushAction(id);
}

function describeDocs(docs) {
  if (docs.length === 1) {
    const d = docs[0];
    if (d.before === null) return `Created ${d.model}`;
    if (d.after === null) return `Deleted ${d.model}`;
    return `Updated ${d.model}`;
  }
  return `${docs.length} changes`;
}

/**
 * A transaction the undo stack can never use: no `docs` to restore. Mirrors
 * `STACK_FILTER` in socketHandlers/transactions.js — the two must agree, or the
 * prune would delete something Ctrl+Z still needs.
 */
export const HISTORY_ONLY = { $or: [{ docs: { $exists: false } }, { docs: { $size: 0 } }] };

/** The oldest timestamp worth keeping for the readable trail. */
export function historyCutoff(now = Date.now()) {
  return new Date(now - KEEP_HISTORY_DAYS * 86400000);
}

/** How many history-only rows a grid keeps regardless of age. */
export const HISTORY_CAP = KEEP_HISTORY_PER_GRID;

let pruneTimer = null;
function pruneLater(userId, gridId) {
  if (pruneTimer) return;
  pruneTimer = setTimeout(async () => {
    pruneTimer = null;
    try {
      const cutoff = await Transaction.findOne({ userId, gridId })
        .sort({ sequence: -1 }).skip(KEEP_PER_GRID).select({ sequence: 1 }).lean();
      if (cutoff?.sequence) {
        await Transaction.deleteMany({ userId, gridId, sequence: { $lte: cutoff.sequence } });
      }
      // History-only rows age out instead of accumulating for ever. Scoped to
      // (user, grid) like the cap above, so one grid never prunes another's.
      await Transaction.deleteMany({
        userId, gridId,
        timestamp: { $lt: historyCutoff() },
        ...HISTORY_ONLY,
      });
      // …and a per-grid cap, because a single busy day can add 20,000 rows and
      // the window would not touch them for a fortnight. Same shape as the
      // sequence cap above: find the Nth newest, delete from there down.
      const histCut = await Transaction.findOne({ userId, gridId, ...HISTORY_ONLY })
        .sort({ timestamp: -1 }).skip(KEEP_HISTORY_PER_GRID).select({ timestamp: 1 }).lean();
      if (histCut?.timestamp) {
        await Transaction.deleteMany({
          userId, gridId, timestamp: { $lte: histCut.timestamp }, ...HISTORY_ONLY,
        });
      }
    } catch { /* pruning is housekeeping — never surface it */ }
  }, 5000);
}

/** Test seam: drop all in-memory state. */
export function _resetTxRecorder() {
  for (const b of buffers.values()) if (b.timer) clearTimeout(b.timer);
  for (const t of pendingClose.values()) clearTimeout(t);
  pendingClose.clear();
  buffers.clear();
  seqByGrid.clear();
}
