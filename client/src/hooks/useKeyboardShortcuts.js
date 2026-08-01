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

      // Plain form controls keep the browser's native undo — it gives us no
      // signal about whether it handled the key, so we must not race it.
      const target = e.target;
      const tagName = target.tagName?.toLowerCase?.() || "";
      if (tagName === "input" || tagName === "textarea") return;

      // Check for Ctrl/Cmd key
      const isMod = e.ctrlKey || e.metaKey;

      if (!isMod) return;

      // A doc page IS a contenteditable, and this hook used to bail on ANY
      // contenteditable target — so Ctrl+Z did nothing at all on doc pages
      // (user 2026-08-01: "i tried doing the control z and control y and its
      // not working on docpages"). Bailing outright is wrong in the other
      // direction too: inside prose, Ctrl+Z must first undo TYPING.
      //
      // Let the editor win while it HAS local history, then fall through to
      // app-level undo. ProseMirror calls preventDefault ONLY when a command
      // actually ran, so `defaultPrevented` is exactly "the editor consumed
      // this key" — and an editor with an empty history leaves it false. Our
      // listener is on `window`, so the editor's handler has already run by
      // the time this reads the flag.
      if (e.defaultPrevented) return;

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
