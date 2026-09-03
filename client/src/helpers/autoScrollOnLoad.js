// THE LOAD-TIME SCROLL, AND WHEN TO GIVE UP ON IT.
//
// `SCROLL_TO` is a courtesy: an onLoad op scrolls the Schedule to the current
// timeslot so a fresh load opens where you are. The target is usually NOT in the
// DOM when the effect is applied — the sweep runs before its page finishes
// mounting — so the effect polls until the node lands.
//
// THAT POLL OUTLIVED ITS WELCOME AND CANCELLED A DRAG. Reported from the device:
// "the first two failed to drop cause 1 of the last ops was the scroll to the
// timeslot on fresh load and that canceled out my drag." On a slow load the ops
// arrive in waves over most of a minute, so the node can appear seconds after
// the user has already started using the grid — and the scroll then yanks the
// page out from under a finger that is mid-gesture.
//
// TWO DECISIONS, AND THE FIRST IS THE ONE THAT MATTERS:
//
// 1. IT ABANDONS, IT DOES NOT DEFER. Waiting for the drag to end and scrolling
//    then is the same yank one moment later — and worse, it arrives when the
//    user believes they are done. A load-time courtesy that missed its window
//    has no claim on the viewport; the user's own position wins outright.
//
// 2. ANY INPUT COUNTS, NOT JUST A DRAG. `window.__moduli_interacting` is set for
//    the whole of a drag (DragProvider), which covers the reported case — but
//    someone who has scrolled or typed is just as clearly reading something, and
//    scrolling away from it is wrong whether or not they ever touch a handle.
//
// Deliberately NOT listening for `scroll`: this feature's whole job is to
// produce one, so a scroll listener would let it cancel itself.

/** Input that means "the user has taken over". Pointer/touch/wheel/key only. */
export const TAKEOVER_EVENTS = ["pointerdown", "touchstart", "wheel", "keydown"];

/**
 * Poll for the target and scroll to it, unless the user takes over first.
 *
 * Every dependency is injected so the decision is testable without a DOM, a
 * real clock, or a mounted grid — which is the whole reason this is not inline
 * in the effect handler.
 *
 * @param jump        () => boolean — attempt the scroll; true when it landed.
 * @param isUserBusy  () => boolean — sampled before EVERY attempt.
 * @param schedule    (fn, ms) => token
 * @param unschedule  (token) => void
 * @param subscribe   (onTakeover) => unsubscribe. Fires once, on real input.
 * @returns { cancel } — cancel it yourself (e.g. the panel unmounted).
 */
export function autoScrollWhenReady({
  jump,
  isUserBusy = () => false,
  schedule,
  unschedule = () => {},
  subscribe = () => () => {},
  maxTries = 24,
  intervalMs = 250,
} = {}) {
  let tries = 0;
  let token = null;
  let done = false;
  let unsubscribe = () => {};

  const stop = () => {
    if (done) return;
    done = true;
    if (token != null) unschedule(token);
    token = null;
    unsubscribe();
  };

  const attempt = () => {
    token = null;
    if (done) return;
    // Sampled per attempt, not once up front: the drag that cancels this
    // typically starts BETWEEN two polls, which is exactly the reported case.
    if (isUserBusy()) return stop();
    if (jump()) return stop();
    if (++tries >= maxTries) return stop();
    token = schedule(attempt, intervalMs);
  };

  unsubscribe = subscribe(stop) || (() => {});
  token = schedule(attempt, intervalMs);
  return { cancel: stop };
}

/** The browser-side wiring. Kept apart so the decision above stays pure. */
export function browserTakeoverSubscription(target = typeof window !== "undefined" ? window : null) {
  return (onTakeover) => {
    if (!target?.addEventListener) return () => {};
    // Capture + passive: this must observe input the app also handles, and must
    // never delay it. `once` is per-listener, so the others still need removing.
    const opts = { capture: true, passive: true, once: true };
    const fire = () => onTakeover();
    for (const e of TAKEOVER_EVENTS) target.addEventListener(e, fire, opts);
    return () => { for (const e of TAKEOVER_EVENTS) target.removeEventListener(e, fire, opts); };
  };
}
