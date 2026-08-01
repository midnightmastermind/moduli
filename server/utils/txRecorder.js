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

// How long a buffer may sit idle before it flushes on its own. The client
// closes an action explicitly, but a close that never arrives (crash, dropped
// socket) must not strand a buffer — undo would silently lose the action.
const IDLE_FLUSH_MS = 1500;

// Retention per (user, grid). Matches OperationRunLog's cap in spirit: history
// is for undo + a readable trail, not an archive.
const KEEP_PER_GRID = 200;

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
export function snapshotDoc(doc) {
  if (!doc) return null;
  const plain = typeof doc.toObject === "function" ? doc.toObject() : doc;
  let clone;
  try {
    clone = structuredClone(plain);
  } catch {
    clone = JSON.parse(JSON.stringify(plain));
  }
  delete clone._id;
  delete clone.__v;
  if (clone.textmap && !isCompressed(clone.textmap)) {
    clone.textmap = compressTextmap(clone.textmap);
  }
  return clone;
}

async function nextSequence(userId, gridId) {
  const key = `${userId}:${gridId}`;
  if (!seqByGrid.has(key)) {
    const latest = await Transaction.findOne({ userId, gridId })
      .sort({ sequence: -1 }).select({ sequence: 1 }).lean();
    seqByGrid.set(key, latest?.sequence || 0);
  }
  const next = seqByGrid.get(key) + 1;
  seqByGrid.set(key, next);
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
export function recordDoc({ userId, gridId, actionId, model, id, before, after, label, broadcast }) {
  if (!userId || !gridId || !model || !id) return;
  const key = actionId || `auto-${nanoid(10)}`;
  const buf = bufferFor({ userId, gridId, actionId: key, label, broadcast });
  if (!actionId) buf.derived = true;

  const docKey = `${model}:${id}`;
  const existing = buf.docs.get(docKey);
  if (existing) {
    existing.after = snapshotDoc(after);      // latest wins
  } else {
    buf.docs.set(docKey, { model, id, before: snapshotDoc(before), after: snapshotDoc(after) });
  }

  // A write with no action behind it is its own transaction — flush on the
  // idle timer rather than holding it open indefinitely.
  return key;
}

/** Write the buffered docs as ONE transaction. No-op when nothing buffered. */
export async function flushAction(actionId) {
  const buf = buffers.get(actionId);
  if (!buf) return null;
  buffers.delete(actionId);
  if (buf.timer) clearTimeout(buf.timer);

  const docs = [...buf.docs.values()].filter(d => {
    // A write that changed nothing is not an undo step.
    if (d.before === null && d.after === null) return false;
    return JSON.stringify(d.before) !== JSON.stringify(d.after);
  });
  if (!docs.length) return null;

  try {
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
    try { buf.broadcast?.(json); } catch { /* a broadcast failure must not lose the write */ }
    pruneLater(buf.userId, buf.gridId);
    return json;
  } catch (err) {
    // The audit trail must never roll back the user's actual edit.
    console.error("txRecorder flush failed:", err?.message || err);
    return null;
  }
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
    } catch { /* pruning is housekeeping — never surface it */ }
  }, 5000);
}

/** Test seam: drop all in-memory state. */
export function _resetTxRecorder() {
  for (const b of buffers.values()) if (b.timer) clearTimeout(b.timer);
  buffers.clear();
  seqByGrid.clear();
}
