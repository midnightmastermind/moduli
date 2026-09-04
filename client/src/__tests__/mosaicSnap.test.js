import { describe, it, expect } from "vitest";
import { makeLeaf, makeSplit } from "../helpers/bspTree";
import { regionOf } from "../helpers/mosaicSnap";

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
