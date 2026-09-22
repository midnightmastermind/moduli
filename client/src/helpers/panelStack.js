// helpers/panelStack.js — which panel a cell shows next.
//
// A cell can hold several panels stacked on top of each other; the header's
// Layers button cycles through them.
//
// THERE IS NO "ALL HIDDEN" STATE, and that is a decision rather than an
// omission. `cyclePanelStack` used to cycle N+1 states — each panel, then a
// state with every panel in the cell hidden, revealing the empty pocket — and
// `Grid` rendered a cell-level Layers button so you could cycle back out of it.
// But Grid ALSO carries a "Defensive: ensure at least one panel per cell is
// visible" effect that force-writes `display: "block"` on the first panel the
// moment a cell goes all-hidden. Measured on prod 2026-09-22: the hidden state
// was unreachable, the cell-level button was dead code, and every attempt to
// reach it cost a wasted `update_module` write as the two rules fought.
//
// The user's call (2026-09-22): a cell always shows one panel. So the cycle is
// N states, the defensive effect is the single authority on "a cell is never
// empty", and the code now says what it does.

/**
 * The index of the panel to show next.
 *
 * @param {number} currentIdx  index of the visible panel, or -1 if none is
 *                             (a cell mid-heal, or data that arrived hidden)
 * @param {number} length      how many panels sit in this cell
 * @param {number} dir         >= 0 forward, < 0 backward
 * @returns {number|null}      index to show, or null when there is nothing to do
 */
export function nextStackIndex(currentIdx, length, dir = 1) {
  if (!Number.isFinite(length) || length <= 0) return null;
  // One panel is not a stack — cycling it would hide the only thing in the
  // cell, which is exactly what the defensive effect would undo.
  if (length === 1) return null;
  const step = dir >= 0 ? 1 : -1;
  // No visible panel yet: step from the "before the first" position so a
  // forward press lands on 0 and a backward press on the last.
  const from = currentIdx >= 0 && currentIdx < length ? currentIdx : (step > 0 ? -1 : 0);
  return ((from + step) % length + length) % length;
}
