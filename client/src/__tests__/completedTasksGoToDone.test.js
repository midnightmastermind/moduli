// 0471 — ticking Completed moves a task into Tasks › Done; unticking moves it back; a Schedule copy acts on its original.
import { describe, it, expect } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";
import { completedToDonePipeline, acceptDoneFromTodo } from "../../../server/migrations/0471-completed-tasks-go-to-done.mjs";
import { evalGroup } from "../helpers/operationActions";

const TODO = "542da7cf-79a9-4a85-be33-cce33327aa72", DONE = "eac2cc53-c04f-403e-ac01-dd0d76bb8f19", C = "tZWiPDQUDP74";
const pipeline = completedToDonePipeline({ tasksPageId: "tasks", doneFieldId: "fDone", sinceFieldId: "fSince" });

function world(task, extra = {}) {
  const occ = {
    tasks: { id: "tasks", moduleId: "mp", occurrences: [TODO, DONE] },
    [TODO]: { id: TODO, moduleId: "mc", parentId: "tasks", occurrences: task.parentId === TODO ? ["t1"] : [] },
    [DONE]: { id: DONE, moduleId: "mc", parentId: "tasks", occurrences: task.parentId === DONE ? ["t1"] : [] },
    sched: { id: "sched", moduleId: "mp", occurrences: ["slot"] },
    slot: { id: "slot", moduleId: "mc", parentId: "sched", occurrences: ["copy"] },
    copy: { id: "copy", moduleId: "mt", parentId: "slot", linkedGroupId: "lg", fields: task.fields },
    t1: { id: "t1", moduleId: "mt", linkedGroupId: "lg", ...task },
    ...extra,
  };
  const mods = { mp: { id: "mp", role: "page" }, mc: { id: "mc", role: "container" }, mt: { id: "mt", role: "instance", label: "Call mom" } };
  return { occ, mods };
}
function run(task, triggerId = "t1") {
  const { occ, mods } = world(task);
  const ctx = { state: { grid: { _id: "g" }, gridId: "g", fields: [], modules: Object.values(mods), occurrencesById: occ, modulesById: mods, fieldsById: {}, operationsById: {}, operations: [] },
    fieldsById: {}, occurrencesById: occ, modulesById: mods, operationsById: {}, operations: [] };
  const out = executePipeline({ id: "op", name: "x", pipeline }, ctx, { type: "onChange", occurrenceId: triggerId }, {});
  return (Array.isArray(out) ? out : (out?.effects || out?.updates || [])).filter((e) => e._effect);
}
const moves = (effs) => effs.filter((e) => e._effect === "MOVE_OCCURRENCE").map((e) => [e.occurrenceId, e.toContainerId]);

describe("0471 Tasks: Completed to Done", () => {
  it("a ticked Todo task moves into Done and remembers Todo", () => {
    const effs = run({ parentId: TODO, fields: { [C]: { value: true } } });
    expect(moves(effs)).toEqual([["t1", DONE]]);
    expect(effs.find((e) => e._effect === "UPDATE_ITEM_META")).toMatchObject({ itemId: "t1", metaPath: ["doneFrom"], value: TODO });
  });
  it("ticking the Schedule copy moves the ORIGINAL", () => {
    expect(moves(run({ parentId: TODO, fields: { [C]: { value: true } } }, "copy"))).toEqual([["t1", DONE]]);
  });
  it("unticking in Done moves it back and clears Done / Done Since", () => {
    const effs = run({ parentId: DONE, meta: { doneFrom: TODO }, fields: { [C]: { value: false } } });
    expect(moves(effs)).toEqual([["t1", TODO]]);
    const fieldWrites = effs.filter((e) => e._effect === "UPDATE_ITEM_FIELD").map((e) => [e.fieldId, e.value]);
    expect(fieldWrites).toEqual(expect.arrayContaining([["fSince", null], ["fDone", false]]));
  });
  it("an unticked task outside Done, or a ticked one already in Done, does nothing (control)", () => {
    expect(run({ parentId: TODO, fields: { [C]: { value: false } } })).toEqual([]);
    expect(moves(run({ parentId: DONE, meta: { doneFrom: TODO }, fields: { [C]: { value: true } } }))).toEqual([]);
  });
});

describe("0471 Place Dated Work keeps a Done row that came from Todo", () => {
  const p = { steps: [{ id: "i", type: "if", condition: { operator: "AND", rules: [{ id: "r", left: "$ut.parentId", comparator: "IS", right: TODO }] }, then: [], else: [] }] };
  const rule = acceptDoneFromTodo(p).pipeline.steps[0].condition;
  const ok = (ut) => evalGroup(rule, { $ut: ut });
  it("accepts Todo, and Done-from-Todo, and nothing else", () => {
    expect(ok({ parentId: TODO })).toBe(true);
    expect(ok({ parentId: DONE, meta: { doneFrom: TODO } })).toBe(true);
    expect(ok({ parentId: DONE, meta: { doneFrom: "appointments" } })).toBe(false);
    expect(ok({ parentId: DONE })).toBe(false);
  });
  it("is idempotent", () => {
    const once = acceptDoneFromTodo(p).pipeline;
    expect(acceptDoneFromTodo(once).changed).toBe(0);
  });
});
