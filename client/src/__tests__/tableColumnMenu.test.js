// A column menu sat inside the table, so on a short table its last items were cut off at the bottom edge: Move and Remove
// column could not be reached (seen on a new 2-row table).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { placeColumnMenu } from "../helpers/placeColumnMenu";

const vp = { width: 1000, height: 800 };
describe("placeColumnMenu", () => {
  it("opens under its button, right edges lined up", () => {
    expect(placeColumnMenu({ top: 100, bottom: 120, left: 400, right: 420 }, { width: 200, height: 300 }, vp)).toEqual({ left: 220, top: 122, maxHeight: 670 });
  });
  it("stays inside the left edge", () => {
    expect(placeColumnMenu({ top: 100, bottom: 120, left: 10, right: 30 }, { width: 200, height: 300 }, vp).left).toBe(8);
  });
  it("stays inside the right edge", () => {
    expect(placeColumnMenu({ top: 100, bottom: 120, left: 900, right: 1200 }, { width: 200, height: 300 }, vp).left).toBe(792);
  });
  it("opens upward when it fits only there", () => {
    const p = placeColumnMenu({ top: 700, bottom: 720, left: 400, right: 420 }, { width: 200, height: 300 }, vp);
    expect(p.top).toBe(398); expect(p.maxHeight).toBe(690);
  });
  it("a menu taller than both sides scrolls where there is more room", () => {
    const p = placeColumnMenu({ top: 300, bottom: 320, left: 400, right: 420 }, { width: 200, height: 900 }, vp);
    expect(p.top).toBe(322); expect(p.maxHeight).toBe(470);
  });
});
describe("wiring", () => {
  it("the table places its menu against the window", () => {
    expect(fs.readFileSync(new URL("../modules/containers/ContainerTable.jsx", import.meta.url), "utf8")).toMatch(/placeColumnMenu\(/);
  });
});
