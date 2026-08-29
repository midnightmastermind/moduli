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

/**
 * @param {Array} items
 * @param {(item, index) => void} work   called once per item, synchronously
 * @param {Object} [opts]
 * @param {number} [opts.budgetMs=8]     max time in one slice before yielding
 * @param {Function} [opts.yieldFn]      injected for tests
 * @param {Function} [opts.now]          injected for tests
 * @returns {Promise<{ slices: number, items: number }>}
 */
export async function runSliced(items, work, { budgetMs = 8, yieldFn, now } = {}) {
  const list = Array.isArray(items) ? items : [];
  const clock = now || (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const doYield = yieldFn || yieldToBrowser;

  let i = 0, slices = 0;
  while (i < list.length) {
    const started = clock();
    slices++;
    // do/while: one item minimum per slice — see the header.
    do {
      work(list[i], i);
      i++;
    } while (i < list.length && clock() - started < budgetMs);
    if (i < list.length) await doYield();
  }
  return { slices, items: list.length };
}
