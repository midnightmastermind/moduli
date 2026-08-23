// The tracker date-filter audit's BEHAVIOURAL half (0196).
//
// User, 2026-08-21: *"audit all my trackers and make sure they are updated and
// everything is updated when i select a new date filter in the respective
// spots"*. Structure has repeatedly been right here while behaviour was wrong —
// most recently in this very migration, whose first apply inserted a step
// missing `type: "action"`, which the executor SKIPS silently. The pipeline read
// correctly and did nothing. So this drives the REAL executor over the REAL grid
// at two filter dates and asserts the output MOVES.
//
// Keyed on OP NAME, not tile label: this grid has two modules labelled
// "Workout Log", and resolving a tile by label picks the wrong one (2026-08-03).
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations } from "../helpers/operationExecutor";

vi.setConfig({ testTimeout: 90000, hookTimeout: 120000 });   // two full 51-op sweeps over 3,455 occurrences run in the beforeAll — the default 10s hook cap fails only under the FULL suite, where the file competes for the pool
const here = path.dirname(fileURLToPath(import.meta.url));
const DATE = "Eh7oi4HKdbHB";
let fx;
beforeAll(() => {
  fx = JSON.parse(brotliDecompressSync(
    readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString("utf8"));
});

/** The load sweep with the date filter moved the way the user moves it. */
function sweepAt(day) {
  const occurrencesById = Object.fromEntries(fx.occurrences.map(o => [o.id, structuredClone(o)]));
  const modulesById = Object.fromEntries(fx.modules.map(m => [m.id, m]));
  const fieldsById = Object.fromEntries(fx.fields.map(f => [f.id, f]));
  const operations = fx.operations.filter(o => o.enabled !== false);
  const grid = { ...fx.grid, activeFilterValues: { ...(fx.grid.activeFilterValues || {}), [DATE]: day } };
  for (const o of Object.values(occurrencesById)) {
    if (o.filterOverride && DATE in o.filterOverride) o.filterOverride = { ...o.filterOverride, [DATE]: day };
  }
  const state = { grid, gridId: grid?._id, fields: Object.values(fieldsById),
    modules: Object.values(modulesById), occurrencesById, modulesById, fieldsById,
    operationsById: Object.fromEntries(operations.map(o => [o.id, o])), operations };
  const out = new Map();
  runMatchingOperations(operations, null, null,
    { state, fieldsById, occurrencesById, modulesById, operationsById: state.operationsById },
    { onError: () => {}, onSuccess: (opName, effects) => {
        for (const e of effects || []) {
          if (e?._effect !== "UPDATE_ITEM_FIELD") continue;
          out.set(`${opName}::${e.occurrenceId}.${e.fieldId}`, JSON.stringify(e.value));
        }
      } });
  return out;
}
const movedFor = (a, b, opName) => {
  const keys = [...a.keys()].filter(k => k.startsWith(opName + "::"));
  return { wrote: keys.length, moved: keys.filter(k => a.get(k) !== b.get(k)).length };
};

describe("a tracker follows the date filter on the page it lives on", () => {
  let onDay, offDay;
  beforeAll(() => {
    onDay = sweepAt("2026-08-22");    // the day the schedule is built for
    offDay = sweepAt("2026-07-04");   // no column, no rows
  });

  it("CONTROL — both sweeps produced a real body of writes", () => {
    // Without this every "moved" claim below could be comparing empty maps.
    expect(onDay.size).toBeGreaterThan(20);
    expect(offDay.size).toBeGreaterThan(20);
  });

  it("CONTROL — a period-free tracker does NOT move", () => {
    // Net Worth is a balance; it is legitimately date-independent. If this
    // moved, the harness would be changing something other than the filter.
    const { wrote, moved } = movedFor(onDay, offDay, "Net Worth");
    expect(wrote).toBeGreaterThan(0);
    expect(moved).toBe(0);
  });

  it("CONTROL — a tracker that already followed the filter still does", () => {
    // Meal Nutrition is one of the healthy 24. It anchors the claim that the
    // harness CAN observe movement.
    const { wrote, moved } = movedFor(onDay, offDay, "Meal Nutrition");
    expect(wrote).toBeGreaterThan(0);
    expect(moved).toBeGreaterThan(0);
  });

  it("`Nutrition: Today's Micronutrients` now follows it too — the 0196 fix", () => {
    // Before 0196 this had NO date rule at all: it summed every completed meal
    // under the Schedule and was correct only because the grid holds one day
    // column. Now: Meal Count 1 -> 0, Vitamin A 31 -> 0 on an empty day.
    const { wrote, moved } = movedFor(onDay, offDay, "Nutrition: Today's Micronutrients");
    expect(wrote).toBeGreaterThan(10);
    expect(moved).toBeGreaterThan(10);
  });

  it("the repaired ops bind $goalPeriod as a RUNNABLE step", () => {
    // The defect 0196 shipped once: a step without `type: "action"` is skipped
    // silently by the executor — no error, no log entry — so the var never
    // exists and every gate falls through its fail-open arm. A pipeline that
    // merely CONTAINS the binding is not enough; it has to be shaped like a step.
    for (const name of ["Nutrition: Today's Micronutrients",
                        "Fitness: Today's Prescription", "Workouts: Today's Session"]) {
      const op = fx.operations.find(o => o.name === name);
      const step = (op.pipeline.steps || []).find(s => s.config?.name === "$goalPeriod");
      expect(step, `${name} binds $goalPeriod`).toBeTruthy();
      expect(step.type, `${name}'s binding is runnable`).toBe("action");
    }
  });
});
