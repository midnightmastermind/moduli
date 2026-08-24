// 0219 — the pairing plan, driven dry.
//
// The migration's OWN exported table and planner are used here, so the test
// cannot drift from what ships (the `0046` rule).
import { describe, it, expect } from "vitest";
import { planPairings, PAIRINGS } from "../migrations/0219-preset-search-providers.mjs";

const f = (id, name, type = "occurrence", meta = {}) => ({ id, name, type, meta });

describe("0219 — which dropdowns get a search feed", () => {
  it("pairs an occurrence dropdown that has no provider yet", () => {
    const { plan } = planPairings([f("f1", "Movement")], { Movement: "wger" });
    expect(plan).toEqual([{ fieldId: "f1", name: "Movement", provider: "wger" }]);
  });

  it("REFUSES a field of the wrong type, even with the right name", () => {
    // This grid carries duplicate field names — `0053` had to discriminate by
    // TYPE because two fields are called "Due". A feed on a text field renders a
    // control that mints nothing.
    const { plan, skipped } = planPairings([f("f1", "Song", "text")], { Song: "musicbrainz" });
    expect(plan).toEqual([]);
    expect(skipped[0].why).toMatch(/text field/);
  });

  it("picks the dropdown out of a duplicate-named PAIR and leaves the other", () => {
    const fields = [f("txt", "Song", "text"), f("occ", "Song", "occurrence")];
    const { plan } = planPairings(fields, { Song: "musicbrainz" });
    expect(plan.map((p) => p.fieldId)).toEqual(["occ"]);
  });

  it("never overwrites a pairing that is already there — it is the user's", () => {
    const existing = f("f1", "Song", "occurrence", { searchProvider: { provider: "wikipedia" } });
    const { plan, skipped } = planPairings([existing], { Song: "musicbrainz" });
    expect(plan).toEqual([]);
    expect(skipped[0].why).toMatch(/already paired with wikipedia/);
  });

  it("reports a field that does not exist rather than failing the run", () => {
    // `Medication` is absent from test grid 2 and present on poms grid; a
    // migration that threw on the first missing name could never run on both.
    const { plan, skipped } = planPairings([], { Medication: "openfda" });
    expect(plan).toEqual([]);
    expect(skipped).toEqual([{ name: "Medication", why: "no such field" }]);
  });

  it("is a no-op on a second pass — every field now carries its provider", () => {
    const fields = [f("f1", "Movement"), f("f2", "Song")];
    const first = planPairings(fields, { Movement: "wger", Song: "musicbrainz" });
    expect(first.plan).toHaveLength(2);
    // Apply the plan the way `up()` does, then re-plan.
    for (const p of first.plan) {
      fields.find((x) => x.id === p.fieldId).meta.searchProvider = { provider: p.provider, fieldMap: {} };
    }
    expect(planPairings(fields, { Movement: "wger", Song: "musicbrainz" }).plan).toEqual([]);
  });

  it("names only providers that actually exist", async () => {
    // A pairing naming a provider nobody registered is the inert-token class:
    // the field looks configured and the dropdown searches nothing.
    for (const m of ["wikipedia", "wger", "openlibrary", "musicbrainz",
                     "openfoodfacts", "itunes", "places", "openfda", "tmdb"]) {
      await import(`../utils/providers/${m}.js`);
    }
    const { getProvider } = await import("../utils/searchProviders.js");
    for (const [name, provider] of Object.entries(PAIRINGS)) {
      expect(getProvider(provider), `${name} -> ${provider}`).toBeTruthy();
    }
  });
});

describe("a keyed provider with no key", () => {
  it("is named as UNCONFIGURED, not reported as an upstream failure", async () => {
    const { providerUnavailableReason } = await import("../utils/searchProviders.js");
    const tmdb = { id: "tmdb", label: "TMDB (films)", requiresEnv: "TMDB_API_KEY" };
    expect(providerUnavailableReason(tmdb, {})).toMatch(/TMDB_API_KEY/);
    // The discriminator: with the key present it is available, so the guard
    // cannot be a blanket refusal of every keyed provider.
    expect(providerUnavailableReason(tmdb, { TMDB_API_KEY: "k" })).toBeNull();
    expect(providerUnavailableReason({ id: "wikipedia" }, {})).toBeNull();
  });
});
