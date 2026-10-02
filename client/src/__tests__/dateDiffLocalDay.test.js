// DATE_DIFF / COUNT_DATE_* read a date-only field as a LOCAL day. `new Date("2026-10-09")`
// is UTC midnight — the previous evening in every US timezone — so "Days Until Due"
// read 6 for a date 7 days out (watched on the rebuild grid, 2026-10-02).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { executePipeline } from "../helpers/operationExecutor";

const pad = (n) => String(n).padStart(2, "0");
const dayFromNow = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

function run(steps, rows) {
  const occurrencesById = {}; const modulesById = { m: { id: "m", role: "instance", label: "Task" } };
  rows.forEach((due, i) => { occurrencesById[`r${i}`] = { id: `r${i}`, moduleId: "m", fields: { due: { value: due } } }; });
  const ctx = { state: { grid: { _id: "g" }, gridId: "g", userId: "u", fields: [], modules: Object.values(modulesById), occurrencesById, modulesById, fieldsById: {}, operations: [] },
    fieldsById: {}, occurrencesById, modulesById, operationsById: {}, operations: [] };
  const out = executePipeline({ id: "op", name: "x", pipeline: { sources: [], steps } }, ctx, { type: "LoadOp" }, {});
  return Array.isArray(out) ? out : (out?.effects || out?.updates || []);
}
const step = (config) => [{ id: "s", type: "action", config }];

describe("date-only values are local days", () => {
  it("DATE_DIFF: 7 days out is 7, today is 0, yesterday is -1", () => {
    const fx = run(step({ type: "DATE_DIFF", dateFieldId: "due", targetFieldId: "dud" }), [dayFromNow(7), dayFromNow(0), dayFromNow(-1)]);
    const byRow = Object.fromEntries(fx.filter((e) => e.fieldId === "dud").map((e) => [e.occurrenceId, e.value]));
    expect(byRow).toEqual({ r0: 7, r1: 0, r2: -1 });
  });
  it("COUNT_DATE_OVERDUE: today is not overdue, yesterday is", () => {
    const fx = run(step({ type: "COUNT_DATE_OVERDUE", dateFieldId: "due", targetFieldId: "n" }), [dayFromNow(0), dayFromNow(-1)]);
    expect(fx.find((e) => e.fieldId === "n").value).toBe(1);
  });
  it("COUNT_DATE_UPCOMING: the window's last day counts, the day after does not", () => {
    const fx = run(step({ type: "COUNT_DATE_UPCOMING", dateFieldId: "due", targetFieldId: "n", withinDays: 7 }), [dayFromNow(7), dayFromNow(8), dayFromNow(0)]);
    expect(fx.find((e) => e.fieldId === "n").value).toBe(2);
  });
  it("none of the three parses a field date with a bare new Date()", () => {
    const src = fs.readFileSync(path.join(__dirname, "../helpers/operationActions.js"), "utf8");
    for (const name of ["DATE_DIFF", "COUNT_DATE_OVERDUE", "COUNT_DATE_UPCOMING"]) {
      const at = src.indexOf(`case "${name}": {`); const body = src.slice(at, src.indexOf("\n    case ", at + 10));
      expect(body).toMatch(/parseLocalDate\(dateVal\)/);
      expect(body).not.toMatch(/new Date\(dateVal\)/);
    }
  });
});
