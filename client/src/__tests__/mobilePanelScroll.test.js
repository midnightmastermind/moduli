// Multicell panel native-scroll helpers (mobile/MobileGridNav.jsx) — the
// clamp/anchor math behind "a 2-high panel scrolls continuously, cell snapping
// only crosses panels" (user 2026-07-24).
import { describe, test, expect } from "vitest";
import {
  panelScrollMax,
  nearestSubCell,
  isViewportAtPanelEnd,
} from "../mobile/MobileGridNav.jsx";

const VP = { W: 390, H: 700 };
const viewport = (scrollTop, scrollLeft = 0) => ({
  scrollTop, scrollLeft, clientWidth: VP.W, clientHeight: VP.H,
});

describe("panelScrollMax", () => {
  test("2-row panel scrolls exactly one extra viewport height", () => {
    expect(panelScrollMax({ row: 0, col: 1, width: 1, height: 2 }, VP.W, VP.H))
      .toEqual({ maxTop: VP.H, maxLeft: 0 });
  });
  test("single-cell panel has no scroll range", () => {
    expect(panelScrollMax({ row: 0, col: 0, width: 1, height: 1 }, VP.W, VP.H))
      .toEqual({ maxTop: 0, maxLeft: 0 });
  });
  test("2x2 panel scrolls both axes", () => {
    expect(panelScrollMax({ row: 1, col: 0, width: 2, height: 2 }, VP.W, VP.H))
      .toEqual({ maxTop: VP.H, maxLeft: VP.W });
  });
});

describe("nearestSubCell", () => {
  const panel = { row: 0, col: 1, width: 1, height: 2 };
  test("top of the panel → top sub-row", () => {
    expect(nearestSubCell(panel, 0, 0, VP.W, VP.H)).toEqual({ row: 0, col: 1 });
  });
  test("scrolled past halfway → bottom sub-row", () => {
    expect(nearestSubCell(panel, VP.H * 0.6, 0, VP.W, VP.H)).toEqual({ row: 1, col: 1 });
  });
  test("under halfway stays on the top sub-row", () => {
    expect(nearestSubCell(panel, VP.H * 0.4, 0, VP.W, VP.H)).toEqual({ row: 0, col: 1 });
  });
  test("clamped into the panel's span", () => {
    expect(nearestSubCell(panel, VP.H * 5, 0, VP.W, VP.H)).toEqual({ row: 1, col: 1 });
  });
  test("offset panel origin is respected", () => {
    const p = { row: 1, col: 2, width: 2, height: 1 };
    expect(nearestSubCell(p, 0, VP.W * 0.8, VP.W, VP.H)).toEqual({ row: 1, col: 3 });
  });
});

describe("isViewportAtPanelEnd (overscroll-nav gate)", () => {
  const panel = { row: 0, col: 1, width: 1, height: 2 };
  test("mid-scroll: not at either end → no cell-snap nav", () => {
    const vp = viewport(VP.H / 2);
    expect(isViewportAtPanelEnd(vp, panel, "down")).toBe(false);
    expect(isViewportAtPanelEnd(vp, panel, "up")).toBe(false);
  });
  test("at the clamp bottom → crossing down is allowed", () => {
    expect(isViewportAtPanelEnd(viewport(VP.H), panel, "down")).toBe(true);
  });
  test("at the top → crossing up is allowed", () => {
    expect(isViewportAtPanelEnd(viewport(0), panel, "up")).toBe(true);
  });
  test("horizontal axis mirrors", () => {
    const wide = { row: 0, col: 0, width: 2, height: 1 };
    expect(isViewportAtPanelEnd(viewport(0, 0), wide, "left")).toBe(true);
    expect(isViewportAtPanelEnd(viewport(0, VP.W / 2), wide, "right")).toBe(false);
    expect(isViewportAtPanelEnd(viewport(0, VP.W), wide, "right")).toBe(true);
  });
  test("no viewport → permissive (matches isAtScrollBoundary's null contract)", () => {
    expect(isViewportAtPanelEnd(null, panel, "down")).toBe(true);
  });
});
