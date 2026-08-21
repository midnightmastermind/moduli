// `Schedule: Place Weekday` merges EVERY template whose Weekday contains the day.
//
// USER, 2026-08-21: *"is there anyway to merge like templates too. maybe we should
// have a monday - thurs workout templates ... and a meal one where i have all my
// meals, and at game time, we merge those together through the operation"*.
//
// THE DEFECT THIS GUARDS AGAINST IS A SILENT ONE. The op used to resolve a single
// template with `FIND ... Weekday IS $wd`. A FIND that matches several rows binds
// an ARRAY and every consumer downstream throws — so a naive "widen the FIND" fix
// swaps a missing layer for a crash. The layered form is a LOOP with the match as
// an inner gate, and what has to be proven is that TWO templates both contribute
// to ONE day. A test that places a single layer passes against the OLD op too.
//
// The transform is imported from the migration's OWN export, so this cannot pass
// against a pipeline the grid does not have.
import { describe, it, expect, vi } from "vitest";
vi.setConfig({ testTimeout: 120000 });
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations, applyEffectsToLiveOccs } from "../helpers/operationExecutor";
import { layerizePlaceWeekday } from "../../../server/migrations/0177-merge-templates-as-layers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(brotliDecompressSync(readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString());

const SCHEDULE_PAGE = "llpF10Bda5nu";
const FORMAT = "vQ0ELZP_zxnx", DATE = "Eh7oi4HKdbHB", TS = "nSccAtADyUGW";
const WD = fx.fields.find((f) => f.name === "Weekday").id;
const MEAL = fx.fields.find((f) => f.name === "Meal")?.id;
const modsById = Object.fromEntries(fx.modules.map((m) => [m.id, m]));
const lbl = (o) => o?.label || modsById[o?.moduleId]?.label || "?";
const FRIDAY = "2026-08-21";   // a Friday — the token computes the weekday from the date

const baseOp = fx.operations.find((o) => o.name === "Schedule: Place Weekday");

function makeOp({ layered }) {
  const op = structuredClone(baseOp);
  if (layered) {
    const r = layerizePlaceWeekday(op.pipeline, { WD });
    if (!r.changed) throw new Error(`layerize did not apply: ${r.reason}`);
  }
  op.enabled = true;
  return op;
}

/** Templates keyed by the weekday they carry, read out of the live world. */
function templatesOf(occ) {
  const out = {};
  for (const o of Object.values(occ)) {
    const v = o.fields?.[WD]?.value;
    const day = Array.isArray(v) ? v[0] : v;
    if (day) out[String(day)] = o;
  }
  return out;
}

/**
 * Run the op over the fixture placed on `iso`. `mutate` shapes the templates.
 * Both the column date AND the Schedule page's filterOverride move, because
 * `$activePeriodDates` resolves from the op's own target page, not the clock.
 */
function run({ layered, mutate, iso = FRIDAY }) {
  const occ = Object.fromEntries(fx.occurrences.map((o) => [o.id, structuredClone(o)]));
  const column = Object.values(occ).find((o) => o.fields?.[FORMAT]?.value === "day-col");
  column.fields[DATE] = { value: iso, flow: "in" };
  const sched = occ[SCHEDULE_PAGE];
  sched.filterOverride = { ...(sched.filterOverride || {}), [DATE]: iso };

  // Start from an EMPTY day so what lands is what this op placed, not what the
  // fixture happened to be carrying. Slots are kept; only their contents go.
  for (const sid of column.occurrences || []) {
    const slot = occ[sid];
    if (slot) slot.occurrences = [];
  }
  mutate?.(occ, templatesOf(occ));

  const operations = [makeOp({ layered })];
  const fieldsById = Object.fromEntries(fx.fields.map((f) => [f.id, f]));
  const operationsById = { [operations[0].id]: operations[0] };
  const state = { grid: fx.grid, gridId: fx.grid._id, fields: fx.fields, modules: fx.modules,
    occurrencesById: occ, modulesById: modsById, fieldsById, operationsById, operations };
  const errors = [];
  const ups = runMatchingOperations(operations, null, null,
    { state, fieldsById, operationsById, occurrencesById: occ, modulesById: modsById },
    { onError: (n, e) => errors.push(`${n}: ${e?.message || e}`) });
  applyEffectsToLiveOccs(occ, ups);
  applyParentListWrites(occ, ups);

  const placed = [];
  for (const sid of column.occurrences || []) {
    const slot = occ[sid];
    for (const cid of slot?.occurrences || []) {
      const c = occ[cid];
      placed.push({ slot: String(slot.fields?.[TS]?.value ?? ""), label: c ? lbl(c) : "(unresolved)",
        isMeal: !!(c && c.fields?.[MEAL]?.value != null && c.fields[MEAL].value !== "") });
    }
  }
  return { occ, errors, placed, column,
    meals: placed.filter((p) => p.isMeal), other: placed.filter((p) => !p.isMeal) };
}

/**
 * `applyEffectsToLiveOccs` handles CREATE_ITEM / UPDATE_ITEM_* / DELETE_ITEM, but NOT
 * `UPDATE_OCCURRENCE` — the parent-list write. In the app that lands through the reducer.
 * APPLY_TEMPLATE emits its placements as exactly that, so a harness that skips it reads
 * every run as "placed nothing" no matter how well the op worked. (It did: 10 effects.)
 */
function applyParentListWrites(occ, effects) {
  for (const e of effects || []) {
    if (e?._effect !== "UPDATE_OCCURRENCE") continue;
    const patch = e.occurrence;
    if (!patch?.id) continue;
    const cur = occ[patch.id] || { id: patch.id };
    occ[patch.id] = { ...cur, ...patch };
  }
}

/** Strip every meal row out of a template, as the migration does. */
function stripMeals(occ, tpl) {
  for (const sid of tpl.occurrences || []) {
    const slot = occ[sid];
    if (!slot) continue;
    slot.occurrences = (slot.occurrences || []).filter((cid) => {
      const c = occ[cid];
      return !(c && c.fields?.[MEAL]?.value != null && c.fields[MEAL].value !== "");
    });
  }
}

/** The post-migration shape: Saturday is the all-week Meals layer, Friday is Cardio. */
function layerize(occ, t) {
  t.Saturday.fields[WD] = { value: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], flow: "in" };
  for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]) {
    t[day].fields[WD] = { value: [day], flow: "in" };
    stripMeals(occ, t[day]);
  }
}

describe("the fixture's shape — the controls", () => {
  it("carries the real op and seven scalar-weekday templates", () => {
    expect(baseOp).toBeTruthy();
    expect(MEAL).toBeTruthy();
    const t = templatesOf(Object.fromEntries(fx.occurrences.map((o) => [o.id, o])));
    expect(Object.keys(t).sort()).toEqual(
      ["Friday", "Monday", "Saturday", "Sunday", "Thursday", "Tuesday", "Wednesday"]);
  });

  it("UNLAYERED, on a Friday, places Friday's own rows — so the harness works at all", () => {
    // Without this the two-layer assertion below could pass by placing nothing
    // twice. A zero here would be a claim about the harness, not about the op.
    const r = run({ layered: false });
    expect(r.errors).toEqual([]);
    expect(r.placed.length).toBeGreaterThan(0);
    expect(r.meals.length).toBe(8);
    expect(r.other.map((o) => o.label).sort()).toEqual(["Run", "Stretch"]);
  });
});

describe("two layers merge into one day", () => {
  it("LAYERED: the Meals layer and the Friday layer BOTH contribute", () => {
    const r = run({ layered: true, mutate: layerize });
    expect(r.errors).toEqual([]);
    // meals come from the all-week layer, cardio from Friday's own
    expect(r.meals.length).toBe(8);
    expect(r.other.map((o) => o.label).sort()).toEqual(["Run", "Stretch"]);
    expect(r.meals.map((m) => m.slot).sort())
      .toEqual(["1:00pm", "11:00am", "3:00pm", "5:00pm", "7:00am", "7:00pm", "9:00am", "9:00pm"].sort());
  });

  it("A/B — the SAME data through the UNLAYERED op places only ONE layer", () => {
    // This is the assertion that makes the test discriminate. The old op resolves
    // a single template, so with the meals moved out of Friday it can only place
    // Run + Stretch and the day ends up with NO meals at all.
    const r = run({ layered: false, mutate: layerize });
    expect(r.errors).toEqual([]);
    expect(r.meals.length).toBe(0);
    expect(r.other.map((o) => o.label).sort()).toEqual(["Run", "Stretch"]);
  });

  it("a template carrying NO weekday is never merged in", () => {
    // The `Day` template sits in the same child list and must be skipped by the
    // IS_NOT_EMPTY arm — not by anything knowing its name. Its daily routines
    // (Drink, Hygiene, Journal, Walk) would show up here if it leaked in.
    const r = run({ layered: true, mutate: layerize });
    expect(r.errors).toEqual([]);
    const leaked = r.other.map((o) => o.label)
      .filter((n) => ["Drink", "Hygiene", "Journal", "Walk"].includes(n));
    expect(leaked).toEqual([]);
  });

  it("a second pass places nothing new — merge still recognises what it wrote", () => {
    const first = run({ layered: true, mutate: layerize });
    const before = first.placed.length;
    expect(before).toBeGreaterThan(0);

    const occ = first.occ;
    const operations = [makeOp({ layered: true })];
    const fieldsById = Object.fromEntries(fx.fields.map((f) => [f.id, f]));
    const operationsById = { [operations[0].id]: operations[0] };
    const ups = runMatchingOperations(operations, null, null,
      { state: { grid: fx.grid, gridId: fx.grid._id, fields: fx.fields, modules: fx.modules,
        occurrencesById: occ, modulesById: modsById, fieldsById, operationsById, operations },
        fieldsById, operationsById, occurrencesById: occ, modulesById: modsById },
      { onError: () => {} });
    applyEffectsToLiveOccs(occ, ups);

    let after = 0;
    for (const sid of first.column.occurrences || []) after += (occ[sid]?.occurrences || []).length;
    expect(after).toBe(before);
  });
});
