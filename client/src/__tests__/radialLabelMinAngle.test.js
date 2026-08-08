// Sunburst labels on a phone (2026-08-08).
//
// The emotions wheel's outer ring is 80 tertiary leaves at ~4.5deg each. At a
// 390px viewport that is ~14px of arc per label, and because the labels are
// `rotate: "radial"` the constraint is the label's THICKNESS — a 10px font in
// 14px of arc collides with its neighbours.
//
// `minAngle` hides a label whose slice is narrower than N degrees. It was a
// fixed 1, deliberately low after `minAngle: 8` blanked ALL 80 outer labels on
// 2026-08-06 while every metric said the chart was fine. A fixed number cannot
// be right: the same 4.5deg slice is 14px of arc on a phone and 40px on a
// desktop, and 170px at 12x zoom.
//
// So the threshold is derived from a READABLE ARC LENGTH IN PIXELS, which makes
// it viewport-aware by construction AND makes zoom reveal labels rather than
// just enlarge them.
//
//   arc = 2*pi*r * (deg/360)   ->   deg = minArcPx * 360 / (2*pi*r)
//
// r is in PIXELS, which is the whole reason the host box has to be threaded in:
// the series radius is a PERCENT and ECharts resolves it against
// min(width, height) / 2.

import { describe, it, expect } from "vitest";
import { radialLabelMinAngle, LABEL_MIN_ARC_PX } from "../helpers/graphOption.js";

// r for a square box: (radiusPct/100) * zoom * min(w,h)/2
const rFor = (box, pct, zoom = 1) => (pct / 100) * zoom * (box / 2);
const expected = (box, pct, zoom = 1, arc = LABEL_MIN_ARC_PX) =>
  (arc * 360) / (2 * Math.PI * rFor(box, pct, zoom));

describe("radialLabelMinAngle — falls back rather than guessing", () => {
  // Every existing caller and every unit test passes no box. They must keep
  // today's chart exactly, so "no box" is null and the caller uses its fixed 1.
  it("returns null when the host box is unknown", () => {
    expect(radialLabelMinAngle({ radiusPct: 92 })).toBe(null);
    expect(radialLabelMinAngle({ boxPx: null, radiusPct: 92 })).toBe(null);
    expect(radialLabelMinAngle({ boxPx: { width: 0, height: 0 }, radiusPct: 92 })).toBe(null);
  });

  it("returns null for a nonsense radius", () => {
    expect(radialLabelMinAngle({ boxPx: { width: 400, height: 400 }, radiusPct: 0 })).toBe(null);
  });
});

describe("radialLabelMinAngle — the geometry", () => {
  it("derives the angle that fits one readable label", () => {
    const got = radialLabelMinAngle({ boxPx: { width: 400, height: 400 }, radiusPct: 92 });
    expect(got).toBeCloseTo(expected(400, 92), 5);
  });

  // ECharts resolves a percent radius against the SMALLER dimension, so a wide
  // short box is governed by its height. Getting this wrong makes every
  // landscape chart hide labels it had room for.
  it("uses the smaller dimension of a non-square box", () => {
    const wide = radialLabelMinAngle({ boxPx: { width: 1200, height: 400 }, radiusPct: 92 });
    expect(wide).toBeCloseTo(expected(400, 92), 5);
  });

  it("a bigger box needs a smaller angle", () => {
    const small = radialLabelMinAngle({ boxPx: { width: 390, height: 390 }, radiusPct: 92 });
    const big = radialLabelMinAngle({ boxPx: { width: 1400, height: 1400 }, radiusPct: 92 });
    expect(big).toBeLessThan(small);
  });

  // The composition the fixed number could never have: zooming in grows r, so
  // the threshold falls and labels APPEAR. On a phone that is how you read the
  // outer ring at all.
  it("doubling the zoom halves the required angle", () => {
    const at1 = radialLabelMinAngle({ boxPx: { width: 390, height: 390 }, radiusPct: 92, zoom: 1 });
    const at2 = radialLabelMinAngle({ boxPx: { width: 390, height: 390 }, radiusPct: 92, zoom: 2 });
    expect(at2).toBeCloseTo(at1 / 2, 5);
  });

  // The concrete case from the report: 80 tertiary leaves are 4.5deg. On a
  // phone they must be hidden (they collide); zoomed in they must come back.
  it("hides the 4.5deg outer ring on a phone and restores it under zoom", () => {
    const box = { width: 390, height: 390 };
    expect(radialLabelMinAngle({ boxPx: box, radiusPct: 92, zoom: 1 })).toBeGreaterThan(4.5);
    expect(radialLabelMinAngle({ boxPx: box, radiusPct: 92, zoom: 4 })).toBeLessThan(4.5);
  });

  // THE 2026-08-06 DISASTER, as a guard: minAngle applies to the WHOLE series,
  // so an unclamped value on a tiny box would blank the 8 primary slices (45deg
  // each) too — "a wheel you cannot read is a wheel you cannot pick from".
  it("never rises far enough to blank the primary ring", () => {
    for (const box of [40, 80, 120, 200, 390]) {
      const got = radialLabelMinAngle({ boxPx: { width: box, height: box }, radiusPct: 92 });
      expect(got).toBeLessThan(45);
    }
  });
});
