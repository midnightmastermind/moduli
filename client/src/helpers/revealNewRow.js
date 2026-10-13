// A row added by "+ › Item" opens its name editor when it MOUNTS (pendingLabelEdit is
// consumed in ModuleInstance's mount effect). On a long board the new row is appended past
// the virtualized / windowed range, so it never mounts and the editor never opens — the
// row arrives as "Item N" with nothing focused (found 2026-10-13 on a 128-row board).
//
// After the add has rendered, if the row is not in the DOM, jump to it: the jump's
// render-all request makes the list mount it, it scrolls into view, and the mount opens
// the editor. A row already on screen is left alone (no scroll, no ring).
import { findOccurrenceElement, jumpToOccurrence } from "./jumpToOccurrence.js";

export function revealNewRow(occurrenceId, {
  find = findOccurrenceElement,
  jump = jumpToOccurrence,
  schedule = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn)),
} = {}) {
  if (!occurrenceId) return;
  schedule(() => {
    if (find(occurrenceId)) return;
    jump(occurrenceId);
  });
}
