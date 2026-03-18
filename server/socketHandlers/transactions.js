// socketHandlers/transactions.js — get_transactions, undo, redo, get_undo_state, get_field_history
import Transaction from "../models/Transaction.js";
import Occurrence from "../models/Occurrence.js";

export function registerTransactionHandlers(socket, {
  io, ensureUserCache, userCacheReady, loadUserIntoCache,
  userRoom, getModelByType,
}) {
  const userId = socket.userId;

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

  socket.on("undo_transaction", async ({ transactionId, gridId } = {}) => {
    try {
      if (!userId || !transactionId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);

      const tx = await Transaction.findOne({ id: transactionId, userId });
      if (!tx || tx.state === "undone") {
        return socket.emit("undo_result", { success: false, error: "Transaction not found or already undone" });
      }

      const reversedOps = [];
      for (const op of tx.operations) {
        if (op.type === "occurrence_list" && op.occurrenceList) {
          const ol = op.occurrenceList;
          switch (ol.action) {
            case "add":
              await Occurrence.findOneAndUpdate({ id: ol.occurrenceId }, { $set: { _deleted: true, _deletedAt: new Date() } });
              reversedOps.push({ type: "remove", occurrenceId: ol.occurrenceId });
              break;
            case "remove":
              await Occurrence.findOneAndUpdate({ id: ol.occurrenceId }, { $unset: { _deleted: 1, _deletedAt: 1 } });
              reversedOps.push({ type: "restore", occurrenceId: ol.occurrenceId });
              break;
            case "move": {
              const occ = await Occurrence.findOne({ id: ol.occurrenceId });
              if (occ && ol.from) {
                await Occurrence.findOneAndUpdate({ id: ol.occurrenceId }, { $set: { containerId: ol.from.containerId, panelId: ol.from.panelId, _undoAnimation: { type: "slide", from: { containerId: ol.to?.containerId, panelId: ol.to?.panelId }, to: { containerId: ol.from.containerId, panelId: ol.from.panelId } } } });
                reversedOps.push({ type: "move_back", occurrenceId: ol.occurrenceId, from: ol.to, to: ol.from });
              }
              break;
            }
            case "copy":
              await Occurrence.findOneAndUpdate({ id: ol.occurrenceId }, { $set: { _deleted: true, _deletedAt: new Date() } });
              reversedOps.push({ type: "delete_copy", occurrenceId: ol.occurrenceId });
              break;
          }
        } else if (op.type === "measure" && op.measure) {
          const m = op.measure;
          if (m.previousValue !== undefined) {
            await Occurrence.findOneAndUpdate({ id: m.occurrenceId }, { $set: { [`fields.${m.fieldId}`]: m.previousValue } });
            reversedOps.push({ type: "restore_value", occurrenceId: m.occurrenceId, fieldId: m.fieldId, value: m.previousValue });
          }
        } else if (op.type === "entity" && op.entity) {
          const e = op.entity;
          const Model = getModelByType(e.entityType);
          if (!Model) continue;
          switch (e.action) {
            case "create":
              await Model.findOneAndUpdate({ id: e.entityId }, { $set: { _deleted: true, _deletedAt: new Date() } });
              reversedOps.push({ type: "soft_delete", entityType: e.entityType, entityId: e.entityId });
              break;
            case "delete":
              await Model.findOneAndUpdate({ id: e.entityId }, { $unset: { _deleted: 1, _deletedAt: 1 } });
              reversedOps.push({ type: "restore", entityType: e.entityType, entityId: e.entityId });
              break;
            case "update":
              if (e.previousData) {
                await Model.findOneAndUpdate({ id: e.entityId }, { $set: e.previousData });
                reversedOps.push({ type: "restore_data", entityType: e.entityType, entityId: e.entityId });
              }
              break;
          }
        }
      }

      await Transaction.findOneAndUpdate({ id: transactionId }, { $set: { state: "undone", undoneAt: new Date(), undoneBy: userId } });
      await loadUserIntoCache(userId);
      socket.emit("undo_result", { success: true, transactionId, reversedOps, animate: reversedOps.some(op => op.type === "move_back") });
      io.to(userId).emit("sync_state", {});
    } catch (err) {
      console.error("undo_transaction error:", err);
      socket.emit("undo_result", { success: false, error: err.message });
    }
  });

  socket.on("redo_transaction", async ({ transactionId, gridId } = {}) => {
    try {
      if (!userId || !transactionId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);

      const tx = await Transaction.findOne({ id: transactionId, userId, state: "undone" });
      if (!tx) return socket.emit("redo_result", { success: false, error: "Transaction not found or not undone" });

      for (const op of tx.operations) {
        if (op.type === "occurrence_list" && op.occurrenceList) {
          const ol = op.occurrenceList;
          switch (ol.action) {
            case "add":
              await Occurrence.findOneAndUpdate({ id: ol.occurrenceId }, { $unset: { _deleted: 1, _deletedAt: 1 } });
              break;
            case "remove":
              await Occurrence.findOneAndUpdate({ id: ol.occurrenceId }, { $set: { _deleted: true, _deletedAt: new Date() } });
              break;
            case "move":
              if (ol.to) await Occurrence.findOneAndUpdate({ id: ol.occurrenceId }, { $set: { containerId: ol.to.containerId, panelId: ol.to.panelId } });
              break;
            case "copy":
              await Occurrence.findOneAndUpdate({ id: ol.occurrenceId }, { $unset: { _deleted: 1, _deletedAt: 1 } });
              break;
          }
        } else if (op.type === "measure" && op.measure) {
          const m = op.measure;
          await Occurrence.findOneAndUpdate({ id: m.occurrenceId }, { $set: { [`fields.${m.fieldId}`]: m.value } });
        } else if (op.type === "entity" && op.entity) {
          const e = op.entity;
          const Model = getModelByType(e.entityType);
          if (!Model) continue;
          switch (e.action) {
            case "create":
              await Model.findOneAndUpdate({ id: e.entityId }, { $unset: { _deleted: 1, _deletedAt: 1 } });
              break;
            case "delete":
              await Model.findOneAndUpdate({ id: e.entityId }, { $set: { _deleted: true, _deletedAt: new Date() } });
              break;
            case "update":
              if (e.data) await Model.findOneAndUpdate({ id: e.entityId }, { $set: e.data });
              break;
          }
        }
      }

      await Transaction.findOneAndUpdate({ id: transactionId }, { $set: { state: "redone", redoneAt: new Date(), redoneBy: userId } });
      await loadUserIntoCache(userId);
      socket.emit("redo_result", { success: true, transactionId });
      io.to(userId).emit("sync_state", {});
    } catch (err) {
      console.error("redo_transaction error:", err);
      socket.emit("redo_result", { success: false, error: err.message });
    }
  });

  socket.on("get_undo_state", async ({ gridId } = {}) => {
    try {
      if (!userId) return;
      const lastUndoable = await Transaction.findOne({ userId, gridId, state: { $in: ["applied", "redone"] } }).sort({ timestamp: -1 });
      const lastRedoable = await Transaction.findOne({ userId, gridId, state: "undone" }).sort({ undoneAt: -1 });
      socket.emit("undo_state", {
        canUndo: !!lastUndoable, lastUndoableId: lastUndoable?.id, lastUndoableDesc: lastUndoable?.description,
        canRedo: !!lastRedoable, lastRedoableId: lastRedoable?.id, lastRedoableDesc: lastRedoable?.description,
      });
    } catch (err) {
      console.error("get_undo_state error:", err);
    }
  });

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
