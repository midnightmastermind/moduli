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

/**
 * @param {Array} items
 * @param {(item, index) => void} work   called once per item, synchronously
 * @param {Object} [opts]
 * @param {number} [opts.budgetMs=32]    max time in one slice before yielding
 * @param {Function} [opts.yieldFn]      injected for tests
 * @param {Function} [opts.now]          injected for tests
 * @returns {Promise<{ slices: number, items: number }>}
 */
/**
 * THE BUDGET IS A DESKTOP NUMBER, AND THE DEVICE IS NOT A DESKTOP.
 *
 * 32ms was chosen against an item measured at ~9ms, so a slice batched three or
 * four. On the tablet the same item costs ~94ms — the load line reads
 * `effects=22166ms` for 236 effects — so EVERY item blows the budget and the
 * loop yields after each one. That is precisely the degeneracy the header above
 * records reverting once already, arrived at from the other side: the budget did
 * not change, the item cost did.
 *
 * It is worse than the scheduling overhead alone, because a yield is a
 * macrotask and a macrotask ENDS React's auto-batching window. One slice per
 * effect means one synchronous render pass per effect instead of one for the
 * whole batch — and on a 24,000-node document that render is the expensive part.
 *
 * `adaptiveBudget` measures the items it is actually slicing and raises the
 * budget when they turn out to cost more than it does, so a slice always
 * batches SEVERAL. It is capped so no slice becomes the long task slicing
 * exists to prevent, and it is OPT-IN until a device capture says it helps —
 * shipping it on by default is what this session already got wrong once.
 */
export async function runSliced(items, work, { budgetMs = 32, maxBudgetMs = 120, adaptiveBudget = false, yieldFn, now } = {}) {
  const list = Array.isArray(items) ? items : [];
  const clock = now || (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const doYield = yieldFn || yieldToBrowser;

  let i = 0, slices = 0, budget = budgetMs;
  while (i < list.length) {
    const started = clock();
    slices++;
    const from = i;
    // do/while: one item minimum per slice — see the header.
    do {
      work(list[i], i);
      i++;
    } while (i < list.length && clock() - started < budget);
    if (adaptiveBudget && i - from === 1) {
      // THIS SLICE DID ONE ITEM, which means the item alone outran the budget.
      // Left alone that repeats for every remaining item — one yield each, and
      // one React render pass each. Raise the budget above the cost just
      // measured so the next slice batches, capped so a slice never becomes the
      // long task this exists to prevent.
      const cost = clock() - started;
      if (cost > budget) budget = Math.min(maxBudgetMs, Math.ceil(cost * 1.5));
    }
    if (i < list.length) await doYield();
  }
  // The return shape is pinned by callers and tests — the adapted budget is an
  // internal detail and stays out of it.
  return { slices, items: list.length };
}
