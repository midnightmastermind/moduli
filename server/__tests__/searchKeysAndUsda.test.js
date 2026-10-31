import { describe, it, expect } from "vitest";
import { keySpecOf, resolveProviderKey, keySourceOf, providerUnavailableReason, availableProviders, keyRows, registerProvider, PROVIDERS } from "../utils/searchProviders.js";
import { nutrientFields } from "../utils/providers/usda.js";
import { showFields } from "../utils/providers/tmdb.js";

const films = { id: "f", label: "Films", apiKey: { id: "acct", env: "ACCT_KEY" }, search: async () => [] };
const tv = { id: "t", label: "TV", apiKey: { id: "acct", env: "ACCT_KEY" }, search: async () => [] };
const demo = { id: "d", label: "Demo", apiKey: { id: "d", env: "D_KEY", demo: "DEMO" }, search: async () => [] };

describe("provider keys: the user's, then the server's, then a demo key", () => {
  it("the user's key wins over the env", () => {
    expect(resolveProviderKey(films, { ACCT_KEY: "srv" }, { acct: "mine" })).toBe("mine");
    expect(keySourceOf(films, { ACCT_KEY: "srv" }, { acct: "mine" })).toBe("user");
  });
  it("falls back to the env, then the demo key, then none", () => {
    expect(resolveProviderKey(films, { ACCT_KEY: "srv" }, {})).toBe("srv");
    expect(resolveProviderKey(demo, {}, {})).toBe("DEMO");
    expect(keySourceOf(films, {}, {})).toBe("none");
    expect(providerUnavailableReason(films, {}, {})).toMatch(/Search sources/);
    expect(providerUnavailableReason(demo, {}, {})).toBeNull();
  });
  it("a keyless provider has no key and is always usable", () => {
    const free = { id: "x", label: "X" };
    expect(keySpecOf(free)).toBeNull();
    expect(providerUnavailableReason(free, {}, {})).toBeNull();
  });
  it("the old requiresEnv spelling still works", () => {
    expect(resolveProviderKey({ id: "o", requiresEnv: "O_KEY" }, { O_KEY: "k" }, {})).toBe("k");
  });
  it("providers sharing an account share ONE key row, and a user key lists them", () => {
    registerProvider(films); registerProvider(tv);
    try {
      const row = keyRows({}, {}).find((r) => r.id === "acct");
      expect(row.providers.map((p) => p.id).sort()).toEqual(["f", "t"]);
      expect(availableProviders({}, {}).map((p) => p.id)).not.toContain("t");
      expect(availableProviders({}, { acct: "mine" }).map((p) => p.id)).toEqual(expect.arrayContaining(["f", "t"]));
    } finally { delete PROVIDERS.f; delete PROVIDERS.t; }
  });
});

describe("USDA nutrientFields", () => {
  it("converts to the grid's units and names the basis", () => {
    const f = nutrientFields([
      { nutrientNumber: "208", value: 23, unitName: "KCAL" },
      { nutrientNumber: "303", value: 0.00271, unitName: "G" },    // grams -> mg
      { nutrientNumber: "320", value: 469, unitName: "UG" },
      { number: "401", amount: 28.1, unitName: "MG" },            // abridged detail shape
    ]);
    expect(f["Calories per 100g"]).toBe("23 kcal");
    expect(f["Iron per 100g"]).toBe("2.71 mg");
    expect(f["Vitamin A per 100g"]).toBe("469 mcg");
    expect(f["Vitamin C per 100g"]).toBe("28.1 mg");
  });
  it("sums omega-3 from ALA under either number plus EPA/DHA, in mg", () => {
    const f = nutrientFields([
      { nutrientNumber: "619", value: 0.138, unitName: "G" },
      { nutrientNumber: "629", value: 0.01, unitName: "G" },
    ]);
    expect(f["Omega-3 per 100g"]).toBe("148 mg");
  });
  it("leaves out a nutrient USDA does not report (never a made-up zero)", () => {
    expect(nutrientFields([{ nutrientNumber: "208", value: 10, unitName: "KCAL" }])).toEqual({ "Calories per 100g": "10 kcal" });
  });
});

describe("TMDB showFields", () => {
  it("reads the show's own facts", () => {
    const f = showFields({ name: "Severance", created_by: [{ name: "Dan Erickson" }], first_air_date: "2022-02-17",
      number_of_seasons: 2, number_of_episodes: 19, networks: [{ name: "Apple TV+" }], status: "Returning Series" });
    expect(f).toMatchObject({ "Created by": "Dan Erickson", "First aired": "2022-02-17", Seasons: "2", Episodes: "19",
      Network: "Apple TV+", Status: "Returning Series" });
  });
});
