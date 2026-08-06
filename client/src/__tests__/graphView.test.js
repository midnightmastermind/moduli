// helpers/graphView — the zoom/pan state of a graph surface.
//
// The properties that matter are geometric, so they are asserted as geometry:
// a zoom about a point must LEAVE THAT POINT ALONE, and an unzoomed chart must
// not be draggable off centre. Both are the kind of thing that reads fine in
// source and is wrong by a factor of the zoom.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_VIEW, MIN_ZOOM, MAX_ZOOM,
  clampView, isDefaultView, zoomAt, panBy,
  wheelFactor, pinchFactor, distanceBetween,
} from "../helpers/graphView";

describe("clampView", () => {
  it("normalizes junk to the default view", () => {
    expect(clampView(null)).toEqual({ zoom: 1, cx: 50, cy: 50 });
    expect(clampView({ zoom: "wat", cx: NaN })).toEqual({ zoom: 1, cx: 50, cy: 50 });
  });

  it("holds zoom inside its range", () => {
    expect(clampView({ zoom: 0.01 }).zoom).toBe(MIN_ZOOM);
    expect(clampView({ zoom: 9999 }).zoom).toBe(MAX_ZOOM);
  });

  it("AT ZOOM 1 THE CENTRE CANNOT MOVE — the pan range collapses to a point", () => {
    // This is what makes "panning is only possible once zoomed" fall out of the
    // geometry instead of needing a flag anyone could forget to check.
    expect(clampView({ zoom: 1, cx: 10, cy: 90 })).toEqual({ zoom: 1, cx: 50, cy: 50 });
  });

  it("widens the pan range as zoom grows", () => {
    const v = clampView({ zoom: 2, cx: -999, cy: 999 });
    expect(v.cx).toBe(4);    // 50 - 46*(2-1)
    expect(v.cy).toBe(96);   // 50 + 46*(2-1)
  });
});

describe("zoomAt", () => {
  it("keeps the point under the pointer FIXED", () => {
    // The whole reason this function is not `zoom *= factor`. Zooming 3x about
    // the point 25% across must leave that point at 25% across.
    const before = DEFAULT_VIEW;
    const after = zoomAt(before, 3, 25, 25);
    // A point p sits at (p - c)/z in chart space; after the zoom the SAME chart
    // position must map back to the same screen percent.
    const chartPosBefore = (25 - before.cx) / before.zoom;
    const chartPosAfter = (25 - after.cx) / after.zoom;
    expect(chartPosAfter).toBeCloseTo(chartPosBefore, 10);
  });

  it("zooms about the box centre when given no pointer", () => {
    const v = zoomAt(DEFAULT_VIEW, 2);
    expect(v).toEqual({ zoom: 2, cx: 50, cy: 50 });
  });

  it("does not slide the chart when the zoom is CLAMPED", () => {
    // Asking for 100x at the ceiling applies no zoom, so it must apply no pan
    // either — using the requested factor here drifts the chart sideways while
    // the zoom stands still.
    const atMax = zoomAt(DEFAULT_VIEW, MAX_ZOOM, 50, 50);
    const again = zoomAt(atMax, 100, 10, 10);
    expect(again.zoom).toBe(MAX_ZOOM);
    expect(again.cx).toBe(atMax.cx);
    expect(again.cy).toBe(atMax.cy);
  });

  it("returns exactly to centre when zoomed back out to 1", () => {
    const zoomed = zoomAt(DEFAULT_VIEW, 4, 10, 90);
    const back = zoomAt(zoomed, 1 / 4, 10, 90);
    expect(back).toEqual({ zoom: 1, cx: 50, cy: 50 });
    expect(isDefaultView(back)).toBe(true);
  });

  it("ignores a nonsense factor rather than producing a broken view", () => {
    expect(zoomAt(DEFAULT_VIEW, 0)).toEqual({ zoom: 1, cx: 50, cy: 50 });
    expect(zoomAt(DEFAULT_VIEW, -2)).toEqual({ zoom: 1, cx: 50, cy: 50 });
  });
});

describe("panBy", () => {
  it("moves the centre by the delta once zoomed", () => {
    const v = panBy({ zoom: 3, cx: 50, cy: 50 }, 10, -10);
    expect(v).toEqual({ zoom: 3, cx: 60, cy: 40 });
  });

  it("refuses to drag an unzoomed chart off centre", () => {
    expect(panBy(DEFAULT_VIEW, 40, 40)).toEqual({ zoom: 1, cx: 50, cy: 50 });
  });

  it("clamps a pan that would push the chart out of frame", () => {
    const v = panBy({ zoom: 2, cx: 50, cy: 50 }, 500, 0);
    expect(v.cx).toBe(96);
  });
});

describe("gesture inputs", () => {
  it("wheel up zooms IN and wheel down zooms OUT", () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(0)).toBe(1);
  });

  it("a wheel notch is a usable step, not a jump", () => {
    // Guards the sensitivity constant: one notch should be a noticeable but
    // controllable move, not a leap across the zoom range.
    const f = wheelFactor(-100);
    expect(f).toBeGreaterThan(1.05);
    expect(f).toBeLessThan(1.4);
  });

  it("pinch factor is the ratio of finger distances", () => {
    expect(pinchFactor(100, 200)).toBe(2);
    expect(pinchFactor(200, 100)).toBe(0.5);
  });

  it("a degenerate pinch is a no-op instead of an infinity", () => {
    expect(pinchFactor(0, 100)).toBe(1);
    expect(pinchFactor(100, 0)).toBe(1);
  });

  it("measures pointer distance", () => {
    expect(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});
