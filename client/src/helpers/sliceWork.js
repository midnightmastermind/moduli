// Run a long synchronous loop in TIME SLICES, yielding to the browser between
// them so it can paint and handle input.
//
// ── WHY, MEASURED ON THE DEVICE ────────────────────────────────────────────
//
// User, 2026-08-29: tablet scrolling is choppy. The on-device diagnostic
// returned PAINT — **main thread blocked 8,680ms of a 12,117ms scroll, 11 long
// tasks** — and a headless follow-up found where they come from: after first
// paint the main thread runs at ~100% for NINE consecutive seconds, then goes
// quiet. The client's own log names the two biggest pieces:
//
//     [op-timing] total=2076ms ops=51        <- the onLoad sweep, ONE task
//     applied effects in 1766ms              <- the effect loop, ONE task
//
// The grid has already painted, so it LOOKS ready; scrolling then is scrolling
// against a main thread that is fully committed.
//
// ── LONG TASKS ARE THE PROBLEM, NOT TOTAL WORK ─────────────────────────────
//
// A frame cannot start while a task is running, so one 1,766ms task drops ~100
// frames while the same work in 8ms slices drops none. This does not make the
// sweep faster — it makes it INTERRUPTIBLE, which is the thing the user
// actually feels. Total wall time goes up slightly (the yields are real); that
// is the trade, and it is the right way round.
//
// ── THE BUDGET HAS TO STRADDLE THE ITEM COST, and picking it wrong is worse
//    than not slicing at all ─────────────────────────────────────────────────
//
// The first attempt used 8ms against items that measured ~9ms EACH, so every
// item blew the budget and the loop yielded after every one: 194 slices for 195
// effects, ~3s of pure scheduling overhead, and the 1,766ms block replaced by
// something slower. Measured, and reverted.
//
// A budget is only useful strictly BETWEEN one item's cost and the 50ms a
// browser calls a "long task": above the item cost so a slice batches several,
// below 50ms so no slice becomes the thing it was meant to prevent. At ~9ms an
// item, 32ms batches three or four and keeps every task comfortably short.
//
// ── A SLICE ALWAYS DOES AT LEAST ONE ITEM ──────────────────────────────────
//
// The budget is checked AFTER the first item of each slice, never before. An
// item slower than the whole budget would otherwise be skipped forever and the
// loop would spin — and some of these items genuinely are (one op measured
// 450ms). Time-slicing cannot split a single item; it bounds everything else
// around it.

/** Yield to the browser: a macrotask, so paint and input can run before we resume. */
export function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Yield for a fixed gap, leaving the rest of the frame to whoever is using it. */
export function yieldFor(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The default yield seam: a bare macrotask, or a real gap while backing off. */
export function defaultYield(gapMs) {
  return gapMs ? yieldFor(gapMs) : yieldToBrowser();
}

// ── AND IT BACKS OFF WHILE A FINGER IS DOWN ────────────────────────────────
//
// Slicing made the load sweep interruptible; it did not make it smaller. The
// user's own capture, a drag begun 12 seconds after a page load:
//
//     opBy=[load:1x3015ms/236fx …]   opSweeps=4 opMs=3929
//     longTasks=111(19231ms)   <- 84% of a 22.9-second drag
//     fps=4                    onMove max=59.9ms
//
// No single block reached the drag any more (`over32=1`, and the same drag
// before slicing carried a 220ms hit-test) — but three seconds of thread
// arriving in 50ms pieces still costs three seconds of frames. The drag hold
// cannot help: it defers fires that have not STARTED, and this sweep is
// already running.
//
// So while the user is interacting the loop takes a SMALLER bite and leaves a
// GAP — roughly a quarter of each frame instead of all of it. The grid still
// builds, which is what stops this being "hide the work until they let go":
// a drop needs the slot it is dropping into to exist.
//
// THE BACK-OFF EXPIRES, on the same principle as `stagedMount`'s
// HARD_RELEASE_MS and the drag hold's cap: a flag that got stuck, or a gesture
// nobody ended, must not be able to stall the grid for ever.
export const INTERACTIVE_BUDGET_MS = 8;
export const INTERACTIVE_GAP_MS = 24;
export const INTERACTIVE_MAX_MS = 15000;

/** True while a gesture is in progress. Set by the drag bridge at finger-down. */
export function userIsInteracting() {
  return typeof window !== "undefined" && window.__moduli_interacting === true;
}

/**
 * The per-slice policy. Pure, and mutating only the caller's own `state` —
 * which is what makes the expiry testable without a clock or a timer.
 * @returns {{ budgetMs: number, gapMs: number }}
 */
export function interactiveSlice(state, { budgetMs = 32, interacting = false, now = 0, maxBackoffMs = INTERACTIVE_MAX_MS } = {}) {
  if (!interacting) { state.since = 0; return { budgetMs, gapMs: 0 }; }
  if (!state.since) state.since = now;
  // Held too long — a stuck flag is indistinguishable from a very long drag,
  // and only one of them is allowed to stop the grid settling.
  if (now - state.since >= maxBackoffMs) return { budgetMs, gapMs: 0 };
  return { budgetMs: INTERACTIVE_BUDGET_MS, gapMs: INTERACTIVE_GAP_MS };
}

/**
 * @param {Array} items
 * @param {(item, index) => void} work   called once per item, synchronously
 * @param {Object} [opts]
 * @param {number} [opts.budgetMs=32]    max time in one slice before yielding
 * @param {Function} [opts.yieldFn]      injected for tests
 * @param {Function} [opts.now]          injected for tests
 * @returns {Promise<{ slices: number, items: number }>}
 */
export async function runSliced(items, work, { budgetMs = 32, yieldFn, now, interacting = userIsInteracting } = {}) {
  const list = Array.isArray(items) ? items : [];
  const clock = now || (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  // ONE yield seam, taking the gap as its argument — the back-off must not be
  // able to route around an injected yield, or a test can only ever observe
  // the idle path (which is exactly what the first version of this did).
  const doYield = yieldFn || defaultYield;
  const backoff = { since: 0 };

  let i = 0, slices = 0;
  while (i < list.length) {
    const started = clock();
    const pol = interactiveSlice(backoff, { budgetMs, interacting: interacting(), now: started });
    slices++;
    // do/while: one item minimum per slice — see the header.
    do {
      work(list[i], i);
      i++;
    } while (i < list.length && clock() - started < pol.budgetMs);
    if (i < list.length) await doYield(pol.gapMs);
  }
  return { slices, items: list.length };
}
