import { describe, it, expect } from "vitest";
import { makeLeaf, makeSplit } from "../helpers/bspTree";
import { regionOf, snapLeaf } from "../helpers/mosaicSnap";

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
