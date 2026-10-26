// 0443 — rows in the Tasks page's Done section are stamped the day they arrive and marked Done once that day has
// passed. Drives the migration's own pipeline through the REAL executor.
import { describe, it, expect } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";
import { markDonePipeline } from "../../../server/migrations/0443-done-section-marks-at-day-end.mjs";

const DONE = "f-done", SINCE = "f-since", SEC = "sec";
const pad = (n) => String(n).padStart(2, "0");
const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = day(new Date());
const yesterday = day(new Date(Date.now() - 86400000));

function run(rows) {
  const occurrencesById = { [SEC]: { id: SEC, moduleId: "m-sec", occurrences: Object.keys(rows), fields: {} } };
  for (const [id, fields] of Object.entries(rows)) occurrencesById[id] = { id, moduleId: "m-task", parentId: SEC, fields };
  const modulesById = { "m-sec": { id: "m-sec", role: "container", label: "Done" }, "m-task": { id: "m-task", role: "instance", label: "Task" } };
  const ctx = { state: { grid: { _id: "g" }, gridId: "g", fields: [], modules: Object.values(modulesById), occurrencesById, modulesById, fieldsById: {}, operationsById: {}, operations: [] },
    fieldsById: {}, occurrencesById, modulesById, operationsById: {}, operations: [] };
  const out = executePipeline({ id: "op", name: "Tasks: Mark Done", pipeline: markDonePipeline({ sectionId: SEC, doneId: DONE, sinceId: SINCE }) }, ctx, { type: "LoadOp" }, {});
  const effects = Array.isArray(out) ? out : (out?.effects || out?.updates || []);
  const w = {};
  for (const e of effects) { const id = e.itemId || e.occurrenceId; const f = e.fieldId; if (id && f) (w[id] ||= {})[f] = e.value; }
  return w;
}

describe("Tasks: Mark Done", () => {
  it("stamps a row new to Done with today, and leaves it unmarked", () => {
    expect(run({ a: {} })).toEqual({ a: { [SINCE]: today } });
  });
  it("marks a row that has been in Done since an earlier day", () => {
    expect(run({ b: { [SINCE]: { value: yesterday } } })).toEqual({ b: { [DONE]: true } });
  });
  it("leaves a row dragged in today, and a row already marked, alone", () => {
    expect(run({ c: { [SINCE]: { value: today } }, d: { [DONE]: { value: true }, [SINCE]: { value: yesterday } } })).toEqual({});
  });
});
