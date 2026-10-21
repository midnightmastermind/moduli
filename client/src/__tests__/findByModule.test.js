// "Occurrences of this module" (2026-10-21): a module index read instead of a
// scan, a Find option that narrows to it, and "first match only".
import { describe, it, expect } from "vitest";
import { executeActionItem, moduleIndexFor, recordsOfModules, resolveModuleIds } from "../helpers/operationActions";

const rows = [
  { id: "a", moduleId: "ex", fields: { done: { value: true } } },
  { id: "b", moduleId: "eat" },
  { id: "c", moduleId: "ex", fields: { done: { value: false } } },
  { id: "d", moduleId: "ex", meta: { isTemplate: true } },
  { id: "e", moduleId: "sleep" },
];
const run = (type, cfg, extra = {}) => { const $vars = { $allOccurrences: rows, ...extra }; executeActionItem(type, cfg, $vars, {}, {}); return $vars; };

describe("module index", () => {
  it("groups a list by module, keeping positions, and is cached per list", () => {
    const idx = moduleIndexFor(rows);
    expect(idx.get("ex").map(([, r]) => r.id)).toEqual(["a", "c", "d"]);
    expect(moduleIndexFor(rows)).toBe(idx);
  });
  it("several modules come back in the list's own order", () => {
    expect(recordsOfModules(rows, ["sleep", "ex"]).map((r) => r.id)).toEqual(["a", "c", "d", "e"]);
  });
  it("module ids can come from an expression naming a record", () => {
    expect(resolveModuleIds(["$pick", "eat"], { $pick: { moduleId: "ex" } })).toEqual(["ex", "eat"]);
  });
});

describe("FIND_MODULE_OCCURRENCES", () => {
  it("binds every occurrence of the module (templates excluded), always a list", () => {
    const v = run("FIND_MODULE_OCCURRENCES", { modules: ["ex"], idsVar: "$ids" });
    expect(v.$moduleOccurrences.map((r) => r.id)).toEqual(["a", "c"]);
    expect(v.$ids).toEqual(["a", "c"]);
  });
  it("no module chosen → an empty list, never everything", () => {
    expect(run("FIND_MODULE_OCCURRENCES", {}).$moduleOccurrences).toEqual([]);
  });
});

describe("FIND with ofModules / first", () => {
  const done = { operator: "AND", rules: [{ left: "fields.done.value", comparator: "IS", right: "true" }] };
  it("narrows to the module before the conditions", () => {
    const v = run("FIND", { ofModules: ["ex"], predicate: { operator: "AND", rules: [] }, itemIdVar: "$id", multiple: true });
    expect(v.$id).toEqual(["a", "c"]);
  });
  it("conditions still apply on top", () => {
    expect(run("FIND", { ofModules: ["ex"], predicate: done, itemIdVar: "$id" }).$id).toBe("a");
  });
  it("first match only returns one even when several match", () => {
    expect(run("FIND", { first: true, predicate: { operator: "AND", rules: [] }, itemIdVar: "$id" }).$id).toBe("a");
  });
  it("CONTROL: without ofModules the whole list is searched", () => {
    expect(run("FIND", { predicate: { operator: "AND", rules: [] }, itemIdVar: "$id" }).$id).toEqual(["a", "b", "c", "e"]);
  });
});
