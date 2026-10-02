// @vitest-environment jsdom
// An operation's MOVE_OCCURRENCE actually moves the occurrence.
//
// The effect used to emit a `move_occurrence` socket event that no server
// handler has ever listened for: the step ran, the run log said
// `MOVE_OCCURRENCE=1`, and nothing moved (found 2026-10-02 building "Schedule:
// Route by Timeslot" by clicking — it is the only move action the editor offers).
import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { bindSocketToStore, operationsBridge } from "../state/bindSocketToStore";

vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });

function setup() {
  const emitted = [];
  const socket = { on() {}, emit: (ev, payload) => emitted.push([ev, payload]), connected: true };
  const occurrences = [
    { id: "todo", moduleId: "mC", occurrences: ["task", "other"] },
    { id: "nine", moduleId: "mC", occurrences: [] },
    { id: "task", moduleId: "mT", parentId: "todo" },
    { id: "other", moduleId: "mT", parentId: "todo" },
  ];
  const stateRef = { current: { modules: [{ id: "mC", role: "container" }, { id: "mT", role: "instance" }], occurrences, operations: [], fields: [], grid: { activeFilterValues: {} } } };
  bindSocketToStore(socket, () => {}, stateRef);
  occurrences.forEach((o) => operationsBridge.updateLocalOcc(o));
  const updates = () => Object.fromEntries(emitted.filter(([ev]) => ev === "update_occurrence").map(([, p]) => [p.occurrence.id, p.occurrence]));
  return { emitted, updates };
}

describe("MOVE_OCCURRENCE effect", () => {
  it("unlists from the old parent, sets parentId, lists in the new parent", () => {
    const { emitted, updates } = setup();
    operationsBridge.applyEffect({ _effect: "MOVE_OCCURRENCE", occurrenceId: "task", toContainerId: "nine" });
    const u = updates();
    expect(u.todo.occurrences).toEqual(["other"]);
    expect(u.task.parentId).toBe("nine");
    expect(u.nine.occurrences).toEqual(["task"]);
    // …and nothing is sent to the event nobody handles.
    expect(emitted.some(([ev]) => ev === "move_occurrence")).toBe(false);
  });
  it("moving to the parent it is already in changes no list", () => {
    const { updates } = setup();
    operationsBridge.applyEffect({ _effect: "MOVE_OCCURRENCE", occurrenceId: "task", toContainerId: "todo" });
    const u = updates();
    expect(u.todo).toBeUndefined();
  });
  it("UPDATE_ITEM_PARENT still does the same thing (the control)", () => {
    const { updates } = setup();
    operationsBridge.applyEffect({ _effect: "UPDATE_ITEM_PARENT", itemId: "task", toParentId: "nine" });
    const u = updates();
    expect(u.task.parentId).toBe("nine");
    expect(u.nine.occurrences).toEqual(["task"]);
  });
  it("the client emits no socket event the server does not handle for it", () => {
    const helpers = fs.readFileSync(path.join(__dirname, "../helpers/CommitHelpers.js"), "utf8");
    expect(helpers).not.toMatch(/"move_occurrence"/);
  });
});

// A FIND that matched several records binds an array; a move into it is refused.
import { executePipeline } from "../helpers/operationExecutor";
describe("MOVE_OCCURRENCE action", () => {
  const run = (slots) => {
    const occurrencesById = { task: { id: "task", moduleId: "mT", parentId: "todo", fields: {} }, todo: { id: "todo", moduleId: "mC", occurrences: ["task"], fields: {} } };
    slots.forEach((id) => { occurrencesById[id] = { id, moduleId: "mC", occurrences: [], fields: { slot: { value: "9:00am" } } }; });
    const modulesById = { mC: { id: "mC", role: "container" }, mT: { id: "mT", role: "instance" } };
    const ctx = { state: { grid: { _id: "g" }, gridId: "g", userId: "u", fields: [], modules: Object.values(modulesById), occurrencesById, modulesById, fieldsById: {}, operations: [] }, fieldsById: {}, occurrencesById, modulesById, operationsById: {}, operations: [] };
    const steps = [
      { id: "f", type: "action", config: { type: "FIND", over: "$allContainers", itemIdVar: "$slotId", predicate: { operator: "AND", rules: [{ left: "fields.slot.value", comparator: "IS", right: "9:00am" }] } } },
      { id: "m", type: "action", config: { type: "MOVE_OCCURRENCE", occurrenceIdExpr: "$trigger.occurrenceId", toContainerIdExpr: "$slotId" } },
    ];
    const out = executePipeline({ id: "op", name: "x", pipeline: { sources: [], steps } }, ctx, { type: "MeasureOp", occurrenceId: "task" }, {});
    return (Array.isArray(out) ? out : (out?.effects || out?.updates || [])).filter((e) => e._effect === "MOVE_OCCURRENCE");
  };
  it("one matching slot: one move to it", () => {
    expect(run(["nine"])).toEqual([{ _effect: "MOVE_OCCURRENCE", occurrenceId: "task", toContainerId: "nine" }]);
  });
  it("two matching slots: refused by name, nothing moves", () => {
    expect(() => run(["nineMon", "nineTue"])).toThrow(/MOVE_OCCURRENCE: \$slotId matched 2 records/);
  });
});
