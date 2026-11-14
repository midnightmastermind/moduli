import { describe, it, expect } from "vitest";
import { catalogueOps, opReadPlan } from "../utils/opReadScope.js";

const loop = (over, rules, body = []) => ({ type: "loop", overExpr: over, as: "$item", body: [{ type: "if", condition: { operator: "AND", rules }, then: body }] });
const find = (over, rules) => ({ type: "action", config: { type: "FIND", over, predicate: { operator: "AND", rules }, itemVar: "$x" } });
const op = (id, steps, name = id) => ({ id, name, pipeline: { steps } });

const occurrences = [
  { id: "sched", occurrences: ["col"] }, { id: "col", parentId: "sched", occurrences: ["pic"] }, { id: "pic", parentId: "col" },
  { id: "tasks", occurrences: ["t1"] }, { id: "t1", parentId: "tasks" },
];
const grid = { occurrences, catalogueIds: new Set(["s0ngR0wId123"]), catalogueModuleIds: new Set(["songMod"]) };

describe("which load operations need the catalogue", () => {
  it("lets a tracker over $allInstances and a builder confined by parentId run early", () => {
    const tracker = op("tr", [loop("$allInstances", [{ left: "_ancestors", comparator: "HAS_ANCESTOR", right: "sched" }])]);
    const builder = op("b", [find("$allOccurrences", [{ left: "parentId", comparator: "IS", right: "$dayPage" }])]);
    expect(catalogueOps([tracker, builder], grid).ids).toEqual([]);
  });
  it("holds back counts, unconfined whole-grid reads and $allArtifacts", () => {
    const count = op("c", [{ type: "action", config: { type: "COUNT_BY", over: "$allItems" } }]);
    const loose = op("l", [find("$allOccurrences", [{ left: "fields.x.value", comparator: "SAME_DAY", right: "$day" }])]);
    const arts = op("a", [loop("$allArtifacts", [{ left: "_ancestors", comparator: "HAS_ANCESTOR", right: "sched" }])]);
    expect(catalogueOps([count, loose, arts], grid).ids.sort()).toEqual(["a", "c", "l"]);
  });
  it("holds back a read confined under a page that holds catalogue rows", () => {
    const g = { ...grid, catalogueIds: new Set(["pic"]) };
    const t = op("t", [loop("$allItems", [{ left: "_ancestors", comparator: "HAS_ANCESTOR", right: "sched" }])]);
    expect(catalogueOps([t], g).ids).toEqual(["t"]);
    expect(catalogueOps([t], grid).ids).toEqual([]); // the control: the same read when nothing under it is held back
  });
  it("holds back an operation that names a catalogue row or calls one that needs it", () => {
    const named = op("n", [{ type: "action", config: { type: "INIT_VAR", name: "$s", expr: "$allItemsById.s0ngR0wId123" } }]);
    const callee = op("callee", [{ type: "action", config: { type: "COUNT_BY", over: "$allItems" } }], "Counter");
    const caller = op("caller", [{ type: "action", config: { type: "RUN_OPERATION", operationName: "Counter" } }]);
    expect(catalogueOps([named, callee, caller], grid).ids.sort()).toEqual(["callee", "caller", "n"]);
  });
  it("reads a variable's literal value as the confining page", () => {
    const steps = [{ type: "action", config: { type: "INIT_VAR", name: "$page", expr: "literal:sched" } },
      loop("$allItems", [{ left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$page" }])];
    expect([...opReadPlan(op("v", steps)).literalRoots]).toEqual(["sched"]);
  });
});
