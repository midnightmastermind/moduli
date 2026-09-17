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

/** Can a text caret sit inside this node at all? */
export function canHoldCaret(node) {
  return !!node?.inlineContent;
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
