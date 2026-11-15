// socketHandlers/undoCore.js — the undo/redo stack's writing half, shared by the socket handler and REST (Jonah's
// `undo` tool, 2026-11-15). Moved VERBATIM out of transactions.js (same helpers, same order); `undoTop` is the socket
// handler's undo body as a function. Deps: { userId, io, userRoom, getModelByType, loadUserIntoCache, userCacheReady,
// ensureUserCache }.
import Transaction from "../models/Transaction.js";
import { planUndoSync, CACHE_KEY_BY_MODEL } from "../utils/undoSync.js";
import { decompressTextmap } from "../utils/textmapCompression.js";

/**
 * The restored documents as the CLIENT reads them. Undo snapshots keep a
 * textmap COMPRESSED (that is the form `$set` writes back), and sent as-is the
 * client stored a base64 string as the doc's text: every open editor refused it
 * and an undone drop or typing stayed on screen until a reload (2026-10-02).
 * Same shape `patchCache` gives the warm cache, so the two cannot disagree.
 */
export function wireRestoreDocs(docs = []) {
  return docs.map((d) => (d.model === "occurrence" && d.doc && typeof d.doc.textmap === "string")
    ? { ...d, doc: { ...d.doc, textmap: decompressTextmap(d.doc.textmap) } }
    : d);
}

export function makeUndoCore({ userId, io, userRoom, getModelByType, loadUserIntoCache, userCacheReady, ensureUserCache }) {
  const keyFilter = (model, id) =>
    model === "grid" ? { _id: id, userId } : { id, userId };

  /** Write one side of every snapshot. Reverse order so parents settle last. */
  async function applySnapshots(docs, side) {
    const applied = [];
    for (const d of [...docs].reverse()) {
      const Model = getModelByType(d.model);
      if (!Model) { console.warn(`undo: no model for "${d.model}" — skipping ${d.id}`); continue; }
      const target = side === "before" ? d.before : d.after;
      const filter = keyFilter(d.model, d.id);
      if (target == null) {
        // No state on this side = the document did not exist then.
        await Model.findOneAndDelete(filter);
        applied.push({ type: "deleted", model: d.model, id: d.id });
      } else {
        await Model.findOneAndUpdate(filter, { $set: target }, { upsert: true });
        // The DOCUMENT rides along, so the cache and the client can be patched
        // from what was just written instead of re-reading the whole grid.
        applied.push({ type: "restored", model: d.model, id: d.id, doc: target });
      }
    }
    return applied;
  }

  /**
   * Patch ONE document into the warm cache, shaped the way `loadUserIntoCache`
   * shapes it — textmaps decompressed, `id` normalised, a module's null label
   * defaulted. Divergence here is a cache that disagrees with a fresh load, so
   * the two must keep saying the same thing about the same document.
   */
  function patchCache(uc, model, id, doc) {
    const key = CACHE_KEY_BY_MODEL[model];
    if (!uc || !key) return;
    if (doc == null) { delete uc[key][id]; return; }
    if (model === "occurrence") {
      uc[key][id] = doc.textmap ? { ...doc, id, textmap: decompressTextmap(doc.textmap) } : { ...doc, id };
    } else if (model === "module") {
      uc[key][id] = { ...doc, id, label: doc.label ?? "" };
    } else {
      uc[key][id] = { ...doc, id };
    }
  }

  /**
   * Publish the result of an undo/redo.
   *
   * The fast path patches the cache for the documents that actually changed and
   * hands the client the same list. The slow path — an unusual snapshot set —
   * is exactly what this handler did for every undo before: reload everything
   * and make the client re-hydrate. See utils/undoSync.js for why it fails
   * closed in that direction.
   */
  async function publishRestore(applied, gId) {
    const plan = planUndoSync(applied);
    if (!plan.incremental) {
      console.log(`↩️  undo: full resync (${plan.reason})`);
      await loadUserIntoCache(userId, gId);
      io.to(userRoom(userId)).emit("sync_state", {});
      return;
    }
    // The cache must exist before it can be patched; if it does not, the load
    // IS the patch.
    if (!userCacheReady(userId, gId)) {
      await loadUserIntoCache(userId, gId);
    } else {
      const uc = ensureUserCache(userId, gId);
      for (const d of plan.docs) patchCache(uc, d.model, d.id, d.doc);
    }
    // userRoom — NOT io.to(userId). Include this socket: it has to re-read
    // state it did not write itself.
    io.to(userRoom(userId)).emit("undo_applied", { docs: wireRestoreDocs(plan.docs) });
  }

  /**
   * The undo stack. Ordered by `sequence` (a total order) rather than
   * `timestamp` — two writes can share a millisecond, and a stack that is not
   * totally ordered will skip or repeat a step.
   *
   * `meta.derived` transactions are excluded: those are writes with no user
   * action behind them (the scheduler, feed sync, and the op sweep that runs
   * after an undo re-syncs). Letting them onto the stack would mean Ctrl+Z
   * undoing the app's own bookkeeping instead of what the user just did.
   */
  const STACK_FILTER = { docs: { $exists: true, $ne: [] }, "meta.derived": { $ne: true } };

  async function nextUndoable(gridId) {
    return Transaction.findOne({ userId, gridId, state: { $in: ["applied", "redone"] }, ...STACK_FILTER })
      .sort({ sequence: -1 });
  }
  // ASCENDING, and that is not a typo. Undo walks the stack high→low, so the
  // most-recently-undone transaction is the LOWEST-sequenced undone one, and
  // that is what redo must replay first. Sorting descending here re-applied the
  // older transaction's `after` snapshot on top of state where the newer one
  // was still reverted.
  async function nextRedoable(gridId) {
    return Transaction.findOne({ userId, gridId, state: "undone", ...STACK_FILTER })
      .sort({ sequence: 1 });
  }

  /** Undo the newest undoable transaction (an explicit id must name it). Returns `publish` to broadcast the restore. */
  async function undoTop({ gridId, transactionId = null }) {
    const top = await nextUndoable(gridId);
    if (transactionId && transactionId !== top?.id) return { success: false, error: "Only the most recent change can be undone" };
    const tx = top;
    if (!tx || tx.state === "undone") return { success: false, error: "Nothing to undo" };
    if (!tx.docs?.length) return { success: false, error: "That change was recorded before undo could restore it" };
    const applied = await applySnapshots(tx.docs, "before");
    await Transaction.findOneAndUpdate({ id: tx.id }, { $set: { state: "undone", undoneAt: new Date(), undoneBy: userId } });
    // The caller publishes, so the socket handler can answer its client BEFORE the restore is broadcast (its order).
    return { success: true, transactionId: tx.id, description: tx.description, applied, publish: () => publishRestore(applied, gridId) };
  }

  return { keyFilter, applySnapshots, patchCache, publishRestore, nextUndoable, nextRedoable, undoTop };
}
