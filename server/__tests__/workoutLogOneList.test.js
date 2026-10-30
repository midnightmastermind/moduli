import { describe, it, expect } from "vitest";
import { mergedHistoryPipeline } from "../migrations/0460-workout-log-one-list.mjs";

const C = "compId";
const pipeline = () => ({ sources: [], steps: [
  { id: "a", type: "action", config: { type: "INIT_VAR", name: "$rows", value: [] } },
  { id: "loop", type: "loop", overExpr: "$allInstances", as: "$inst", body: [
    { id: "gate", type: "if", condition: { operator: "AND", rules: [
      { id: "r1", left: "$inst.meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
      { id: "g", operator: "OR", rules: [
        { id: "c1", left: `$inst.fields.${C}.value`, comparator: "IS", right: true },
        { id: "c2", left: "$inst._boundFieldIds", comparator: "ARRAY_NOT_INCLUDES", right: C },
      ] },
    ] }, then: [
      { id: "mv", type: "loop", overExpr: "$inst.fields.m.value", as: "$mvId", body: [
        { id: "p", type: "action", config: { type: "PUSH_TO_ARRAY", name: "$rows", value: { label: "$mv.label", s1: "$inst.fields.s1.value" } } },
        { id: "l", type: "action", config: { type: "SET_VAR", name: "$lastW", expr: "$mv.label" } },
      ] },
    ], else: [] },
  ] },
] });

describe("0460 mergedHistoryPipeline", () => {
  const out = mergedHistoryPipeline(pipeline(), C);
  const gate = out.steps[1].body[0];
  it("no longer requires the movement to be completed", () => {
    expect(JSON.stringify(gate.condition)).not.toContain(C);
    expect(gate.condition.rules.map((r) => r.id)).toEqual(["r1"]);
  });
  it("sets a status from Completed before the movement loop, and puts it on each row", () => {
    expect(gate.then[0].config).toEqual({ type: "SET_VAR", name: "$status", value: "not yet" });
    expect(gate.then[1].type).toBe("if");
    expect(gate.then[1].then[0].config.value).toBe("done");
    const push = gate.then[2].body[0].config.value;
    expect(Object.keys(push)).toEqual(["label", "status", "s1"]);
    expect(push.status).toBe("$status");
  });
  it("Last Workout only counts a finished movement", () => {
    const last = gate.then[2].body[1];
    expect(last.type).toBe("if");
    expect(last.condition.rules[0]).toMatchObject({ left: "$status", right: "done" });
    expect(last.then[0].config.name).toBe("$lastW");
  });
  it("refuses a pipeline without the Completed rule (control)", () => {
    const p = pipeline(); p.steps[1].body[0].condition.rules.pop();
    expect(() => mergedHistoryPipeline(p, C)).toThrow(/Completed rule/);
  });
});

import { withFitnessRoutines } from "../migrations/0461-workout-log-counts-fitness-routines.mjs";
describe("0461 withFitnessRoutines", () => {
  const merged = mergedHistoryPipeline(pipeline(), C);
  merged.steps[1].body[0].condition.rules.push({ id: "mvr", left: "$inst.fields.m.value", comparator: "IS_NOT_EMPTY", right: "" });
  const out = withFitnessRoutines(merged, { fitnessContainerId: "fit", movementFieldId: "m" });
  it("collects the Fitness routines' modules first", () => {
    expect(out.steps[1].config).toMatchObject({ type: "INIT_VAR", name: "$fitMods" });
    expect(JSON.stringify(out.steps[2])).toContain('"right":"fit"');
  });
  it("a row counts with a movement OR as a Fitness routine", () => {
    const gate = out.steps[3].body[0];
    const or = gate.condition.rules.find((r) => r.id === "wl0461or");
    expect(or.rules.map((r) => r.left)).toEqual(["$inst.fields.m.value", "$fitMods"]);
  });
  it("a row with no movement lists itself", () => {
    const branch = out.steps[3].body[0].then.find((s) => s.id === "wl0461hasMv");
    expect(branch.then[0].type).toBe("loop");
    expect(branch.else[0].config.value.label).toBe("$inst.label");
  });
});
