// server/__tests__/liveSystemBuilders.test.js
import { describe, it, expect } from "vitest";
import { buildGridDoc, buildScheduleFilters, buildDailyRoutineTemplate, buildDayPageTemplate, makeScheduleBuildDayOp, makeStampDateTimeSlotOp } from "../utils/liveSystemBuilders.js";

describe("buildGridDoc", () => {
  it("creates a Daily namedFilter on dateFieldId with empty activeFilterValues", () => {
    const g = buildGridDoc({ userId: "u1", gridName: "Live Grid", manifestId: "m1", dateFieldId: "DF" });
    expect(g.name).toBe("Live Grid");
    expect(g.activeFilterId).toBe("filter_daily");
    expect(g.namedFilters[0].conditions[0]).toMatchObject({ fieldId: "DF", comparator: "SAME_DAY", isNav: true });
    expect(g.activeFilterValues).toEqual({});
  });
});

describe("buildScheduleFilters", () => {
  it("returns a date filter + a timeslot select filter", () => {
    const f = buildScheduleFilters({ schedFilterId: "s", timeslotFilterId: "t", dateFieldId: "DF", timeslotFieldId: "TS", timeslotLabels: ["6:00am"] });
    expect(f).toHaveLength(2);
    expect(f[0]).toMatchObject({ id: "s", fieldId: "DF", active: true });
    expect(f[1]).toMatchObject({ id: "t", fieldId: "TS", style: "select", options: ["6:00am"] });
    expect(f[0].condition.rules).toHaveLength(2);
    expect(f[0].condition.rules[1]).toMatchObject({ comparator: "IS_EMPTY" });
  });
});

describe("buildDailyRoutineTemplate", () => {
  it("emits one slot template occ per timeSlot with identitySignature and routine children", async () => {
    const occs = [];
    const mkOcc = async (d) => { const id = d.id || `o${occs.length}`; occs.push({ ...d, id }); return id; };
    const ModuleStub = function (o) { Object.assign(this, o); this.save = async () => {}; };
    const rootOccId = await buildDailyRoutineTemplate({
      userId: "u", gridId: "g", timeSlots: [{ hour: 6, minute: 0, label: "6:00am" }, { hour: 7, minute: 0, label: "7:00am" }],
      timeslotFieldId: "TS",
      routineBySlot: { "6:00am": [{ sourceModId: "SRC", label: "Drink Water" }] },
      tplManifestRootFolderId: "tplRoot", mkOcc, Module: ModuleStub,
      findModule: async () => ({ fieldBindings: [{ fieldId: "c", role: "input", order: 0 }] }),
    });
    const slotOccs = occs.filter(o => o.identitySignature?.startsWith("slot:"));
    expect(slotOccs).toHaveLength(2);
    const root = occs.find(o => o.id === rootOccId);
    expect(root.meta).toMatchObject({ templateName: "Daily Routine", templateModule: true });
  });
});

describe("schedule ops", () => {
  it("Build Day op is priority-1, onLoad+onFilterChange, references date/due/timeslot fields", () => {
    const op = makeScheduleBuildDayOp({ userId: "u", gridId: "g", dateFieldId: "DF", dueFieldId: "DUE", timeslotFieldId: "TS" });
    expect(op.name).toBe("Schedule: Build Day");
    expect(op.triggerTypes).toEqual(["onLoad", "onFilterChange"]);
    expect(op.triggerObjects.every(t => t.priority === 1)).toBe(true);
    expect(JSON.stringify(op.pipeline)).toContain("DF");
    expect(JSON.stringify(op.pipeline)).toContain("DUE");
  });
  it("Stamp op writes the timeslot field on onCreate under the hub panel", () => {
    const op = makeStampDateTimeSlotOp({ userId: "u", gridId: "g", timeslotFieldId: "TS", hubPanelModuleId: "HUB" });
    expect(op.triggerObjects[0]).toMatchObject({ eventType: "onCreate", targetId: "HUB" });
    expect(JSON.stringify(op.pipeline)).toContain("TS");
  });
});

describe("buildDayPageTemplate", () => {
  it("creates a doc-page root referencing a textblock child with the {Date} token", async () => {
    const occs = [];
    const mkOcc = async (d) => { const id = d.id || `o${occs.length}`; occs.push({ ...d, id }); return id; };
    const ModuleStub = function (o) { Object.assign(this, o); this.save = async () => {}; };
    const rootOccId = await buildDayPageTemplate({
      userId: "u", gridId: "g", tplManifestRootFolderId: "tplRoot", mkOcc, Module: ModuleStub,
    });
    const root = occs.find(o => o.id === rootOccId);
    expect(root.meta).toMatchObject({ templateName: "Day Page", templateModule: true });
    const child = occs.find(o => o.id !== rootOccId);
    expect(JSON.stringify(child.textmap)).toContain("Day Page - {Date}");
  });
});
