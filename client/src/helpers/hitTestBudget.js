// helpers/hitTestBudget.js
//
// HOW OFTEN A TOUCH DRAG MAY AFFORD TO HIT-TEST.
//
// `_findDropTarget` calls `document.elementsFromPoint`, and the drag probe
// measured what that costs on the user's grid (~20,000 DOM nodes, 2026-09-01):
//
//     Chrome/tablet   efp avg 17.8-30.3ms   max 147ms
//     Firefox         efp avg  0.6ms        max   3ms
//
// Same document, same drag, a 50x difference. At the shipped fixed interval of
// 32ms that is 55-95% of the frame budget spent asking the browser what is
// under the finger — which is the reported "jittery… like its freezing up
// during the drag", and why portrait is worse than landscape (more of the grid
// in view, more for the hit-test to walk).
//
// A BIGGER CONSTANT WOULD BE WRONG ON THE OTHER BROWSER. 120ms is right for
// Chrome here and needlessly laggy for Firefox, which can afford 32ms four
// times over — and both numbers go stale on the next device or the next grid
// size. So the interval is DERIVED from the measured cost: spend at most
// `budget` of the time hit-testing, whatever that turns out to cost.
//
// The floor is the old constant, so nothing that was fast gets slower. The
// ceiling is what keeps the drop target honest: past ~160ms the highlight
// visibly trails the finger, which is worse than a dropped frame.

export const HIT_MIN_MS = 32;    // the shipped interval — the fast path keeps it
export const HIT_MAX_MS = 160;   // beyond this the highlight lags the finger
export const HIT_BUDGET = 0.25;  // at most a quarter of the time hit-testing

/**
 * @param {number} avgCostMs rolling cost of one hit-test
 * @returns {number} ms to wait before the next one
 */
export function hitInterval(avgCostMs, { min = HIT_MIN_MS, max = HIT_MAX_MS, budget = HIT_BUDGET } = {}) {
  // No measurement yet (the first hit-test of a drag) — behave exactly as before
  // rather than guessing high and making the first crossing feel dead.
  if (!Number.isFinite(avgCostMs) || avgCostMs <= 0) return min;
  return Math.max(min, Math.min(max, Math.round(avgCostMs / budget)));
}

/**
 * Rolling mean, weighted to recent samples. A drag crosses cheap regions and
 * expensive ones, and a plain average would keep punishing the whole gesture
 * for one costly frame near a dense container.
 */
export function blendCost(prev, sample, weight = 0.3) {
  if (!Number.isFinite(sample) || sample < 0) return prev;
  if (!Number.isFinite(prev) || prev <= 0) return sample;
  return prev * (1 - weight) + sample * weight;
}
