// The macro tile read 0 while every meal on the schedule carried its macros.
//
// USER, 2026-08-21: *"the macros for meals arent working"* / *"when it comes to
// updating the macro tracker"*.
//
// TWO DIFFERENT MISTAKES, ONE SYMPTOM. `Meal Nutrition` matched `templateId IS
// <the Eat module>` — but a row placed by APPLY_TEMPLATE is a CLONE with its OWN
// module, so eight meals on one column carry eight distinct modules and none of
// them is the one the rule names. `Meal History` matched `Meal Type`, a field
// with zero values and zero bindings on the whole grid.
//
// THE TEST DRIVES THE REAL EXECUTOR BOTH WAYS. Asserting the patched pipeline's
// SHAPE would prove nothing here: the old shape was perfectly well-formed and ran
// cleanly every load, and that is exactly why nobody noticed. So the fixture's
// ticked meals are summed through `runMatchingOperations` before and after.
import { describe, it, expect, vi } from "vitest";
vi.setConfig({ testTimeout: 120000 });
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations, applyEffectsToLiveOccs } from "../helpers/operationExecutor";
import { replaceRule } from "../../../server/migrations/0174-meal-trackers-match-the-pick.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(brotliDecompressSync(readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString());

const DATE = "Eh7oi4HKdbHB", COMPLETED = "tZWiPDQUDP74", FORMAT = "vQ0ELZP_zxnx";
const MEAL = fx.fields.find(f => f.name === "Meal" && f.type === "occurrence" && !f.displayEnabled).id;
const MEAL_TYPE = fx.fields.find(f => f.name === "Meal Type")?.id;
const CAL = "jddty2jAdahL", PRO = "Tz1oUY7IjMEg";
const TILES = { "Meal Nutrition": "KIuTctiiQfAL", "Meal History": "7XKtH0inSuve" };
const OUT_CAL = "D9KMAGt-4Vrr", OUT_PRO = "9fN60rViIQPY";
const modsById = Object.fromEntries(fx.modules.map(m => [m.id, m]));
const lbl = (o) => o?.label || modsById[o?.moduleId]?.label || "?";

const uid = () => Math.random().toString(36).slice(2, 12);
const newRule = (v) => ({ id: uid(), left: `${v}.fields.${MEAL}.value`, comparator: "IS_NOT_EMPTY", right: "" });

/** Apply the migration's own two edits to a pipeline copy. */
function patch(op, kind) {
  const pipe = structuredClone(op.pipeline);
  const modCount = {};
  for (const o of fx.occurrences) modCount[o.moduleId] = (modCount[o.moduleId] || 0) + 1;
  if (kind === "nutrition") {
    replaceRule(pipe,
      (r, v) => r?.comparator === "IS" && r.left === `${v || "$item"}.templateId` && (modCount[r.right] || 0) <= 1,
      (r, v) => newRule(v || "$item"));
  } else {
    replaceRule(pipe,
      (r, v) => r?.left === `${v || "$inst"}.fields.${MEAL_TYPE}.value`,
      (r, v) => newRule(v || "$inst"));
  }
  return pipe;
}

/**
 * Tick every meal on the day column, then run the given op. Returns the effects.
 * The TILE's own date filter has to move too — `$goalPeriod` resolves from the
 * tile's effective filter, not the clock.
 */
function runMealOp(opName, { patched }) {
  const occ = Object.fromEntries(fx.occurrences.map(o => [o.id, structuredClone(o)]));
  const column = Object.values(occ).find(o => o.fields?.[FORMAT]?.value === "day-col");
  const day = column.fields[DATE].value;
  const TILE = TILES[opName];
  occ[TILE].filterOverride = { ...(occ[TILE].filterOverride || {}), [DATE]: day };
  const trackersPage = Object.values(occ).find(o => lbl(o) === "Trackers" && modsById[o.moduleId]?.role === "page");
  if (trackersPage) trackersPage.filterOverride = { ...(trackersPage.filterOverride || {}), [DATE]: day };

  // Tick every meal row on the column and give it known macros.
  const meals = [];
  for (const sid of column.occurrences || []) {
    for (const kid of occ[sid]?.occurrences || []) {
      const k = occ[kid];
      if (!k?.fields?.[MEAL]?.value) continue;
      k.fields[COMPLETED] = { value: true, flow: "in" };
      k.fields[CAL] = { value: 100, flow: "in" };
      k.fields[PRO] = { value: 10, flow: "in" };
      k.fields[DATE] = { value: day, flow: "in" };
      meals.push(k.id);
    }
  }

  const src = fx.operations.find(o => o.name === opName);
  const op = structuredClone(src);
  if (patched) op.pipeline = patch(src, opName === "Meal Nutrition" ? "nutrition" : "history");
  const operations = [op];
  const fieldsById = Object.fromEntries(fx.fields.map(f => [f.id, f]));
  const operationsById = { [op.id]: op };
  const errors = [];
  const ups = runMatchingOperations(operations, null, null,
    { state: { grid: fx.grid, gridId: fx.grid._id, fields: fx.fields, modules: fx.modules,
      occurrencesById: occ, modulesById: modsById, fieldsById, operationsById, operations },
      fieldsById, operationsById, occurrencesById: occ, modulesById: modsById },
    { onError: (n, e) => errors.push(`${n}: ${e?.message || e}`) });
  // Read the TILE back after the effects land, not the effect objects — the
  // shape of an UPDATE effect is the executor's business and asserting on it
  // would be testing the plumbing rather than the answer.
  applyEffectsToLiveOccs(occ, ups);
  return { ups, errors, meals, day, valueOf: (fid) => occ[TILE]?.fields?.[fid]?.value };
}

describe("the fixture's own shape — the controls", () => {
  it("the day column really does hold meals, or every assertion below is vacuous", () => {
    const { meals } = runMealOp("Meal Nutrition", { patched: false });
    expect(meals.length).toBeGreaterThan(0);
  });

  it("`Meal Type` is a dead field — 0 values and 0 bindings on the whole grid", () => {
    // The reason Meal History could never have worked, pinned so a future
    // migration that starts using the field makes this fail loudly.
    expect(MEAL_TYPE).toBeTruthy();
    const valued = fx.occurrences.filter(o => {
      const v = o.fields?.[MEAL_TYPE]?.value; return v != null && v !== "";
    });
    const bound = fx.modules.filter(m => (m.fieldBindings || []).some(b => b.fieldId === MEAL_TYPE));
    expect(valued).toEqual([]);
    expect(bound).toEqual([]);
  });

  it("no placed meal row carries the module Meal Nutrition was matching", () => {
    // The defect itself. Every meal on the column is an APPLY_TEMPLATE clone
    // with its own module.
    const occ = Object.fromEntries(fx.occurrences.map(o => [o.id, o]));
    const column = fx.occurrences.find(o => o.fields?.[FORMAT]?.value === "day-col");
    const mealMods = new Set();
    for (const sid of column.occurrences || [])
      for (const kid of occ[sid]?.occurrences || [])
        if (occ[kid]?.fields?.[MEAL]?.value) mealMods.add(occ[kid].moduleId);
    expect(mealMods.size).toBeGreaterThan(1);          // several distinct modules
    // Walk for the rule rather than regexing the JSON — key order is the
    // serializer's business, and a regex that quietly matches nothing would
    // make this assertion pass for the wrong reason.
    const named = [];
    const walk = (v) => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== "object") return;
      if (typeof v.left === "string" && v.left.endsWith(".templateId") && v.comparator === "IS") named.push(v.right);
      Object.values(v).forEach(walk);
    };
    walk(fx.operations.find(o => o.name === "Meal Nutrition").pipeline);
    expect(named).toHaveLength(1);
    expect(mealMods.has(named[0])).toBe(false);
  });
});

describe("Meal Nutrition", () => {
  it("writes NOTHING before the fix, with every meal ticked — the A/B", () => {
    const { errors, valueOf } = runMealOp("Meal Nutrition", { patched: false });
    expect(errors).toEqual([]);
    expect(valueOf(OUT_CAL) ?? 0).toBe(0);
  });

  it("sums the ticked meals after the fix", () => {
    const { errors, meals, valueOf } = runMealOp("Meal Nutrition", { patched: true });
    expect(errors).toEqual([]);
    expect(valueOf(OUT_CAL)).toBe(meals.length * 100);
    expect(valueOf(OUT_PRO)).toBe(meals.length * 10);
  });
});

describe("Meal History", () => {
  it("collects no rows before the fix, and the day's meals after it", () => {
    const ROWS = "zeMzKYEUumwZ";
    const before = runMealOp("Meal History", { patched: false });
    expect(before.errors).toEqual([]);
    expect(before.valueOf(ROWS) ?? []).toEqual([]);

    const after = runMealOp("Meal History", { patched: true });
    expect(after.errors).toEqual([]);
    expect(after.valueOf(ROWS)).toHaveLength(after.meals.length);
  });
});
