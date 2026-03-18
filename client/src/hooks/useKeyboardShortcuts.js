// hooks/useKeyboardShortcuts.js
// ============================================================
// Global keyboard shortcuts for the grid
// Handles Ctrl+Z (undo), Ctrl+Y/Ctrl+Shift+Z (redo)
// ============================================================

import { useEffect, useCallback } from "react";

/**
 * useKeyboardShortcuts - Global keyboard shortcuts hook
 *
 * @param {Object} handlers - Object with handler functions
 * @param {Function} handlers.onUndo - Called on Ctrl+Z
 * @param {Function} handlers.onRedo - Called on Ctrl+Y or Ctrl+Shift+Z
 * @param {boolean} enabled - Whether shortcuts are enabled
 */
export function useKeyboardShortcuts({ onUndo, onRedo, enabled = true }) {
  const handleKeyDown = useCallback(
    (e) => {
      if (!enabled) return;

      // Don't intercept when typing in inputs/textareas
      const target = e.target;
      const tagName = target.tagName.toLowerCase();
      const isEditable =
        tagName === "input" ||
        tagName === "textarea" ||
        target.isContentEditable;

      if (isEditable) return;

      // Check for Ctrl/Cmd key
      const isMod = e.ctrlKey || e.metaKey;

      if (!isMod) return;

      // Undo: Ctrl+Z (without Shift)
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        onUndo?.();
        return;
      }

      // Redo: Ctrl+Y or Ctrl+Shift+Z
      if (e.key === "y" || (e.key === "z" && e.shiftKey) || (e.key === "Z" && e.shiftKey)) {
        e.preventDefault();
        onRedo?.();
        return;
      }
    },
    [enabled, onUndo, onRedo]
  );

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, handleKeyDown]);
}

export default useKeyboardShortcuts;
