// helpers/previewAdmission.js
//
// One folder-page preview mounts at a time, with a paint in between.
//
// ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────
// `PreviewNode` gates its preview on an IntersectionObserver, which is the
// right idea and does NOT solve the problem: the observer fires for EVERY card
// above the fold in the same tick, so all of them flip `hasBeenVisible` in one
// React commit and all of them mount a full `PagePreviewBody` inside a single
// synchronous task. The browser cannot paint or dispatch a click until that
// task ends, so the folder page is frozen for as long as the whole batch takes
// — the user: *"the folders page shouldnt freeze up while its waiting for the
// previews to load, i should be able to click on any of them before waiting"*.
//
// The card CHROME (title, icon, click target) is cheap and already rendered by
// then. It is only the preview body that is expensive, so the fix is to let
// those bodies in one at a time rather than to render less.
//
// ── WHY A SHARED QUEUE AND NOT A PER-CARD `setTimeout(index * N)` ───────────
// A per-card delay derived from its own index is a GUESS at how long the card
// ahead of it will take. Guess low and the mounts overlap in one task again —
// the bug, restored. Guess high and a folder of eight cards sits blank for
// seconds after it could have finished. A queue admits the next card when the
// previous one has actually mounted and the browser has actually painted, so
// it is self-pacing: fast previews fill in quickly, slow ones simply take their
// turn without blocking the page.
//
// `loadIndex` is what ORDERS the queue (top-left card first, matching reading
// order) rather than what times it. Before this file that prop was passed by
// `PageFolder` and never read by anything — an inert prop, which is the class
// of defect this repo keeps rediscovering; it is load-bearing now.
//
// ── `afterPaint`, NOT `requestAnimationFrame` ───────────────────────────────
// A rAF callback runs BEFORE the paint it is scheduled in, so releasing the
// next preview there puts it in the very frame meant to show the previous one.
// `afterPaint` (rAF *then* a macrotask) is the shape that actually yields —
// see that file's own header, which records the two times this was measured
// the hard way.

import { afterPaint } from "./afterPaint.js";

// Waiting cards, kept sorted by `loadIndex` so previews fill in reading order
// rather than in whatever order the IntersectionObserver happened to fire.
let queue = [];
let running = false;
let cancelCurrent = null;

function pump() {
  if (running || queue.length === 0) return;
  running = true;
  // Yield a paint BEFORE admitting, so the click/scroll that arrived during
  // the previous mount is handled before we occupy the thread again.
  cancelCurrent = afterPaint(() => {
    cancelCurrent = null;
    running = false;
    // The winner is chosen HERE, not when the timer was scheduled. A card that
    // scrolled out of view and cancelled in the meantime must be able to give
    // up its turn, and re-reading the queue at admission time is also what lets
    // a lower `loadIndex` registered late still go first.
    const next = queue.shift();
    // A THROWING CARD MUST NOT STOP THE QUEUE. `cb` is a React setState, and a
    // component torn down between its turn being scheduled and this callback
    // can throw from it. Without the `finally`, `pump()` below never runs and
    // `running` is already false, so nothing re-pumps: every card after the
    // thrower waits forever, which reads exactly like the page giving up
    // part-way down. Nobody has watched this fire — it is the one path out of
    // this function that leaves the queue permanently parked, so it is guarded
    // rather than left to be discovered by a blank folder page.
    try {
      if (next) next.cb();
    } finally {
      // The admitted card mounts during this callback's own task; pump again
      // afterwards so the next one waits for the paint that follows it.
      pump();
    }
  });
}

/**
 * Ask for permission to mount a preview body.
 *
 * @param {number} index  position in the folder grid; lower goes first
 * @param {() => void} cb called when this card may mount
 * @returns {() => void} cancel — MUST be called on unmount, or a card that has
 *                       scrolled away still takes a turn and delays a visible one
 */
export function requestPreviewSlot(index, cb) {
  const entry = { index: Number.isFinite(index) ? index : 0, cb };
  queue.push(entry);
  queue.sort((a, b) => a.index - b.index);
  pump();
  return () => {
    queue = queue.filter((e) => e !== entry);
  };
}

// Test seam: drop every waiting card and forget the in-flight one. Production
// never calls this — a folder page unmounting cancels its own entries.
export function __resetPreviewAdmission() {
  queue = [];
  running = false;
  if (cancelCurrent) { cancelCurrent(); cancelCurrent = null; }
}
