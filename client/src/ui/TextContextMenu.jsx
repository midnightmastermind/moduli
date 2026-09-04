// ui/TextContextMenu.jsx
// ============================================================
// Cut / copy / paste on a right-clicked TEXT INPUT.
//
// User, 2026-09-04: *"can we add the text cut copy and paste to our right
// click menu"*.
//
// WHY THIS IS ONE DOCUMENT LISTENER AND NOT A BAIL IN SEVEN HANDLERS.
// Every right-click handler on this grid — ModuleInstance, ModuleContainer,
// ModulePage, ModulePanel, PreviewNode, ManifestTree — calls preventDefault()
// with NO target guard, so right-clicking a field pill pops the occurrence
// menu and the browser's own cut/copy/paste is taken away. Adding a guard to
// each is the "eighth caller forgets" trap this repo keeps paying for
// (2026-08-08 (10)), so the decision lives in ONE place: a capture-phase
// listener on `document`, the same seam App already uses to suppress the
// touch/drag context menu.
//
// `stopPropagation` there runs BEFORE React's root listener (React attaches at
// `#root`, document capture fires first), so no surface menu ever opens.
//
// IT SHOWS ONLY THE TEXT ITEMS, not the row's. Right-clicking inside a text
// box is a text gesture, and "Copy" sitting next to "Copy 3 selected" in one
// menu is unreadable. The occurrence menu is still one right-click away on the
// row itself.
//
// PROSE IS NOT HANDLED HERE. A doc body is a contenteditable with its own menu
// (Bold, Convert to instance, Add occurrence here…) — `isTextInputTarget`
// deliberately rejects contenteditable, and `Editor.jsx` renders the same three
// items from the same builder.
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from "react";
import ContextMenu from "./ContextMenu.jsx";
import {
  isTextInputTarget, inputSelection,
  cutFromInput, copyFromInput, pasteIntoInput,
  buildTextClipboardItems,
} from "../helpers/textClipboard.js";

export default function TextContextMenu() {
  const [ctx, setCtx] = useState(null);
  // The element the menu was opened on. Clicking a menu item moves focus out
  // of the field, so the actions cannot re-derive it from document.activeElement.
  const targetRef = useRef(null);

  const close = useCallback(() => setCtx(null), []);

  // Every action refocuses first: `setInputValue` moves the caret, and a caret
  // in an unfocused field is invisible — the paste would look like it landed
  // somewhere else.
  const withTarget = useCallback((fn) => async () => {
    const el = targetRef.current;
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch { /* focus is a courtesy */ }
    await fn(el);
    setCtx(null);
  }, []);

  useEffect(() => {
    const onContextMenu = (e) => {
      if (!isTextInputTarget(e.target)) return;
      // NOT preventDefault-then-nothing: we draw our own menu, so the browser's
      // must not also appear.
      e.preventDefault();
      e.stopPropagation();
      targetRef.current = e.target;
      setCtx({
        x: e.clientX,
        y: e.clientY,
        hasSelection: !!inputSelection(e.target).text,
      });
    };
    document.addEventListener("contextmenu", onContextMenu, true);
    return () => document.removeEventListener("contextmenu", onContextMenu, true);
  }, []);

  if (!ctx) return null;

  const items = buildTextClipboardItems({
    hasSelection: ctx.hasSelection,
    onCut: withTarget(cutFromInput),
    onCopy: withTarget(copyFromInput),
    onPaste: withTarget(pasteIntoInput),
  });

  return <ContextMenu ctx={{ x: ctx.x, y: ctx.y, items }} onClose={close} />;
}
