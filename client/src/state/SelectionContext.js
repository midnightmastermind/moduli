// state/SelectionContext.js
// Multi-select state container. App.jsx owns the actual state; consumers
// (ModuleInstance, ModuleContainer, ContextMenu) read via useContext.
//
// Shape:
//   selectedIds  — Set<occurrenceId>, immutable per change (new Set() each
//                  call so React's reference equality fires re-renders)
//   isSelected   — (id) => bool
//   toggle       — (id) => void, adds or removes
//   add          — (id) => void
//   remove       — (id) => void
//   clear        — () => void
//   count        — number, == selectedIds.size (cached so consumers can
//                  read without forcing the Set into deps)
//
// MVP scope: shift+click on instances/containers. Future: rubber-band
// drag, shift+arrow tree-walking, multi-drag, copy/copylink/move bulk
// actions.
import { createContext, useCallback, useMemo, useState } from "react";

// Clipboard shape:
//   { mode: "copy" | "move" | "copylink", ids: [occId,...] }
// Move stages the originals; Paste-here updates their parent. Copy mints
// fresh occurrences sharing only the moduleId. Copy-link mints fresh
// occurrences that share moduleId AND linkedGroupId (writes propagate).
export const SelectionContext = createContext({
  selectedIds: new Set(),
  isSelected: () => false,
  toggle: () => {},
  add: () => {},
  remove: () => {},
  clear: () => {},
  count: 0,
  clipboard: null,
  setClipboard: () => {},
  clearClipboard: () => {},
});

export function useSelectionProvider() {
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [clipboard, setClipboardState] = useState(null);

  const isSelected = useCallback((id) => selectedIds.has(id), [selectedIds]);
  const toggle = useCallback((id) => {
    if (!id) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const add = useCallback((id) => {
    if (!id) return;
    setSelectedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);
  const remove = useCallback((id) => {
    if (!id) return;
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);
  const clear = useCallback(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);
  const setClipboard = useCallback((mode, ids) => {
    if (!mode || !Array.isArray(ids) || ids.length === 0) {
      setClipboardState(null);
      return;
    }
    setClipboardState({ mode, ids: [...ids] });
  }, []);
  const clearClipboard = useCallback(() => setClipboardState(null), []);

  return useMemo(() => ({
    selectedIds, isSelected, toggle, add, remove, clear, count: selectedIds.size,
    clipboard, setClipboard, clearClipboard,
  }), [selectedIds, isSelected, toggle, add, remove, clear, clipboard, setClipboard, clearClipboard]);
}
