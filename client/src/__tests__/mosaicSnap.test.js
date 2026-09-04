import { describe, it, expect } from "vitest";
import { makeLeaf, makeSplit } from "../helpers/bspTree";
import { regionOf, regionForZone, snapLeaf, snapLeafToRegion, zoneAt } from "../helpers/mosaicSnap";

const A = () => makeLeaf("a");
const B = () => makeLeaf("b");
const C = () => makeLeaf("c");

describe("regionOf", () => {
  it("is full on both axes for a lone leaf", () => {
    expect(regionOf(A(), "a")).toEqual({ col: "full", row: "full" });
  });

  it("reads the right half off a root column split", () => {
    // v[ B | A ]  →  A is the last child of a column split
    expect(regionOf(makeSplit("v", [B(), A()]), "a")).toEqual({ col: "right", row: "full" });
  });

  it("reads the left half", () => {
    expect(regionOf(makeSplit("v", [A(), B()]), "a")).toEqual({ col: "left", row: "full" });
  });

  it("reads the top half off a root row split", () => {
    expect(regionOf(makeSplit("h", [A(), B()]), "a")).toEqual({ col: "full", row: "top" });
  });

  // The shape a top-right snap produces: h[ v[B, A], C ]
  it("reads a top-right quadrant", () => {
    const tree = makeSplit("h", [makeSplit("v", [B(), A()]), C()]);
    expect(regionOf(tree, "a")).toEqual({ col: "right", row: "top" });
  });

  it("reads a bottom-left quadrant", () => {
    const tree = makeSplit("h", [C(), makeSplit("v", [A(), B()])]);
    expect(regionOf(tree, "a")).toEqual({ col: "left", row: "bottom" });
  });

  // A middle child is neither edge — claiming one would make the arrows lie.
  it("is full when the panel is a MIDDLE child", () => {
    expect(regionOf(makeSplit("v", [B(), A(), C()]), "a")).toEqual({ col: "full", row: "full" });
  });

  it("answers null for a panel that is not in the tree", () => {
    expect(regionOf(makeSplit("v", [B(), C()]), "a")).toBe(null);
    expect(regionOf(null, "a")).toBe(null);
  });
});

// Compare shape only — makeSplit mints a fresh random `id` per node.
const shape = (n) =>
  !n ? null
  : n.panelOccId ? n.panelOccId
  : { dir: n.dir, children: n.children.map(shape) };

describe("snapLeaf — halves", () => {
  // A panel with NO constraint on either axis is a middle child (regionOf calls
  // an edge child of a two-way split a half already). Pressing left/right from
  // there is the only press that produces a plain half rather than a quadrant.
  it("takes the right half, complement on the left", () => {
    const tree = makeSplit("h", [B(), A(), C()]);     // A is a middle row: col+row full
    expect(shape(snapLeaf(tree, "a", "right")))
      .toEqual({ dir: "v", children: [{ dir: "h", children: ["b", "c"] }, "a"] });
  });

  it("takes the left half", () => {
    const tree = makeSplit("h", [B(), A(), C()]);
    expect(shape(snapLeaf(tree, "a", "left")))
      .toEqual({ dir: "v", children: ["a", { dir: "h", children: ["b", "c"] }] });
  });

  // THE DEGRADE RULE, pinned so it is deliberate rather than accidental: from a
  // plain TOP half, Right targets the top-right QUADRANT, and with only one
  // panel left there is no row split to partition — so nothing moves. Falling
  // back to the right half would discard the row the panel already held, which
  // is exactly what the spec refuses. Two panels have no quadrants.
  it("does nothing when the perpendicular press cannot build a quadrant", () => {
    expect(snapLeaf(makeSplit("h", [A(), B()]), "a", "right")).toBe(null);
  });

  it("walks across in ONE press: right half → left half", () => {
    const tree = makeSplit("v", [B(), A()]);          // A is right
    expect(shape(snapLeaf(tree, "a", "left")))
      .toEqual({ dir: "v", children: ["a", "b"] });
  });

  it("sets the bottom half from a plain top half — it does NOT release", () => {
    // Releasing here would leave the panel with no region at all, and the
    // press would read as broken.
    const tree = makeSplit("h", [A(), B()]);          // A is top, col is full
    expect(shape(snapLeaf(tree, "a", "down")))
      .toEqual({ dir: "h", children: ["b", "a"] });
  });
});

describe("snapLeaf — the release rule (quadrant only)", () => {
  it("releases the row from a quadrant, keeping the column", () => {
    // top-right + Down → full-height right
    const tree = makeSplit("h", [makeSplit("v", [B(), A()]), C()]);
    expect(shape(snapLeaf(tree, "a", "down")))
      .toEqual({ dir: "v", children: [{ dir: "h", children: ["b", "c"] }, "a"] });
  });
});

describe("snapLeaf — no-ops answer null", () => {
  it("returns null when already in that region", () => {
    expect(snapLeaf(makeSplit("v", [B(), A()]), "a", "right")).toBe(null);
  });

  it("returns null for a panel that is not in the tree", () => {
    expect(snapLeaf(makeSplit("v", [B(), C()]), "a", "right")).toBe(null);
  });

  it("returns null for a lone leaf — there is no complement to place", () => {
    expect(snapLeaf(A(), "a", "right")).toBe(null);
  });

  it("returns null for an unknown direction", () => {
    expect(snapLeaf(makeSplit("v", [B(), A()]), "a", "sideways")).toBe(null);
  });
});

describe("snapLeaf — quadrants", () => {
  // The user's own case, 2026-09-04:
  //   v[ h[Routines, Trackers] , Browser ]  + Up
  //   → h[ v[Routines, Browser] , Trackers ]
  it("builds the top-right quadrant from the complement's first row", () => {
    const tree = makeSplit("v", [makeSplit("h", [A(), B()]), C()]);   // C full-height right
    expect(shape(snapLeaf(tree, "c", "up")))
      .toEqual({ dir: "h", children: [{ dir: "v", children: ["a", "c"] }, "b"] });
  });

  it("builds the top-LEFT quadrant with the leaf first in its row", () => {
    const tree = makeSplit("v", [C(), makeSplit("h", [A(), B()])]);   // C full-height left
    expect(shape(snapLeaf(tree, "c", "up")))
      .toEqual({ dir: "h", children: [{ dir: "v", children: ["c", "a"] }, "b"] });
  });

  // Bottom pairs with the complement's LAST row, not its first.
  it("builds the bottom-right quadrant from the complement's last row", () => {
    const tree = makeSplit("v", [makeSplit("h", [A(), B()]), C()]);
    expect(shape(snapLeaf(tree, "c", "down")))
      .toEqual({ dir: "h", children: ["a", { dir: "v", children: ["b", "c"] }] });
  });

  it("keeps the remaining rows grouped when the complement has three", () => {
    const D = () => makeLeaf("d");
    const tree = makeSplit("v", [makeSplit("h", [A(), B(), D()]), C()]);
    expect(shape(snapLeaf(tree, "c", "up")))
      .toEqual({
        dir: "h",
        children: [{ dir: "v", children: ["a", "c"] }, { dir: "h", children: ["b", "d"] }],
      });
  });

  // DEGRADE: nothing to partition → nothing moves, and the column survives.
  it("does nothing when the complement is a single leaf", () => {
    const tree = makeSplit("v", [A(), C()]);      // C right, complement is one leaf
    expect(snapLeaf(tree, "c", "up")).toBe(null);
  });

  it("does nothing when the complement splits on the wrong axis", () => {
    const tree = makeSplit("v", [makeSplit("v", [A(), B()]), C()]);
    expect(snapLeaf(tree, "c", "up")).toBe(null);
  });

  it("carries the complement's existing ratios into the grouped remainder", () => {
    const D = () => makeLeaf("d");
    const inner = makeSplit("h", [A(), B(), D()], [1, 3, 2]);
    const out = snapLeaf(makeSplit("v", [inner, C()]), "c", "up");
    expect(out.children[1].ratio).toEqual([3, 2]);   // A's weight left with A
  });
});

describe("zoneAt — perimeter drop zones", () => {
  const box = { w: 900, h: 600, band: 48 };

  it("is null well inside the grid — the pane keeps the drop", () => {
    expect(zoneAt({ x: 450, y: 300, ...box })).toBe(null);
  });

  it("the middle of the right band means the right half", () => {
    expect(zoneAt({ x: 880, y: 300, ...box })).toEqual({ direction: "right", quadrant: null });
  });

  it("the top of the right band means the top-right quadrant", () => {
    expect(zoneAt({ x: 880, y: 40, ...box })).toEqual({ direction: "right", quadrant: "up" });
  });

  it("the bottom of the right band means the bottom-right quadrant", () => {
    expect(zoneAt({ x: 880, y: 560, ...box })).toEqual({ direction: "right", quadrant: "down" });
  });

  it("the middle of the top band means the top half", () => {
    expect(zoneAt({ x: 450, y: 10, ...box })).toEqual({ direction: "up", quadrant: null });
  });

  // A corner sits in two bands and both mean the same quadrant, so the overlap
  // needs no tie-break — but it must not answer null.
  it("a corner resolves to that quadrant", () => {
    const c = zoneAt({ x: 890, y: 8, ...box });
    expect(c).not.toBe(null);
    expect(new Set([c.direction, c.quadrant])).toEqual(new Set(["right", "up"]));
  });
});

describe("regionForZone — a perimeter zone names an ABSOLUTE region", () => {
  it("a side's middle third is that half", () => {
    expect(regionForZone({ direction: "right", quadrant: null })).toEqual({ col: "right", row: "full" });
    expect(regionForZone({ direction: "up", quadrant: null })).toEqual({ col: "full", row: "top" });
  });

  it("a side's end thirds are that quadrant, from either side of the corner", () => {
    expect(regionForZone({ direction: "right", quadrant: "up" })).toEqual({ col: "right", row: "top" });
    expect(regionForZone({ direction: "up", quadrant: "right" })).toEqual({ col: "right", row: "top" });
  });

  it("maps the far corner too", () => {
    expect(regionForZone({ direction: "down", quadrant: "left" })).toEqual({ col: "left", row: "bottom" });
  });

  it("answers null for no zone", () => {
    expect(regionForZone(null)).toBe(null);
  });
});

describe("snapLeafToRegion — pointing is absolute, not two relative presses", () => {
  // THE LIVE CASE, 2026-09-04: h[C, v[A, B]] — A is bottom-LEFT. Aiming at the
  // top-right corner must land A in the top-right quadrant. Composing the two
  // arrow presses instead gives the right HALF, because the second press meets
  // the release rule on a row A already had.
  it("sets a quadrant outright from a panel that already had the opposite row", () => {
    const tree = makeSplit("h", [C(), makeSplit("v", [A(), B()])]);
    expect(shape(snapLeafToRegion(tree, "a", { col: "right", row: "top" })))
      .toEqual({ dir: "h", children: [{ dir: "v", children: ["c", "a"] }, "b"] });
  });

  it("is NOT what composing the two presses gives — that releases to a half", () => {
    const tree = makeSplit("h", [C(), makeSplit("v", [A(), B()])]);
    let composed = snapLeaf(tree, "a", "right") || tree;
    composed = snapLeaf(composed, "a", "up") || composed;
    expect(shape(composed)).toEqual({ dir: "v", children: [{ dir: "h", children: ["c", "b"] }, "a"] });
  });

  it("sets a plain half", () => {
    const tree = makeSplit("h", [B(), A(), C()]);
    expect(shape(snapLeafToRegion(tree, "a", { col: "right", row: "full" })))
      .toEqual({ dir: "v", children: [{ dir: "h", children: ["b", "c"] }, "a"] });
  });

  it("returns null when the panel is already in that region", () => {
    expect(snapLeafToRegion(makeSplit("v", [B(), A()]), "a", { col: "right", row: "full" })).toBe(null);
  });

  // The degrade rule survives: an unbuildable quadrant moves nothing.
  it("returns null when the complement cannot supply the quadrant's rows", () => {
    const tree = makeSplit("v", [makeSplit("v", [A(), B()]), C()]);
    expect(snapLeafToRegion(tree, "c", { col: "right", row: "top" })).toBe(null);
  });

  it("returns null for a panel that is not in the tree", () => {
    expect(snapLeafToRegion(makeSplit("v", [B(), C()]), "a", { col: "right", row: "full" })).toBe(null);
  });
});
