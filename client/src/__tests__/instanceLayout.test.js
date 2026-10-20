// A placement's nested row/column layout (helpers/instanceLayout).
import { describe, it, expect } from "vitest";
import * as L from "../helpers/instanceLayout";

const F = (id) => L.fieldKey(id);
// Exercise, the user's example: col 1 Completed, col 2 Movement, col 3 the sets,
// and inside col 3 a column per set (Set 1 over Weight 1, …).
const exercise = {
  tree: { dir: "row", items: [
    { dir: "col", items: [F("completed")] },
    { dir: "col", items: [F("movement")] },
    { dir: "row", items: [
      { dir: "col", items: [F("set1"), F("w1")] },
      { dir: "col", items: [F("set2"), F("w2")] },
    ] },
  ] },
};

describe("instance layout", () => {
  it("default: label, a row of the fields, the cover last", () => {
    const d = L.defaultLayout(["a", "b"], { hasCover: true });
    expect(d.tree).toEqual({ dir: "col", items: ["label", { dir: "row", items: [F("a"), F("b")] }, "cover"] });
  });
  it("resolves the user's nested example unchanged when every field exists", () => {
    const keys = ["completed", "movement", "set1", "w1", "set2", "w2"].map(F);
    const { tree, unplaced } = L.resolveTree(exercise, keys);
    expect(unplaced).toEqual([]);
    expect(L.keysIn(tree)).toEqual(keys);
    expect(tree.items[2].items[0]).toEqual({ dir: "col", items: [F("set1"), F("w1")] });
  });
  it("a field bound after the layout was made is appended, never dropped", () => {
    const { tree, unplaced } = L.resolveTree(exercise, ["completed", "movement", "set1", "w1", "set2", "w2", "set3"].map(F));
    expect(unplaced).toEqual([F("set3")]);
    expect(tree.items.at(-1)).toBe(F("set3"));
  });
  it("a field no longer bound is dropped, and a key placed twice draws once", () => {
    const dup = { tree: { dir: "row", items: [F("a"), { dir: "col", items: [F("a"), F("gone")] }] } };
    const { tree } = L.resolveTree(dup, [F("a")]);
    expect(L.keysIn(tree)).toEqual([F("a")]);
  });
  it("moveItem moves a field into a nested group at an index", () => {
    const n = L.moveItem(exercise, F("w2"), [2, 0], 1);
    expect(n.tree.items[2].items[0].items).toEqual([F("set1"), F("w2"), F("w1")]);
    expect(n.tree.items[2].items[1].items).toEqual([F("set2")]);
    expect(exercise.tree.items[2].items[1].items).toEqual([F("set2"), F("w2")]); // pure
  });
  it("addGroup adds a group running the other way; toggleDir flips one", () => {
    const n = L.addGroup(exercise, [2]);
    expect(n.tree.items[2].items.at(-1)).toEqual({ dir: "col", items: [] });
    expect(L.toggleDir(n, [2]).tree.items[2].dir).toBe("col");
  });
  it("removeGroup puts its items where it was; the root cannot be removed", () => {
    const n = L.removeGroup(exercise, [2, 0]);
    expect(n.tree.items[2].items).toEqual([F("set1"), F("w1"), { dir: "col", items: [F("set2"), F("w2")] }]);
    expect(L.removeGroup(exercise, [])).toBe(exercise);
  });
  it("field style: patch merges, a cleared value removes the key, an empty style is dropped", () => {
    let n = L.setFieldStyle({}, "a", { width: "wide", color: "#123" });
    expect(n.fieldStyles.a).toEqual({ width: "wide", color: "#123" });
    n = L.setFieldStyle(n, "a", { width: null, color: "" });
    expect(n.fieldStyles.a).toBeUndefined();
  });
  it("wrapper style: own line / full fill the row; size zooms; colour tints", () => {
    expect(L.fieldWrapStyle({ ownLine: true })).toMatchObject({ flex: "1 1 100%" });
    expect(L.fieldWrapStyle({ width: "narrow" })).toMatchObject({ width: 80 });
    expect(L.fieldWrapStyle({ size: "lg" }).zoom).toBe(1.2);
    expect(L.fieldWrapStyle({ color: "#abc" })).toMatchObject({ background: "#abc" });
    expect(L.fieldWrapStyle({})).toEqual({});
  });
  it("a group is responsive (wraps) unless switched off, and the flag survives resolve", () => {
    const off = L.setGroupProps(exercise, [2], { wrap: false });
    expect(L.groupFlexStyle(off.tree.items[2]).flexWrap).toBe("nowrap");
    expect(L.groupFlexStyle(exercise.tree.items[2]).flexWrap).toBe("wrap");
    const keys = ["completed", "movement", "set1", "w1", "set2", "w2"].map(F);
    expect(L.resolveTree(off, keys).tree.items[2].wrap).toBe(false);
    expect(L.setGroupProps(off, [2], { wrap: null }).tree.items[2].wrap).toBeUndefined();
  });
  it("a copy carries the layout and nothing else from the source's meta", () => {
    const src = { meta: { instanceLayout: exercise, x: 5, linkedGroupId: "g" } };
    const out = L.carriedPlacementMeta(src);
    expect(out).toEqual({ instanceLayout: exercise });
    expect(out.instanceLayout).not.toBe(exercise);
    expect(L.carriedPlacementMeta({})).toEqual({});
  });
});

// Found building Exercise's layout by dragging (2026-10-16): a chip moved into a box that
// sits AFTER it in the same parent was dropped silently — removing the chip shifted the
// box's index, so the path no longer named it.
describe("moveItem into a later sibling box", () => {
  const base = { tree: { dir: "col", items: ["label", { dir: "row", items: ["field:a", "field:b", { dir: "row", items: [{ dir: "col", items: [] }] }] }] } };
  it("lands in the box the path named before the move", async () => {
    const { moveItem } = await import("../helpers/instanceLayout");
    const next = moveItem(base, "field:a", [1, 2, 0]);
    expect(next.tree.items[1].items).toEqual(["field:b", { dir: "row", items: [{ dir: "col", items: ["field:a"] }] }]);
  });
  it("an index in the same group counts the slot the chip leaves", async () => {
    const { moveItem } = await import("../helpers/instanceLayout");
    const g = { tree: { dir: "row", items: ["field:a", "field:b", "field:c"] } };
    expect(moveItem(g, "field:a", [], 2).tree.items).toEqual(["field:b", "field:a", "field:c"]);
    expect(moveItem(g, "field:c", [], 0).tree.items).toEqual(["field:c", "field:a", "field:b"]);
  });
});

import { stepItem } from "../helpers/instanceLayout";
describe("stepItem (the editor's arrows)", () => {
  const L0 = () => ({ tree: { dir: "col", items: ["label", "f:a", { dir: "row", items: ["f:b", "f:c"] }, "f:d"] } });
  it("swaps with an ordinary neighbour", () => {
    expect(stepItem(L0(), [], 1, -1).tree.items.slice(0, 2)).toEqual(["f:a", "label"]);
  });
  it("can bring a field all the way to the top", () => {
    let l = L0();
    l = stepItem(l, [], 3, -1);                   // f:d steps into the box (its bottom)
    expect(l.tree.items[2].items).toEqual(["f:b", "f:c", "f:d"]);
    for (let i = 2; i > 0; i--) l = stepItem(l, [2], i, -1); // up to the box's top
    l = stepItem(l, [2], 0, -1);                  // out of the box, above it
    l = stepItem(l, [], 2, -1); l = stepItem(l, [], 1, -1);
    expect(l.tree.items[0]).toBe("f:d");
  });
  it("a field next to a box steps into it: its top going down, its bottom going up", () => {
    expect(stepItem(L0(), [], 1, +1).tree.items[1].items).toEqual(["f:a", "f:b", "f:c"]);
    expect(stepItem(L0(), [], 3, -1).tree.items[2].items).toEqual(["f:b", "f:c", "f:d"]);
  });
  it("at a box's end a field steps out into the parent, next to the box", () => {
    const up = stepItem(L0(), [2], 0, -1).tree.items;
    expect(up.slice(1, 3)).toEqual(["f:a", "f:b"]);
    const down = stepItem(L0(), [2], 1, +1).tree.items;
    expect(down.slice(2, 4)).toEqual([{ dir: "row", items: ["f:b"] }, "f:c"]);
  });
  it("a box swaps with a box (never nests) and moves past fields", () => {
    const l = { tree: { dir: "col", items: [{ dir: "row", items: ["f:a"] }, { dir: "row", items: ["f:b"] }] } };
    expect(stepItem(l, [], 1, -1).tree.items.map((g) => g.items[0])).toEqual(["f:b", "f:a"]);
    expect(stepItem(L0(), [], 2, -1).tree.items.slice(1, 3)).toEqual([{ dir: "row", items: ["f:b", "f:c"] }, "f:a"]);
  });
  it("returns the same layout when there is nowhere to go", () => {
    const l = L0();
    expect(stepItem(l, [], 0, -1)).toBe(l);
    expect(stepItem(l, [], 3, +1)).toBe(l);
  });
});
