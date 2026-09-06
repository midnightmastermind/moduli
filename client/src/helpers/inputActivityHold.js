// helpers/inputActivityHold.js
//
// HOLD THE OP CASCADE WHILE THE USER IS STILL TAPPING.
//
// User, 2026-09-06: *"not letting the app freeze up immediately after marking
// something complete. i try to do that quickly and its taking a second to mark
// something complete if i just marked it on a diff occurance"*.
//
// ── WHAT IS ACTUALLY BETWEEN THE TWO TICKS ─────────────────────────────────
//
// Measured against the live grid's own 74 enabled pipelines: one `Completed`
// write fires a sweep costing **570-690ms and emitting 49 effects** on a
// desktop. This file's own history puts the device at ~3.3x that, i.e. about
// two seconds — the "second" in the report.
//
// The tick itself is already instant: `handleCommit` has deferred its write
// past the paint since 2026-08-25 (8), which took the toggle 2333ms -> 30ms.
// What is NOT instant is the SECOND tick, because tick A's cascade is one long
// synchronous task and tick B's deferred callback cannot run until it ends.
//
// ── THE MECHANISM ALREADY EXISTS AND WAS ARMED FOR ONE GESTURE ─────────────
//
// `interactionHold` defers exactly this class of fire, dedupes by what the fire
// is about, and drains-and-re-arms on a cap so it can never hide work forever.
// It is armed by `DragProvider` alone — `beginInteraction` / `endInteraction`
// have two call sites, both drag. A tap got none of it, and
// `autoScrollOnLoad`'s header already states the principle this misses: **any
// input counts, not just a drag.**
//
// ── IT HOLDS FROM THE *SECOND* RAPID WRITE, NOT THE FIRST ──────────────────
//
// Arming on every write would defer a lone tick's cascade by the quiet window
// too — making the tracker tiles update LATER for the common case, to fix a
// problem that only exists when writes come in quick succession. So the first
// write fires exactly as it does today, and the hold arms only when a second
// arrives inside the window. A single tick is byte-identical to before; a
// burst is protected from its own first member onward.
//
// ── AND IT NEVER RELEASES A DRAG'S HOLD ────────────────────────────────────
//
// `interactionHold.begin()` is a FLAG, not a counter, so `end()` from here
// during a drag would un-hold the rest of the gesture — the exact defect
// 2026-09-03 fixed when a 6-second cap was ending drags that ran 16-38 seconds.
// While a drag is down the release is skipped entirely; the drag's own
// `endInteraction` drains everything, tap writes included.

/** Quiet time after the last write before the cascade is let through. Long
 *  enough that a burst stays one burst, short enough that a tracker tile does
 *  not visibly lag the tick that moved it. */
export const QUIET_MS = 500;

export function makeInputActivityHold({
  quietMs = QUIET_MS,
  begin, end, isDragging = () => false,
  now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
  unschedule = (t) => clearTimeout(t),
} = {}) {
  let timer = null;
  let last = 0;
  let armed = false;

  const stopTimer = () => { if (timer !== null) { unschedule(timer); timer = null; } };

  const releaseSoon = () => {
    stopTimer();
    timer = schedule(() => {
      timer = null;
      // A drag owns the hold while the finger is down. Releasing here would
      // end it early; the drag's own end drains what we armed.
      if (isDragging()) return;
      if (!armed) return;
      armed = false;
      end?.();
    }, quietMs);
  };

  return {
    /** Call immediately BEFORE firing operations for a field write. */
    noteWrite() {
      // Runtime opt-out, so the two arms can be compared in ONE session on one
      // page — the only honest way to A/B a perf change, since two page loads
      // differ by more than the change does.
      if (typeof window !== "undefined" && window.__noTickHold) return false;
      const t = now();
      const rapid = last !== 0 && (t - last) < quietMs;
      last = t;
      // The FIRST write of a burst fires normally — see the header.
      if (rapid && !armed) { armed = true; begin?.(); }
      if (armed) releaseSoon();
      return armed;
    },

    /** Let go now (teardown, or a caller that knows the burst is over). */
    flush() {
      stopTimer();
      if (!armed) return false;
      armed = false;
      end?.();
      return true;
    },

    isArmed() { return armed; },
  };
}
