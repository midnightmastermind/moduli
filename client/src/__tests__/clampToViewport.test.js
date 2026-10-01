import { describe, it, expect } from "vitest";
import { clampToViewport } from "../helpers/clampToViewport.js";
describe("clampToViewport", () => {
  it("pulls a popup that would run off the right edge back in", () => {
    expect(clampToViewport({ x: 1500, y: 100, w: 220, h: 200 }, 1600, 1000)).toEqual({ left: 1374, top: 100 });
  });
  it("pulls one that would run off the bottom back up", () => {
    expect(clampToViewport({ x: 100, y: 900, w: 220, h: 200 }, 1600, 1000).top).toBe(794);
  });
  // The control: a popup that fits stays exactly at the click point.
  it("leaves a popup that fits where it opened", () => {
    expect(clampToViewport({ x: 300, y: 200, w: 220, h: 200 }, 1600, 1000)).toEqual({ left: 300, top: 200 });
  });
});
