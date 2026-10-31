// 0466 — the snap op runs when the window opens on a past date, even if another window already stamped today.
import { describe, it, expect, vi, afterEach } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";
import { snapWhenStale } from "../../../server/migrations/0466-snap-today-when-date-is-past.mjs";

const D = "fDate", MF = "fMark", MARK = "occ-mark";
const oldPipeline = () => ({ sources: [], steps: [
  { id: "m", type: "action", config: { type: "INIT_VAR", name: "$openMarker", expr: `$allItemsById.${MARK}` } },
  { id: "if", type: "if", condition: { operator: "AND", rules: [{ id: "r", left: `$openMarker.fields.${MF}.value`, comparator: "SAME_DAY", right: "$today" }] },
    then: [], else: [
      { id: "sf", type: "action", config: { type: "SET_FILTER", fieldId: D, value: "$today" } },
      { id: "um", type: "action", config: { type: "UPDATE", path: `$openMarker.fields.${MF}.value`, value: "$today" } },
    ] },
] });

function run(pipeline, { marker, gridDate }) {
  const occurrencesById = { [MARK]: { id: MARK, moduleId: "m", fields: { [MF]: { value: marker } } } };
  const modulesById = { m: { id: "m", role: "instance", label: "Last Opened" } };
  const grid = { _id: "g", activeFilterValues: { [D]: gridDate } };
  const ctx = { state: { grid, gridId: "g", fields: [], modules: Object.values(modulesById), occurrencesById, modulesById, fieldsById: {}, operationsById: {}, operations: [] },
    fieldsById: { [D]: { id: D, type: "date" } }, occurrencesById, modulesById, operationsById: {}, operations: [] };
  const out = executePipeline({ id: "op", name: "Grid: Snap Filter To Today", pipeline }, ctx, { type: "onLoad" }, {});
  const effects = Array.isArray(out) ? out : (out?.effects || out?.updates || []);
  return effects.filter((e) => e._effect === "SET_FILTER").map((e) => e.value);
}

afterEach(() => vi.useRealTimers());
const today = () => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 31, 9, 0)); };

describe("0466 — snap to today", () => {
  it("first load of the day snaps (marker yesterday)", () => {
    today();
    expect(run(snapWhenStale(oldPipeline()).pipeline, { marker: "2026-10-30", gridDate: "2026-10-30" })).toEqual(["2026-10-31"]);
  });
  it("a window reopening on yesterday snaps even after another window stamped today", () => {
    today();
    expect(run(oldPipeline(), { marker: "2026-10-31", gridDate: "2026-10-30" })).toEqual([]);   // the old op: the bug
    expect(run(snapWhenStale(oldPipeline()).pipeline, { marker: "2026-10-31", gridDate: "2026-10-30" })).toEqual(["2026-10-31"]);
  });
  it("leaves today and a future date alone once today is stamped (control)", () => {
    today();
    const p = snapWhenStale(oldPipeline()).pipeline;
    expect(run(p, { marker: "2026-10-31", gridDate: "2026-10-31" })).toEqual([]);
    expect(run(p, { marker: "2026-10-31", gridDate: "2026-11-03" })).toEqual([]);
  });
  it("is idempotent and refuses a shape it does not know", () => {
    const once = snapWhenStale(oldPipeline()).pipeline;
    expect(snapWhenStale(once).changed).toBe(0);
    expect(() => snapWhenStale({ steps: [] })).toThrow(/marker IF/);
  });
});
