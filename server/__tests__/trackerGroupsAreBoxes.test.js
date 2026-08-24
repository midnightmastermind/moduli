// 0215's selector. The whole point is that it is NARROW: the obvious rule
// ("any nested container draws as a card") matches 539 containers on the live
// grid, every schedule time slot among them.
import { describe, it, expect } from "vitest";
import { nestedGroupsOf } from "../migrations/0215-tracker-groups-are-boxes.mjs";

const mk = (occs, mods) => [new Map(occs.map(o => [o.id, o])), new Map(mods.map(m => [m.id, m]))];

describe("nestedGroupsOf", () => {
  const page = { id: "page", moduleId: "m-page", occurrences: ["top1", "top2"] };
  const base = [
    page,
    { id: "top1", moduleId: "m-top", occurrences: ["g1", "leaf"] },
    { id: "top2", moduleId: "m-top", occurrences: ["g2"] },
    { id: "g1", moduleId: "m-g1", occurrences: [] },
    { id: "g2", moduleId: "m-g2", occurrences: [] },
    { id: "leaf", moduleId: "m-inst", occurrences: [] },
  ];
  const mods = [
    { id: "m-page", role: "page", label: "Trackers" },
    { id: "m-top", role: "container", label: "Physical" },
    { id: "m-g1", role: "container", kind: "board", label: "Workout" },
    { id: "m-g2", role: "container", kind: "board", label: "Media" },
    { id: "m-inst", role: "instance", label: "a tile" },
  ];

  it("finds containers nested one level under the page's children", () => {
    const [o, m] = mk(base, mods);
    expect(nestedGroupsOf(page, o, m).map(g => g.mod.label).sort()).toEqual(["Media", "Workout"]);
  });

  it("does NOT return the page's direct children — they already draw as cards", () => {
    const [o, m] = mk(base, mods);
    expect(nestedGroupsOf(page, o, m).map(g => g.mod.label)).not.toContain("Physical");
  });

  it("ignores a nested INSTANCE — only containers get chrome", () => {
    const [o, m] = mk(base, mods);
    expect(nestedGroupsOf(page, o, m).map(g => g.mod.label)).not.toContain("a tile");
  });

  it("reports which parent each sits in, for the log", () => {
    const [o, m] = mk(base, mods);
    expect(nestedGroupsOf(page, o, m)[0].parent).toBe("Physical");
  });

  it("does NOT recurse to a THIRD level", () => {
    // A time slot's children are nested two deep. Going deeper is how this
    // selector would start matching the Schedule.
    const deep = [...base, { id: "g3", moduleId: "m-g3", occurrences: [] }];
    deep.find(x => x.id === "g1").occurrences = ["g3"];
    const [o, m] = mk(deep, [...mods, { id: "m-g3", role: "container", label: "deeper" }]);
    expect(nestedGroupsOf(page, o, m).map(g => g.mod.label)).not.toContain("deeper");
  });

  it("survives a page with no children, and a dangling child id", () => {
    const [o, m] = mk(base, mods);
    expect(nestedGroupsOf({ id: "x", occurrences: [] }, o, m)).toEqual([]);
    expect(nestedGroupsOf({ id: "x", occurrences: ["gone"] }, o, m)).toEqual([]);
    expect(nestedGroupsOf(null, o, m)).toEqual([]);
  });
});
