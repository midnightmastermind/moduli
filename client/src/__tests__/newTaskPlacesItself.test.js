// 0467 — the New task operation calls the placing operation, and the callee sees the task just created.
import { describe, it, expect } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";
import { runPlacingAfterCreate } from "../../../server/migrations/0467-new-task-places-itself.mjs";

const TODO = "todo", DEST = "sched-todo";
const callee = { id: "place", name: "Schedule: Place Dated Work", enabled: true, pipeline: { sources: [], steps: [
  { id: "l", type: "loop", overExpr: "$allInstances", as: "$ut", body: [
    { id: "i", type: "if", condition: { operator: "AND", rules: [{ id: "r", left: "$ut.parentId", comparator: "IS", right: TODO }] },
      then: [{ id: "a", type: "action", config: { type: "ADD_CHILD", parentId: DEST, childId: "$ut.id" } }], else: [] },
  ] },
] } };
const caller = (steps) => ({ id: "new", name: "New task", enabled: true, pipeline: { sources: [], steps } });
const createStep = { id: "c", type: "action", config: { type: "CREATE", role: "instance", name: "literal:Buy milk", parent: TODO, itemIdVar: "$newId" } };

function run(op) {
  const occurrencesById = { [TODO]: { id: TODO, moduleId: "mT", occurrences: [] }, [DEST]: { id: DEST, moduleId: "mT", occurrences: [] } };
  const modulesById = { mT: { id: "mT", role: "container", label: "Todo" } };
  const operationsById = { place: callee, new: op };
  const ctx = { state: { grid: { _id: "g" }, gridId: "g", fields: [], modules: Object.values(modulesById), occurrencesById, modulesById, fieldsById: {}, operationsById, operations: Object.values(operationsById) },
    fieldsById: {}, occurrencesById, modulesById, operationsById, operations: Object.values(operationsById) };
  const out = executePipeline(op, ctx, { type: "ButtonOp" }, {});
  const effects = Array.isArray(out) ? out : (out?.effects || out?.updates || []);
  return JSON.stringify(effects);
}

describe("0467 — New task places itself", () => {
  it("the called operation lists the new task in the Schedule's Todo", () => {
    const { pipeline } = runPlacingAfterCreate(caller([createStep]).pipeline, "place");
    const fx = run(caller(pipeline.steps));
    expect(fx).toContain(DEST);
  });
  it("without the call nothing is placed (control)", () => {
    expect(run(caller([createStep]))).not.toContain(DEST);
  });
  it("inserts right after the Create, once", () => {
    const steps = [{ id: "f", config: { type: "ASK_FORM" } }, createStep, { id: "s", config: { type: "SCROLL_TO" } }];
    const once = runPlacingAfterCreate({ steps }, "place").pipeline;
    expect(once.steps.map((s) => s.id)).toEqual(["f", "c", "newTaskPlaces", "s"]);
    expect(runPlacingAfterCreate(once, "place").changed).toBe(0);
    expect(() => runPlacingAfterCreate({ steps: [] }, "place")).toThrow(/CREATE/);
  });
});
