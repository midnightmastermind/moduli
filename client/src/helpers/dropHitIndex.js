// helpers/dropHitIndex.js
// ============================================================
// THE DRAG HIT-TEST, WITHOUT ASKING THE BROWSER.
//
// `_findDropTarget` calls `document.elementsFromPoint` on every hit-test.
// Measured on the user's tablet after the other drag fixes landed, it is the
// single largest attributable during-drag cost:
//
//     hit avg=12.9-13.6ms  x ~130-180 calls  =  ~2s of a 12-18s drag
//     raf avg=13.3ms                            i.e. the rAF IS the hit-test
//
// It is proportional to the document, not to the number of drop points: 21,454
// nodes here, and the same call costs 0.6ms on Firefox against 17-30ms on
// Chrome — the same engine split every other forced-layout finding this week
// has shown.
//
// **AND THE CHEAP VERSION OF THIS FIX IS DEAD, MEASURED RATHER THAN ASSUMED.**
// `elementFromPoint` (singular) looked 1,616x cheaper than the plural on a
// 21,006-node synthetic document — but that was a repeated hit-test at ONE
// point being served from a cache. Jittered coordinates, which is what a drag
// actually does, put it at **1.1x**. A ten-percent fix, shipped on an artifact.
//
// ── WHAT THIS DOES INSTEAD ─────────────────────────────────────────────────
//
// Every drop target is already in a registry. Their rects are read ONCE per
// drag (one forced layout, then N cheap reads), and a hit-test becomes an
// array scan of a few hundred rectangles — arithmetic, no layout, no engine.
//
// ── WHY IT IS ALLOWED TO BE WRONG, AND WHAT HAPPENS WHEN IT IS ─────────────
//
// A rect index cannot see everything the engine sees: z-index, clipping by a
// scrolled ancestor, `pointer-events`, transforms. So it is a FAST PATH, never
// the authority:
//
//   * a HIT is returned only when the index is confident (see `findAt`)
//   * a MISS falls through to `document.elementsFromPoint`, unchanged
//   * anything that could move the rects marks the index stale, and a stale
//     index answers nothing until it is rebuilt
//
// The failure mode that matters is a WRONG hit, not a miss — a drop landing in
// the wrong container is data damage, and this repo's log is emphatic that the
// drop path is where it has been damaged before. So `findAt` returns a hit
// only when exactly one candidate is deepest; ANY ambiguity defers to the
// engine rather than guessing between two overlapping targets.
// ============================================================

/** Depth of `el` from the document root — the tiebreak "innermost wins". */
export function domDepth(el) {
  let d = 0;
  let n = el;
  while (n && n.parentElement) { d++; n = n.parentElement; }
  return d;
}

/**
 * Snapshot every registered target's rect.
 *
 * `entries` is `[el, config]` pairs (a Map's iterator works directly). Reading
 * the first rect forces one layout; the rest are free because layout is then
 * clean — which is the whole reason this is worth doing once per drag instead
 * of per move.
 *
 * Zero-area targets are dropped: they can never contain a point, and keeping
 * them only makes the scan longer.
 */
export function buildHitIndex(entries, { rectOf } = {}) {
  const read = rectOf || ((el) => el.getBoundingClientRect());
  const out = [];
  for (const [el, config] of entries) {
    let r;
    try { r = read(el); } catch { continue; }
    if (!r || r.width <= 0 || r.height <= 0) continue;
    out.push({
      el, config, depth: domDepth(el),
      left: r.left, top: r.top, right: r.right, bottom: r.bottom,
    });
  }
  return out;
}

/**
 * The deepest registered target containing (x, y) that accepts `dragType`.
 *
 * Returns `{ el, config }` on a confident hit, or `null` — and null MUST be
 * read as "ask the engine", never as "there is no drop target here".
 *
 * `sourceEl` (the thing being dragged) is skipped, matching the engine walk,
 * which steps over it and keeps climbing.
 *
 * AMBIGUITY DEFERS. Two accepting targets at the same depth both containing
 * the point cannot be ordered without the paint order the engine has and this
 * does not. Picking either would be a coin flip on which container a drop
 * lands in, so it returns null and the engine decides.
 */
export function findAt(index, x, y, dragType, sourceEl) {
  let best = null;
  let bestDepth = -1;
  let tied = false;
  for (const c of index) {
    if (x < c.left || x > c.right || y < c.top || y > c.bottom) continue;
    if (c.el === sourceEl) continue;
    const accepts = c.config?.acceptsRef?.current;
    if (accepts && accepts.length > 0 && !accepts.includes(dragType)) continue;
    if (c.depth > bestDepth) { best = c; bestDepth = c.depth; tied = false; }
    else if (c.depth === bestDepth && c.el !== best?.el) { tied = true; }
  }
  if (!best || tied) return null;
  return { el: best.el, config: best.config };
}
