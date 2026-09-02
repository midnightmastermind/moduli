/**
 * OFF-SCREEN PANELS DO NOT MOUNT THEIR ROWS.
 *
 * The measurement that chose this shape (prod, 820x1180, 6x throttle, one rail
 * tap, median of 3):
 *
 *     arm                     rows shown   paint    whole tap
 *     baseline                       195   457.7        1860
 *     null_arm                       195   443.0        2015
 *     offscreen_panels_only           54   258.5        1429   <- this rule
 *     window_viewport_600             45   285.2        1451
 *     rows_none (the CEILING)          0   187.0         990
 *
 * The two middle arms are the same result, so the per-row viewport window is
 * pure risk — and the risk is the 2026-08-04 per-row `content-visibility`
 * defect, which made mobile scroll 40x worse. What is pinned here is therefore
 * the SHAPE: coarse (per panel), and every case where hiding would blank
 * something the user can actually see.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  panelCoversCell,
  shouldHidePanelRows,
  publishPanelRowsHidden,
  usePanelRowsHidden,
  enableOffscreenRows,
  _resetOffscreenRows,
} from "../helpers/offscreenRows.js";
import { RENDER_ALL_EVENT } from "../helpers/renderWindow.js";

beforeEach(() => { _resetOffscreenRows(); enableOffscreenRows(true); });

const P = (row, col, width = 1, height = 1) => ({ row, col, width, height });
const MOBILE = { isMobileLayout: true, zoomedOut: false };

describe("panelCoversCell — spans count", () => {
  it("covers its own cell", () => {
    expect(panelCoversCell(P(1, 2), { row: 1, col: 2 })).toBe(true);
    expect(panelCoversCell(P(1, 2), { row: 0, col: 2 })).toBe(false);
  });

  it("a 2-high panel is on screen from EITHER of its cells", () => {
    const tall = P(0, 1, 1, 2);
    expect(panelCoversCell(tall, { row: 0, col: 1 })).toBe(true);
    expect(panelCoversCell(tall, { row: 1, col: 1 })).toBe(true);
    expect(panelCoversCell(tall, { row: 2, col: 1 })).toBe(false);
  });

  it("keeps a placement-less panel mounted rather than guessing", () => {
    // An unknown placement must fail toward rendering: a blank panel is worse
    // than a slow one.
    expect(panelCoversCell(null, { row: 3, col: 3 })).toBe(true);
    expect(panelCoversCell(P(0, 0), null)).toBe(true);
  });
});

describe("shouldHidePanelRows — every 'no' is a case the user can see", () => {
  it("hides the rows of a panel that is not the active cell", () => {
    expect(shouldHidePanelRows(P(0, 1), { row: 0, col: 0 }, MOBILE)).toBe(true);
  });

  it("never hides the ACTIVE panel", () => {
    expect(shouldHidePanelRows(P(0, 0), { row: 0, col: 0 }, MOBILE)).toBe(false);
  });

  it("never hides on desktop — every panel is laid out at once there", () => {
    expect(shouldHidePanelRows(P(0, 1), { row: 0, col: 0 },
      { isMobileLayout: false, zoomedOut: false })).toBe(false);
  });

  it("never hides while ZOOMED OUT — that map is the thing being chosen from", () => {
    expect(shouldHidePanelRows(P(0, 1), { row: 0, col: 0 },
      { isMobileLayout: true, zoomedOut: true })).toBe(false);
  });

  it("is inert until enabled, and `window.__offscreenRows` overrides both ways", () => {
    _resetOffscreenRows();                                  // disabled
    expect(shouldHidePanelRows(P(0, 1), { row: 0, col: 0 }, MOBILE)).toBe(false);
    window.__offscreenRows = true;
    expect(shouldHidePanelRows(P(0, 1), { row: 0, col: 0 }, MOBILE)).toBe(true);
    window.__offscreenRows = false;
    enableOffscreenRows(true);
    expect(shouldHidePanelRows(P(0, 1), { row: 0, col: 0 }, MOBILE)).toBe(false);
  });
});

describe("the store — containers subscribe by panel id", () => {
  it("reports only the panel that was published", () => {
    const a = renderHook(() => usePanelRowsHidden("A"));
    const b = renderHook(() => usePanelRowsHidden("B"));
    act(() => publishPanelRowsHidden("A", true));
    expect(a.result.current).toBe(true);
    expect(b.result.current).toBe(false);   // the control
    act(() => publishPanelRowsHidden("A", false));
    expect(a.result.current).toBe(false);
  });

  it("a container with no panel id renders its rows", () => {
    const { result } = renderHook(() => usePanelRowsHidden(undefined));
    act(() => publishPanelRowsHidden("A", true));
    expect(result.current).toBe(false);
  });
});

describe("the search escape hatch — an unmounted row must not become a lie", () => {
  it("`moduli:render-all` un-hides every panel", () => {
    // jumpToOccurrence finds an occurrence by DOM query and reports "filtered
    // out" on a miss. Without this, searching into an off-screen panel would
    // say the row does not exist. Same event renderWindow answers.
    const { result } = renderHook(() => usePanelRowsHidden("A"));
    act(() => publishPanelRowsHidden("A", true));
    expect(result.current).toBe(true);
    act(() => window.dispatchEvent(new CustomEvent(RENDER_ALL_EVENT)));
    expect(result.current).toBe(false);
  });

  it("the next cell switch takes the pin back off", () => {
    // Otherwise one search would keep every row on the grid mounted forever,
    // which is the whole cost this is removing.
    const { result } = renderHook(() => usePanelRowsHidden("A"));
    act(() => publishPanelRowsHidden("A", true));
    act(() => window.dispatchEvent(new CustomEvent(RENDER_ALL_EVENT)));
    expect(result.current).toBe(false);
    act(() => publishPanelRowsHidden("B", true));    // the grid moved
    expect(result.current).toBe(true);
  });
});
