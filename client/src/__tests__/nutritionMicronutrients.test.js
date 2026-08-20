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

  // Targets AND their units, because half of this pair is not a check.
  // `0165`: Vitamin D's target was 600 — the IU figure — while every stored
  // ingredient value was in mcg, so the tile compared mcg against IU and a fully
  // met day read as 2.5% of goal. Nothing errored. The unit is asserted here so
  // the pair can never drift apart again, and this test would have caught it.
  it("every nutrient carries the right daily target, in the right unit", () => {
    const { fieldsById } = sweep();
    const want = {
      "Total Vitamin A":  [900,  "mcg"],
      "Total Vitamin C":  [90,   "mg"],
      "Total Vitamin D":  [15,   "mcg"],   // 15 mcg == the 600 IU it used to say
      "Total Vitamin B12":[2.4,  "mcg"],
      "Total Magnesium":  [420,  "mg"],    // adult male 31-50, the user's profile
      "Total Iron":       [8,    "mg"],
      "Total Zinc":       [11,   "mg"],
      "Total Calcium":    [1000, "mg"],
      "Total Omega-3":    [250,  null],
      "Total Sodium":     [2300, "mg"],
      "Total Potassium":  [3400, "mg"],
    };
    for (const [name, [target, unit]] of Object.entries(want)) {
      const f = Object.values(fieldsById).find(x => x.name === name && x.displayEnabled);
      expect(f?.displayConfig?.targetValue, name).toBe(target);
      if (unit) expect(f?.unit, `${name} unit`).toBe(unit);
    }
  });

  it("sodium is a CEILING, not a goal to reach", () => {
    // `displayConfigTarget` defaults to op ">=", which turned the tile GREEN once
    // you went OVER your sodium limit. Every other nutrient here is a floor, and
    // asserting that is what stops a later pass "tidying" this one back.
    const { fieldsById } = sweep();
    const by = (n) => Object.values(fieldsById).find(x => x.name === n && x.displayEnabled);
    expect(by("Total Sodium")?.displayConfig?.targetOp).toBe("<=");
    for (const n of ["Total Vitamin D", "Total Calcium", "Total Iron"])
      expect(by(n)?.displayConfig?.targetOp ?? ">=", n).toBe(">=");
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
