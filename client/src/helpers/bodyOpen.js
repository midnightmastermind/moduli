// helpers/bodyOpen.js
// ============================================================
// WHICH instance body is open — exactly one, app-wide.
//
// WHY THIS IS NOT PER-COMPONENT STATE. When you open row B's body, row A has
// to close — but A is precisely the row that receives no event. It is not
// hovered, not clicked, and nothing about its own props changed. A boolean per
// row can never express "someone else opened", so the rows would drift into
// several bodies open at once.
//
// This is the same shape as the stuck doc insert-gap solved on 2026-08-01 (9),
// whose entry records the reasoning: *"Every doc editor holds a SEPARATE
// docGap state. Per-editor clearing can never fix this, because the editor
// that ought to clear is the one no longer receiving pointer events."* The fix
// there was a global claim (`claimExclusiveGap` in helpers/gapHover.js) that
// makes "at most one on screen" true BY CONSTRUCTION rather than by
// bookkeeping. This mirrors it deliberately.
//
// Module state rather than React context ON PURPOSE: a context value would
// re-render every instance row on the grid each time any body opened, and this
// file exists on the hot path (ModuleInstance mounts once per row).
// ============================================================

let openId = null;
const subs = new Set();

function publish() {
  // Copy first: a subscriber may unsubscribe during its own notification.
  for (const fn of Array.from(subs)) {
    try {
      fn(openId);
    } catch {
      // One bad row must not leave every other row stuck open.
    }
  }
}

/** The occurrence id whose body is open, or null. */
export function getOpenBodyId() {
  return openId;
}

/** Open this body — closing whichever was open before. */
export function claimBodyOpen(occurrenceId) {
  if (!occurrenceId || openId === occurrenceId) return;
  openId = occurrenceId;
  publish();
}

/**
 * Close this body — but ONLY if it still holds the claim.
 *
 * The guard is load-bearing rather than defensive: a row unmounts AFTER
 * another body opened (React commits the new row before running the old row's
 * cleanup), so an unconditional release would close the body that just opened.
 */
export function releaseBodyOpen(occurrenceId) {
  if (openId === null || openId !== occurrenceId) return;
  openId = null;
  publish();
}

/** Subscribe to changes. Returns an unsubscribe. */
export function subscribeBodyOpen(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
