// 0449 — "Schedule: Clear Date on Move-Out" clears Date/Time Slot only for a
// row moved OUT of the Schedule; a move between Tasks containers keeps them
// (user, 2026-10-27). Drives the real executor over the live op's shape.
import { describe, it, expect } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";
import { onlyWhenLeaving } from "../../../server/migrations/0449-clear-date-only-when-leaving-schedule.mjs";

const D = "date", T = "slot";
const LIVE = { steps: [
  { id: "a", type: "action", config: { type: "INIT_VAR", name: "$schedPageId", value: "sched" } },
  { id: "b", type: "action", config: { type: "FIND", predicate: { operator: "AND", rules: [{ id: "r", left: "id", comparator: "IS", right: "$trigger.occurrenceId" }] }, itemVar: "$movedItem" } },
  { id: "c", type: "if", condition: { operator: "AND", rules: [{ id: "r2", left: "$movedItem._ancestors", comparator: "NOT_HAS_ANCESTOR", right: "$schedPageId" }] },
    then: [
      { id: "d", type: "action", config: { type: "UPDATE", path: `$movedItem.fields.${D}.value`, value: null } },
      { id: "e", type: "action", config: { type: "UPDATE", path: `$movedItem.fields.${T}.value`, value: null } },
    ], else: [] },
] };

function run(pipeline, { from }) {
  const occurrencesById = {
    sched: { id: "sched", moduleId: "m-page", occurrences: ["slot3"] },
    slot3: { id: "slot3", moduleId: "m-c", parentId: "sched", occurrences: [] },
    tasks: { id: "tasks", moduleId: "m-page", occurrences: ["appts", "done"] },
    appts: { id: "appts", moduleId: "m-c", parentId: "tasks", occurrences: [] },
    done: { id: "done", moduleId: "m-c", parentId: "tasks", occurrences: ["keith"] },
    keith: { id: "keith", moduleId: "m-i", parentId: "done", fields: { [D]: { value: "2026-10-26" }, [T]: { value: "3:00pm" } } },
  };
  const modulesById = { "m-page": { id: "m-page", role: "page" }, "m-c": { id: "m-c", role: "container" }, "m-i": { id: "m-i", role: "instance" } };
  const ctx = { state: { grid: { _id: "g" }, gridId: "g", modules: Object.values(modulesById), occurrencesById, modulesById, fieldsById: {}, operations: [] },
    fieldsById: {}, occurrencesById, modulesById, operationsById: {}, operations: [] };
  const out = executePipeline({ id: "op", name: "Clear", pipeline }, ctx,
    { type: "OccurrenceMoveOp", occurrenceId: "keith", fromContainerId: from, toContainerId: "done" });
  const effects = Array.isArray(out) ? out : (out?.effects || out?.updates || []);
  return effects.filter((e) => e._effect === "UPDATE_ITEM_FIELD");
}

describe("Clear Date on Move-Out", () => {
  const fixed = onlyWhenLeaving(LIVE).pipeline;
  it("the old op cleared the date on a move between Tasks containers (the report)", () => {
    expect(run(LIVE, { from: "appts" }).length).toBeGreaterThan(0);
  });
  it("a move from Appointments to Done keeps the date and time", () => {
    expect(run(fixed, { from: "appts" })).toEqual([]);
  });
  it("a row dragged OUT of a Schedule slot still has its date and time cleared", () => {
    expect(run(fixed, { from: "slot3" })).toHaveLength(2);
  });
  it("applies once", () => {
    expect(onlyWhenLeaving(fixed).changed).toBe(false);
  });
});
