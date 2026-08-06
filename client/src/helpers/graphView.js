// helpers/graphView.js
// ============================================================
// PURE. The zoom/pan state of a graph surface, and the arithmetic that moves it.
// No React, no ECharts — so the whole gesture model is testable without
// rendering or touching a pointer.
//
// WHY ZOOM EXISTS AT ALL (user, 2026-08-06): "the graph should be the size of
// the container (so the size of the page), and have it be zoomable." The
// measured problem it answers: the real 128-node emotions wheel has 80 tertiary
// leaves, so at 390px each outer slice is a 14px arc — the labels collide and
// you cannot tap a specific one. Filling the container buys back what it can;
// zoom buys the rest, at any width, without a second reduced wheel and without
// changing what a click MEANS (the thing `nodeClick: false` was set to prevent).
//
// THE COORDINATE MODEL IS PERCENT, NOT PIXELS, and that is what keeps this file
// free of layout. ECharts places a radial series with `center: ["50%", "50%"]`
// and `radius: [0, "92%"]` — percentages of the host box, resolved by the chart
// itself. So a view is:
//
//   { zoom, cx, cy }   cx/cy = the series centre in PERCENT of width/height
//
// and zooming about a pointer is exact in that space, because ECharts resolves
// x-percent against width and y-percent against height exactly as the pointer
// fraction does. No dimensions are ever needed here.
//
// ZOOM-ABOUT-A-POINT is the one bit of real arithmetic. Holding the point under
// the cursor fixed means its offset from the centre must scale with the zoom:
//
//   (p - c) / z  ==  (p - c') / z'      →      c' = p - (p - c) * z'/z
//
// Anything else zooms toward the middle of the box, which feels like the chart
// is running away from the thing you are pointing at.
// ============================================================

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 12;

// The wheel is drawn at 92% of the box, so its radius is 46% — panning further
// than that per zoom step would let the whole chart leave the frame. Deriving
// the clamp from the radius means at zoom 1 the range collapses to exactly
// [50, 50]: an unzoomed chart cannot be panned off centre at all, which is why
// no separate "is panning allowed" flag is needed anywhere.
const PAN_LIMIT_PCT = 46;

export const DEFAULT_VIEW = Object.freeze({ zoom: 1, cx: 50, cy: 50 });

const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Force a view into legal range. Also the normalizer for anything stored. */
export function clampView(view) {
  const zoom = clamp(num(view?.zoom, 1), MIN_ZOOM, MAX_ZOOM);
  const span = PAN_LIMIT_PCT * (zoom - 1);
  return {
    zoom,
    cx: clamp(num(view?.cx, 50), 50 - span, 50 + span),
    cy: clamp(num(view?.cy, 50), 50 - span, 50 + span),
  };
}

export function isDefaultView(view) {
  const v = clampView(view);
  return v.zoom === 1 && v.cx === 50 && v.cy === 50;
}

/**
 * Zoom by `factor`, holding the point (fx, fy) — percent of the host box —
 * still under the pointer. Called with the box centre it behaves like a plain
 * zoom, so callers with no pointer (a button) can pass 50, 50.
 */
export function zoomAt(view, factor, fx = 50, fy = 50) {
  const cur = clampView(view);
  const f = num(factor, 1);
  if (f <= 0) return cur;
  const zoom = clamp(cur.zoom * f, MIN_ZOOM, MAX_ZOOM);
  // The RATIO of what actually happened, not what was asked: at the clamp the
  // requested factor is not applied, and using it anyway would slide the chart
  // sideways while the zoom stood still.
  const applied = zoom / cur.zoom;
  const px = num(fx, 50);
  const py = num(fy, 50);
  return clampView({
    zoom,
    cx: px - (px - cur.cx) * applied,
    cy: py - (py - cur.cy) * applied,
  });
}

/** Drag the chart by a delta expressed in percent of the host box. */
export function panBy(view, dxPct, dyPct) {
  const cur = clampView(view);
  return clampView({
    zoom: cur.zoom,
    cx: cur.cx + num(dxPct, 0),
    cy: cur.cy + num(dyPct, 0),
  });
}

// A wheel notch is ~100px in a mouse and a few px on a trackpad, so the factor
// is exponential in the delta rather than linear — one model covers both, and
// no accumulation of small deltas can overshoot.
const WHEEL_SENSITIVITY = 0.0016;
export function wheelFactor(deltaY) {
  return Math.exp(-num(deltaY, 0) * WHEEL_SENSITIVITY);
}

/** Two-finger pinch: the ratio of finger distances IS the zoom factor. */
export function pinchFactor(prevDistance, distance) {
  const a = num(prevDistance, 0);
  const b = num(distance, 0);
  if (a <= 0 || b <= 0) return 1;
  return b / a;
}

/** Distance between two pointer positions — the pinch gesture's only input. */
export function distanceBetween(a, b) {
  const dx = num(a?.x, 0) - num(b?.x, 0);
  const dy = num(a?.y, 0) - num(b?.y, 0);
  return Math.hypot(dx, dy);
}
