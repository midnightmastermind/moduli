// helpers/opActivity.js
//
// "THE GRID IS STILL WORKING — don't drag yet."
//
// User, 2026-09-02, after a drag capture came back `longTasks=100(17563ms)`
// with `opBy=[MeasureOp:20x974ms]`: *"is there any way we can have a
// notification where the reconnected message is, to say that ops are still
// running. that way i dont try to drag during it"*.
//
// The grid PAINTS long before it is idle — the documented post-load tail is
// seconds of op sweeps and effect application after the screen looks ready,
// and a drag begun in that window is measuring the cascade rather than the
// drag. Every session that has chased "it's jittery" has had to work out
// afterwards, from `sinceLoad`, whether the capture was even taken on a
// settled grid. The person holding the tablet had no way to know at all.
//
// This is the smallest honest signal: a sweep ran, recently, and enough of
// them to matter.
//
// WHY A BURST THRESHOLD RATHER THAN "a sweep is running". Ticking a checkbox
// fires one ~30ms sweep. A pill that flashes on every interaction is noise
// people learn to ignore, and then it is not there when it matters. So the
// pill appears once the CURRENT burst has cost real time (or has clearly not
// stopped), and goes quiet on its own.

const QUIET_MS = 1200;   // no sweep for this long ⇒ the burst is over
const SHOW_MS = 300;     // a burst worth interrupting for
const SHOW_SWEEPS = 4;   // …or one that simply will not stop

const listeners = new Set();
let burstSweeps = 0;
let burstMs = 0;
let quietTimer = null;
// The snapshot is CACHED and replaced only when it changes. `useSyncExternalStore`
// re-reads it on every render and compares by identity, so returning a fresh
// object each time is an infinite render loop rather than a slow component.
let snap = { busy: false, sweeps: 0, ms: 0 };

function publish() {
  const busy = burstMs >= SHOW_MS || burstSweeps >= SHOW_SWEEPS;
  const next = { busy, sweeps: burstSweeps, ms: Math.round(burstMs) };
  // UNREACHABLE TODAY, and kept deliberately rather than counted as coverage:
  // every current publish changes the sweep count, so the A/B for it does not
  // discriminate and no test claims it does. It exists so a future caller that
  // publishes without changing anything cannot turn a subscriber notification
  // into a render loop. What IS tested is the cached snapshot below, which is
  // the property `useSyncExternalStore` actually depends on.
  if (next.busy === snap.busy && next.sweeps === snap.sweeps && next.ms === snap.ms) return;
  snap = next;
  for (const fn of listeners) fn();
}

/** One op sweep finished, having cost `ms`. Called from the single sweep
 *  chokepoint so nothing else has to remember to report. */
export function noteOpSweep(ms = 0) {
  burstSweeps += 1;
  burstMs += ms || 0;
  if (quietTimer) clearTimeout(quietTimer);
  quietTimer = setTimeout(() => {
    quietTimer = null;
    burstSweeps = 0;
    burstMs = 0;
    publish();
  }, QUIET_MS);
  publish();
}

export function subscribeOpActivity(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getOpActivity() {
  return snap;
}

/** Tests only — a module-level burst would otherwise leak between cases. */
export function _resetOpActivity() {
  if (quietTimer) clearTimeout(quietTimer);
  quietTimer = null;
  burstSweeps = 0;
  burstMs = 0;
  snap = { busy: false, sweeps: 0, ms: 0 };
}

export const _OP_ACTIVITY = { QUIET_MS, SHOW_MS, SHOW_SWEEPS };
