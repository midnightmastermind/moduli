// A linked rectangle/ellipse on a canvas holds the cards whose centre sits inside it. Dragging one with
// Select moved a card outside it and left a card inside behind (2026-10-20): the centres were measured
// from screen rects during a scale animation. These pin the containment rule and the scale correction.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { linkedShapeChildren, worldCssScale } from "../modules/CanvasContent.jsx";

const centers = { a: { x: 347, y: 392 }, b: { x: 527, y: 472 }, far: { x: 2000, y: 2000 } };
const at = (id) => centers[id] || null;

describe("linkedShapeChildren", () => {
  const rect = { kind: "rect", x1: 230, y1: 332, x2: 464, y2: 453 };
  it("takes a card whose centre is inside and leaves one that only overlaps a corner", () => {
    expect(linkedShapeChildren(rect, ["a", "b", "far"], at).map(c => c.occId)).toEqual(["a"]);
  });
  it("accepts the shape drawn in any direction", () => {
    const flipped = { kind: "rect", x1: 464, y1: 453, x2: 230, y2: 332 };
    expect(linkedShapeChildren(flipped, ["a", "b"], at).map(c => c.occId)).toEqual(["a"]);
  });
  it("an ellipse uses its equation, not its box", () => {
    const ell = { kind: "circle", x1: 0, y1: 0, x2: 100, y2: 100 };
    const pts = { mid: { x: 50, y: 50 }, corner: { x: 5, y: 5 } };
    expect(linkedShapeChildren(ell, ["mid", "corner"], (id) => pts[id]).map(c => c.occId)).toEqual(["mid"]);
  });
  it("skips ids with no position and a degenerate ellipse", () => {
    expect(linkedShapeChildren(rect, [null, "nope"], at)).toEqual([]);
    expect(linkedShapeChildren({ kind: "circle", x1: 0, y1: 0, x2: 0, y2: 50 }, ["a"], at)).toEqual([]);
  });
});

describe("worldCssScale", () => {
  it("is the drawn width over the layout width", () => {
    expect(worldCssScale({ offsetWidth: 4000 }, { width: 3200 })).toBeCloseTo(0.8);
    expect(worldCssScale({ offsetWidth: 4000 }, { width: 4000 })).toBe(1);
  });
  it("falls back to 1 when there is nothing to measure", () => {
    expect(worldCssScale({ offsetWidth: 0 }, { width: 100 })).toBe(1);
    expect(worldCssScale({ offsetWidth: 100 }, { width: 0 })).toBe(1);
  });
});

describe("wiring", () => {
  const src = readFileSync(resolve(process.cwd(), "src/modules/CanvasContent.jsx"), "utf8");
  it("card centres are divided by the world's scale", () => {
    expect(src).toMatch(/const scale = worldCssScale\(worldEl, wRect\);/);
    expect(src).toMatch(/\/ scale,/);
  });
  it("a shape drag measures its children at the press, not from the render", () => {
    expect(src.match(/children: childrenNow\(\),/g)?.length).toBe(2);
    expect(src).not.toMatch(/children: children\.map\(/);
  });
  it("the shape and its children move as one undo step", () => {
    expect(src).toMatch(/if \(dx !== 0 \|\| dy !== 0\) withAction\("Moved group", \(\) => \{/);
  });
});
