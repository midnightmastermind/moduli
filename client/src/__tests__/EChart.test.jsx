// ui/EChart — the ECharts wrapper's LIFECYCLE contract.
//
// ECharts is MOCKED here on purpose. A jsdom canvas proves nothing about a
// chart — the picture is a browser harness's job. What this file protects is
// the thing that actually breaks in production and is invisible on screen: a
// leaked instance keeps a canvas AND a resize listener alive, so every early
// return and every effect re-run must dispose.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

const init = vi.fn();
const setOption = vi.fn();
const dispose = vi.fn();
const resize = vi.fn();
const on = vi.fn();
const use = vi.fn();

vi.mock("echarts/core", () => ({ init: (...a) => init(...a), use: (...a) => use(...a) }));
vi.mock("echarts/charts", () => ({ SunburstChart: {}, PieChart: {}, BarChart: {}, LineChart: {} }));
vi.mock("echarts/components", () => ({ TooltipComponent: {}, LegendComponent: {}, GridComponent: {} }));
vi.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

import EChart, { normalizeSelect } from "../ui/EChart";

const OPTION = { series: [{ type: "pie", data: [] }] };
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  [init, setOption, dispose, resize, on, use].forEach(f => f.mockClear());
  init.mockReturnValue({ setOption, dispose, resize, on });
  globalThis.ResizeObserver = class {
    constructor(cb) { this.cb = cb; }
    observe() {} disconnect() {}
  };
});
afterEach(cleanup);

describe("EChart lifecycle", () => {
  it("inits once, applies the option, and registers a click handler", async () => {
    render(<EChart option={OPTION} onSelect={vi.fn()} />);
    await flush();
    expect(init).toHaveBeenCalledTimes(1);
    expect(setOption).toHaveBeenCalledWith(OPTION, { notMerge: true });
    expect(on).toHaveBeenCalledWith("click", expect.any(Function));
  });

  it("uses notMerge so switching CHART TYPE cannot leave the old one behind", async () => {
    const { rerender } = render(<EChart option={OPTION} />);
    await flush();
    const next = { series: [{ type: "bar", data: [] }] };
    rerender(<EChart option={next} />);
    expect(setOption).toHaveBeenLastCalledWith(next, { notMerge: true });
    expect(setOption.mock.calls.every(c => c[1]?.notMerge === true)).toBe(true);
  });

  it("DISPOSES on unmount — a leaked instance keeps a canvas and a listener alive", async () => {
    const { unmount } = render(<EChart option={OPTION} />);
    await flush();
    expect(dispose).not.toHaveBeenCalled();
    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("does NOT init when unmounted while the chunk is still in flight", async () => {
    const { unmount } = render(<EChart option={OPTION} />);
    unmount();               // before the dynamic import resolves
    await flush();
    expect(init).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();  // nothing was created, nothing to dispose
  });

  it("does not re-init when only the handler identity changes", async () => {
    const { rerender } = render(<EChart option={OPTION} onSelect={() => {}} />);
    await flush();
    rerender(<EChart option={OPTION} onSelect={() => {}} />);
    await flush();
    expect(init).toHaveBeenCalledTimes(1);
  });

  it("calls the LATEST onSelect, normalized", async () => {
    const stale = vi.fn();
    const fresh = vi.fn();
    const { rerender } = render(<EChart option={OPTION} onSelect={stale} />);
    await flush();
    rerender(<EChart option={OPTION} onSelect={fresh} />);
    const handler = on.mock.calls.find(c => c[0] === "click")[1];
    act(() => handler({ name: "Annoyed", value: 1, seriesName: "s", data: { occurrenceId: "occ-c" },
                        treePathInfo: [{ name: "" }, { name: "Angry" }, { name: "Annoyed" }] }));
    expect(stale).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledWith(expect.objectContaining({ occurrenceId: "occ-c", path: ["Angry", "Annoyed"] }));
  });
});

describe("normalizeSelect", () => {
  it("keeps the sunburst ancestor path and drops ECharts' empty root entry", () => {
    const sel = normalizeSelect({
      name: "Annoyed", value: 1, seriesName: "s", data: { occurrenceId: "occ-c" },
      treePathInfo: [{ name: "" }, { name: "Angry" }, { name: "Frustrated" }, { name: "Annoyed" }],
    });
    expect(sel.path).toEqual(["Angry", "Frustrated", "Annoyed"]);
    expect(sel.occurrenceId).toBe("occ-c");
  });

  it("returns an EMPTY path for a flat chart rather than undefined", () => {
    const sel = normalizeSelect({ name: "Sad", value: 3, data: { occurrenceId: "occ-b" } });
    expect(sel.path).toEqual([]);
  });

  it("reports a null occurrenceId for a hardcoded literal — nothing to open", () => {
    const sel = normalizeSelect({ name: "Target", value: 10, data: { occurrenceId: null } });
    expect(sel.occurrenceId).toBe(null);
  });

  it("never throws on a malformed payload", () => {
    expect(normalizeSelect(null)).toBe(null);
    expect(normalizeSelect({}).occurrenceId).toBe(null);
  });
});
