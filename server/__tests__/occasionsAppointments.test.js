import { describe, it, expect } from "vitest";
import { patchPlaceDatedWork, addOccasionExclusion, occasionDateFieldOf } from "../migrations/0488-occasions-hold-the-days-appointments.mjs";
import { occasionSteps } from "../migrations/0453-schedule-occasions-and-undated-todos.mjs";

const ids0453 = { occasionsTplId: "OCC", dateFieldId: "D", timeslotFieldId: "T", scheduleTypeFieldId: "ST", holidayTypeId: "HOL" };
const pdw = () => ({ steps: [{ type: "loop", overExpr: "$activePeriodDates", as: "$day", body: [
  { id: "x", type: "if", condition: { operator: "AND", rules: [{ left: "$dayColId", comparator: "IS_NOT_EMPTY" }] }, then: occasionSteps(ids0453), else: [] },
] }] });
const json = (p) => JSON.stringify(p);

describe("0488 — appointments in Occasions", () => {
  it("adds the pass inside the Occasions block, once", () => {
    const { pipeline, changed } = patchPlaceDatedWork(pdw(), { appointmentsId: "APPTS", dateFieldId: "D" });
    expect(changed).toBe(true);
    expect(json(pipeline)).toContain('"occasionAppt":true');
    expect(json(pipeline)).toContain('"right":"APPTS"');
    const again = patchPlaceDatedWork(pipeline, { appointmentsId: "APPTS", dateFieldId: "D" });
    expect(again.changed).toBe(false);
    expect(json(again.pipeline)).toBe(json(pipeline));
  });
  it("refuses a pipeline with no Occasions block", () => {
    expect(() => patchPlaceDatedWork({ steps: [] }, { appointmentsId: "A", dateFieldId: "D" })).toThrow();
  });
  it("reads the Date field off 0453's sweep", () => {
    expect(occasionDateFieldOf(pdw())).toBe("D");
  });
  it("adds an occasion exclusion beside every feed-copy exclusion, with the same prefix", () => {
    const p = { steps: [{ type: "if", condition: { operator: "AND", rules: [
      { left: "$item.meta.feedSourceId", comparator: "IS_EMPTY" }, { left: "$item.fields.C.value", comparator: "IS", right: true } ] }, then: [], else: [] },
      { type: "action", config: { type: "FIND", predicate: { operator: "AND", rules: [{ left: "meta.feedSourceId", comparator: "IS_EMPTY" }] } } }] };
    const { pipeline, added } = addOccasionExclusion(p);
    expect(added).toBe(2);
    expect(json(pipeline)).toContain('"left":"$item.meta.occasion","comparator":"IS_EMPTY"');
    expect(json(pipeline)).toContain('"left":"meta.occasion","comparator":"IS_EMPTY"');
    expect(addOccasionExclusion(pipeline).added).toBe(0);
  });
  it("covers a loop that picks rows under the Schedule page with no feed rule", () => {
    const p = { steps: [{ type: "loop", over: "$allInstances", as: "$t", predicate: { operator: "AND", rules: [
      { left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" } ] }, body: [] }] };
    expect(json(addOccasionExclusion(p).pipeline)).toContain('"left":"meta.occasion"');
  });
  it("leaves a lookup over CONTAINERS alone — an Occasions copy is never one", () => {
    const p = { steps: [
      { type: "action", config: { type: "FIND", over: "$allContainers", predicate: { operator: "AND", rules: [{ left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" }] } } },
      { type: "loop", overExpr: "$allContainers", as: "$col", body: [{ type: "if", condition: { operator: "AND", rules: [{ left: "$col._ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" }] }, then: [], else: [] }] },
      { type: "loop", overExpr: "$allInstances", as: "$it", body: [{ type: "if", condition: { operator: "AND", rules: [{ left: "$it._ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" }] }, then: [], else: [] }] },
    ] };
    const { pipeline, added } = addOccasionExclusion(p);
    expect(added).toBe(1);
    expect(json(pipeline)).toContain('"left":"$it.meta.occasion"');
    expect(json(pipeline)).not.toContain('"left":"$col.meta.occasion"');
  });
  it("never adds to an OR group (it would widen it)", () => {
    const p = { steps: [{ type: "if", condition: { operator: "OR", rules: [{ left: "$x.meta.feedSourceId", comparator: "IS_EMPTY" }, { left: "$x.y", comparator: "IS", right: 1 }] }, then: [], else: [] }] };
    const out = addOccasionExclusion(p);
    expect(out.added).toBe(0);
    expect(out.skippedOr).toBe(1);
  });
});
