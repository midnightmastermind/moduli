// client/src/helpers/shiftSelect.js
//
// WHO OWNS A SHIFT+CLICK — the container, or the row inside it.
//
// Both handle shift+click in the CAPTURE phase, and capture runs top-down, so
// the container fires first and its `stopPropagation()` used to halt the event
// before the row ever saw it. Measured on prod (2026-09-22): a shift+click on
// an instance produced pointerdown / mousedown / mouseup on the row and NO
// click at all, while the container toggled instead — so rows could not be
// multi-selected, and the bulk clipboard that hangs off a row's right-click
// menu ("Copy N selected") was unreachable for them.
//
// The capture phase is NOT the thing to remove: it is there so a row's inner
// contentEditable label and field inputs cannot swallow the gesture. What was
// missing is the container deferring the clicks that belong to one of its rows.
export const ROW_SELECTOR = ".instance-wrap";

/**
 * True when a shift+click that landed on `target` belongs to the CONTAINER —
 * i.e. it did not land inside a row, which selects itself.
 *
 * A null target is the container's: nothing else can own it, and answering
 * false there would make a shift+click on chrome select nothing at all.
 */
export function containerClaimsShiftClick(target) {
  if (!target?.closest) return true;
  return !target.closest(ROW_SELECTOR);
}
