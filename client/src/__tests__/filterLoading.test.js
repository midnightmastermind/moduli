// User, 2026-11-11: a toolbar date change takes a second to rebuild the schedule; the panels it affects show their
// loader meanwhile instead of looking frozen. The store ends on its own once the op sweeps go quiet.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { beginFilterLoading, getFilterLoading, filterIsLoading, _resetFilterLoading, _FILTER_LOADING } from "../helpers/filterLoading.js";
import { noteOpSweep, _resetOpActivity } from "../helpers/opActivity.js";

const { QUIET_MS, NO_SWEEP_MS, MAX_MS } = _FILTER_LOADING;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (fn) => setTimeout(fn, 16));
  vi.stubGlobal("cancelAnimationFrame", (id) => clearTimeout(id));
  _resetOpActivity();
  _resetFilterLoading();
});
afterEach(() => { _resetFilterLoading(); _resetOpActivity(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("filterLoading", () => {
  it("holds while sweeps keep landing, ends once they go quiet", () => {
    beginFilterLoading(["date"]);
    expect(getFilterLoading()).toEqual(["date"]);
    for (let i = 0; i < 5; i++) { vi.advanceTimersByTime(QUIET_MS - 50); noteOpSweep(30); }
    expect(getFilterLoading()).toEqual(["date"]);
    vi.advanceTimersByTime(QUIET_MS + 100);
    expect(getFilterLoading()).toBeNull();
  });

  it("a change that starts no sweep ends on its own", () => {
    beginFilterLoading(["date"]);
    vi.advanceTimersByTime(NO_SWEEP_MS + 100);
    expect(getFilterLoading()).toBeNull();
  });

  it("can never stick: a sweep that never goes quiet still ends at the cap", () => {
    beginFilterLoading(["date"]);
    for (let t = 0; t < MAX_MS + 500; t += 100) { vi.advanceTimersByTime(100); noteOpSweep(5); }
    expect(getFilterLoading()).toBeNull();
  });

  it("a newer change restarts it", () => {
    beginFilterLoading(["a"]);
    noteOpSweep(10);
    vi.advanceTimersByTime(QUIET_MS - 100);
    beginFilterLoading(["b"]);
    vi.advanceTimersByTime(200);
    expect(getFilterLoading()).toEqual(["b"]);
  });

  it("a page is affected only when its filter holds one of the fields", () => {
    expect(filterIsLoading(["date"], { date: "2026-11-11" })).toBe(true);
    expect(filterIsLoading(["date"], { tags: ["x"] })).toBe(false);
    expect(filterIsLoading(["date"], { date: null })).toBe(false); // switched off here
    expect(filterIsLoading(null, { date: "2026-11-11" })).toBe(false);
  });

  it("is wired: the toolbar starts it, the panel draws its own loader, the ops wait for the paint", () => {
    const strip = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
    expect(strip("Toolbar.jsx")).toMatch(/beginFilterLoading\(navConditions\.map/);
    const panel = strip("modules/ModulePanel.jsx");
    expect(panel).toMatch(/filterLoadingHere && \(/);
    expect(panel).toMatch(/panel-filter-loading[\s\S]{0,200}staged-hold-spinner/);
    expect(strip("helpers/CommitHelpers.js")).toMatch(/afterPaint\(\(\) => \{\s*operationsBridge\.fireOperations\?\.\("NavigationOp"/);
  });
});

describe("PageBoard empty placeholder while a filter loads", () => {
  it("hides 'Drop containers here' when the page's filter is loading", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../modules/pages/PageBoard.jsx", import.meta.url), "utf8");
    expect(src).toMatch(/filterIsLoading\(loadingFilterFields/);
    expect(src).toMatch(/visibleList\.length === 0 && !filterLoading &&[^\n]*\n\s*<div[^>]*empty-placeholder/);
  });
});

describe("a board already showing the new day drops its loader early", () => {
  it("counts as reached only once the page's filter reads the target value", async () => {
    const m = await import("../helpers/filterLoading.js");
    m._resetFilterLoading();
    m.beginFilterLoading(["date"], { value: "2026-11-13", unit: "day" });
    expect(m.filterReachedTarget(["date"], { date: { value: "2026-11-12", unit: "day" } })).toBe(false);
    expect(m.filterReachedTarget(["date"], { date: { value: "2026-11-13", unit: "day" } })).toBe(true);
    m._resetFilterLoading();
  });
  it("marks a page ready and resets on the next change", async () => {
    const m = await import("../helpers/filterLoading.js");
    m._resetFilterLoading();
    m.beginFilterLoading(["date"], "2026-11-13");
    m.markFilterPageReady("pg1");
    const { getFilterLoading } = m;
    expect(getFilterLoading()).toEqual(["date"]);
    m.beginFilterLoading(["date"], "2026-11-14");
    expect(m.filterReachedTarget(["date"], { date: "2026-11-13" })).toBe(false);
    m._resetFilterLoading();
  });
  it("PageBoard marks ready only on the target value with rows visible; the panel skips ready pages", () => {
    const board = readFileSync(new URL("../modules/pages/PageBoard.jsx", import.meta.url), "utf8");
    const panel = readFileSync(new URL("../modules/ModulePanel.jsx", import.meta.url), "utf8");
    expect(board).toMatch(/if \(onTargetValue && hasVisible\) markFilterPageReady/);
    expect(panel).toMatch(/!filterReadyPages\.has\(activePageEntry\.occurrence\.id\)/);
  });
});
