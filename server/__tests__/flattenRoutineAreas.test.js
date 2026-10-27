import { test, expect } from "vitest";
import { planFlatten, directNewRoutine } from "../migrations/0451-flatten-routine-areas.mjs";

const occ = [
  { id: "area", occurrences: ["s1", "loose", "s2"] },
  { id: "s1", c: 1, parentId: "area", occurrences: ["a", "b"] },
  { id: "s2", c: 1, parentId: "area", occurrences: ["c", "shared"] },
  { id: "a", parentId: "s1" }, { id: "b", parentId: "s1" }, { id: "c", parentId: "s2" },
  { id: "loose", parentId: "area" }, { id: "shared", parentId: "elsewhere" },
];
const byId = new Map(occ.map((o) => [o.id, o]));

test("rows take their inner container's place, in order; only rows homed there are re-homed", () => {
  const p = planFlatten(byId.get("area"), byId, (o) => !!o.c);
  expect(p.list).toEqual(["a", "b", "loose", "c", "shared"]);
  expect(p.rehome).toEqual(["a", "b", "c"]);
  expect(p.drop).toEqual(["s1", "s2"]);
});

test("New routine stops asking Where and creates in the area", () => {
  const pipe = { steps: [
    { type: "action", config: { type: "ASK_FORM", items: [{ key: "name" }, { key: "where", options: [] }] } },
    { type: "action", config: { type: "CREATE", parent: "$form.values.where", name: "$form.values.name" } },
  ] };
  const out = directNewRoutine(pipe, "area");
  expect(out.steps[0].config.items.map((i) => i.key)).toEqual(["name"]);
  expect(out.steps[1].config.parent).toBe("literal:area");
});
