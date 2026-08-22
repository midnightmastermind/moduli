// `Schedule: Place Weekday` — one template per weekday, chosen by a FIELD.
//
// USER, 2026-08-20: *"i dont want a cycle, i just want 7 day templates"* and
// *"give the templates weekday fields"*.
//
// THIS FILE EXISTS BECAUSE THE OP IT REPLACES WAS IDEMPOTENT BY ACCIDENT.
// `Place Cycle Day` only ever placed rows carrying a Meal or Movement pick, and
// every such row was hand-signed `cycle:<label>`. The weekday op places
// EVERYTHING on its template — that is what lets a repeatable appointment land on
// a Tuesday — so its safety rests entirely on `mergeSubtreeInto`'s
// `auto:<sourceId>` fallback matching an unsigned row against itself. If that
// ever regresses, every page load re-clones the whole template into the column:
// the 23-duplicate-wrappers bug of 2026-07-31, and the reason the LAST case here
// is the one that matters most.
import { describe, it, expect, vi } from "vitest";
vi.setConfig({ testTimeout: 120000 });
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations, applyEffectsToLiveOccs } from "../helpers/operationExecutor";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(brotliDecompressSync(readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString());
const OP = "Schedule: Place Weekday";
const SCHEDULE_PAGE = "llpF10Bda5nu";
const MOVEMENT = "gF1S8FoNc4An", FORMAT = "vQ0ELZP_zxnx", DATE = "Eh7oi4HKdbHB";

const modsById = Object.fromEntries(fx.modules.map(m => [m.id, m]));
const lbl = (o) => o?.label || modsById[o?.moduleId]?.label || "?";
const weekdayField = fx.fields.find(f => f.name === "Weekday");

// Drive the op for one date. BOTH the day column's date AND the SCHEDULE PAGE's
// own filterOverride have to move: `$activePeriodDates` is resolved from
// `operation.targetOccurrenceId`'s effective filter — the op's own page — not
// from the clock and not from `grid.activeFilterValues`. The first version of
// this harness moved only the clock, and every run silently iterated the
// fixture's original date, found no column, and placed nothing.
function placeOn(isoDate, mutate) {
  const occ = Object.fromEntries(fx.occurrences.map(o => [o.id, structuredClone(o)]));
  const column = Object.values(occ).find(o => o.fields?.[FORMAT]?.value === "day-col");
  column.fields[DATE] = { value: isoDate, flow: "in" };
  const sched = occ[SCHEDULE_PAGE];
  sched.filterOverride = { ...(sched.filterOverride || {}), [DATE]: isoDate };

  // EMPTY THE COLUMN FIRST. The fixture is a snapshot of a LIVE grid, so whether
  // today's column happened to hold a placed session is a fact about the MINUTE
  // the export was taken — not about the op. These tests passed for a week only
  // because the snapshot caught an empty column; a re-export taken after the
  // morning sweep made Monday read 12 movements (6 already there + 6 placed) and
  // gave Fri/Sat/Sun 6 apiece on days that must place none.
  //
  // Slots are kept and their CONTENTS dropped, which is what "a fresh day" means
  // here. The daily routines go with them, and that is safe by measurement rather
  // than by hope: the invariant test above asserts no weekday template carries a
  // daily routine, so nothing this clears is anything `Place Weekday` places.
  const slotIds = column.occurrences || [];
  let cleared = 0;
  for (const sid of slotIds) {
    const slot = occ[sid];
    if (!slot) continue;
    for (const cid of slot.occurrences || []) { delete occ[cid]; cleared++; }
    slot.occurrences = [];
  }
  const leftAfterClear = (column.occurrences || [])
    .flatMap((sid) => occ[sid]?.occurrences || []).length;
  mutate?.(occ);

  const op = fx.operations.find(o => o.name === OP);
  const operations = [structuredClone(op)];
  const fieldsById = Object.fromEntries(fx.fields.map(f => [f.id, f]));
  const operationsById = { [operations[0].id]: operations[0] };
  const state = { grid: fx.grid, gridId: fx.grid._id, fields: fx.fields, modules: fx.modules,
    occurrencesById: occ, modulesById: modsById, fieldsById, operationsById, operations };
  const errors = [];
  const ups = runMatchingOperations(operations, null, null,
    { state, fieldsById, operationsById, occurrencesById: occ, modulesById: modsById },
    { onError: (n, e) => errors.push(`${n}: ${e?.message || e}`) });
  applyEffectsToLiveOccs(occ, ups);

  const parentOf = {};
  for (const o of Object.values(occ)) for (const c of o.occurrences || []) parentOf[c] = o.id;
  const under = (id) => { let cur = id, seen = new Set();
    while (cur && !seen.has(cur)) { seen.add(cur); const p = parentOf[cur] ?? occ[cur]?.parentId;
      if (!p) break; if (p === column.id) return true; cur = p; } return false; };
  const rows = Object.values(occ).filter(o => under(o.id) && !o.meta?.feedSourceId);
  const movements = rows.filter(o => o.fields?.[MOVEMENT]?.value).map(o => {
    const v = o.fields[MOVEMENT].value;
    return lbl(occ[(Array.isArray(v) ? v : [v])[0]]);
  });
  return { occ, errors, cleared, leftAfterClear, created: ups.filter(u => u._effect === "CREATE_ITEM").length, movements, column };
}

describe("the seven weekday templates", () => {
  it("every weekday is claimed by a template, and the field is MULTI-select", () => {
    // THE CONTROL. The op resolves its templates by matching this field, so if
    // the values were missing every assertion below would pass vacuously on an
    // op that found nothing.
    //
    // WHAT CHANGED: this used to require SEVEN templates each carrying one scalar
    // weekday. `0177` turned them into SIX reusable LAYERS with a multi-select
    // Weekday — `Meals` names all seven, `Workout — Push` names Monday — so a day
    // is built by merging every template whose Weekday CONTAINS it. Asserting
    // seven scalars pinned the shape the migration deliberately replaced.
    //
    // The invariant that survives is the one the feature actually rests on: no
    // weekday is unclaimed, and no template is left with an empty Weekday.
    expect(weekdayField).toBeTruthy();
    const st = fx.occurrences.find(o => lbl(o) === "Schedule Template");
    const vals = (st.occurrences || []).map(i => fx.occurrences.find(o => o.id === i))
      .map(t => t?.fields?.[weekdayField.id]?.value).filter(Boolean);
    expect(vals.length).toBeGreaterThan(0);
    const claimed = new Set(vals.flatMap(v => Array.isArray(v) ? v : [v]));
    expect([...claimed].sort()).toEqual(
      ["Friday", "Monday", "Saturday", "Sunday", "Thursday", "Tuesday", "Wednesday"]);
  });

  it("holds only what makes that weekday different — the daily routines are not on it", () => {
    // `Build Schedule` copies Drink / Hygiene / Hot Tub / Take Medication / Walk
    // / Journal onto every column from the `Day` template. The weekday op has no
    // row filter, so a routine left on a weekday template would be placed a
    // SECOND time, every load.
    const st = fx.occurrences.find(o => lbl(o) === "Schedule Template");
    const byId = Object.fromEntries(fx.occurrences.map(o => [o.id, o]));
    const day = (st.occurrences || []).map(i => byId[i]).find(t => lbl(t) === "Day");
    const dailyLabels = new Set();
    for (const sid of day.occurrences || [])
      for (const k of (byId[sid]?.occurrences || []).map(i => byId[i])) if (k) dailyLabels.add(lbl(k));
    expect(dailyLabels.size).toBeGreaterThan(0);           // control

    const offenders = [];
    for (const t of (st.occurrences || []).map(i => byId[i])) {
      if (!t?.fields?.[weekdayField.id]?.value) continue;
      for (const sid of t.occurrences || [])
        for (const k of (byId[sid]?.occurrences || []).map(i => byId[i]))
          if (k && dailyLabels.has(lbl(k))) offenders.push(`${lbl(t)}: ${lbl(k)}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("Schedule: Place Weekday", () => {
  // The user's own week: Mon Push · Tue Legs · Wed Pull · Thu Core+Cardio ·
  // Fri cardio only · Sat/Sun rest. Dates are a real Mon-Sun run.
  const WEEK = [
    ["2026-08-24", "Monday", ["Barbell Bench Press", "Tricep Pushdowns"], 6],
    ["2026-08-25", "Tuesday", ["Barbell Squats", "Calf Raises"], 6],
    ["2026-08-26", "Wednesday", ["Deadlifts", "Hammer Curls"], 6],
    ["2026-08-27", "Thursday", ["Planks", "Side Planks"], 6],
    ["2026-08-28", "Friday", [], 0],
    ["2026-08-29", "Saturday", [], 0],
    ["2026-08-30", "Sunday", [], 0],
  ];

  it("the harness really does empty the column first — the control", () => {
    // Without this, a clear that silently matched nothing would put every test
    // below back at the mercy of when the fixture was exported.
    const { cleared, leftAfterClear } = placeOn("2026-08-29");
    expect(cleared).toBeGreaterThan(0);      // it found rows to remove
    expect(leftAfterClear).toBe(0);          // and the column really was empty when the op ran
  });

  it.each(WEEK)("%s (%s) places that weekday's own movements", (iso, day, expected, count) => {
    const { errors, movements } = placeOn(iso);
    expect(errors).toEqual([]);
    expect(movements.length).toBe(count);
    for (const name of expected) expect(movements).toContain(name);
  });

  it("gives Thursday its Run and Stretch, and Friday those ALONE", () => {
    // The two cardio routines are the discriminator between the two templates:
    // Thursday is core + cardio, Friday is cardio only. Neither carries a
    // Movement pick, so the CREATE count is what distinguishes them.
    //
    // Measured as a DELTA against a rest day, not as an absolute. Every weekday
    // template also carries the day's meals, so an absolute count is partly a
    // count of meals — and it silently changes the moment the meal plan does.
    // Saturday is the baseline: meals and nothing else.
    const base = placeOn("2026-08-29").created;
    expect(base).toBeGreaterThan(0);                       // control: meals ARE placed
    expect(placeOn("2026-08-27").created - base).toBe(8);  // 6 core + Run + Stretch
    expect(placeOn("2026-08-28").created - base).toBe(2);  // Run + Stretch only
  });

  it("places NOTHING on a second run — the check the whole design rests on", () => {
    const first = placeOn("2026-08-24");
    expect(first.created).toBeGreaterThan(0);        // control: it did something
    const op = fx.operations.find(o => o.name === OP);
    const operations = [structuredClone(op)];
    const fieldsById = Object.fromEntries(fx.fields.map(f => [f.id, f]));
    const operationsById = { [operations[0].id]: operations[0] };
    const state = { grid: fx.grid, gridId: fx.grid._id, fields: fx.fields, modules: fx.modules,
      occurrencesById: first.occ, modulesById: modsById, fieldsById, operationsById, operations };
    const ups = runMatchingOperations(operations, null, null,
      { state, fieldsById, operationsById, occurrencesById: first.occ, modulesById: modsById }, {});
    expect(ups.filter(u => u._effect === "CREATE_ITEM").length).toBe(0);
  });

  it("places nothing when no template claims that weekday", () => {
    // Fails CLOSED. A column whose weekday no template names must produce an
    // empty day, never a fallback to some other day's session.
    const { created, movements } = placeOn("2026-08-24", (occ) => {
      // Weekday is MULTI-select since `0177`, so a strict `=== "Monday"` matched
      // nothing and this test silently stopped un-claiming the day — it placed 14
      // rows while asserting 0. Strip Monday from whichever shape the value holds.
      for (const o of Object.values(occ)) {
        const v = o.fields?.[weekdayField.id]?.value;
        if (v == null) continue;
        if (Array.isArray(v)) {
          const rest = v.filter(d => d !== "Monday");
          if (rest.length === v.length) continue;
          if (rest.length) o.fields[weekdayField.id] = { ...o.fields[weekdayField.id], value: rest };
          else delete o.fields[weekdayField.id];
        } else if (v === "Monday") {
          delete o.fields[weekdayField.id];
        }
      }
    });
    expect(created).toBe(0);
    expect(movements).toEqual([]);
  });
});
