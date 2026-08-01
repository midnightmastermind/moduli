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

// `transactionId` is OPTIONAL and normally omitted: the server then resolves
// the current top of the undo stack itself. Passing one targets a specific
// entry — that path exists for the history panel. It must NOT be required, or
// the keyboard path is forced to send a cached id that goes stale after every
// write (which is how Ctrl+Z ended up undoing a transaction several steps back).
export function undoTransaction({ socket, transactionId, gridId }) {
  if (!socket) return;
  socket.emit("undo_transaction", { gridId, ...(transactionId ? { transactionId } : {}) });
}

export function redoTransaction({ socket, transactionId, gridId }) {
  if (!socket) return;
  socket.emit("redo_transaction", { gridId, ...(transactionId ? { transactionId } : {}) });
}

export function getUndoState({ socket, gridId }) {
  if (!socket || !gridId) return;
  socket.emit("get_undo_state", { gridId });
}
