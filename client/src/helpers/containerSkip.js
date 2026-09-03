// helpers/containerSkip.js
//
// SKIP THE 93% OF THE DOCUMENT NOBODY CAN SEE.
//
// Measured on prod at the tablet's own 820x1180 viewport, one style+layout pass
// over the whole document, median of 21:
//
//     24,218 elements · 105 containers, of which 98 are OFF SCREEN · 215 rows
//
//     baseline          158.7ms    0%
//     null_arm          154.7ms   -3%    <- an arm that changes nothing behaves
//     contain: layout   148.4ms   -6%    <- containment alone is NOT the lever
//     cv on rows         74.7ms  -53%
//     display:none       45.4ms  -71%
//     cv on containers   12.8ms  -92%
//
// That 158.7ms is the 206ms average long task the device reports during a drag,
// and it is what "only ~10% of the blocked time is our JavaScript" is made of:
// `onMove 251ms + rAF 500ms + ops 147ms` against 9,055ms blocked, with 37 rAF
// frames in twelve seconds.
//
// ── THE NAIVE VERSION BREAKS THE APP, AND THE SAFETY CHECK IS WHY THIS EXISTS
//
// `content-visibility: auto` alone, with a PICKED `contain-intrinsic-size`:
//
//     scrollHeight   18,313 -> 10,638   (-42%)
//     hit-test       35 of 48 points resolved to the same target
//
// A skipped subtree reserves whatever the seed says, so a wrong seed collapses
// the scroller and everything below it MOVES. That is 2026-08-31 (4)'s trap
// ("the seed was wrong in both directions") confirmed for containers rather
// than rows — and it would land a drop in the wrong place, silently, on live
// data.
//
// ── SO NOTHING SKIPS UNTIL IT HAS BEEN MEASURED ────────────────────────────
//
// The CSS is gated on `[data-cv-seeded]`, which is written only from the
// element's own observed size. No seed, no skipping — safe by construction
// rather than by everyone remembering to set one. Re-verified with the seed in
// place, keyed on element IDENTITY rather than class:
//
//     same ELEMENT at point   120 of 120
//     scrollHeight            18,313 -> 18,331   (0.1%)
//     scrollTop / first top   unchanged
//     layout pass             147.5ms -> 55ms    (-63%)
//
// **-63%, not -92%.** The larger figure was measured against the COLLAPSED
// document, and a shorter document is cheaper to lay out — the win was partly
// the bug. This is the honest number.

/** Written only once a real size has been observed. The CSS keys on it. */
export const CV_ATTR = "data-cv-seeded";

/**
 * Reserve exactly the space this container already occupies.
 *
 * `auto` matters: the browser then prefers the size the element had when it was
 * LAST RENDERED and falls back to ours only for one that has never rendered —
 * so the seed is a floor under the first paint, not a permanent guess.
 *
 * @returns {boolean} whether anything was written (false = already correct)
 */
export function seedIntrinsicSize(el, height) {
  if (!el || !(height > 0)) return false;
  const px = Math.round(height);
  if (el.getAttribute(CV_ATTR) === String(px)) return false;
  el.style.containIntrinsicSize = `auto ${px}px`;
  el.setAttribute(CV_ATTR, String(px));
  return true;
}

/**
 * Is this element actually being rendered right now?
 *
 * A SKIPPED element's box IS its intrinsic size, so measuring one and writing
 * the result back would ossify the seed against itself and it could never
 * correct. `getBoundingClientRect` cannot tell the two apart — it answers for a
 * skipped subtree without rendering it — which is why this asks
 * `checkVisibility` and not geometry. Older engines with no `checkVisibility`
 * report true, so they simply keep seeding, which is the pre-existing behaviour.
 */
export function isRendered(el) {
  if (!el) return false;
  if (typeof el.checkVisibility !== "function") return true;
  try { return el.checkVisibility({ contentVisibilityAuto: true }); }
  catch { return true; }   // an engine that rejects the option is not skipping
}

/**
 * The size to seed from a ResizeObserver entry.
 *
 * CONTENT box, because `contain-intrinsic-size` describes the principal box's
 * CONTENT — seeding from the border box over-reserves by padding and border on
 * every container, and 105 of those add up to a scroller that does not match
 * itself.
 */
export function heightFromEntry(entry) {
  const box = entry?.contentBoxSize?.[0];
  if (box && typeof box.blockSize === "number") return box.blockSize;
  if (entry?.contentRect && typeof entry.contentRect.height === "number") return entry.contentRect.height;
  return 0;
}

/**
 * Observe one container and keep its reserved size honest.
 * Returns a teardown. No ResizeObserver (jsdom, old engines) means no seed and
 * therefore no skipping — the feature is off rather than half on.
 */
export function observeContainerSize(el, { ResizeObserverImpl } = {}) {
  const RO = ResizeObserverImpl || (typeof ResizeObserver !== "undefined" ? ResizeObserver : null);
  if (!el || !RO) return () => {};
  const ro = new RO((entries) => {
    for (const entry of entries) {
      const target = entry.target || el;
      if (!isRendered(target)) continue;
      seedIntrinsicSize(target, heightFromEntry(entry));
    }
  });
  ro.observe(el);
  return () => { try { ro.disconnect(); } catch { /* teardown */ } };
}
