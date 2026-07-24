// Drag-over edge autoscroll math (helpers/autoscrollMath.js) — the zone/ramp/
// grace contract behind DragProvider's continuous autoscroll loop.
import { describe, test, expect } from "vitest";
import {
  autoscrollZone,
  computeAutoscroll,
  autoscrollSpeed,
  pointerNearRect,
  canScrollFurther,
  maxScrollTopFor,
  AUTOSCROLL_MIN_SPEED,
  AUTOSCROLL_MAX_SPEED,
  AUTOSCROLL_GRACE_PX,
} from "../helpers/autoscrollMath";

const rect = (top, bottom, left = 0, right = 400) => ({
  top, bottom, left, right, height: bottom - top, width: right - left,
});

describe("autoscrollZone", () => {
  test("quarter of the container height", () => {
    expect(autoscrollZone(400)).toBe(100);
  });
  test("clamped for short containers (keeps a grabbable middle)", () => {
    expect(autoscrollZone(120)).toBe(56);
  });
  test("clamped for very tall containers", () => {
    expect(autoscrollZone(2000)).toBe(150);
  });
});

describe("computeAutoscroll", () => {
  const r = rect(100, 500); // height 400 → zone 100

  test("middle of the container → no scroll", () => {
    expect(computeAutoscroll(r, 300)).toEqual({ dir: 0, intensity: 0 });
  });
  test("just inside the bottom zone → dir down, low intensity", () => {
    const { dir, intensity } = computeAutoscroll(r, 405);
    expect(dir).toBe(1);
    expect(intensity).toBeGreaterThan(0);
    expect(intensity).toBeLessThan(0.2);
  });
  test("at the very bottom edge → full intensity", () => {
    expect(computeAutoscroll(r, 500)).toEqual({ dir: 1, intensity: 1 });
  });
  test("finger PAST the bottom edge keeps max pressure (no dead zone)", () => {
    expect(computeAutoscroll(r, 540)).toEqual({ dir: 1, intensity: 1 });
  });
  test("top zone mirrors: above the rect → full up intensity", () => {
    expect(computeAutoscroll(r, 80)).toEqual({ dir: -1, intensity: 1 });
    const { dir, intensity } = computeAutoscroll(r, 195);
    expect(dir).toBe(-1);
    expect(intensity).toBeGreaterThan(0);
    expect(intensity).toBeLessThan(0.2);
  });
});

describe("autoscrollSpeed ramp", () => {
  test("zone entry crawls, edge sweeps", () => {
    expect(autoscrollSpeed(0)).toBe(AUTOSCROLL_MIN_SPEED);
    expect(autoscrollSpeed(1)).toBe(AUTOSCROLL_MAX_SPEED);
    const mid = autoscrollSpeed(0.5);
    expect(mid).toBeGreaterThan(AUTOSCROLL_MIN_SPEED);
    expect(mid).toBeLessThan(AUTOSCROLL_MAX_SPEED);
  });
  test("intensity clamped to [0,1]", () => {
    expect(autoscrollSpeed(-2)).toBe(AUTOSCROLL_MIN_SPEED);
    expect(autoscrollSpeed(9)).toBe(AUTOSCROLL_MAX_SPEED);
  });
});

describe("pointerNearRect (grace band)", () => {
  const r = rect(100, 500, 50, 350);
  test("inside the rect", () => {
    expect(pointerNearRect(r, 200, 300)).toBe(true);
  });
  test("slightly past the bottom edge — within grace", () => {
    expect(pointerNearRect(r, 200, 500 + AUTOSCROLL_GRACE_PX - 1)).toBe(true);
  });
  test("far outside — beyond grace", () => {
    expect(pointerNearRect(r, 200, 500 + AUTOSCROLL_GRACE_PX + 1)).toBe(false);
    expect(pointerNearRect(r, 50 - AUTOSCROLL_GRACE_PX - 1, 300)).toBe(false);
  });
});

describe("canScrollFurther / maxScrollTopFor", () => {
  const el = (scrollTop, scrollHeight, clientHeight, cap) => ({
    scrollTop, scrollHeight, clientHeight,
    dataset: cap != null ? { scrollMaxTop: String(cap) } : {},
  });

  test("mid-scroll can move both ways", () => {
    const e = el(100, 1000, 400);
    expect(canScrollFurther(e, 1)).toBe(true);
    expect(canScrollFurther(e, -1)).toBe(true);
  });
  test("at natural end → no further down; at 0 → no further up", () => {
    expect(canScrollFurther(el(600, 1000, 400), 1)).toBe(false);
    expect(canScrollFurther(el(0, 1000, 400), -1)).toBe(false);
  });
  test("data-scroll-max-top cap wins over the natural ceiling", () => {
    // Mobile viewport over a 2-row panel in a 3-row grid: natural max 800,
    // panel clamp 400 — the autoscroll must stop at the panel edge.
    expect(maxScrollTopFor(el(0, 1200, 400, 400))).toBe(400);
    expect(canScrollFurther(el(400, 1200, 400, 400), 1)).toBe(false);
    expect(canScrollFurther(el(200, 1200, 400, 400), 1)).toBe(true);
  });
  test("no dir or no el → false", () => {
    expect(canScrollFurther(null, 1)).toBe(false);
    expect(canScrollFurther(el(100, 1000, 400), 0)).toBe(false);
  });
});
