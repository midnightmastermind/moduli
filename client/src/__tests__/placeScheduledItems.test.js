// The Schedule field's op (migration 0396) through the REAL executor over the poms fixture: an item whose
// Schedule value falls on the day is applied into that day's slot (floored to the half hour) with the day
// stamped; an all-day value lands in the day's Todo; a value that does not fall on the day places nothing.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { executePipeline } from "../helpers/operationExecutor";
import { placeScheduledPipeline } from "../../../server/migrations/0396-reminder-and-schedule-fields.mjs";

vi.setConfig({ testTimeout: 60000 });
const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(brotliDecompressSync(readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString("utf8"));
const ids = fx.grid.meta.scheduleFieldIds;
const SCHED = "fSchedule";
const DAY = fx.occurrences.filter((o) => o.fields?.[ids.scheduleFormatFieldId]?.value === "day-col").map((o) => o.fields?.[ids.dateFieldId]?.value).sort().pop();
const op = { id: "op-place", name: "Schedule: Place Scheduled Items", pipeline: placeScheduledPipeline({ ...ids, scheduleFieldId: SCHED }) };

function run(scheduleValue) {
  const occ = Object.fromEntries(fx.occurrences.map((o) => [o.id, structuredClone(o)]));
  const mods = Object.fromEntries(fx.modules.map((m) => [m.id, m]));
  mods["m-task"] = { id: "m-task", role: "instance", label: "Dentist", fieldBindings: [{ fieldId: SCHED }] };
  const tasks = Object.values(occ).find((o) => mods[o.moduleId]?.role === "container");
  occ["o-task"] = { id: "o-task", moduleId: "m-task", parentId: tasks.id, fields: { [SCHED]: { value: scheduleValue } } };
  tasks.occurrences = [...(tasks.occurrences || []), "o-task"];
  const sched = occ[ids.pageOccurrenceId];
  const dateF = Object.keys(fx.grid.activeFilterValues || {})[0];
  sched.filterOverride = { ...(sched.filterOverride || {}), [dateF]: DAY };
  const grid = { ...fx.grid, activeFilterValues: { [dateF]: DAY } };
  const fields = [...fx.fields, { id: SCHED, name: "Schedule", type: "when" }];
  const state = { grid, gridId: grid._id, fields, modules: Object.values(mods), occurrencesById: occ, modulesById: mods };
  const ctx = { state, fieldsById: Object.fromEntries(fields.map((f) => [f.id, f])), occurrencesById: occ, modulesById: mods, operationsById: {} };
  const effects = executePipeline({ ...op, targetOccurrenceId: ids.pageOccurrenceId }, ctx, null, {});
  const created = effects.filter((e) => e._effect === "CREATE_ITEM" && e.instance?.moduleId === "m-task" || e._effect === "CREATE_ITEM" && e.template?.id === "m-task");
  const roots = effects.filter((e) => e._effect === "CREATE_ITEM").map((e) => e.instance).filter((i) => i && (i.fields?.[ids.dateFieldId]));
  return { occ, effects, created, roots };
}
const parentLabel = (occ, id) => occ[id]?.fields?.[ids.timeslotFieldId]?.value;

describe("Schedule field → the day in the Schedule", () => {
  it("places a value that falls on the day in its slot, dated", () => {
    const { occ, roots } = run({ mode: "once", date: DAY, time: "14:40" });
    expect(roots).toHaveLength(1);
    expect(parentLabel(occ, roots[0].parentId)).toBe("2:30pm");
    expect(roots[0].fields[ids.dateFieldId].value).toBe(DAY);
  });
  it("an all-day value goes in the day's Todo", () => {
    const { occ, roots } = run({ mode: "once", date: DAY });
    expect(roots).toHaveLength(1);
    expect(parentLabel(occ, roots[0].parentId)).toBe("Todo");
  });
  it("a repeat that does not fall on the day places nothing", () => {
    const d = new Date(`${DAY}T12:00:00`).getDay();
    expect(run({ mode: "weekdays", days: [(d + 1) % 7], time: "09:00" }).roots).toHaveLength(0);
    expect(run({ mode: "weekdays", days: [d], time: "09:00" }).roots).toHaveLength(1);
  });
});
