import { describe, it, expect } from "vitest";
import { fillMissingLeaves } from "../helpers/bspTree";

const leaf = (id) => ({ panelOccId: id });
const split = (...children) => ({ dir: "row", sizes: children.map(() => 1), children });

describe("fillMissingLeaves", () => {
  it("hands a deleted panel's slot to the panel added in its place", () => {
    const tree = split(leaf("a"), leaf("b"), leaf("old"), leaf("d"));
    const out = fillMissingLeaves(tree, ["a", "b", "d", "new"]);
    expect(out.children.map((c) => c.panelOccId)).toEqual(["a", "b", "new", "d"]);
  });
  it("leaves the slot when no panel is spare", () => {
    const tree = split(leaf("a"), leaf("old"));
    expect(fillMissingLeaves(tree, ["a"])).toBe(tree);
  });
  it("returns the same tree when every panel exists", () => {
    const tree = split(leaf("a"), split(leaf("b"), leaf("c")));
    expect(fillMissingLeaves(tree, ["a", "b", "c", "x"])).toBe(tree);
  });
  it("does not place a panel the tree already shows", () => {
    const tree = split(leaf("a"), leaf("gone"));
    const out = fillMissingLeaves(tree, ["a"]);
    expect(out.children[1].panelOccId).toBe("gone");
  });
});
