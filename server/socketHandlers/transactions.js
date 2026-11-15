// socketHandlers/transactions.js — get_transactions, undo, redo, get_undo_state, get_field_history
import Transaction from "../models/Transaction.js";
import { closeAction, flushAll } from "../utils/txRecorder.js";
import { makeUndoCore } from "./undoCore.js";
import { decompressTextmap } from "../utils/textmapCompression.js";

// wireRestoreDocs lives in undoCore (shared with REST); re-exported for its existing importers.
export { wireRestoreDocs } from "./undoCore.js";

export function registerTransactionHandlers(socket, {
  io, ensureUserCache, userCacheReady, loadUserIntoCache,
  userRoom, getModelByType,
}) {
  const userId = socket.userId;
  const getUc = async () => {
    const gId = socket.data.activeGridId;
    if (!userCacheReady(userId, gId)) await loadUserIntoCache(userId, gId);
    return ensureUserCache(userId, gId);
  };

  socket.on("get_transactions", async ({ gridId, fieldId, timeRange, limit = 100, includeUndone = true } = {}) => {
    try {
      if (!userId) return;
      const query = { userId };
      if (!includeUndone) query.state = { $in: ["applied", "redone"] };
      if (gridId) query.gridId = gridId;
      if (fieldId) query["operations.measure.fieldId"] = fieldId;
      if (timeRange?.start || timeRange?.end) {
        query.timestamp = {};
        if (timeRange.start) query.timestamp.$gte = new Date(timeRange.start);
        if (timeRange.end) query.timestamp.$lte = new Date(timeRange.end);
      }
      const transactions = await Transaction.find(query).sort({ timestamp: -1 }).limit(limit);
      socket.emit("transactions", { transactions });
    } catch (err) {
      console.error("get_transactions error:", err);
      socket.emit("server_error", "Failed to get transactions");
    }
  });

  // ── Undo / redo over document SNAPSHOTS ────────────────────────────────
  //
  // Rewritten 2026-08-01. The previous implementation computed an INVERSE per
  // mutation type and was broken in four independent ways, all silent:
  //   * the move inverse wrote `containerId` / `panelId`, which are not fields
  //     on Occurrence (placement is `parentId` + the parent's `occurrences[]`),
  //     so Mongoose strict mode dropped them and undoing a move did nothing;
  //   * create/delete undo toggled a `_deleted` flag that is in no schema and
  //     that no read path filters on;
  //   * field restore wrote a raw scalar into `fields[fid]`, whose real shape
  //     is `{ value, flow }`;
  //   * the "now re-sync" broadcast went to `io.to(userId)`, but sockets join
  //     `user:${userId}` — so it reached nobody and nothing repainted.
  // Undo now writes back the stored `before` document wholesale. One code path
  // for every entity type, and textmaps need no special handling.

  // Grid is keyed by `_id`; everything else by `id`.
  // The stack's writing half lives in undoCore (shared with REST — Jonah's undo tool).
  const { applySnapshots, publishRestore, nextUndoable, nextRedoable, undoTop } = makeUndoCore({
    userId, io, userRoom, getModelByType, loadUserIntoCache, userCacheReady, ensureUserCache,
  });

  socket.on("undo_transaction", async ({ transactionId, gridId } = {}) => {
    try {
      if (!userId) return;
      const gId = gridId || socket.data.activeGridId;
      // ONLY THE TOP OF THE STACK IS UNDOABLE (2026-09-25): undo writes back each document's whole `before` snapshot,
      // so undoing an older transaction out of order would erase every later edit. Rules in undoCore.undoTop.
      const r = await undoTop({ gridId: gId, transactionId });
      const { publish, ...result } = r;
      socket.emit("undo_result", result);
      if (publish) await publish();
    } catch (err) {
      console.error("undo_transaction error:", err);
      socket.emit("undo_result", { success: false, error: err.message });
    }
  });

  socket.on("redo_transaction", async ({ transactionId, gridId } = {}) => {
    try {
      if (!userId) return;
      const gId = gridId || socket.data.activeGridId;
      const tx = transactionId
        ? await Transaction.findOne({ id: transactionId, userId, state: "undone" })
        : await nextRedoable(gId);

      if (!tx) return socket.emit("redo_result", { success: false, error: "Nothing to redo" });
      if (!tx.docs?.length) {
        return socket.emit("redo_result", { success: false, error: "That change has no redo snapshot" });
      }

      const applied = await applySnapshots(tx.docs, "after");
      await Transaction.findOneAndUpdate({ id: tx.id }, { $set: { state: "redone", redoneAt: new Date(), redoneBy: userId } });

      socket.emit("redo_result", { success: true, transactionId: tx.id, description: tx.description, applied });
      // Redo is undo in the other direction and pays the same cost — it went
      // through the identical full reload.
      await publishRestore(applied, gId);
    } catch (err) {
      console.error("redo_transaction error:", err);
      socket.emit("redo_result", { success: false, error: err.message });
    }
  });

  socket.on("get_undo_state", async ({ gridId } = {}) => {
    try {
      if (!userId) return;
      const gId = gridId || socket.data.activeGridId;
      const lastUndoable = await nextUndoable(gId);
      const lastRedoable = await nextRedoable(gId);
      socket.emit("undo_state", {
        canUndo: !!lastUndoable, lastUndoableId: lastUndoable?.id, lastUndoableDesc: lastUndoable?.description,
        canRedo: !!lastRedoable, lastRedoableId: lastRedoable?.id, lastRedoableDesc: lastRedoable?.description,
      });
    } catch (err) {
      console.error("get_undo_state error:", err);
    }
  });

  // The client's action scope closed (helpers/actionScope.js). Flush its buffer
  // now instead of waiting out the idle timer, so the transaction is undoable
  // by the time the user can press Ctrl+Z.
  socket.on("close_action", ({ actionId } = {}) => {
    if (!userId || !actionId) return;
    closeAction(actionId);
  });

  // A buffer that is still open when the socket goes away would be stranded
  // until its idle timer — and a reload inside that window lost the record
  // entirely: the write persisted, unundoable.
  socket.on("disconnect", () => { flushAll().catch(() => {}); });

  socket.on("get_field_history", async ({ fieldId, occurrenceId, limit = 50 } = {}) => {
    try {
      if (!userId || !fieldId) return;
      const query = { userId, state: "applied", "operations.measure.fieldId": fieldId };
      if (occurrenceId) query["operations.measure.occurrenceId"] = occurrenceId;
      const transactions = await Transaction.find(query).sort({ timestamp: -1 }).limit(limit);
      const history = transactions.flatMap(tx =>
        tx.operations
          .filter(op => op.type === "measure" && op.measure.fieldId === fieldId)
          .map(op => ({ timestamp: tx.timestamp, transactionId: tx.id, ...op.measure }))
      );
      socket.emit("field_history", { fieldId, history });
    } catch (err) {
      console.error("get_field_history error:", err);
      socket.emit("server_error", "Failed to get field history");
    }
  });
}
