// helpers/caretFromPoint.js
//
// Put the caret where the pointer is, inside a small contentEditable.
//
// FIREFOX refuses native caret placement in an editable that has ANY
// draggable="true" ANCESTOR (proven 2026-07-13 on the inline textblock chip:
// the same mid-chip click landed at offset 0 with the ancestors draggable and at
// offset 10 with them stripped). Every container shell, instance row and page
// shell on this grid is a drag source, and an editable cannot disarm ancestors
// it does not own — so it places its own caret from the click point instead.
//
// User, 2026-09-15: *"when i click on a doccontainers header, i expect the cursor
// to go where i click in the text. right now, it sends the typing cursor to the
// end of the text."* Same class, second surface: the embedded container's
// header label is a contentEditable span inside a draggable container shell.
//
// Skipped when the user made a RANGE selection, so drag-select and double-click
// word-select survive. A no-op where native placement already landed in the
// right spot (re-placing a caret at the same offset changes nothing).

/** @returns {boolean} whether a caret was placed */
export function placeCaretAtPoint(el, clientX, clientY) {
  if (!el || typeof document === "undefined") return false;
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (!sel || (sel.rangeCount && !sel.isCollapsed)) return false;
  let node = null, offset = 0;
  try {
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(clientX, clientY);
      if (pos && el.contains(pos.offsetNode)) { node = pos.offsetNode; offset = pos.offset; }
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(clientX, clientY);
      if (r && el.contains(r.startContainer)) { node = r.startContainer; offset = r.startOffset; }
    }
  } catch (_) { return false; }
  if (!node) return false;
  try {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  } catch (_) { return false; }
}
