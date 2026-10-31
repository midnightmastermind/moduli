// 0469 — the scaling op (nutrient = per-100g × Grams ÷ 100) and the grocery toggle, through the real executor.
import { describe, it, expect } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";
import { scalePipeline, groceryTogglePipeline } from "../../../server/migrations/0469-ingredients-usda-grams-grocery.mjs";

const PER = "fPerCal", BASE = "fCal", PER2 = "fPerIron", BASE2 = "fIron", G = "fGrams", BC = "uew6sn6WWXin";
function run(pipeline, fields) {
  const occurrencesById = { row: { id: "row", moduleId: "m", parentId: "board", fields } };
  const modulesById = { m: { id: "m", role: "instance", label: "Spinach" } };
  const ctx = { state: { grid: { _id: "g" }, gridId: "g", fields: [], modules: Object.values(modulesById), occurrencesById, modulesById, fieldsById: {}, operationsById: {}, operations: [] },
    fieldsById: {}, occurrencesById, modulesById, operationsById: {}, operations: [] };
  const out = executePipeline({ id: "op", name: "x", pipeline }, ctx, { type: "onChange", occurrenceId: "row" }, {});
  const effects = Array.isArray(out) ? out : (out?.effects || out?.updates || []);
  const w = {};
  for (const e of effects) if (e._effect === "UPDATE_ITEM_FIELD" || e.fieldId) w[e.fieldId] = e.value;
  return w;
}
const scale = () => scalePipeline([{ per: PER, base: BASE }, { per: PER2, base: BASE2 }], G);

describe("0469 scale to grams", () => {
  it("empty Grams counts as 100g: the plain value is the per-100g value", () => {
    expect(run(scale(), { [PER]: { value: 23 }, [PER2]: { value: 2.71 } })).toMatchObject({ [BASE]: 23, [BASE2]: 2.71 });
  });
  it("150g scales every nutrient by 1.5, rounded to 2 decimals", () => {
    expect(run(scale(), { [PER]: { value: 23 }, [PER2]: { value: 2.71 }, [G]: { value: 150 } })).toMatchObject({ [BASE]: 34.5, [BASE2]: 4.07 });
  });
  it("a nutrient with no per-100g value is left alone (a typed value survives)", () => {
    const w = run(scale(), { [PER]: { value: 23 }, [BASE2]: { value: 9 }, [G]: { value: 200 } });
    expect(w[BASE]).toBe(46);
    expect(BASE2 in w).toBe(false);
  });
});

describe("0469 grocery toggle", () => {
  it("adds grocery when it is not there, keeping the other tags", () => {
    expect(run(groceryTogglePipeline(), { [BC]: { value: ["ingredient"] } })[BC]).toEqual(["ingredient", "grocery"]);
  });
  it("takes grocery off when it is there", () => {
    expect(run(groceryTogglePipeline(), { [BC]: { value: ["ingredient", "grocery"] } })[BC]).toEqual(["ingredient"]);
  });
  it("works on a row with no tags yet", () => {
    expect(run(groceryTogglePipeline(), {})[BC]).toEqual(["grocery"]);
  });
});
