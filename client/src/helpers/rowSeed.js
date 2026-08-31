// helpers/rowSeed.js
//
// THE PLACEHOLDER HEIGHT FOR AN UNRENDERED ROW, DERIVED INSTEAD OF PICKED.
//
// `.container-list--long .instance-wrap` carries `content-visibility: auto`,
// which skips layout and paint off screen, and `contain-intrinsic-size` is the
// height the engine reserves for a row it has not rendered yet. Get that number
// wrong and the list's geometry is wrong by (error x rows): the scroller
// resizes as rows render and the content slides under the finger.
//
// IT HAS NOW BEEN WRONG IN BOTH DIRECTIONS, WHICH IS THE ARGUMENT AGAINST A
// CONSTANT. index.css carried 60px, and its own comment records lowering it to
// 44 because 60 "over-estimated most rows, so the scroller shrank as they
// rendered and dragged content under the finger" — measured on a Samsung A15
// where rows ran 36-60px. On the user's phone (384x700 @2.8125x, 2026-08-31)
// the same diagnostic reports:
//
//     seed=44  real=81        seed=44  real=109        seed=44  real=110
//
// A 2-2.5x UNDER-estimate, so the list now grows as it renders — the same
// defect the 60 -> 44 change was made to fix, from the other side. The user's
// report is "occurrences are just disappearing when i scroll".
//
// No third constant is right either: 44 and 110 are both real row heights on
// this grid. So the seed is measured from the rows themselves.

export const ROW_SEED_FALLBACK = 44;   // what index.css shipped; used when nothing is measurable
export const ROW_SEED_MIN = 24;
export const ROW_SEED_MAX = 400;
const SAMPLE = 8;

/**
 * MEDIAN, not the first row and not the mean. Rows in one list legitimately
 * differ — a tracker tile and a bare task row are 44px and 110px in the same
 * board — so one sample is a coin flip and a mean is dragged by the tallest.
 */
export function rowSeedFrom(heights, fallback = ROW_SEED_FALLBACK) {
  const real = (heights || []).filter((h) => Number.isFinite(h) && h > 0);
  if (!real.length) return fallback;
  const s = [...real].sort((a, b) => a - b);
  const mid = s.length % 2
    ? s[(s.length - 1) / 2]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return Math.max(ROW_SEED_MIN, Math.min(ROW_SEED_MAX, Math.round(mid)));
}

/**
 * Measure a long list's own rows and publish the seed as `--cv-seed`.
 *
 * HONEST LIMIT: a row that is currently SKIPPED reports the placeholder height
 * rather than its real one, so a list scrolled entirely out of view measures
 * its own current guess and learns nothing. That is a no-op, not a wrong
 * answer, and the next mount or resize re-measures — whereas reading the size
 * back from a skipped row and treating it as real would launder the guess into
 * a measurement.
 */
export function applyRowSeed(el) {
  if (!el || !el.isConnected || typeof el.querySelectorAll !== "function") return null;
  const rows = el.querySelectorAll(".instance-wrap");
  if (!rows.length) return null;
  // SAMPLE ACROSS THE LIST, NOT THE FIRST N. Taking the first 8 rows made this
  // WORSE than the constant it replaced on its first live capture: the
  // diagnostic reported `seed=32px real=110px`, where 110 is the median of
  // every row and 32 was the median of the short ones that happen to sit at
  // the top. A stride costs the same number of reads and estimates the median
  // it is actually trying to estimate.
  const heights = [];
  const stride = Math.max(1, Math.floor(rows.length / SAMPLE));
  for (let i = 0; i < rows.length && heights.length < SAMPLE; i += stride) {
    const h = rows[i]?.getBoundingClientRect?.().height;
    if (h) heights.push(h);
  }
  const seed = rowSeedFrom(heights);
  el.style.setProperty("--cv-seed", `${seed}px`);
  return seed;
}
