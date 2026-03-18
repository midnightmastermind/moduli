// helpers/TransactionHelpers.js
// Transaction/undo/redo socket calls — centralizes all transaction-related emissions.
// Part of CommitHelpers contract: these are the only allowed callers of transaction socket events.

export function getTransactions({ socket, gridId, includeUndone = true, fieldId, timeRange, limit }) {
  if (!socket || !gridId) return;
  const payload = { gridId, includeUndone };
  if (fieldId) payload.fieldId = fieldId;
  if (timeRange) payload.timeRange = timeRange;
  if (limit != null) payload.limit = limit;
  socket.emit("get_transactions", payload);
}

export function undoTransaction({ socket, transactionId, gridId }) {
  if (!socket || !transactionId) return;
  socket.emit("undo_transaction", { transactionId, gridId });
}

export function redoTransaction({ socket, transactionId, gridId }) {
  if (!socket || !transactionId) return;
  socket.emit("redo_transaction", { transactionId, gridId });
}

export function getUndoState({ socket, gridId }) {
  if (!socket || !gridId) return;
  socket.emit("get_undo_state", { gridId });
}
