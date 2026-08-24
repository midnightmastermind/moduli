// The two decisions the DSLD provider makes, and why each exists.
//
// These do NOT hit the network — the network measurements that justified them
// are in the file's header. What is tested here is the rule.
import { describe, it, expect } from "vitest";
import { rankAndDedupe, supplementFields } from "../utils/providers/dsld.js";

const hit = (id, fullName, brandName, offMarket = 0) =>
  ({ _id: String(id), _source: { fullName, brandName, offMarket } });

describe("rankAndDedupe", () => {
  it("drops discontinued products — measured, 7 of 10 `creatine` hits are archived", () => {
    const out = rankAndDedupe([
      hit(1, "Creatine Fruit Punch", "GNC", 1),
      hit(2, "Creatine Alkaline", "BPI Sports", 0),
    ]);
    expect(out.map((h) => h._id)).toEqual(["2"]);
  });

  it("collapses the SAME product listed current AND archived", () => {
    // The real pair: `Creatine Alkaline · BPI Sports` is both 43261 (current)
    // and 25731 (archived). A dropdown listing one product twice is unusable.
    const out = rankAndDedupe([
      hit(43261, "Creatine Alkaline", "BPI Sports", 0),
      hit(25731, "Creatine Alkaline", "BPI Sports", 1),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]._id).toBe("43261");
  });

  it("dedupes case-insensitively, and keeps two brands of ONE product apart", () => {
    const out = rankAndDedupe([
      hit(1, "Vitamin D", "Endo-met"),
      hit(2, "VITAMIN D", "endo-met"),   // same product, different casing
      hit(3, "Vitamin D", "Spring Valley"),  // a DIFFERENT product
    ]);
    expect(out.map((h) => h._id)).toEqual(["1", "3"]);
  });

  it("FAILS OPEN — an archive-only product is still the right answer", () => {
    // The discriminating case for the filter. A niche supplement that exists
    // only in the archive must not come back as "no results", which reads as
    // "we have never heard of it".
    const out = rankAndDedupe([hit(1, "Obscure Blend", "Tiny Co", 1)]);
    expect(out.map((h) => h._id)).toEqual(["1"]);
  });

  it("refuses a row with no name at all — it cannot be chosen meaningfully", () => {
    expect(rankAndDedupe([{ _id: "1", _source: { offMarket: 0 } }])).toEqual([]);
  });

  it("survives junk", () => {
    expect(rankAndDedupe(null)).toEqual([]);
    expect(rankAndDedupe([null, { nope: 1 }])).toEqual([]);
  });
});

describe("supplementFields", () => {
  const src = {
    brandName: "Vitamin World",
    physicalState: { langualCodeDescription: "Softgel Capsule" },
    productType: { langualCodeDescription: "Single Vitamin and Mineral" },
    netContents: [{ display: "200 Rapid Release Softgel(s)" }],
    allIngredients: [
      { ingredientGroup: "Vitamin D", category: "vitamin" },
      { ingredientGroup: "Calcium", category: "mineral" },
      { ingredientGroup: "Magnesium", name: "Magnesium Stearate", category: "mineral" },
      { ingredientGroup: "Sugar", name: "Glucose Syrup", category: "sugar" },
      { ingredientGroup: "Calories", name: "Calories", category: "other" },
    ],
  };

  it("reads the fields a person would want off a label", () => {
    const f = supplementFields(src);
    expect(f.Brand).toBe("Vitamin World");
    expect(f.Form).toBe("Softgel Capsule");
    expect(f["Product type"]).toBe("Single Vitamin and Mineral");
    expect(f["Net contents"]).toBe("200 Rapid Release Softgel(s)");
  });

  it("lists NUTRIENTS, not the sugar and the calorie line", () => {
    // A list led by its excipients describes the pill rather than what you
    // take it for.
    const ing = supplementFields(src).Ingredients;
    expect(ing).toContain("Vitamin D");
    expect(ing).not.toContain("Sugar");
    expect(ing).not.toContain("Calories");
  });

  it("does not repeat an ingredient group that appears twice", () => {
    expect(supplementFields(src).Ingredients.match(/Magnesium/g)).toHaveLength(1);
  });

  it("omits a key rather than writing an empty one", () => {
    expect(supplementFields({})).toEqual({});
    expect(supplementFields({ netContents: [] })["Net contents"]).toBeUndefined();
  });
});
