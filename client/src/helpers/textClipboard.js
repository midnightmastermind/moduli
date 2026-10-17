// helpers/textClipboard.js
// ============================================================
// Cut / copy / paste for TEXT — the one implementation, shared by the two
// surfaces that offer it: the doc editor's right-click menu (selected prose)
// and `ui/TextContextMenu` (form inputs).
//
// ONE SOURCE FOR THE ACTIONS AND FOR THE ITEM LIST, deliberately. The two
// hosts edit completely different things — a ProseMirror transaction vs a
// controlled `<input>` — so it is the LABELS, the ORDER and the "which items
// appear" rule that would silently drift, and those live in
// `buildTextClipboardItems` where neither host can disagree with the other.
//
// WHY PASTE IS THE AWKWARD ONE, since it will read as an oversight otherwise:
// writing the clipboard is free, READING it is a privacy boundary — a page
// that could call readText() silently could scrape whatever you last copied.
// Firefox and Safari answer that with an ephemeral "Paste" prompt and have
// said they will not implement the `clipboard-read` permission at all, so the
// prompt is the permanent design rather than a gap that closes later. It is
// SUPPRESSED for same-origin clipboard content — text copied from inside this
// app pastes silently, which is the case that actually matters here; text
// arriving from another site or app pays one confirmation click.
// Ref: https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API
// ============================================================

import { Scissors, Copy, ClipboardPaste, Undo2, Redo2, Trash2, TextSelect, Search, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { lookupTerm, wikipediaSearchUrl, defineWord, dictionaryUrl } from "./textLookup.js";

/**
 * The clipboard's text, or null.
 *
 * NULL COVERS THREE DIFFERENT THINGS ON PURPOSE — no clipboard API, a refused
 * prompt, and an empty clipboard. Every caller does the same thing with all
 * three (leave the field alone), and distinguishing them would only tempt a
 * caller into writing an empty string over a selection the user still has.
 */
export async function readClipboardText() {
  try {
    const text = await navigator.clipboard?.readText?.();
    return text ?? null;
  } catch {
    return null;
  }
}

/** Put text on the clipboard. Answers whether it landed. */
export async function writeClipboardText(text) {
  try {
    await navigator.clipboard?.writeText?.(String(text ?? ""));
    return true;
  } catch {
    return false;
  }
}

/**
 * The browser's own selection, when it is a real range that touches `el`.
 * A ProseMirror editor only knows about a selection inside ITSELF, and a page
 * of textblocks is one editor per block — so a highlight across two blocks
 * leaves every one of them with an empty selection while the user plainly has
 * text selected (user 2026-10-16: highlighting in a book's Magic view offered
 * Paste and never Copy). Returns "" when there is nothing selected or the
 * selection lies elsewhere on the page.
 */
export function domSelectionTextTouching(el) {
  try {
    const sel = typeof window !== "undefined" ? window.getSelection?.() : null;
    if (!sel || sel.isCollapsed || !sel.rangeCount || !el) return "";
    const range = sel.getRangeAt(0);
    if (!range.intersectsNode?.(el)) return "";
    return String(sel.toString() || "");
  } catch {
    return "";
  }
}

/** Copy whatever the page has selected right now (the browser's own copy). */
export function copyDomSelection() {
  try { return !!document.execCommand?.("copy"); } catch { return false; }
}

/**
 * Input types that are not text editing. A DENYLIST, not a whitelist —
 * enumerating the text-ish types is how this silently stops working the next
 * time a field renders `type="search"`, and the same reason APPLY_TEMPLATE's
 * defaultFields is a denylist (2026-08-05).
 */
const NON_TEXT_INPUT_TYPES = new Set([
  "checkbox", "radio", "button", "submit", "reset",
  "file", "image", "range", "color", "hidden",
]);

/**
 * Is this element a text control the browser would offer cut/copy/paste on?
 *
 * DELIBERATELY EXCLUDES `contenteditable`. ProseMirror IS one, and the doc
 * editor's own menu (Bold, Convert to instance, Add occurrence here…) is the
 * reason that menu exists — a predicate that caught contenteditable would
 * delete it. Prose gets its clipboard items from the editor's own menu instead.
 */
export function isTextInputTarget(el) {
  const tag = el?.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  if (el.disabled || el.readOnly) return false;   // nothing to cut, nothing to paste into
  return !NON_TEXT_INPUT_TYPES.has(String(el.type || "text").toLowerCase());
}

/** `{ start, end, text }` for an input/textarea — text is "" at a collapsed caret. */
export function inputSelection(el) {
  const value = String(el?.value ?? "");
  const start = el?.selectionStart ?? 0;
  const end = el?.selectionEnd ?? start;
  return { start, end, text: value.slice(start, end) };
}

/**
 * Write an input's value THROUGH THE PROTOTYPE'S NATIVE SETTER, then dispatch
 * a bubbling `input` event.
 *
 * THIS IS THE WHOLE RISK IN THE FEATURE. Every text control on this grid is a
 * CONTROLLED React input (`value={state} onChange={e => setState(...)}`).
 * React installs its own `value` descriptor to track what it has already seen,
 * so a plain `el.value = next` is recorded as "no change": no synthetic
 * onChange fires, the component's state never moves, and the next render puts
 * the old text straight back. The paste appears to work for one frame and is
 * silently lost — the class of defect this repo keeps paying for.
 *
 * Calling the prototype setter bypasses React's tracker, so the dispatched
 * event is seen as a real edit.
 */
export function setInputValue(el, next, caretAt = null) {
  if (!el) return;
  const proto = typeof HTMLTextAreaElement !== "undefined" && el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, next);
  else el.value = next;   // a host with no descriptor is better served badly than not at all
  if (caretAt != null) {
    try { el.setSelectionRange(caretAt, caretAt); } catch { /* not all input types carry a selection */ }
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Copy the input's selection. No-op at a collapsed caret. */
export async function copyFromInput(el) {
  const { text } = inputSelection(el);
  if (!text) return false;
  return writeClipboardText(text);
}

/**
 * Copy the selection and remove it.
 * The write is awaited FIRST — deleting text we then failed to put on the
 * clipboard would lose it outright.
 */
export async function cutFromInput(el) {
  const { start, end, text } = inputSelection(el);
  if (!text) return false;
  if (!(await writeClipboardText(text))) return false;
  const value = String(el.value ?? "");
  setInputValue(el, value.slice(0, start) + value.slice(end), start);
  return true;
}

/** Replace the selection (or insert at the caret) with the clipboard's text. */
export async function pasteIntoInput(el) {
  const text = await readClipboardText();
  if (text == null || text === "") return false;
  const { start, end } = inputSelection(el);
  const value = String(el.value ?? "");
  setInputValue(el, value.slice(0, start) + text + value.slice(end), start + text.length);
  return true;
}

/**
 * Clipboard text → content safe to hand to TipTap's `insertContentAt`.
 *
 * PASSING THE RAW STRING WOULD PARSE IT AS HTML. `readText()` returns PLAIN
 * text, so pasting a snippet that happens to contain `<div>` would be parsed as
 * markup and silently disappear — the paste looks like it dropped half your
 * text. A ProseMirror text node cannot hold a newline either, so a multi-line
 * paste becomes paragraphs and a single line stays INLINE (a paragraph there
 * would split the sentence you pasted into).
 *
 * Lives here rather than in the editor so it can be tested — mounting the
 * editor needs the whole grid store.
 */
export function plainTextToProseContent(text) {
  const str = String(text ?? "");
  if (!/[\r\n]/.test(str)) return { type: "text", text: str };
  return str.split(/\r?\n/).map((line) => (
    line ? { type: "paragraph", content: [{ type: "text", text: line }] }
         : { type: "paragraph" }
  ));
}

/**
 * The three menu items, in one order, ending with a separator so a host can
 * append its own items underneath.
 *
 * CUT AND COPY ARE ABSENT WITHOUT A SELECTION rather than disabled — there is
 * nothing to act on, and a control that cannot act reads as broken. PASTE
 * ALWAYS SHOWS: a collapsed caret is a legal paste target, and whether the
 * clipboard holds anything cannot be known without reading it, which is the
 * very thing that costs a prompt.
 */
export function buildTextClipboardItems({ hasSelection, onCut, onCopy, onPaste }) {
  return [
    hasSelection && { label: "Cut", icon: Scissors, onClick: onCut },
    hasSelection && { label: "Copy", icon: Copy, onClick: onCopy },
    { label: "Paste", icon: ClipboardPaste, onClick: onPaste },
    { separator: true },
  ].filter(Boolean);
}

/** Open a Wikipedia search for `term` in a new tab. */
export function searchWikipedia(term) {
  if (!term) return;
  try { window.open(wikipediaSearchUrl(term), "_blank", "noopener"); } catch { /* popup blocked */ }
}

/**
 * Show a word's definition (a toast, like Windows' "Define" card), with a link
 * to the full entry. Offline or unknown → says so and still offers the link.
 */
export async function showDefinition(word) {
  const w = String(word ?? "").trim();
  if (!w) return;
  const id = toast.loading(`Looking up "${w}"…`);
  const lines = await defineWord(w);
  const open = { label: "More", onClick: () => { try { window.open(dictionaryUrl(w), "_blank", "noopener"); } catch { /* blocked */ } } };
  if (lines.length) toast.message(w, { id, description: lines.join("\n"), duration: 15000, action: open });
  else toast.message(`No definition found for "${w}"`, { id, duration: 6000, action: open });
}

/**
 * Every text item a right-click on text offers, Windows-style, in one order:
 * Undo / Redo · Cut / Copy / Paste / Delete · Select all · Search Wikipedia /
 * Define. A host passes only the actions it can do (a read-only selection has
 * no Cut, Paste or Delete), and an item whose action is missing is not shown.
 * Spelling suggestions are not here: they arrive later (a web lookup) and
 * `ContextMenu` puts them at the top through `ctx.spell`.
 *
 * Ends with a separator so a host can append its own items underneath.
 */
export function buildTextActionItems({
  hasSelection, selectedText = "", word = "",
  onUndo, onRedo, onCut, onCopy, onPaste, onDelete, onSelectAll,
}) {
  const term = lookupTerm(selectedText, word);
  const oneWord = term && !/\s/.test(term) ? term : "";
  return [
    onUndo && { label: "Undo", icon: Undo2, onClick: onUndo },
    onRedo && { label: "Redo", icon: Redo2, onClick: onRedo },
    (onUndo || onRedo) && { separator: true },
    hasSelection && onCut && { label: "Cut", icon: Scissors, onClick: onCut },
    hasSelection && onCopy && { label: "Copy", icon: Copy, onClick: onCopy },
    onPaste && { label: "Paste", icon: ClipboardPaste, onClick: onPaste },
    hasSelection && onDelete && { label: "Delete", icon: Trash2, onClick: onDelete },
    { separator: true },
    onSelectAll && { label: "Select all", icon: TextSelect, onClick: onSelectAll },
    onSelectAll && { separator: true },
    term && { label: `Search Wikipedia for "${term.length > 24 ? term.slice(0, 22) + "…" : term}"`, icon: Search, onClick: () => searchWikipedia(term) },
    oneWord && { label: `Define "${oneWord.length > 24 ? oneWord.slice(0, 22) + "…" : oneWord}"`, icon: BookOpen, onClick: () => showDefinition(oneWord) },
    term && { separator: true },
  ].filter(Boolean);
}
