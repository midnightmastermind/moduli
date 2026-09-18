// helpers/caretLanding.js
//
// WHERE A CARET MAY LAND WHEN A BLOCK GIVES IT UP.
//
// Backspacing an empty textblock, or arrowing off its left edge, hands the caret
// to the previous sibling — `setTextSelection(pos - 1)`, the last position inside
// that sibling. That is right for a paragraph or a heading and WRONG for a block
// that holds no inline content: ProseMirror refuses to build a TextSelection
// there and throws
//
//     TextSelection endpoint not pointing into a node with inline content (wrapGroup)
//
// which the user hit on the Alan Watts article (2026-09-17), where the first
// empty line sits directly under a wrap group. The throw is not cosmetic: it
// aborts the handler PART WAY THROUGH, after the node has been deleted from the
// document and before `dropOccurrenceData()` runs — so the occurrence is never
// discarded and the block leaks.
//
// The predicate is ProseMirror's own: a node type declares whether its content is
// inline (`content: "inline*"` → `node.inlineContent`). So this asks the schema
// rather than listing the block types that happen to fail today — a wrapGroup, an
// image, a table row and whatever is added next are all covered by construction.

/**
 * Can a text caret sit inside this node at all?
 *
 * ProseMirror exposes `inlineContent` on the NODE and on its TYPE (Node's is a
 * getter over the type's), so both are read — a caller holding only a resolved
 * type still gets a truthful answer.
 */
export function canHoldCaret(node) {
  if (!node) return false;
  return !!(node.inlineContent ?? node.type?.inlineContent);
}

/**
 * The position to put the caret at when leaving the block that STARTS at `pos`,
 * or null when the previous sibling cannot hold one (or there is none).
 *
 * `pos - 1` is the last position inside the previous sibling — valid only when
 * that sibling's content is inline.
 */
export function caretPosBeforeBlock(prevSibling, pos) {
  if (!canHoldCaret(prevSibling)) return null;
  if (typeof pos !== "number" || pos <= 0) return null;
  return pos - 1;
}

/**
 * Put the caret at the END of a doc, or as close as the schema allows.
 *
 * `focus("end")` asks for a TextSelection at `doc.content.size`, and a doc whose
 * LAST node is an ATOM has no inline position there — so it throws
 *
 *     TextSelection endpoint not pointing into a node with inline content (doc)
 *
 * which the user hit on 2026-09-18, alongside the [mint] tables. A textblock IS
 * an atom, so any doc ending in one — an import, an embed, a block minted before
 * the mint learned to leave a trailing paragraph — is in that state, and the
 * throw comes from CLICKING THE PADDING BELOW IT: an ordinary gesture on an
 * ordinary document.
 *
 * `Editor.jsx`'s padding-click already caught this; `DocContent.jsx`'s
 * padding-click, the same decision one file over, never did. Both call this now,
 * so there is one answer to "what does clicking the empty space below a document
 * do" rather than two that drift.
 *
 * Falls back to a plain `focus()` — the caret lands wherever the editor last had
 * it, which is strictly better than the click doing nothing.
 *
 * @returns {"end"|"fallback"|"failed"|"no-editor"} which branch ran — the caller
 *   logs it, so a document that can never take an end-caret is visible rather
 *   than silent.
 */
export function focusDocEnd(editor) {
  if (!editor || editor.isDestroyed) return "no-editor";
  try { editor.commands.focus("end"); return "end"; }
  catch (_) {
    try { editor.commands.focus(); return "fallback"; }
    catch (_) { return "failed"; }
  }
}
