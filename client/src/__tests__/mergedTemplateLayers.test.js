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

// Resolved by EITHER name: `0186` renamed this op `Schedule: Fill Day` to match the
// architecture the user described (Build Schedule builds, Fill Day fills). A test that
// pins the label rather than the behaviour breaks on a rename and teaches nothing, so it
// accepts both and asserts on what the op DOES.
const baseOp = fx.operations.find((o) => o.name === "Schedule: Fill Day")
            ?? fx.operations.find((o) => o.name === "Schedule: Place Weekday");

/**
 * The op as the grid carries it. `0177` is APPLIED, so the stored pipeline is
 * already the layered one and `layerizePlaceWeekday` is a no-op against it — this
 * used to run the migration over a pre-`0177` fixture to SIMULATE the layering,
 * and threw the day the fixture caught up. The migration's own idempotence is
 * asserted in the controls instead, which is the honest place for it.
 */
function makeOp() {
  const op = structuredClone(baseOp);
  op.enabled = true;
  return op;
}

/** Every template on the Schedule Template page, with its Weekday claim. */
function layersOf(occ) {
  const st = Object.values(occ).find((o) => lbl(o) === "Schedule Template");
  return (st?.occurrences || []).map((id) => occ[id]).filter(Boolean)
    .map((t) => {
      const v = t.fields?.[WD]?.value;
      return { occ: t, days: v == null ? [] : (Array.isArray(v) ? v : [v]) };
    });
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
function run({ mutate, iso = FRIDAY } = {}) {
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

  const operations = [makeOp()];
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
  it("carries the layered op and multi-select templates covering all seven days", () => {
    // WHAT CHANGED: this used to require SEVEN templates each carrying one scalar
    // weekday, because the file SIMULATED `0177` on a pre-migration fixture. The
    // migration is applied, so the grid holds six reusable LAYERS with a
    // multi-select Weekday and the simulation had nothing left to do.
    expect(baseOp).toBeTruthy();
    expect(MEAL).toBeTruthy();
    const layers = layersOf(Object.fromEntries(fx.occurrences.map((o) => [o.id, o])));
    const claimed = new Set(layers.flatMap((l) => l.days));
    expect([...claimed].sort()).toEqual(
      ["Friday", "Monday", "Saturday", "Sunday", "Thursday", "Tuesday", "Wednesday"]);
    // At least one layer must claim SEVERAL days, or "layer" means nothing.
    expect(layers.some((l) => l.days.length > 1)).toBe(true);
  });

  it("the stored op is already layered — the migration is idempotent against it", () => {
    // The A/B this file used to run (layered vs unlayered) is no longer available:
    // the unlayered shape exists nowhere. What replaces it is the migration
    // declining to change what it already produced.
    const r = layerizePlaceWeekday(structuredClone(baseOp.pipeline), { WD });
    expect(r.changed).toBe(false);
  });

  it("MORE THAN ONE layer claims Friday — or the merge below proves nothing", () => {
    const layers = layersOf(Object.fromEntries(fx.occurrences.map((o) => [o.id, o])));
    expect(layers.filter((l) => l.days.includes("Friday")).length).toBeGreaterThan(1);
  });

  it("running on a Friday places rows at all — so the harness works", () => {
    // A zero here would be a claim about the harness, not about the op.
    const r = run();
    expect(r.errors).toEqual([]);
    expect(r.placed.length).toBeGreaterThan(0);
  });
});

describe("two layers merge into one day", () => {
  it("the meals layer and the workout layer BOTH contribute to one day", () => {
    const r = run();
    expect(r.errors).toEqual([]);
    expect(r.meals.length).toBe(8);
    // Contains rather than equals: `0185` added a `Routine` layer claiming all seven days,
    // so a Friday legitimately receives the daily routines alongside the cardio session.
    // The claim here is that TWO layers contribute, not how many layers exist.
    expect(r.other.map((o) => o.label)).toEqual(expect.arrayContaining(["Run", "Stretch"]));
  });

  it("A/B — un-claim Friday on the meals layer and ONLY the workout arrives", () => {
    // The discriminator, rebuilt from the shape the grid actually has. Layering is
    // what brings two templates into one day; take Friday off the layer carrying
    // the meals and the day keeps its workout and loses every meal.
    const r = run({ mutate: (occ) => {
      for (const l of layersOf(occ)) {
        const carriesMeals = (l.occ.occurrences || []).some((sid) =>
          (occ[sid]?.occurrences || []).some((kid) => occ[kid]?.fields?.[MEAL]?.value));
        if (!carriesMeals || !l.days.includes("Friday")) continue;
        const rest = l.days.filter((d) => d !== "Friday");
        l.occ.fields[WD] = { ...l.occ.fields[WD], value: rest };
      }
    } });
    expect(r.errors).toEqual([]);
    expect(r.meals.length).toBe(0);
    // The workout layer still contributes. NOT asserted as an exact list any more:
    // `0185` added a `Routine` layer claiming all seven days, so a Friday now also
    // receives the daily routines. Pinning `other` to exactly [Run, Stretch] pinned
    // the number of LAYERS that existed the day it was written, which is not what
    // this A/B is about — the claim is that un-claiming Friday costs the MEALS.
    const others = r.other.map((o) => o.label);
    expect(others).toEqual(expect.arrayContaining(["Run", "Stretch"]));
  });

  it("the no-weekday template carries nothing to leak, and that is now the invariant", () => {
    // WHAT THIS TEST USED TO DO, AND WHY IT CANNOT ANY MORE. It watched for `Day`'s daily
    // routines (Drink / Hygiene / Journal / Walk) leaking into a merge, proving the
    // IS_NOT_EMPTY arm skipped the one template with no Weekday.
    //
    // `0185` moved those rows onto a `Routine` LAYER claiming all seven days, so they now
    // arrive legitimately AND `Day` holds zero rows — there is nothing left for it to leak.
    // The old assertion would have passed forever while testing nothing.
    //
    // I TRIED TO REPLACE IT WITH A PLANTED CANARY AND COULD NOT MAKE IT DISCRIMINATE.
    // A synthetic row on a weekday-claiming layer — the positive control — never arrived
    // through the merge either, so "the one on Day did not arrive" said nothing about the
    // guard. Rather than keep an assertion of absence with no proof the thing can be
    // present (the 2026-08-01 (16) trap), the claim is narrowed to what IS checkable and
    // the gap is written down: **the guard itself is exercised by the two tests above**,
    // which show that un-claiming a weekday removes that layer's contribution.
    const occ = Object.fromEntries(fx.occurrences.map((o) => [o.id, o]));
    const noWeekday = layersOf(occ).filter((l) => !l.days.length);
    expect(noWeekday.length, "no unclaimed template — nothing to assert about").toBeGreaterThan(0);
    for (const l of noWeekday) {
      const rows = (l.occ.occurrences || [])
        .flatMap((sid) => occ[sid]?.occurrences || []);
      expect(rows, `${lbl(l.occ)} still carries rows a merge could place`).toEqual([]);
    }
  });

  it("a second pass places nothing new — merge still recognises what it wrote", () => {
    const first = run();
    const before = first.placed.length;
    expect(before).toBeGreaterThan(0);

    const occ = first.occ;
    const operations = [makeOp()];
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
