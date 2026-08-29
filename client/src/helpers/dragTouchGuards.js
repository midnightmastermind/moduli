/**
 * The touch guards a DRAG needs — attached only while one is running.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * `DragProvider` used to attach `touchmove` and `touchstart` to `document` with
 * `{ passive: false }` for the WHOLE SESSION on any touch device. The handlers
 * are cheap and only call `preventDefault()` while a drag is actually running —
 * but that is irrelevant to the browser.
 *
 * **A non-passive touch listener means the browser cannot know whether
 * `preventDefault()` will be called until JavaScript has run.** So it may not
 * hand the gesture to the compositor: every swipe has to wait for the main
 * thread before it can scroll, and the fling is main-thread-gated rather than
 * compositor-driven. That is the "sticky, no momentum" scroll the user reported
 * on tablet (2026-08-29) — and it is exactly why Chrome made document-level
 * `touchstart`/`touchmove` default to PASSIVE in the first place. This code was
 * explicitly opting back out, on every touch device, for the entire session.
 *
 * Measured on prod at a tablet viewport before the change, via CDP:
 *
 *     document  touchstart  passive=false   <- ours
 *     document  touchmove   passive=false   <- ours
 *     document  wheel       passive=false   <- wheelScroll, deliberate, mouse-only
 *
 * ── WHY SCOPING THEM TO A DRAG IS SAFE ─────────────────────────────────────
 *
 * Everything these two listeners were written for is either unchanged or
 * already covered by a mechanism that fires EARLIER:
 *
 *   1. The gesture that BECOMES a drag always starts on a drag handle, and
 *      `.module-drag-handle` / `.module-grab-zone` already carry
 *      `touch-action: none !important` in CSS — set before the touch begins,
 *      precisely because "JS handleDragStart is too late" (index.css). The
 *      browser therefore never scrolls that gesture, with or without these.
 *   2. `handleDragStart` sets `touch-action: none` and `overscroll-behavior:
 *      none` on `documentElement` SYNCHRONOUSLY, so any touch beginning after
 *      the drag starts is already blocked.
 *   3. Edge/OS gestures during a drag are what `preventEdgeTouch` and the edge
 *      barriers handle — and by then these listeners are attached.
 *
 * So the only window they lose is the gesture that started the drag, which (1)
 * already covers. What they gain back is every OTHER gesture on the device:
 * ordinary scrolling is compositor-driven again.
 *
 * The `dragover`/`dragenter` guards deliberately do NOT live here. Those are
 * for HTML5/OS drops, which arrive unannounced and must be claimed whether or
 * not an in-app drag is running — and they do not block scrolling.
 */

/** Event types this module owns. Non-passive by necessity: they preventDefault. */
export const DRAG_TOUCH_EVENTS = Object.freeze(["touchmove", "touchstart"]);

/**
 * Attach the touch guards to `target`.
 *
 * @param {EventTarget} target
 * @param {{ onTouchMove: Function, onTouchStart: Function }} handlers
 * @returns {Function} detach — safe to call more than once
 */
export function attachDragTouchGuards(target, { onTouchMove, onTouchStart } = {}) {
  if (!target || typeof target.addEventListener !== "function") return () => {};
  const moveOpts = { passive: false };
  // Capture phase for touchstart: an edge touch has to be intercepted before
  // anything downstream sees it.
  const startOpts = { capture: true, passive: false };
  if (onTouchMove) target.addEventListener("touchmove", onTouchMove, moveOpts);
  if (onTouchStart) target.addEventListener("touchstart", onTouchStart, startOpts);

  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    if (onTouchMove) target.removeEventListener("touchmove", onTouchMove, moveOpts);
    if (onTouchStart) target.removeEventListener("touchstart", onTouchStart, startOpts);
  };
}

/**
 * The gate. Guards are attached ONLY when both are true — a touch device, and a
 * drag actually in progress.
 */
export function shouldGuardTouch(isTouch, isDragging) {
  return Boolean(isTouch) && Boolean(isDragging);
}
