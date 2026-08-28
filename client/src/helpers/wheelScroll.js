// helpers/wheelScroll.js
// ============================================================
// THE SCROLL WHEEL MOVES FURTHER PER NOTCH. Nothing else changes.
//
// User, 2026-08-28: *"could you make normal scroll (with the scroll wheel or
// just swiping, NOT DRAG SCROLL SPEED), faster"* — i.e. reading a long board,
// not the autoscroll that runs while you are dragging something
// (`helpers/autoscrollMath.js`, which is deliberately untouched here).
//
// ── MEASURED FIRST: NOTHING WAS SLOWING IT DOWN ────────────────────────────
//
// No `scroll-behavior` anywhere in the app, and no wheel listener outside
// `EChart` (which owns its own zoom gesture). Scrolling is entirely native, so
// there is no brake to release — the only lever is to move further per notch.
//
// ── THE TRACKPAD IS DELIBERATELY LEFT ALONE, and that is the whole risk ─────
//
// A mouse wheel arrives as a few big discrete notches; a trackpad arrives as a
// stream of small deltas that already track your fingers 1:1 and carry OS
// momentum. Multiplying the first is what "faster" means. Multiplying the
// second makes every gesture overshoot — the scroll would leap on a
// one-centimetre swipe and the momentum tail would fling the page.
//
// So `isPreciseScroll` splits them, and `PRECISE_SPEED` is **1 by default —
// off**. It exists as a named number rather than a hardcoded `1` so turning it
// on is a one-line change if the user wants it, without anyone having to
// re-derive which branch is which.
//
// The split is conservative in the direction that matters: anything ambiguous
// is treated as PRECISE and left at native speed. Being wrong that way means
// "no change"; being wrong the other way means an unusable trackpad.
//
//     deltaMode 1 or 2 (LINE / PAGE)      -> wheel      (Firefox mouse wheel)
//     deltaMode 0, integer, |dy| >= 40    -> wheel      (Chrome ~100/notch)
//     everything else                     -> precise    (leave native)
//
// ── TOUCH SWIPING IS NOT ADDRESSED, and cannot be from here ────────────────
//
// A finger swipe never produces a wheel event: it is native scrolling with
// OS-owned momentum and rubber-banding. The only way to amplify it is to
// preventDefault every `touchmove` and drive `scrollTop` by hand, which
// **removes the flick entirely** — you would get 1:1 dragging with no inertia,
// which is slower to use, not faster. Stated rather than attempted.
//
// ── IT ONLY ACTS WHEN IT CAN DO THE WHOLE JOB ──────────────────────────────
//
// `preventDefault` is called only after a scrollable ancestor that can actually
// MOVE in this direction has been found. At the end of a list, over a
// non-scrolling region, or on a chart that already handled the event, the
// browser keeps the gesture — including scroll chaining to the page, which a
// blanket preventDefault would silently kill.
// ============================================================

/** How much further a mouse-wheel notch travels. One number; tune to taste. */
export const WHEEL_SPEED = 2.5;

/**
 * Trackpad / precision-scroll multiplier. **1 = unchanged, and that is
 * deliberate** — see the header. Raise it only if the user asks for it.
 */
export const PRECISE_SPEED = 1;

/** A wheel notch reported in LINES has to become pixels somehow. */
export const LINE_HEIGHT_PX = 16;

/** Below this, a pixel-mode delta is a trackpad rather than a notch. */
export const WHEEL_MIN_NOTCH_PX = 40;

/**
 * Is this a precision device (trackpad, precision mouse) rather than a notched
 * wheel? PURE. Ambiguous input answers TRUE — see the header for why that
 * asymmetry is the safe direction.
 */
export function isPreciseScroll(e) {
  if (!e) return true;
  // LINE / PAGE modes are only ever produced by a notched wheel.
  if (e.deltaMode !== 0) return false;
  const dy = Math.abs(e.deltaY || 0);
  const dx = Math.abs(e.deltaX || 0);
  // A fractional delta is a trackpad reporting sub-pixel finger movement.
  if (!Number.isInteger(e.deltaY) || !Number.isInteger(e.deltaX)) return true;
  // Real two-axis movement at once is a trackpad; a wheel is one axis.
  if (dx > 0 && dy > 0) return true;
  return Math.max(dx, dy) < WHEEL_MIN_NOTCH_PX;
}

/**
 * The event's delta in PIXELS, whatever unit it arrived in. PURE.
 * `pageHeight`/`pageWidth` are only consulted for DOM_DELTA_PAGE.
 */
export function wheelDeltaPx(e, { pageHeight = 0, pageWidth = 0 } = {}) {
  const dx = e?.deltaX || 0;
  const dy = e?.deltaY || 0;
  if (e?.deltaMode === 1) return { dx: dx * LINE_HEIGHT_PX, dy: dy * LINE_HEIGHT_PX };
  if (e?.deltaMode === 2) return { dx: dx * (pageWidth || 0), dy: dy * (pageHeight || 0) };
  return { dx, dy };
}

/**
 * The scaled delta this event should scroll by. PURE — the whole speed decision
 * in one testable function.
 */
export function scaledWheelDelta(e, opts = {}) {
  const { dx, dy } = wheelDeltaPx(e, opts);
  const speed = isPreciseScroll(e) ? PRECISE_SPEED : WHEEL_SPEED;
  return { dx: dx * speed, dy: dy * speed, speed };
}

/** Can this element still move in the requested direction? PURE given the element. */
export function canScroll(el, dx, dy) {
  if (!el) return false;
  const EPS = 1;
  if (dy < 0 && el.scrollTop > EPS) return true;
  if (dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - EPS) return true;
  if (dx < 0 && el.scrollLeft > EPS) return true;
  if (dx > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - EPS) return true;
  return false;
}

/**
 * The nearest ancestor that would take this scroll.
 *
 * Deliberately NOT the same predicate as `MobileGridNav`'s private
 * `findScrollableAncestor`, which asks "is this scrollable at all" for a drag
 * gesture. Here it must also be able to move in THIS direction, so the walk
 * continues past a list already at its end — which is what makes scroll
 * chaining keep working.
 */
export function scrollableFor(startEl, dx, dy, stopAt = null) {
  let node = startEl;
  while (node && node !== stopAt && node.nodeType === 1) {
    if (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1) {
      const st = getComputedStyle(node);
      const scrolls = (v) => v === "auto" || v === "scroll" || v === "overlay";
      if ((scrolls(st.overflowY) || scrolls(st.overflowX)) && canScroll(node, dx, dy)) return node;
    }
    node = node.parentElement;
  }
  return null;
}

/** A focused form control owns its own wheel behaviour (number inputs step on wheel). */
function overFocusedControl(target) {
  const el = target?.closest?.("input, textarea, select");
  return !!el && document.activeElement === el;
}

/**
 * Install the faster wheel. Returns a cleanup.
 *
 * `passive: false` because it must be able to `preventDefault` — and it is
 * registered on the document in the BUBBLE phase so anything that owns its own
 * wheel gesture (the chart's zoom) has already run and marked the event.
 */
export function installFastWheel(target = document) {
  const onWheel = (e) => {
    if (e.defaultPrevented) return;      // someone else owns this gesture
    if (e.ctrlKey) return;               // pinch-zoom / browser zoom
    if (overFocusedControl(e.target)) return;

    const { dx, dy, speed } = scaledWheelDelta(e, {
      pageHeight: window.innerHeight,
      pageWidth: window.innerWidth,
    });
    if (speed === 1) return;             // nothing to add — leave it native
    if (!dx && !dy) return;

    const el = scrollableFor(e.target, dx, dy);
    if (!el) return;                     // let the browser chain it out

    e.preventDefault();
    el.scrollBy({ left: dx, top: dy, behavior: "instant" });
  };

  target.addEventListener("wheel", onWheel, { passive: false });
  return () => target.removeEventListener("wheel", onWheel);
}
