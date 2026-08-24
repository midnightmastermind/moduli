// 0231 — the per-100g macros, and the basis that must stay in the name.
import { describe, it, expect } from "vitest";
import { NEW_FIELDS, KEY_TO_FIELD, fieldsToMint, buildFieldMap } from "../migrations/0231-per-100g-macros.mjs";
import { foodFields } from "../utils/providers/openfoodfacts.js";

describe("0231", () => {
  it("mints only what a grid is missing — a re-run mints nothing", () => {
    expect(fieldsToMint(new Set())).toHaveLength(4);
    expect(fieldsToMint(new Set(NEW_FIELDS.map(([n]) => n)))).toEqual([]);
  });

  it("EVERY provider key it maps is one openfoodfacts actually emits", () => {
    // The discriminating check. A map is authored against a KEY NAME, so
    // `Fat per 100g` vs `Fats per 100g` is the difference between a filled
    // field and one that silently stays empty.
    const keys = Object.keys(foodFields({
      nutriments: { "energy-kcal_100g": 96.17, proteins_100g: 4.6, carbohydrates_100g: 3.2, fat_100g: 10 },
    }));
    for (const k of Object.keys(KEY_TO_FIELD)) expect(keys).toContain(k);
  });

  it("never targets the per-SERVING macros — that is the whole point of it", () => {
    // Writing a per-100g number into `Calories` is the vitamin-D IU/mcg
    // mismatch: plausible on screen, wrong in every total that sums it.
    for (const name of Object.values(KEY_TO_FIELD)) {
      expect(["Calories", "Protein", "Carbs", "Fats"]).not.toContain(name);
      expect(name).toMatch(/per 100g$/);
    }
  });

  it("resolves to ids, and REPORTS a target the grid does not have", () => {
    const have = new Map([["Calories per 100g", { id: "c1" }], ["Protein per 100g", { id: "p1" }]]);
    const { map, missing } = buildFieldMap(have);
    expect(map).toEqual({ "Calories per 100g": "c1", "Protein per 100g": "p1" });
    expect(missing).toEqual(["Carbs per 100g", "Fats per 100g"]);
  });

  it("every minted field carries its unit — a number with an implied basis is the bug above", () => {
    for (const [, type, unit] of NEW_FIELDS) { expect(type).toBe("number"); expect(unit).toBeTruthy(); }
  });
});
