// 2026-11-22: a loop over a whole collection whose only step is "if <item> is under X …" walks only X's items.
import { describe, it, expect } from "vitest";
import { executePipeline, loopAncestorOf } from "../helpers/operationExecutor";

const page = { id: "page", moduleId: "mP", occurrences: ["c1", "c2"] };
function world(n) {
  const occ = { page, c1: { id: "c1", moduleId: "mC", fields: { f: { value: "day-col" } } }, c2: { id: "c2", moduleId: "mC", fields: { f: { value: "x" } } } };
  for (let i = 0; i < n; i++) occ[`o${i}`] = { id: `o${i}`, moduleId: "mC", fields: { f: { value: "day-col" } } };
  return { occ, mod: { mP: { id: "mP", role: "page" }, mC: { id: "mC", role: "container" } } };
}
const loopOp = (elseSteps = []) => ({ id: "op", enabled: true, pipeline: { sources: [], steps: [
  { id: "l", type: "loop", overExpr: "$allContainers", as: "$c", body: [
    { id: "i", type: "if", condition: { operator: "AND", rules: [
      { id: "r1", left: "$c._ancestors", comparator: "HAS_ANCESTOR", right: "page" },
      { id: "r2", left: "$c.fields.f.value", comparator: "IS", right: "day-col" } ] },
      then: [{ id: "s", type: "action", config: { type: "SHOW_VALUE", sourceExpr: "$c.id" } }], else: elseSteps },
  ] },
] } });
function run(op, w) {
  const ctx = { state: { grid: { _id: "g" }, gridId: "g", fields: [], modules: Object.values(w.mod), occurrencesById: w.occ, modulesById: w.mod, fieldsById: {} },
    fieldsById: {}, occurrencesById: w.occ, modulesById: w.mod, operationsById: {}, operations: [op] };
  const out = executePipeline(op, ctx, { type: "ButtonOp" }, {});
  return (Array.isArray(out) ? out : (out?.effects || out?.updates || [])).filter((e) => e._effect === "SHOW_VALUE" || e.name).map((e) => e.value);
}

describe("a loop narrowed to the items under an ancestor", () => {
  it("gives the same result as walking everything", () => {
    expect(run(loopOp(), world(50))).toEqual(["c1"]);
  });
  it("narrows only a body of one if with no else, naming the loop's own variable", () => {
    const op = loopOp();
    expect(loopAncestorOf(op.pipeline.steps[0], "$c", {})).toBe("page");
    expect(loopAncestorOf(loopOp([{ id: "e", type: "action", config: { type: "NOTIFY" } }]).pipeline.steps[0], "$c", {})).toBe(null);
    expect(loopAncestorOf({ body: [op.pipeline.steps[0].body[0], { type: "action" }] }, "$c", {})).toBe(null);
    expect(loopAncestorOf(op.pipeline.steps[0], "$other", {})).toBe(null);
  });
});

describe("a loop builds the index on its first ask", async () => {
  const { recordsUnder } = await import("../helpers/operationActions");
  it("now: true answers at once; a FIND's first ask still scans", () => {
    const list = [{ id: "a", _ancestors: ["p"] }, { id: "b", _ancestors: ["q"] }];
    expect(recordsUnder(list, "p")).toBe(null);
    const list2 = [...list];
    expect(recordsUnder(list2, "p", { now: true }).map((r) => r.id)).toEqual(["a"]);
  });
});

describe("a loop narrowed by a field IS value", async () => {
  const { loopFieldIsOf } = await import("../helpers/operationExecutor");
  it("reads the field rule of the loop's own variable", () => {
    const st = loopOp().pipeline.steps[0];
    expect(loopFieldIsOf(st, "$c", {})).toEqual({ fieldId: "f", value: "day-col" });
    expect(loopFieldIsOf(st, "$other", {})).toBe(null);
  });
  it("same result, and a number value still matches its string (IS is String === String)", () => {
    expect(run(loopOp(), world(50))).toEqual(["c1"]);
    const w = world(0); w.occ.c1.fields.f.value = 5;
    const op = loopOp(); op.pipeline.steps[0].body[0].condition.rules[1].right = "5";
    expect(run(op, w)).toEqual(["c1"]);
  });
});
