// __tests__/virtualRowsNoForcedLayout.test.js
// User 2026-11-02: "the people scroll is blacking out on scroll". Profiled on a phone (4x CPU): 40% of a fast scroll
// was `offsetHeight`, read SYNCHRONOUSLY for every row as it mounted (TanStack's default measureElement), plus a
// getBoundingClientRect of our own — each read forcing a fresh layout of a heavy page, many times a frame. The
// virtualizer already watches each row with a ResizeObserver, which reports sizes after layout for free.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { observerOnlyMeasure } from "../helpers/virtualRows";

const inst = (cache = new Map()) => ({
  itemSizeCache: cache,
  indexFromElement: () => 3,
  options: { getItemKey: (i) => `k${i}`, estimateSize: () => 77 },
});
const noLayout = () => { const el = {}; Object.defineProperty(el, "offsetHeight", { get() { throw new Error("forced layout"); } }); el.getBoundingClientRect = () => { throw new Error("forced layout"); }; return el; };

describe("a row is measured by the observer, not by a forced layout", () => {
  it("an observer entry gives the size", () => {
    expect(observerOnlyMeasure(noLayout(), { borderBoxSize: [{ blockSize: 91.6 }] }, inst())).toBe(92);
  });
  it("a synchronous measure returns the cached size, never reading the element", () => {
    expect(observerOnlyMeasure(noLayout(), undefined, inst(new Map([["k3", 120]])))).toBe(120);
  });
  it("…or the estimate when the row has not been measured yet", () => {
    expect(observerOnlyMeasure(noLayout(), undefined, inst())).toBe(77);
  });
  it("the hook uses it, and the row ref reads no rect", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../helpers/virtualRows.js"), "utf8");
    expect(src).toMatch(/measureElement:\s*observerOnlyMeasure/);
    const ref = src.slice(src.indexOf("const measureRef = useCallback"), src.indexOf("return { active, plan, measureRef"));
    expect(ref).toContain("v.measureElement(node)"); // control: rows are still registered
    expect(ref).not.toMatch(/getBoundingClientRect|offsetHeight/);
  });
});
