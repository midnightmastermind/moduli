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
import { placeFields, osmUrl } from "../utils/providers/places.js";
import { drugFields, dedupeByName } from "../utils/providers/openfda.js";
import { filmFields } from "../utils/providers/tmdb.js";

beforeAll(async () => {
  for (const m of ["wikipedia", "wger", "openlibrary", "musicbrainz", "openfoodfacts", "itunes",
                   "places", "openfda", "tmdb"]) {
    await import(`../utils/providers/${m}.js`);
  }
});

describe("the registry", () => {
  it("lists every built-in provider", () => {
    const ids = availableProviders().map((p) => p.id).sort();
    // tmdb is REGISTERED but not LISTED — it declares requiresEnv, and no key is
    // set in the test environment. That absence is the contract, not an omission.
    expect(ids).toEqual(["itunes", "musicbrainz", "openfda", "openfoodfacts",
                        "openlibrary", "places", "wger", "wikipedia"]);
    expect(getProvider("tmdb")).toBeTruthy();
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

describe("itunes — podcasts", () => {
  it("names the publisher, genre and episode count", async () => {
    const { podcastFields } = await import("../utils/providers/itunes.js");
    expect(podcastFields({ artistName: "Dan Carlin", primaryGenreName: "History", trackCount: 13 }))
      .toEqual({ Publisher: "Dan Carlin", Genre: "History", Episodes: "13" });
  });
  it("keeps an episode count of ZERO — a new show is not a missing show", async () => {
    const { podcastFields } = await import("../utils/providers/itunes.js");
    expect(podcastFields({ trackCount: 0 }).Episodes).toBe("0");
  });
});

describe("places — the geocoder, adapted", () => {
  // The one thing a unit test can settle here: both geocoders' spellings of ONE
  // building converge. Probed live, `way/282412131` is the only URL form that
  // answers 200; `W282412131` and `W/282412131` both 404.
  it("spells OSM's own URL the long way, from EITHER geocoder's id", () => {
    const want = "https://www.openstreetmap.org/way/282412131";
    expect(osmUrl("W/282412131")).toBe(want);      // Photon
    expect(osmUrl("way/282412131")).toBe(want);    // Nominatim
  });

  it("refuses to guess a URL for an id it cannot parse", () => {
    expect(osmUrl("not-an-id")).toBeNull();
    expect(osmUrl(null)).toBeNull();
  });

  it("offers latitude and longitude SEPARATELY, so each can be a number", () => {
    const f = placeFields({ address: "9200 W Wisconsin Ave", kind: "hospital", lat: 43.04, lon: -88.02 });
    expect(f).toEqual({ Address: "9200 W Wisconsin Ave", Kind: "hospital",
                        Latitude: "43.04", Longitude: "-88.02" });
  });

  it("keeps a coordinate of ZERO — the equator is not a missing value", () => {
    expect(placeFields({ lat: 0, lon: 0 })).toEqual({ Latitude: "0", Longitude: "0" });
  });
});

describe("openfda — one row per drug, not one per label", () => {
  // The API's own counts: brand_name:aripip* returns 117 labels, every one of
  // them named "Aripiprazole" — one filing per manufacturer.
  const labels = [
    { openfda: { brand_name: ["Aripiprazole"], generic_name: ["Aripiprazole"], spl_set_id: ["a1"] } },
    { openfda: { brand_name: ["Aripiprazole"], generic_name: ["Aripiprazole"], spl_set_id: ["a2"] } },
    { openfda: { brand_name: ["ARIPIPRAZOLE"], spl_set_id: ["a3"] } },
    { openfda: { brand_name: ["Aristada"], spl_set_id: ["b1"] } },
  ];

  it("collapses every manufacturer's label onto one row per drug name", () => {
    const out = dedupeByName(labels);
    expect(out.map((d) => d.name)).toEqual(["Aripiprazole", "Aristada"]);
    expect(out[0].id).toBe("a1");   // the FIRST label wins, so the id is stable
  });

  it("drops a label carrying no name at all — it could not be picked", () => {
    expect(dedupeByName([{ openfda: {} }, { openfda: { route: ["ORAL"] } }])).toEqual([]);
  });

  it("offers identity and form, and NOTHING clinical", () => {
    const f = drugFields({
      generic_name: ["LISDEXAMFETAMINE DIMESYLATE"], route: ["ORAL"],
      dosage_form: ["CAPSULE"], manufacturer_name: ["Takeda Pharmaceuticals America, Inc."],
      indications_and_usage: ["Treatment of ADHD…"], warnings: ["Abuse and dependence…"],
    });
    expect(f["Generic name"]).toBe("Lisdexamfetamine Dimesylate");
    expect(f["Route"]).toBe("Oral");
    expect(f["Dosage form"]).toBe("Capsule");
    // The discriminator: FDA prescribing text is never offered as an importable
    // field. A medication row is a reminder of what to take, not medical advice.
    expect(Object.keys(f)).not.toContain("Warnings");
    expect(JSON.stringify(f)).not.toContain("dependence");
  });
});

describe("tmdb — films, and the disambiguation Wikipedia cannot do", () => {
  it("reads director and cast from credits, not from prose", () => {
    const f = filmFields({
      release_date: "1999-03-30", runtime: 136, vote_average: 8.234,
      genres: [{ name: "Action" }, { name: "Science Fiction" }],
      credits: {
        crew: [{ job: "Director", name: "Lana Wachowski" }, { job: "Director", name: "Lilly Wachowski" },
               { department: "Writing", name: "Lana Wachowski" }],
        cast: [{ name: "Keanu Reeves" }, { name: "Laurence Fishburne" }],
      },
    });
    expect(f["Director"]).toBe("Lana Wachowski, Lilly Wachowski");
    expect(f["Cast"]).toBe("Keanu Reeves, Laurence Fishburne");
    // A BARE number of minutes, unlike Wikipedia's "136 minutes" — so it lands in
    // a duration field without the mapper having to parse prose.
    expect(f["Runtime"]).toBe("136");
    expect(f["Rating"]).toBe("8.2");
  });

  it("offers nothing at all for a payload carrying nothing", () => {
    expect(filmFields({})).toEqual({});
    expect(filmFields({ credits: { crew: [], cast: [] } })).toEqual({});
  });

  it("never reaches the network without a key", async () => {
    const { tmdbProvider } = await import("../utils/providers/tmdb.js");
    await expect(tmdbProvider.search("Dune")).rejects.toThrow(/TMDB_API_KEY/);
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
