// Drives 0453's Occasions steps + 0488's appointments pass through the REAL executor.
import { describe, it, expect, beforeEach } from "vitest";
import { executePipeline, applyEffectsToLiveOccs } from "../helpers/operationExecutor";
import { occasionSteps } from "../../../server/migrations/0453-schedule-occasions-and-undated-todos.mjs";
import { patchPlaceDatedWork, addOccasionExclusion } from "../../../server/migrations/0488-occasions-hold-the-days-appointments.mjs";

const DATE = "f-date", COMPLETED = "f-done", DAY = "2026-08-10", OTHER = "2026-08-11";
let occ, mods;
const fv = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v, flow: "in" }]));
const add = (id, parentId, { role = "instance", fields = {}, kids = [], meta = {}, moduleId } = {}) => {
  occ[id] = { id, role, moduleId: moduleId || `m-${id}`, parentId, fields: fv(fields), occurrences: kids, meta };
  mods[occ[id].moduleId] = { id: occ[id].moduleId, label: id, role, fieldBindings: [] };
  if (parentId && occ[parentId]) occ[parentId].occurrences.push(id);
};
const ctx = () => ({ state: { grid: { _id: "g", activeFilterValues: {} }, gridId: "g", modules: Object.values(mods), occurrencesById: occ, modulesById: mods, fields: [], fieldsById: {}, operations: [] },
  occurrencesById: occ, modulesById: mods, fieldsById: {}, operationsById: {} });
const run = (op) => { const u = executePipeline(op, ctx(), {}) || []; applyEffectsToLiveOccs(occ, u); return u; };
const opFor = (day) => {
  const base = { steps: [{ type: "loop", overExpr: `json:["${day}"]`, as: "$day", body: [
    { id: "a", type: "action", config: { type: "INIT_VAR", name: "$dayColId", expr: "literal:col" } },
    { id: "b", type: "if", condition: { operator: "AND", rules: [{ left: "$dayColId", comparator: "IS_NOT_EMPTY" }] },
      then: occasionSteps({ occasionsTplId: "occ-tpl", dateFieldId: DATE, timeslotFieldId: "f-ts", scheduleTypeFieldId: "f-st", holidayTypeId: "hol" }), else: [] },
  ] }] };
  return { id: "pdw", name: "PDW", pipeline: patchPlaceDatedWork(base, { appointmentsId: "appts", dateFieldId: DATE }).pipeline };
};
const occasionKids = () => occ.occasions.occurrences.map((id) => occ[id]).filter(Boolean);

beforeEach(() => {
  occ = {}; mods = {};
  add("sched", null, { role: "page" });
  add("col", "sched", { role: "container" });
  add("occasions", "col", { role: "container", meta: { copyLinkSource: "occ-tpl" } });
  add("tasks", null, { role: "page" });
  add("appts", "tasks", { role: "container" });
  add("dentist", "appts", { fields: { [DATE]: DAY } });
  add("later", "appts", { fields: { [DATE]: OTHER } });
  add("chore", "tasks", { fields: { [DATE]: DAY } });     // dated that day, not an appointment
});

describe("a day's Occasions holds its appointments", () => {
  it("copy-links that day's appointments, and only them", () => {
    run(opFor(DAY));
    const kids = occasionKids();
    expect(kids.map((k) => k.meta.copyLinkSource)).toEqual(["dentist"]);
    expect(kids[0].meta.occasion).toBe(true);
    expect(kids[0].linkedGroupId).toBeTruthy();
    expect(kids[0].linkedGroupId).toBe(occ.dentist.linkedGroupId);
  });
  it("a second run adds nothing", () => {
    run(opFor(DAY)); run(opFor(DAY));
    expect(occasionKids()).toHaveLength(1);
  });
  it("an appointment moved to another day leaves this day's Occasions", () => {
    run(opFor(DAY));
    occ.dentist.fields[DATE] = { value: OTHER, flow: "in" };
    const copy = occasionKids()[0]; copy.fields[DATE] = { value: OTHER, flow: "in" };
    const u = run(opFor(DAY));
    expect(u.some((e) => e._effect === "DELETE_ITEM" || e._effect === "DELETE_OCCURRENCE" || /DELETE/.test(e._effect || ""))).toBe(true);
  });
  it("an appointment moved out of Appointments leaves Occasions", () => {
    run(opFor(DAY));
    occ.appts.occurrences = occ.appts.occurrences.filter((x) => x !== "dentist");
    occ.dentist.parentId = "tasks"; occ.tasks.occurrences.push("dentist");
    const u = run(opFor(DAY));
    expect(u.some((e) => /DELETE/.test(e._effect || ""))).toBe(true);
  });
  it("a tracker skipping feed copies also skips the Occasions copy", () => {
    run(opFor(DAY));
    occ.dentist.fields[COMPLETED] = { value: true, flow: "in" };
    occasionKids()[0].fields[COMPLETED] = { value: true, flow: "in" };
    const counter = { id: "t", name: "Done", pipeline: { steps: [
      { id: "1", type: "action", config: { type: "INIT_VAR", name: "$n", expr: "0" } },
      { id: "2", type: "loop", overExpr: "$allInstances", as: "$item", body: [
        { id: "3", type: "if", condition: { operator: "AND", rules: [
          { left: `$item.fields.${COMPLETED}.value`, comparator: "IS", right: "true" },
          { left: "$item.meta.feedSourceId", comparator: "IS_EMPTY" } ] },
          then: [{ id: "4", type: "action", config: { type: "ADD_TO_VAR", name: "$n", expr: "1" } }], else: [] } ] },
      { id: "5", type: "action", config: { type: "INIT_VAR", name: "$tile", expr: "$allItemsById.tile" } },
      { id: "6", type: "action", config: { type: "UPDATE", path: "$tile.fields.f-n.value", value: "$n" } } ] } };
    add("tile", "tasks");
    const count = (op) => { run(op); return occ.tile.fields["f-n"]?.value; };
    const before = count(counter);
    const after = count({ ...counter, pipeline: addOccasionExclusion(counter.pipeline).pipeline });
    expect(Number(before)).toBe(2);
    expect(Number(after)).toBe(1);
  });
});

// 0499 (user 2026-11-14: "any schedule type should be there"): any row with a Schedule Type, dated that
// day, wherever it lives — work shifts, classes in Done, holidays — and nothing without one.
import { occasionsHoldAnyScheduleType } from "../../../server/migrations/0499-occasions-hold-any-schedule-type.mjs";
describe("0499: Occasions holds every row with a Schedule Type", () => {
  const ST = "f-st";
  const op0499 = (day) => { const o = opFor(day); return { ...o, pipeline: occasionsHoldAnyScheduleType(o.pipeline, []).pipeline }; };
  beforeEach(() => {
    add("shifts", "tasks", { role: "container" });
    add("done", "tasks", { role: "container" });
    add("shift", "shifts", { fields: { [DATE]: DAY, [ST]: "employment", "f-ts": "3:00pm" } });
    add("class", "done", { fields: { [DATE]: DAY, [ST]: "class" } });
    add("holiday", "tasks", { fields: { [DATE]: DAY, [ST]: "hol" } });
    add("shiftTomorrow", "shifts", { fields: { [DATE]: OTHER, [ST]: "employment" } });
    add("span", "col", { fields: { [DATE]: DAY, [ST]: "employment" }, meta: { spanOf: "shift", copyLinkSource: "shift" } });
  });
  const sources = () => occasionKids().map((k) => k.meta.copyLinkSource).sort();
  it("copies the day's typed rows from anywhere, and nothing untyped or from another day", () => {
    run(op0499(DAY));
    expect(sources()).toEqual(["class", "holiday", "shift"]);   // not the untyped dentist/chore, not tomorrow, not the duration copy
  });
  it("is idempotent", () => {
    run(op0499(DAY)); run(op0499(DAY));
    expect(sources()).toEqual(["class", "holiday", "shift"]);
  });
  it("drops a copy whose source loses its Schedule Type", () => {
    run(op0499(DAY));
    occ.class.fields[ST] = { value: null, flow: "in" };
    const u = run(op0499(DAY));
    expect(u.some((e) => /DELETE/.test(e._effect || ""))).toBe(true);
  });
  it("the transform is idempotent and adds the Schedule Type trigger once", () => {
    const once = occasionsHoldAnyScheduleType(opFor(DAY).pipeline, []);
    const twice = occasionsHoldAnyScheduleType(once.pipeline, once.triggerObjects);
    expect(twice.changed).toBe(false);
    expect(once.triggerObjects.filter((t) => t.targetId === ST)).toHaveLength(1);
  });
});
