import { describe, it, expect } from "vitest";
import { withStoredLayout } from "../utils/gridLayoutKeys.js";

const stored = { meta: { layoutTree: { id: "desktop" }, layoutRules: [1], other: 1 } };
describe("a headset window's grid write keeps the stored layout", () => {
  it("drops top-level layout keys", () => {
    expect(withStoredLayout({ rows: 2, cols: 2, occurrences: ["a"], name: "x" }, stored)).toEqual({ name: "x" });
  });
  it("puts the stored layout back into a whole-meta patch, keeping its other changes", () => {
    const out = withStoredLayout({ meta: { layoutTree: { id: "headset2x2" }, fieldPresets: [9] } }, stored);
    expect(out.meta.layoutTree).toEqual({ id: "desktop" });
    expect(out.meta.layoutRules).toEqual([1]);
    expect(out.meta.fieldPresets).toEqual([9]);
  });
  it("does not add a layout the stored grid never had", () => {
    expect(withStoredLayout({ meta: { layoutTree: { id: "x" } } }, { meta: {} }).meta).toEqual({});
  });
  it("drops dotted layout paths", () => {
    expect(withStoredLayout({ "meta.layoutTree": {}, "meta.other": 2 }, stored)).toEqual({ "meta.other": 2 });
  });
});
