// Every built-in provider, and the shape the dropdown depends on.
//
// These do NOT hit the network — each provider's pure decision layer is tested
// directly. What the network verified separately is recorded in each file's
// header; what belongs here is the contract the UI reads.
import { describe, it, expect, beforeAll } from "vitest";
import { availableProviders, getProvider, normalizeResult } from "../utils/searchProviders.js";
import { rankMatches } from "../utils/providers/wger.js";
import { bookFields } from "../utils/providers/openlibrary.js";
import { rankReleaseGroups } from "../utils/providers/musicbrainz.js";
import { foodFields } from "../utils/providers/openfoodfacts.js";

beforeAll(async () => {
  for (const m of ["wikipedia", "wger", "openlibrary", "musicbrainz", "openfoodfacts"]) {
    await import(`../utils/providers/${m}.js`);
  }
});

describe("the registry", () => {
  it("lists every built-in provider", () => {
    const ids = availableProviders().map((p) => p.id).sort();
    expect(ids).toEqual(["musicbrainz", "openfoodfacts", "openlibrary", "wger", "wikipedia"]);
  });

  it("every listed provider can search AND is keyless today", () => {
    for (const p of availableProviders()) {
      const impl = getProvider(p.id);
      expect(typeof impl.search).toBe("function");
      expect(typeof impl.detail).toBe("function");
      // A keyed provider with no key must not be listed at all — the failure
      // belongs at configuration, not at the user's keystroke.
      expect(p.needsKey).toBe(false);
    }
  });

  it("an unknown provider is null, never a default", () => {
    expect(getProvider("imdb")).toBeFalsy();
    expect(getProvider("")).toBeFalsy();
  });
});

describe("wger — the exercise feed", () => {
  const rows = [
    { name: "Incline Bench Press", exerciseId: 1 },
    { name: "Bench Press", exerciseId: 2 },
    { name: "Squat", exerciseId: 3 },
  ];
  it("ranks a prefix match above a mere substring", () => {
    expect(rankMatches(rows, "bench", 5).map((r) => r.name))
      .toEqual(["Bench Press", "Incline Bench Press"]);
  });
  it("an empty term matches nothing rather than everything", () => {
    expect(rankMatches(rows, "   ", 5)).toEqual([]);
  });
  it("honours the limit", () => {
    expect(rankMatches(rows, "e", 1)).toHaveLength(1);
  });
});

describe("musicbrainz — ranking, because the API scores every hit 100", () => {
  const g = (title, date) => ({ title, "first-release-date": date });
  it("exact title beats an EARLIER release — the two rules must disagree here", () => {
    // The discriminating fixture. My first version listed the exact matches as
    // also being the oldest, so sorting by date ALONE produced the same answer
    // and the test passed with the exact-title rule deleted. It proved nothing.
    // Here the near-match is older, so only the title rule can put "Abbey Road"
    // first.
    expect(rankReleaseGroups(
      [g("Abbey Road Live", "1960"), g("Abbey Road", "1969")],
      "Abbey Road",
    ).map((x) => x.title)).toEqual(["Abbey Road", "Abbey Road Live"]);
  });

  it("among exact matches, the earliest wins — the original before its reissues", () => {
    expect(rankReleaseGroups(
      [g("Abbey Road", "1998"), g("Abbey Road", "1969")], "Abbey Road",
    ).map((x) => x["first-release-date"])).toEqual(["1969", "1998"]);
  });
  it("a missing release date sorts last rather than first", () => {
    // An undated entry must not outrank a real original just by being empty.
    const out = rankReleaseGroups([g("X", undefined), g("X", "1970")], "y");
    expect(out[0]["first-release-date"]).toBe("1970");
  });
});

describe("openlibrary — the fields a book offers", () => {
  it("names the author, year, pages and publisher", () => {
    expect(bookFields({
      author_name: ["Andy Hunt", "Dave Thomas"], first_publish_year: 1999,
      number_of_pages_median: 352, publisher: ["Addison-Wesley"],
    })).toEqual({
      Author: "Andy Hunt, Dave Thomas", "First published": "1999",
      Pages: "352", Publisher: "Addison-Wesley",
    });
  });
  it("caps the subject list — a popular work carries hundreds", () => {
    const subs = Array.from({ length: 40 }, (_, i) => `s${i}`);
    expect(bookFields({ subject: subs }).Subjects.split(", ")).toHaveLength(5);
  });
  it("a sparse record yields no empty fields", () => {
    expect(bookFields({ title: "x" })).toEqual({});
  });
});

describe("openfoodfacts — macros carry their basis", () => {
  const p = { nutriments: { "energy-kcal_100g": 96.1759082217972, proteins_100g: 4.6, fat_100g: 0 } };
  it("rounds the API's full float precision", () => {
    expect(foodFields(p)["Calories per 100g"]).toBe("96.2 kcal");
  });
  it("says PER 100g in the field name — an implied basis is how units go wrong", () => {
    for (const k of Object.keys(foodFields(p))) expect(k).toContain("per 100g");
  });
  it("keeps a real ZERO, which is a fact about the food", () => {
    // Dropping 0 would make "no fat" indistinguishable from "not measured".
    expect(foodFields(p)["Fat per 100g"]).toBe("0 g");
  });
  it("omits a nutrient the product does not carry", () => {
    expect(foodFields({ nutriments: {} })).toEqual({});
  });
});

describe("normalizeResult — the shape the dropdown renders", () => {
  it("always yields the keys the UI reads", () => {
    const r = normalizeResult({ provider: "x", externalId: 7, title: "T" });
    expect(Object.keys(r).sort()).toEqual(
      ["externalId", "fields", "provider", "subtitle", "thumbnail", "title", "url"]);
    expect(r.externalId).toBe("7");   // stringified, so keys compare consistently
  });
});
