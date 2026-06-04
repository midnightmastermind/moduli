// hooks/useUndoRedo.js
// ============================================================
// Undo/Redo state management hook
// Tracks undo/redo state and provides functions to undo/redo
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
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
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [lastUndoableId, setLastUndoableId] = useState(null);
  const [lastRedoableId, setLastRedoableId] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Request undo state from server
  const refreshUndoState = useCallback(() => {
    getUndoState({ socket, gridId });
  }, [socket, gridId]);

  // Listen for undo state updates
  useEffect(() => {
    if (!socket) return;

    const handleUndoState = ({ canUndo, canRedo, lastUndoableId, lastRedoableId }) => {
      setCanUndo(canUndo);
      setCanRedo(canRedo);
      setLastUndoableId(lastUndoableId);
      setLastRedoableId(lastRedoableId);
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
      } else {
        pushTxNotification({ kind: "error", label: `Undo failed: ${error || "Unknown error"}` });
      }
    };

    const handleRedoResult = ({ success, transactionId, error }) => {
      setIsProcessing(false);

      if (success) {
        pushTxNotification({ kind: "success", label: "Redone" });
        refreshUndoState();
      } else {
        pushTxNotification({ kind: "error", label: `Redo failed: ${error || "Unknown error"}` });
      }
    };

    // Listen for state sync (transactions may have changed)
    const handleSyncState = () => {
      refreshUndoState();
    };

    socket.on("undo_state", handleUndoState);
    socket.on("undo_result", handleUndoResult);
    socket.on("redo_result", handleRedoResult);
    socket.on("sync_state", handleSyncState);

    // Initial fetch
    refreshUndoState();

    return () => {
      socket.off("undo_state", handleUndoState);
      socket.off("undo_result", handleUndoResult);
      socket.off("redo_result", handleRedoResult);
      socket.off("sync_state", handleSyncState);
    };
  }, [socket, refreshUndoState, onUndoAnimation]);

  // Refresh when gridId changes
  useEffect(() => {
    refreshUndoState();
  }, [gridId, refreshUndoState]);

  // Undo the last transaction
  const undo = useCallback(() => {
    if (!socket || !canUndo || !lastUndoableId || isProcessing) return;

    setIsProcessing(true);
    undoTransaction({ socket, transactionId: lastUndoableId, gridId });
  }, [socket, canUndo, lastUndoableId, isProcessing, gridId]);

  // Redo the last undone transaction
  const redo = useCallback(() => {
    if (!socket || !canRedo || !lastRedoableId || isProcessing) return;

    setIsProcessing(true);
    redoTransaction({ socket, transactionId: lastRedoableId, gridId });
  }, [socket, canRedo, lastRedoableId, isProcessing, gridId]);

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
