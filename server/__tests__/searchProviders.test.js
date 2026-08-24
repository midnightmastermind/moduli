// The provider registry and the MERGE rule.
//
// User, 2026-08-23: *"i want to make sure we are looping the search options in.
// we still have our search for our own occurances merged in there."* — so a
// provider ADDS to the list, and a result already on the grid must not appear
// twice.
import { describe, it, expect, beforeEach } from "vitest";
import {
  normalizeResult, dropAlreadyOnGrid, gridKeyOf, existingKeys,
  registerProvider, getProvider, availableProviders, PROVIDERS,
} from "../utils/searchProviders.js";
import { infoboxToFields } from "../utils/providers/wikipedia.js";

const r = (externalId, title, provider = "wikipedia") => normalizeResult({ provider, externalId, title });

describe("normalizeResult", () => {
  it("stringifies the id, because providers return numbers and grids store strings", () => {
    expect(normalizeResult({ provider: "wikipedia", externalId: 23270459, title: "x" }).externalId).toBe("23270459");
  });
  it("nulls the optional parts rather than leaving them undefined", () => {
    const n = normalizeResult({ provider: "p", externalId: "1", title: "t" });
    expect(n.subtitle).toBeNull(); expect(n.thumbnail).toBeNull(); expect(n.url).toBeNull();
    expect(n.fields).toEqual({});
  });
});

describe("dropAlreadyOnGrid", () => {
  it("drops a result the grid already holds", () => {
    const out = dropAlreadyOnGrid([r("1", "Inception"), r("2", "Inception (soundtrack)")],
                                  new Set(["wikipedia:1"]));
    expect(out.map((x) => x.externalId)).toEqual(["2"]);
  });

  it("matches on IDENTITY, never on title", () => {
    // "Inception" the film and "Inception (soundtrack)" are different pageids.
    // A title match would conflate them — the `0035` class.
    const out = dropAlreadyOnGrid([r("1", "Inception"), r("2", "Inception")], new Set(["wikipedia:1"]));
    expect(out.map((x) => x.externalId)).toEqual(["2"]);
  });

  it("does not confuse two PROVIDERS that use the same id", () => {
    const out = dropAlreadyOnGrid([r("1", "x", "tmdb")], new Set(["wikipedia:1"]));
    expect(out).toHaveLength(1);
  });

  it("de-duplicates a provider that returned the same thing twice", () => {
    expect(dropAlreadyOnGrid([r("1", "a"), r("1", "a")], new Set())).toHaveLength(1);
  });

  it("KEEPS a result with no identity — it can still be imported", () => {
    // Dropping it would silently hide a real answer just because it cannot be
    // deduped.
    expect(dropAlreadyOnGrid([r(null, "no id")], new Set())).toHaveLength(1);
  });

  it("survives an empty list and a missing set", () => {
    expect(dropAlreadyOnGrid([], new Set())).toEqual([]);
    expect(dropAlreadyOnGrid(null, null)).toEqual([]);
    expect(dropAlreadyOnGrid([r("1", "a")], undefined)).toHaveLength(1);
  });
});

describe("gridKeyOf / existingKeys", () => {
  it("keys an imported occurrence by provider + id", () => {
    expect(gridKeyOf({ meta: { searchProvider: "wikipedia", searchExternalId: "1" } })).toBe("wikipedia:1");
  });
  it("returns null for a row nobody imported", () => {
    expect(gridKeyOf({ meta: {} })).toBeNull();
    expect(gridKeyOf({ meta: { searchProvider: "wikipedia" } })).toBeNull();   // half-stamped
    expect(gridKeyOf(null)).toBeNull();
  });
  it("collects only the imported ones", () => {
    const s = existingKeys([{ meta: { searchProvider: "p", searchExternalId: "1" } }, { meta: {} }, null]);
    expect([...s]).toEqual(["p:1"]);
  });
});

describe("the registry", () => {
  it("refuses a provider with no id or no search()", () => {
    expect(() => registerProvider({ search: () => {} })).toThrow();
    expect(() => registerProvider({ id: "x" })).toThrow();
  });

  it("does not offer a KEYED provider whose key is absent", () => {
    // A provider that would fail at search time should not be in the list at
    // all — the failure belongs at configuration, not at the keystroke.
    registerProvider({ id: "needy", label: "Needy", requiresEnv: "NEEDY_KEY", search: async () => [] });
    expect(availableProviders({}).map((p) => p.id)).not.toContain("needy");
    expect(availableProviders({ NEEDY_KEY: "k" }).map((p) => p.id)).toContain("needy");
    delete PROVIDERS.needy;
  });

  it("offers the keyless one always", () => {
    expect(availableProviders({}).map((p) => p.id)).toContain("wikipedia");
    expect(getProvider("wikipedia")).toBeTruthy();
    expect(getProvider("nope")).toBeNull();
  });
});

describe("infoboxToFields", () => {
  it("keys rows by their own label", () => {
    expect(infoboxToFields([{ label: "Directed by", value: "Christopher Nolan" }]))
      .toEqual({ "Directed by": "Christopher Nolan" });
  });
  it("drops a row with no label or no value — a blank is honest, a guess is not", () => {
    expect(infoboxToFields([{ label: "", value: "x" }, { label: "y", value: "" }])).toEqual({});
  });
  it("keeps the FIRST when an infobox repeats a label", () => {
    expect(infoboxToFields([{ label: "Starring", value: "A" }, { label: "Starring", value: "B" }]))
      .toEqual({ Starring: "A" });
  });
  it("survives junk", () => {
    expect(infoboxToFields(null)).toEqual({});
    expect(infoboxToFields([null, undefined])).toEqual({});
  });
});
