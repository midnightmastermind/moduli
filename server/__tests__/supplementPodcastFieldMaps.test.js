import { describe, it, expect } from "vitest";
import { NEW_FIELDS, TARGETS, fieldsToMint, buildFieldMap }
  from "../migrations/0236-supplement-and-podcast-field-maps.mjs";

const f = (id, name, type = "text") => [name, { id, name, type }];

describe("0236 — what it mints", () => {
  it("mints nothing that is already on the grid", () => {
    const have = new Set(NEW_FIELDS.map(([n]) => n));
    expect(fieldsToMint(have)).toEqual([]);
  });

  it("mints only what is missing", () => {
    const have = new Set(["Brand", "Publisher"]);
    const names = fieldsToMint(have).map(([n]) => n);
    expect(names).not.toContain("Brand");
    expect(names).not.toContain("Publisher");
    expect(names).toContain("Ingredients");
  });

  // The reuse decision, pinned in BOTH directions so a later "tidy up" that
  // mints a `Genre` field fails here instead of quietly forking the concept.
  it("does NOT mint a Genre field — iTunes' Genre reuses the existing `Genres`", () => {
    expect(NEW_FIELDS.map(([n]) => n)).not.toContain("Genre");
    const podcasts = TARGETS.find((t) => t.field === "Podcasts Listened");
    expect(podcasts.keyToField.Genre).toBe("Genres");
  });

  // THE DEFECT THIS MIGRATION EXISTS TO AVOID. iTunes' `Rating` is
  // `contentAdvisoryRating` ("Clean"/"Explicit"), and `mapProviderFields` runs a
  // `rating`-typed field through `parseLeadingNumber` — so pointing this key at
  // the grid's 1-5 star `Rating` would be refused on every pick while READING as
  // configured. It must land on a text field of its own.
  it("routes iTunes `Rating` to a TEXT field, never the star `Rating`", () => {
    const podcasts = TARGETS.find((t) => t.field === "Podcasts Listened");
    expect(podcasts.keyToField.Rating).toBe("Content rating");
    expect(podcasts.keyToField.Rating).not.toBe("Rating");
    const decl = NEW_FIELDS.find(([n]) => n === "Content rating");
    expect(decl?.[1]).toBe("text");
  });

  it("types Episodes as a number and Latest episode as a date", () => {
    expect(NEW_FIELDS.find(([n]) => n === "Episodes")?.[1]).toBe("number");
    expect(NEW_FIELDS.find(([n]) => n === "Latest episode")?.[1]).toBe("date");
  });

  it("never maps onto `Ingredient` — it is an occurrence picker, not writable", () => {
    for (const t of TARGETS) {
      expect(Object.values(t.keyToField)).not.toContain("Ingredient");
    }
  });
});

describe("0236 — buildFieldMap", () => {
  const supplements = TARGETS.find((t) => t.field === "Supplement");

  it("resolves every key to a field id", () => {
    const byName = new Map([
      f("b1", "Brand"), f("f1", "Form"), f("p1", "Product type"),
      f("n1", "Net contents"), f("i1", "Ingredients"),
    ]);
    const { map, missing } = buildFieldMap(byName, supplements.keyToField);
    expect(missing).toEqual([]);
    expect(map).toEqual({
      "Brand": "b1", "Form": "f1", "Product type": "p1",
      "Net contents": "n1", "Ingredients": "i1",
    });
  });

  // A partial map is worse than none: it reports as configured and drops the
  // unresolved keys silently, so `up` throws on a non-empty `missing`.
  it("REPORTS what it could not resolve rather than authoring a hole", () => {
    const byName = new Map([f("b1", "Brand")]);
    const { map, missing } = buildFieldMap(byName, supplements.keyToField);
    expect(map).toEqual({ "Brand": "b1" });
    expect(missing).toEqual(["Form", "Product type", "Net contents", "Ingredients"]);
  });
});
