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
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations } from "../helpers/operationExecutor";

vi.setConfig({ testTimeout: 90000, hookTimeout: 120000 });   // two full 51-op sweeps over 3,455 occurrences run in the beforeAll — the default 10s hook cap fails only under the FULL suite, where the file competes for the pool
// PINNED TO THE FIXTURE'S OWN DAY COLUMN.
//
// These assertions are about "today's column", and the ops resolve `$today` from
// the wall clock — so an unpinned suite is green the day the fixture is exported
// and red the next morning. All three files that read this fixture went red at
// midnight on 2026-08-23, which is the failure CLAUDE.md 2026-08-20 (2) records:
// *"a suite that fails by the calendar gets disabled rather than read."*
//
// The anchor is the DATE THE FIXTURE'S DAY COLUMN CARRIES, not `_exportedAt` and
// not a hardcoded day. `_exportedAt` makes the tests depend on which weekday
// somebody last ran the exporter (2026-08-21, when a Friday export left a column
// with no movements); the column's own date is a fact about the data in front of
// them, and it survives a re-export taken on any day.
function fixtureDayFrom(fx) {
  const SF = fx.fields.find((f) => f.name === "Schedule Format")?.id;
  const DATE = fx.fields.find((f) => f.name === "Date" && f.type === "date")?.id;
  const col = fx.occurrences.find((o) => o.fields?.[SF]?.value === "day-col" && o.fields?.[DATE]?.value);
  const d = col?.fields?.[DATE]?.value;
  if (!d) throw new Error("fixture carries no dated day column — cannot pin the clock to it");
  return String(d).slice(0, 10);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const DATE = "Eh7oi4HKdbHB";
let fx;
beforeAll(() => {
  fx = JSON.parse(brotliDecompressSync(
    readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString("utf8"));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${fixtureDayFrom(fx)}T12:00:00`));
});


// ── THE HARNESS CONSTRUCTS THE CONDITION IT MEASURES ───────────────────────
//
// This suite went red on 2026-08-25 when the fixture was refreshed, and the
// reason was NOT the ops. Measured: on the fixture's own day column the two
// trackers write real values and every one of them is ZERO —
//
//     column 2026-08-24 · 49 children · 87 rows in the subtree
//     Eat rows 8 · Eat rows COMPLETED 0 · anything completed at all 1
//
// so they summed 0 on the built day AND 0 on the empty day, and "does it move"
// was unanswerable. The exporter simply ran on a day the user had not ticked
// anything. The Eat rows already carry their macros (Calories 150, Protein 32,
// …) — they are just not complete.
//
// That is the failure CLAUDE.md 2026-08-20 (6) records, inverted: *"the fixture
// is a snapshot of a grid that changes hour to hour; any test whose premise is
// 'this column starts empty' is a coin flip on export timing."* Here the premise
// was "this column has completed meals". So the harness TICKS them itself and a
// control asserts the tick landed — a setup that silently matched nothing would
// put every assertion below straight back at the mercy of the exporter's clock.
//
// The SAME mutation is applied at both dates, so the only difference between the
// two sweeps is still the filter — which is what these tests are about.
function completeMealsOn(occurrencesById, fx, day) {
  const F = (name, type) => fx.fields.find(f => f.name === name && (!type || f.type === type))?.id;
  const DATEF = F("Date", "date"), FMT = F("Schedule Format"), COMP = F("Completed");
  if (!DATEF || !FMT || !COMP) throw new Error("fixture is missing Date / Schedule Format / Completed");
  const modLabel = Object.fromEntries(fx.modules.map(m => [m.id, m.label]));
  const col = Object.values(occurrencesById).find(o =>
    o.fields?.[FMT]?.value === "day-col" && String(o.fields?.[DATEF]?.value || "").slice(0, 10) === day);
  if (!col) return 0;
  let ticked = 0;
  const seen = new Set(), stack = [...(col.occurrences || [])];
  while (stack.length) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const o = occurrencesById[id];
    if (!o) continue;
    const label = o.label || modLabel[o.moduleId] || "";
    // Eat is the row `Meal Nutrition` is scoped to; the micronutrient op reads
    // the same completed meals. Matched on the row's own label, the way the
    // renderer resolves it (module label when the occurrence overrides nothing).
    if (/^eat$/i.test(label) && o.fields?.[COMP]?.value !== true) {
      o.fields = { ...o.fields, [COMP]: { ...(o.fields?.[COMP] || {}), value: true } };
      ticked++;
    }
    for (const c of (o.occurrences || [])) stack.push(c);
  }
  return ticked;
}

/** The load sweep with the date filter moved the way the user moves it. */
let _ticked = null;   // how many meals the setup completed — asserted as a control
function sweepAt(day) {
  const occurrencesById = Object.fromEntries(fx.occurrences.map(o => [o.id, structuredClone(o)]));
  // Applied at BOTH dates, so the only difference between the sweeps stays the
  // filter. Ticking is keyed to the day the fixture was built for, which is the
  // only day whose column exists.
  const n = completeMealsOn(occurrencesById, fx, builtDay());
  _ticked = _ticked === null ? n : _ticked;
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
/** The day this fixture's schedule was actually built for. */
function builtDay() {
  const fmt = fx.fields.find(f => f.name === "Schedule Format")?.id;
  const date = fx.fields.find(f => f.name === "Date" && f.type === "date")?.id;
  const cols = fx.occurrences
    .filter(o => o.fields?.[fmt]?.value === "day-col")
    .map(o => String(o.fields?.[date]?.value || "").slice(0, 10))
    .filter(Boolean).sort();
  if (!cols.length) throw new Error("fixture has no day column — nothing to sweep for");
  return cols[cols.length - 1];      // the newest column the export caught
}

const movedFor = (a, b, opName) => {
  const keys = [...a.keys()].filter(k => k.startsWith(opName + "::"));
  return { wrote: keys.length, moved: keys.filter(k => a.get(k) !== b.get(k)).length };
};

afterAll(() => { vi.useRealTimers(); });

describe("a tracker follows the date filter on the page it lives on", () => {
  let onDay, offDay;
  beforeAll(() => {
    // DERIVED FROM THE FIXTURE, never hardcoded. The fixture is one day's
    // snapshot of a live grid that rebuilds its day column every morning, so a
    // literal date silently stops matching any column the next time the fixture
    // is re-exported — and the controls below then read 0 and every claim after
    // them is vacuous. That is exactly how this suite broke on 2026-08-24.
    onDay = sweepAt(builtDay());
    offDay = sweepAt("2026-07-04");   // no column, no rows
  });

  it("CONTROL — the harness actually completed the meals it measures", () => {
    // Without this, an export whose Eat rows are named differently would tick
    // NOTHING and every "moved" assertion below would be vacuous again — which
    // is precisely how this suite spent three days red.
    expect(_ticked).toBeGreaterThan(0);
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
