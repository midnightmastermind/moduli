// `Nutrition: Today's Micronutrients` — the day's vitamins and minerals, from
// the meal's INGREDIENTS, against the guide's daily targets.
//
// Macros and micros live in different places: `Meal Nutrition` sums macros
// straight off the Eat rows because `0108` prefilled them, but micronutrients
// were never prefilled — they are on the ingredient rows (`0123`, `0152`). So
// this op takes a second hop through each row's `Ingredient` picks, the way
// `Tracker: Phone Calls` hops through a People array.
import { describe, it, expect, vi } from "vitest";
vi.setConfig({ testTimeout: 60000 });
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations, applyEffectsToLiveOccs } from "../helpers/operationExecutor";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(brotliDecompressSync(readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString());
const COMPLETED = "tZWiPDQUDP74";

function sweep(mutate) {
  const operations = fx.operations.filter(o => o.enabled !== false);
  const occurrencesById = Object.fromEntries(fx.occurrences.map(o => [o.id, structuredClone(o)]));
  const modulesById = Object.fromEntries(fx.modules.map(m => [m.id, m]));
  const fieldsById = Object.fromEntries(fx.fields.map(f => [f.id, f]));
  mutate?.(occurrencesById);
  const operationsById = Object.fromEntries(operations.map(o => [o.id, o]));
  const state = { grid: fx.grid, gridId: fx.grid._id, fields: Object.values(fieldsById),
    modules: Object.values(modulesById), occurrencesById, modulesById, fieldsById, operationsById, operations };
  const errors = [];
  const ups = runMatchingOperations(operations, null, null,
    { state, fieldsById, operationsById, occurrencesById, modulesById },
    { onError: (n, e) => errors.push(`${n}: ${e?.message || e}`) });
  applyEffectsToLiveOccs(occurrencesById, ups);
  const readTile = (label) => {
    const m = Object.values(modulesById).find(x => x.label === label);
    const o = Object.values(occurrencesById).find(x => x.moduleId === m?.id);
    const out = {};
    for (const b of m?.fieldBindings || []) out[fieldsById[b.fieldId]?.name] = o?.fields?.[b.fieldId]?.value;
    return out;
  };
  return { micro: readTile("Vitamins & Minerals"), intake: readTile("Intake"), errors, fieldsById };
}
const tickEveryMeal = (occ) => {
  const ing = fx.fields.find(f => f.name === "Ingredient" && !f.displayEnabled).id;
  for (const o of Object.values(occ)) if (o.fields?.[ing]?.value) o.fields[COMPLETED] = { value: true, flow: "in" };
};

describe("Nutrition: Today's Micronutrients", () => {
  it("runs without error and carries all eleven nutrients", () => {
    const { micro, errors } = sweep();
    expect(errors.filter(e => /Micronutrient/.test(e))).toEqual([]);
    for (const n of ["Total Vitamin A","Total Vitamin C","Total Vitamin D","Total Vitamin B12",
                     "Total Magnesium","Total Iron","Total Zinc","Total Calcium",
                     "Total Omega-3","Total Sodium","Total Potassium"]) {
      expect(Object.prototype.hasOwnProperty.call(micro, n), n).toBe(true);
    }
  });

  it("every nutrient carries the guide's daily target", () => {
    const { fieldsById } = sweep();
    const want = { "Total Vitamin A":900, "Total Vitamin C":90, "Total Vitamin D":600,
      "Total Vitamin B12":2.4, "Total Magnesium":400, "Total Iron":8, "Total Zinc":11,
      "Total Calcium":1000, "Total Omega-3":250, "Total Sodium":2300, "Total Potassium":3400 };
    for (const [name, target] of Object.entries(want)) {
      const f = Object.values(fieldsById).find(x => x.name === name && x.displayEnabled);
      expect(f?.displayConfig?.targetValue, name).toBe(target);
    }
  });

  // THE CONTROL. A total of zero is the correct reading when nothing has been
  // ticked as eaten, and is indistinguishable from an op that cannot add up.
  // This proves the second reading is reachable before the first is trusted.
  it("totals move once meals are ticked — zero is a reading, not a failure", () => {
    const before = sweep().micro;
    const after = sweep(tickEveryMeal).micro;
    expect(before["Total Vitamin A"]).toBe(0);
    expect(after["Total Vitamin A"]).toBeGreaterThan(0);
    expect(after["Total Calcium"]).toBeGreaterThan(0);
    expect(after["Total Iron"]).toBeGreaterThan(0);
  });

  it("Meal Count lands on the tile it is BOUND to", () => {
    // It was written to the micronutrient tile while bound to Intake, so the
    // value sat on an occurrence nothing renders. A field's value is
    // per-occurrence; binding it one place and writing it another never meets.
    const { intake } = sweep(tickEveryMeal);
    expect(intake["Meal Count"]).toBeGreaterThan(0);
  });
});
