import { describe, it, expect } from "vitest";
import { withNutrientRows } from "../migrations/0468-ingredient-fills-every-nutrient.mjs";

describe("0468 withNutrientRows", () => {
  it("adds a sum row for each missing field, in order", () => {
    expect(withNutrientRows([{ from: "p", combine: "sum" }], ["iron", "zinc"]))
      .toEqual([{ from: "p", combine: "sum" }, { from: "iron", combine: "sum" }, { from: "zinc", combine: "sum" }]);
  });
  it("never duplicates a field already mapped (by from or to)", () => {
    const map = [{ from: "p", combine: "sum" }, { from: "x", to: "iron", combine: "sum" }];
    expect(withNutrientRows(map, ["p", "iron"])).toEqual(map);
  });
  it("is idempotent", () => {
    const once = withNutrientRows([], ["iron"]);
    expect(withNutrientRows(once, ["iron"])).toEqual(once);
  });
});
