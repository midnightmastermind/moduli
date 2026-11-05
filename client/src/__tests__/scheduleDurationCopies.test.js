// A row with a Duration gets a plain copy in each further slot it covers; the copies go when it does.
import { describe, it, expect, beforeEach } from "vitest";
import { executePipeline, applyEffectsToLiveOccs } from "../helpers/operationExecutor";
import { durationCopiesOp } from "../../../server/migrations/0487-schedule-duration-copies.mjs";

const DATE = "f-date", SLOT = "f-slot", DUR = "f-dur", FMT = "f-fmt", DONE = "f-completed", NOTE = "f-note", DAY = "2026-11-05", PAGE = "page";
const LABELS = ["3:00pm", "3:30pm", "4:00pm", "4:30pm", "5:00pm", "5:30pm", "6:00pm", "6:30pm", "7:00pm", "7:30pm", "8:00pm", "8:30pm", "9:00pm"];
let occurrencesById, modulesById;
const fv = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v, flow: "in" }]));
function occ(id, { role = "instance", parentId, fields = {}, occurrences = [], meta = {}, moduleId = `m-${id}` }) {
  occurrencesById[id] = { id, moduleId, parentId, fields: fv(fields), occurrences, meta, role };
  modulesById[moduleId] = modulesById[moduleId] || { id: moduleId, role, label: id, fieldBindings: [] };
}
const slotId = (l) => `slot-${l}`;
const op = () => durationCopiesOp({ userId: "u", gridId: "g", schedulePageOccId: PAGE, dateFieldId: DATE, timeslotFieldId: SLOT, durationFieldId: DUR, scheduleFormatFieldId: FMT, omitFieldIds: [DUR, DONE], hiddenFieldIds: ["hid"] });
function run() {
  const fieldsById = {};
  const ctx = { state: { grid: { _id: "g", activeFilterValues: { [DATE]: DAY } }, gridId: "g", fields: [], modules: Object.values(modulesById), occurrencesById, modulesById, fieldsById, operationsById: {}, operations: [] }, fieldsById, operationsById: {}, occurrencesById, modulesById };
  const o = op(); o.targetOccurrenceId = PAGE;
  const fx = executePipeline(o, ctx, { type: "NavigationOp", date: DAY }) || [];
  applyEffectsToLiveOccs(occurrencesById, fx);
  return fx;
}
const copies = () => Object.values(occurrencesById).filter((o) => o.meta?.spanOf);
const copySlots = () => copies().map((c) => c.fields[SLOT].value).sort();

beforeEach(() => {
  occurrencesById = {}; modulesById = {};
  occ(PAGE, { role: "page", occurrences: ["col"] });
  occ("col", { role: "container", parentId: PAGE, fields: { [FMT]: "day-col", [DATE]: DAY }, occurrences: LABELS.map(slotId) });
  for (const l of LABELS) occ(slotId(l), { role: "container", parentId: "col", fields: { [FMT]: "slot", [SLOT]: l, [DATE]: DAY } });
  occ("cps", { parentId: slotId("4:00pm"), fields: { [SLOT]: "4:00pm", [DUR]: 240, [DATE]: DAY, [DONE]: true, [NOTE]: "zoom" } });
  occurrencesById[slotId("4:00pm")].occurrences = ["cps"];
});

describe("Schedule: Duration Copies", () => {
  it("a 4-hour row at 4:00pm gets a copy in the 7 further slots, and none in its own", () => {
    run();
    expect(copySlots()).toEqual(["4:30pm", "5:00pm", "5:30pm", "6:00pm", "6:30pm", "7:00pm", "7:30pm"].sort());
    expect(occurrencesById[slotId("5:00pm")].occurrences.length).toBe(1);
  });
  it("a copy is plain: no link, no Duration, no tick, the other values kept, its own slot and day", () => {
    run();
    const c = copies().find((x) => x.fields[SLOT].value === "6:00pm");
    expect(c.linkedGroupId).toBeFalsy();
    expect(c.fields[DUR]).toBeUndefined();
    expect(c.fields[DONE]).toBeUndefined();
    expect(c.fields[NOTE].value).toBe("zoom");
    expect(c.fields[DATE].value).toBe(DAY);
    expect(c.meta.spanOf).toBe("cps");
    expect(c.moduleId).toBe("m-cps");
  });
  it("its Duration pill is hidden, and the page's own hidden fields stay hidden", () => {
    run();
    expect(copies()[0].fieldVisibility).toEqual({ mode: "hide", fieldIds: ["hid", DUR] });
  });
  it("a second pass adds nothing", () => {
    run(); const first = copies().length; run();
    expect(copies().length).toBe(first);
  });
  it("copies are removed when the original is deleted", () => {
    run();
    delete occurrencesById.cps; occurrencesById[slotId("4:00pm")].occurrences = [];
    run();
    expect(copies()).toEqual([]);
  });
  it("a shorter Duration removes only the slots it no longer covers; a longer one adds", () => {
    run();
    occurrencesById.cps.fields[DUR].value = 60; run();
    expect(copySlots()).toEqual(["4:30pm"]);
    occurrencesById.cps.fields[DUR].value = 120; run();
    expect(copySlots()).toEqual(["4:30pm", "5:00pm", "5:30pm"]);
  });
  it("a moved start time moves the copies", () => {
    run();
    occurrencesById.cps.fields[SLOT].value = "3:00pm"; occurrencesById.cps.fields[DUR].value = 60; run();
    expect(copySlots()).toEqual(["3:30pm"]);
  });
  it("a row with no Duration, or one that is a copy, spawns nothing", () => {
    occurrencesById.cps.fields[DUR].value = 0; run();
    expect(copies()).toEqual([]);
  });
});
