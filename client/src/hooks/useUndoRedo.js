// hooks/useUndoRedo.js
// ============================================================
// Undo/Redo state management hook
// Tracks undo/redo state and provides functions to undo/redo
// ============================================================

import { useState, useEffect, useCallback } from "react";
import { getUndoState, undoTransaction, redoTransaction } from "../helpers/TransactionHelpers";
import { pushTxNotification } from "../state/notificationStore";

/**
 * useUndoRedo - Hook for managing undo/redo state
 *
 * @param {Object} socket - Socket.io client instance
 * @param {string} gridId - Current grid ID
 * @param {Function} onUndoAnimation - Callback for handling undo animations
 */
export function useUndoRedo(socket, gridId, onUndoAnimation) {
  // `canUndo` / `canRedo` drive the BUTTONS only. Neither the keyboard path nor
  // the buttons send an id any more — the server owns stack resolution — so the
  // previously-tracked lastUndoableId / lastRedoableId are gone.
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Request undo state from server
  const refreshUndoState = useCallback(() => {
    getUndoState({ socket, gridId });
  }, [socket, gridId]);

  // Listen for undo state updates
  useEffect(() => {
    if (!socket) return;

    const handleUndoState = ({ canUndo, canRedo }) => {
      setCanUndo(canUndo);
      setCanRedo(canRedo);
    };

    const handleUndoResult = ({ success, transactionId, reversedOps, animate, error }) => {
      setIsProcessing(false);

      if (success) {
        pushTxNotification({ kind: "success", label: "Undone" });

        // Trigger animation if there are move operations to animate
        if (animate && onUndoAnimation && reversedOps) {
          const moveOps = reversedOps.filter(op => op.type === "move_back");
          if (moveOps.length > 0) {
            onUndoAnimation(moveOps);
          }
        }

        // Refresh undo state
        refreshUndoState();
      } else if (error === "Nothing to undo") {
        // An empty stack is a normal outcome now that the keyboard path always
        // asks the server rather than trusting a cached id — not an error.
        pushTxNotification({ kind: "info", label: "Nothing to undo" });
      } else {
        pushTxNotification({ kind: "error", label: `Undo failed: ${error || "Unknown error"}` });
      }
    };

    const handleRedoResult = ({ success, transactionId, error }) => {
      setIsProcessing(false);

      if (success) {
        pushTxNotification({ kind: "success", label: "Redone" });
        refreshUndoState();
      } else if (error === "Nothing to redo") {
        pushTxNotification({ kind: "info", label: "Nothing to redo" });
      } else {
        pushTxNotification({ kind: "error", label: `Redo failed: ${error || "Unknown error"}` });
      }
    };

    // Listen for state sync (transactions may have changed)
    const handleSyncState = () => {
      refreshUndoState();
    };

    // EVERY new transaction moves the top of the stack. Without this the hook
    // only re-synced on mount / gridId change / an undo result, so `canUndo`
    // stayed false right after a user's first edit (Ctrl+Z appeared dead) and
    // the cached ids went stale after every write.
    let refreshTimer = null;
    const handleTransactionCreated = () => {
      // Debounced: a doc save burst emits several in a row and each would
      // otherwise cost a get_undo_state round trip.
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { refreshTimer = null; refreshUndoState(); }, 150);
    };

    socket.on("undo_state", handleUndoState);
    socket.on("undo_result", handleUndoResult);
    socket.on("redo_result", handleRedoResult);
    socket.on("sync_state", handleSyncState);
    socket.on("transaction_created", handleTransactionCreated);

    // Initial fetch
    refreshUndoState();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      socket.off("undo_state", handleUndoState);
      socket.off("undo_result", handleUndoResult);
      socket.off("redo_result", handleRedoResult);
      socket.off("sync_state", handleSyncState);
      socket.off("transaction_created", handleTransactionCreated);
    };
  }, [socket, refreshUndoState, onUndoAnimation]);

  // Refresh when gridId changes
  useEffect(() => {
    refreshUndoState();
  }, [gridId, refreshUndoState]);

  // Undo the last transaction.
  //
  // Deliberately sends NO transactionId: the server resolves the top of the
  // stack itself (nextUndoable). Passing the cached `lastUndoableId` is what
  // made Ctrl+Z undo an OLD transaction — the id is only as fresh as the last
  // `undo_state` round trip, so after a few edits it pointed several steps
  // back, restoring a stale document while the newer transactions stayed
  // `applied`. The explicit-id path still exists on the server for the history
  // panel, which legitimately targets one specific entry.
  const undo = useCallback(() => {
    if (!socket || isProcessing) return;

    setIsProcessing(true);
    undoTransaction({ socket, gridId });
  }, [socket, isProcessing, gridId]);

  // Redo the most recently undone transaction — same reasoning, server-resolved.
  const redo = useCallback(() => {
    if (!socket || isProcessing) return;

    setIsProcessing(true);
    redoTransaction({ socket, gridId });
  }, [socket, isProcessing, gridId]);

  return {
    canUndo,
    canRedo,
    undo,
    redo,
    isProcessing,
    refreshUndoState,
  };
}

export default useUndoRedo;
