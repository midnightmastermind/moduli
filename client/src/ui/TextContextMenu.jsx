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
// PROSE IS NOT HANDLED HERE. An editable doc body has its own menu (Bold,
// Convert to instance, Add occurrence here…) built from the same
// `buildTextActionItems`. What IS handled here besides inputs (2026-10-17): text
// highlighted where nothing editable is — a row label, a read-only reader page —
// when the right-click lands on the highlight. Before, the row's menu opened and
// the highlight had no Copy at all.
//
// Every text menu offers the Windows set: Undo/Redo, Cut/Copy/Paste/Delete,
// Select all, Search Wikipedia, Define, and spelling suggestions for the word
// (helpers/textLookup — the browser's own spellcheck is not readable by a page).
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from "react";
import ContextMenu from "./ContextMenu.jsx";
import {
  isTextInputTarget, inputSelection, setInputValue,
  cutFromInput, copyFromInput, pasteIntoInput,
  buildTextActionItems, writeClipboardText, copyDomSelection,
} from "../helpers/textClipboard.js";
import { wordRangeAt } from "../helpers/textLookup.js";

/**
 * A highlight on text that is NOT an editable field or doc (a row label, a
 * read-only reader page) and that the right-click landed on. Returns its text,
 * or "" — the row's own menu then opens as before.
 */
export function readOnlySelectionAt(x, y) {
  try {
    const sel = window.getSelection?.();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return "";
    const text = String(sel.toString() || "");
    if (!text.trim()) return "";
    const rects = [...sel.getRangeAt(0).getClientRects()];
    const pad = 4;
    const hit = rects.some((r) => x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad);
    return hit ? text : "";
  } catch {
    return "";
  }
}

/** Is the target inside an EDITABLE doc editor? That editor draws its own menu. */
function inEditableProse(el) {
  return !!el?.closest?.('.ProseMirror[contenteditable="true"]');
}

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
      const t = e.target;
      if (isTextInputTarget(t)) {
        // NOT preventDefault-then-nothing: we draw our own menu, so the browser's
        // must not also appear.
        e.preventDefault();
        e.stopPropagation();
        targetRef.current = t;
        const sel = inputSelection(t);
        const word = sel.text ? null : wordRangeAt(String(t.value ?? ""), sel.start);
        setCtx({ kind: "input", x: e.clientX, y: e.clientY, sel, word });
        return;
      }
      if (inEditableProse(t)) return;   // the doc editor's own menu
      const text = readOnlySelectionAt(e.clientX, e.clientY);
      if (!text) return;                // nothing highlighted here: the row's menu
      e.preventDefault();
      e.stopPropagation();
      targetRef.current = null;
      setCtx({ kind: "readonly", x: e.clientX, y: e.clientY, text });
    };
    document.addEventListener("contextmenu", onContextMenu, true);
    return () => document.removeEventListener("contextmenu", onContextMenu, true);
  }, []);

  if (!ctx) return null;

  if (ctx.kind === "readonly") {
    const items = buildTextActionItems({
      hasSelection: true, selectedText: ctx.text,
      onCopy: async () => { if (!(await writeClipboardText(ctx.text))) copyDomSelection(); },
    });
    return <ContextMenu ctx={{ x: ctx.x, y: ctx.y, items }} onClose={close} />;
  }

  const { sel, word } = ctx;
  const exec = (cmd) => withTarget(() => { try { document.execCommand(cmd); } catch { /* unsupported */ } });
  const items = buildTextActionItems({
    hasSelection: !!sel.text,
    selectedText: sel.text,
    word: word?.word || "",
    onUndo: exec("undo"),
    onRedo: exec("redo"),
    onCut: withTarget(cutFromInput),
    onCopy: withTarget(copyFromInput),
    onPaste: withTarget(pasteIntoInput),
    onDelete: withTarget((el) => {
      const v = String(el.value ?? "");
      setInputValue(el, v.slice(0, sel.start) + v.slice(sel.end), sel.start);
    }),
    onSelectAll: withTarget((el) => { try { el.select(); } catch { /* not selectable */ } }),
  });
  const replaceWith = (from, to) => (w) => {
    const el = targetRef.current;
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch { /* courtesy */ }
    const v = String(el.value ?? "");
    setInputValue(el, v.slice(0, from) + w + v.slice(to), from + w.length);
  };
  const oneWord = sel.text && /^[\p{L}'’-]+$/u.test(sel.text.trim()) ? sel.text.trim() : "";
  const spell = word ? { word: word.word, onReplace: replaceWith(word.from, word.to) }
    : oneWord ? { word: oneWord, onReplace: replaceWith(sel.start, sel.end) } : null;

  return <ContextMenu ctx={{ x: ctx.x, y: ctx.y, items, spell }} onClose={close} />;
}
