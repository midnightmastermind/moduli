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

describe("EChart gestures", () => {
  // jsdom lays nothing out, so the host box is stubbed. That is honest about
  // what this proves: the WIRING (which gesture reaches which view call, and
  // whether a drag can masquerade as a click), not the picture — that is a
  // browser harness's job, and on this surface it has now caught two defects
  // no assertion could.
  const stubBox = (host) => {
    host.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200 });
  };
  const renderChart = async (props = {}) => {
    const onViewChange = props.onViewChange || vi.fn();
    const r = render(<EChart option={OPTION} view={{ zoom: 1, cx: 50, cy: 50 }} onViewChange={onViewChange} {...props} />);
    await flush();
    const host = r.container.querySelector(".echart");
    stubBox(host);
    return { ...r, host, onViewChange };
  };
  const pointer = (type, id, x, y) => new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, button: 0 });

  beforeEach(() => {
    // jsdom has no PointerEvent; MouseEvent carries everything used here.
    if (typeof globalThis.PointerEvent === "undefined") {
      globalThis.PointerEvent = class extends MouseEvent {
        constructor(type, init = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? "mouse"; }
      };
    }
    Element.prototype.setPointerCapture = function () {};
    Element.prototype.releasePointerCapture = function () {};
  });

  it("wheel UP zooms in about the pointer", async () => {
    const { host, onViewChange } = await renderChart();
    act(() => { host.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: 50, clientY: 50, bubbles: true, cancelable: true })); });
    const next = onViewChange.mock.calls.at(-1)[0];
    expect(next.zoom).toBeGreaterThan(1);
    // Zoomed about the box's top-left quadrant, so the centre must move AWAY
    // from that corner — zooming toward the middle would leave cx at 50.
    expect(next.cx).toBeGreaterThan(50);
  });

  it("wheel is NON-PASSIVE so the page does not scroll under the chart", async () => {
    const { host } = await renderChart();
    const e = new WheelEvent("wheel", { deltaY: -100, clientX: 50, clientY: 50, bubbles: true, cancelable: true });
    act(() => { host.dispatchEvent(e); });
    expect(e.defaultPrevented).toBe(true);
  });

  it("a one-pointer drag PANS once zoomed", async () => {
    const { host, onViewChange } = await renderChart({ view: { zoom: 3, cx: 50, cy: 50 } });
    act(() => {
      host.dispatchEvent(pointer("pointerdown", 1, 100, 100));
      host.dispatchEvent(pointer("pointermove", 1, 130, 100));
    });
    const next = onViewChange.mock.calls.at(-1)[0];
    expect(next.zoom).toBe(3);
    expect(next.cx).toBeCloseTo(65, 5);   // +30px of a 200px box = +15%
  });

  it("A DRAG IS NOT A CLICK — the pick it ends over is suppressed", async () => {
    // ECharts fires `click` on mouseup no matter how far the pointer travelled,
    // so without this a pan across the wheel records whatever slice you let go
    // over: an emotion the user never chose.
    const onSelect = vi.fn();
    const { host } = await renderChart({ view: { zoom: 3, cx: 50, cy: 50 }, onSelect });
    act(() => {
      host.dispatchEvent(pointer("pointerdown", 1, 100, 100));
      host.dispatchEvent(pointer("pointermove", 1, 140, 100));
      host.dispatchEvent(pointer("pointerup", 1, 140, 100));
    });
    const click = on.mock.calls.find(c => c[0] === "click")[1];
    act(() => click({ name: "Sad", data: { occurrenceId: "occ-b" } }));
    expect(onSelect).not.toHaveBeenCalled();
    // …and the very next click, with no drag before it, still selects.
    act(() => click({ name: "Sad", data: { occurrenceId: "occ-b" } }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("a click that does not move still SELECTS", async () => {
    const onSelect = vi.fn();
    const { host } = await renderChart({ onSelect });
    act(() => {
      host.dispatchEvent(pointer("pointerdown", 1, 100, 100));
      host.dispatchEvent(pointer("pointermove", 1, 101, 100));  // inside the slop
      host.dispatchEvent(pointer("pointerup", 1, 101, 100));
    });
    const click = on.mock.calls.find(c => c[0] === "click")[1];
    act(() => click({ name: "Sad", data: { occurrenceId: "occ-b" } }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("two pointers PINCH-zoom", async () => {
    const { host, onViewChange } = await renderChart();
    act(() => {
      host.dispatchEvent(pointer("pointerdown", 1, 80, 100));
      host.dispatchEvent(pointer("pointerdown", 2, 120, 100));
      host.dispatchEvent(pointer("pointermove", 2, 160, 100));   // fingers spread
    });
    expect(onViewChange.mock.calls.at(-1)[0].zoom).toBeGreaterThan(1);
  });

  it("double-click resets the view — a zoom is never a dead end", async () => {
    const { host, onViewChange } = await renderChart({ view: { zoom: 5, cx: 20, cy: 80 } });
    act(() => { host.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    expect(onViewChange).toHaveBeenLastCalledWith({ zoom: 1, cx: 50, cy: 50 });
  });

  it("registers NO gesture listeners when the host does not want a view", async () => {
    // A read-only chart should not silently swallow the page's wheel.
    const { container } = render(<EChart option={OPTION} />);
    await flush();
    const host = container.querySelector(".echart");
    stubBox(host);
    const e = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    act(() => { host.dispatchEvent(e); });
    expect(e.defaultPrevented).toBe(false);
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
