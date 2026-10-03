// 0385 — poms' Route by Timeslot and Status Router read the edited value the way a hand edit carries it.
import { describe, it, expect } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";
import { buildRoutePipeline, readTriggerValue, monthlyByDay } from "../../../server/migrations/0385-route-and-status-reads-retire-next-due.mjs";

const IDS = { schedPageId: "page", formatFieldId: "fmt", dateFieldId: "date", timeslotFieldId: "slot" };
function world() {
  const o = {
    page: { id: "page", moduleId: "mC", occurrences: ["c1", "c2"], fields: {} },
    c1: { id: "c1", moduleId: "mC", parentId: "page", occurrences: ["todo1", "nine1"], fields: { fmt: { value: "day-col" }, date: { value: "2026-10-02" } } },
    c2: { id: "c2", moduleId: "mC", parentId: "page", occurrences: ["nine2"], fields: { fmt: { value: "day-col" }, date: { value: "2026-10-03" } } },
    todo1: { id: "todo1", moduleId: "mC", parentId: "c1", occurrences: ["task"], fields: { slot: { value: "Todo" } } },
    nine1: { id: "nine1", moduleId: "mC", parentId: "c1", occurrences: [], fields: { fmt: { value: "slot" }, slot: { value: "9:00am" } } },
    nine2: { id: "nine2", moduleId: "mC", parentId: "c2", occurrences: [], fields: { fmt: { value: "slot" }, slot: { value: "9:00am" } } },
    task: { id: "task", moduleId: "mT", parentId: "todo1", fields: { date: { value: "2026-10-02" }, slot: { value: "9:00am" } } },
  };
  const m = { mC: { id: "mC", role: "container" }, mT: { id: "mT", role: "instance" } };
  return { state: { grid: { _id: "g" }, gridId: "g", userId: "u", fields: [], modules: Object.values(m), occurrencesById: o, modulesById: m, fieldsById: {}, operations: [] }, fieldsById: {}, occurrencesById: o, modulesById: m, operationsById: {}, operations: [] };
}
const moves = (out) => (Array.isArray(out) ? out : (out?.effects || out?.updates || [])).filter((e) => e._effect === "MOVE_OCCURRENCE");

describe("Route by Timeslot (0385)", () => {
  it("a hand edit (raw value) moves the item into ITS day's slot — not every day's", () => {
    const out = executePipeline({ id: "op", name: "Route", pipeline: buildRoutePipeline(IDS) }, world(),
      { type: "MeasureOp", occurrenceId: "task", fields: { slot: "9:00am" } }, {});
    expect(moves(out)).toEqual([{ _effect: "MOVE_OCCURRENCE", occurrenceId: "task", toContainerId: "nine1" }]);
  });
  it("an item with no date goes nowhere", () => {
    const w = world(); w.occurrencesById.task.fields.date = { value: null };
    const out = executePipeline({ id: "op", name: "Route", pipeline: buildRoutePipeline(IDS) }, w, { type: "MeasureOp", occurrenceId: "task", fields: { slot: "9:00am" } }, {});
    expect(moves(out)).toEqual([]);
  });
});

describe("readTriggerValue", () => {
  it("replaces every read of that field's trigger cell, nothing else", () => {
    const p = { steps: [{ config: { expr: "$trigger.fields.st.value" } }, { condition: { rules: [{ left: "$trigger.fields.st.value" }, { left: "$trigger.fields.other.value" }] } }] };
    expect(JSON.stringify(readTriggerValue(p, "st"))).toBe(JSON.stringify({ steps: [{ config: { expr: "$trigger.value" } }, { condition: { rules: [{ left: "$trigger.value" }, { left: "$trigger.fields.other.value" }] } }] }));
  });
});

describe("monthlyByDay", () => {
  it("Cadence IS monthly becomes Day IS_NOT_EMPTY, and the Cadence trigger becomes a Day trigger", () => {
    const op = { pipeline: { steps: [{ type: "loop", body: [{ type: "if", condition: { operator: "AND", rules: [{ left: "$item.fields.cad.value", comparator: "IS", right: "monthly" }, { left: "$item.fields.amt.value", comparator: "IS_NOT_EMPTY", right: "" }] }, then: [] }] }] },
      triggerObjects: [{ eventType: "onChange", targetId: "cad" }, { eventType: "onChange", targetId: "amt" }] };
    const out = monthlyByDay(op, { cadenceFieldId: "cad", dayFieldId: "day" });
    expect(out.pipeline.steps[0].body[0].condition.rules[0]).toEqual({ left: "$item.fields.day.value", comparator: "IS_NOT_EMPTY", right: "" });
    expect(out.pipeline.steps[0].body[0].condition.rules[1].left).toBe("$item.fields.amt.value");
    expect(out.triggerObjects.map((t) => t.targetId)).toEqual(["day", "amt"]);
  });
});
