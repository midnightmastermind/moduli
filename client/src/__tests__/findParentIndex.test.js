// FIND with a plain `parentId IS <id>` rule reads that parent's records from an index instead of testing every
// record. `Day Page: Add Reading` runs four such FINDs over every occurrence, once per day per book — ~300ms of a
// poms-grid date step (2026-11-10). The index only NARROWS what is tested; the condition still runs.
import { describe, it, expect } from "vitest";
import { executeActionItem, parentRuleOf, recordsWithParent } from "../helpers/operationActions.js";

const rec = (id, parentId, label = id) => ({ id, parentId, label, moduleId: "m", fields: {} });
const list = [rec("a", "p1"), rec("b", "p2"), rec("c", "p1", "keep"), rec("d", null), rec("e", 7), rec("f", "p1")];

const run = (predicate, extra = {}) => {
  const $vars = { $allOccurrences: list, $pid: "p1", ...extra };
  executeActionItem("FIND", { predicate, itemIdVar: "$ids", multiple: true }, $vars, {}, {});
  return $vars.$ids;
};

describe("FIND by parent reads an index", () => {
  it("recognises only a plain AND parentId IS rule", () => {
    const p = { operator: "AND", rules: [{ left: "parentId", comparator: "IS", right: "$pid" }] };
    expect(parentRuleOf(p, { $pid: "p1" })).toBe("p1");
    expect(parentRuleOf({ ...p, rules: [{ ...p.rules[0], left: "$item.parentId" }] }, { $pid: "p1" })).toBe("p1");
    expect(parentRuleOf({ ...p, operator: "OR" }, { $pid: "p1" })).toBe(null);
    expect(parentRuleOf(p, { $pid: "" })).toBe(null);
    expect(parentRuleOf({ ...p, rules: [{ ...p.rules[0], comparator: "IS_NOT" }] }, { $pid: "p1" })).toBe(null);
  });

  it("returns a parent's records in list order; a number parent matches its string", () => {
    expect(recordsWithParent(list, "p1").map((r) => r.id)).toEqual(["a", "c", "f"]);
    expect(recordsWithParent(list, "7").map((r) => r.id)).toEqual(["e"]);
    expect(recordsWithParent(list, "nope")).toEqual([]);
  });

  it("finds exactly what the full scan finds, other rules included", () => {
    const p = { operator: "AND", rules: [{ left: "parentId", comparator: "IS", right: "$pid" }] };
    expect(run(p)).toEqual(["a", "c", "f"]);
    const p2 = { operator: "AND", rules: [...p.rules, { left: "label", comparator: "IS", right: "literal:keep" }] };
    expect(run(p2)).toEqual(["c"]);
    // an OR group still scans everything
    const p3 = { operator: "OR", rules: [...p.rules, { left: "id", comparator: "IS", right: "literal:b" }] };
    expect(run(p3)).toEqual(["a", "b", "c", "f"]);
  });

  it("a new array (an addition) is indexed afresh", () => {
    const grown = [...list, rec("g", "p1")];
    expect(recordsWithParent(grown, "p1").map((r) => r.id)).toEqual(["a", "c", "f", "g"]);
  });
});
