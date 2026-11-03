import { describe, it, expect } from "vitest";
import { placeOnce, routeSkipsAppointments, unschedulePipeline } from "../migrations/0484-appointments-scheduled-once.mjs";
import { placeSteps } from "../migrations/0447-appointments-copy-linked-into-schedule.mjs";

const S = "fScheduled";
const pipeline = () => ({ steps: [{ id: "L", type: "loop", as: "$appt", body: [{ id: "G", type: "if", condition: { operator: "AND", rules: [] },
  then: placeSteps({ scheduleFormatFieldId: "fFmt", timeslotFieldId: "fTs" }), else: [] }] }] });

const findGate = (steps) => JSON.stringify(steps).includes("$apptCopyId");

describe("0484 placeOnce", () => {
  it("adds 'not Scheduled' to the create gate and ticks Scheduled once the copy is there", () => {
    const { pipeline: p, changed } = placeOnce(pipeline(), S);
    expect(changed).toBe(1);
    const inner = p.steps[0].body[0].then[1].then; // inside `$slotId IS_NOT_EMPTY`
    const gate = inner.find((s) => s.type === "if" && s.then?.[0]?.config?.type === "COPY_LINK");
    expect(gate.condition.rules.some((r) => r.left === `$appt.fields.${S}.value` && r.comparator === "IS_NOT")).toBe(true);
    const tick = inner[inner.indexOf(gate) + 1];
    expect(tick.meta.scheduledTick).toBe(true);
    expect(tick.then[0].config).toEqual({ type: "UPDATE", path: `$appt.fields.${S}.value`, value: true });
    expect(findGate(p.steps)).toBe(true);
  });
  it("is idempotent: a second run leaves one rule and one tick", () => {
    const once = placeOnce(pipeline(), S).pipeline;
    const twice = placeOnce(once, S);
    expect(twice.changed).toBe(1);
    const json = JSON.stringify(twice.pipeline);
    expect(json.split('"scheduledTick":true').length - 1).toBe(1);
    expect(json.split(`"left":"$appt.fields.${S}.value","comparator":"IS_NOT"`).length - 1).toBe(2); // gate + tick
  });
  it("finds nothing in an unrelated pipeline", () => {
    expect(placeOnce({ steps: [{ type: "action", config: { type: "NOTIFY" } }] }, S).changed).toBe(0);
  });
});

describe("0484 routeSkipsAppointments", () => {
  const route = () => ({ steps: [{ id: "G", type: "if", condition: { operator: "AND", rules: [{ left: "$trigger.value", comparator: "IS_NOT_EMPTY" }] },
    then: [{ id: "a", type: "action", config: { type: "MOVE_OCCURRENCE" } }], else: [] }] });
  it("guards the move: under the Schedule, or not an appointment", () => {
    const { pipeline: p, changed } = routeSkipsAppointments(route(), { schedulePageId: "sched", scheduleTypeFieldId: "fType" });
    expect(changed).toBe(1);
    const [find, guard] = p.steps[0].then;
    expect(find.config.itemVar).toBe("$routeItem");
    expect(guard.condition.operator).toBe("OR");
    expect(guard.condition.rules.map((r) => [r.left, r.comparator, r.right])).toEqual([
      ["$routeItem._ancestors", "HAS_ANCESTOR", "sched"], ["$routeItem._boundFieldIds", "ARRAY_NOT_INCLUDES", "fType"]]);
    expect(guard.then[0].config.type).toBe("MOVE_OCCURRENCE");
    expect(routeSkipsAppointments(p, { schedulePageId: "sched", scheduleTypeFieldId: "fType" }).changed).toBe(0);
  });
});

describe("0484 unschedulePipeline", () => {
  it("unticks only a ticked row", () => {
    const p = unschedulePipeline(S);
    expect(p.steps[1].condition.rules[0]).toMatchObject({ left: `$item.fields.${S}.value`, comparator: "IS", right: true });
    expect(p.steps[1].then[0].config).toEqual({ type: "UPDATE", path: `$item.fields.${S}.value`, value: false });
  });
});
