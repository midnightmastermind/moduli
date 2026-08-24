// 0228 — the eleven preset providers were written where nothing reads.
import { describe, it, expect } from "vitest";
import { planConfig } from "../migrations/0228-search-providers-were-inert.mjs";

const legacy = (provider, fieldMap = {}) => ({ meta: { searchProvider: { provider, fieldMap } } });

describe("planConfig — moving a config the reader cannot see", () => {
  it("moves a legacy config and ENABLES it", () => {
    // `enabled` is the half that makes it visible: searchProviderConfig()
    // returns null without it even when the path is right.
    const c = planConfig(legacy("openlibrary"));
    expect(c).toMatchObject({ provider: "openlibrary", enabled: true, hadLegacy: true });
  });

  it("PRESERVES a fieldMap authored by hand rather than resetting it", () => {
    // `0219` wrote `fieldMap: {}`. Someone who then authored a mapping in the
    // editor must not lose it to this repair.
    const f = { meta: { searchProvider: { provider: "openlibrary", fieldMap: {} },
                        optionsSource: { searchProvider: { provider: "openlibrary", fieldMap: { Pages: "p1" } } } } };
    expect(planConfig(f).fieldMap).toEqual({ Pages: "p1" });
  });

  it("prefers the authored map at the legacy path over an empty current one", () => {
    const f = { meta: { searchProvider: { provider: "wger", fieldMap: { Muscles: "m1" } },
                        optionsSource: { searchProvider: { provider: "wger", fieldMap: {} } } } };
    expect(planConfig(f).fieldMap).toEqual({ Muscles: "m1" });
  });

  it("respects an explicit OFF instead of switching it back on", () => {
    // Someone who disabled a provider deliberately must not have it re-enabled
    // by a repair pass.
    const f = { meta: { optionsSource: { searchProvider: { provider: "tmdb", enabled: false, fieldMap: {} } } } };
    expect(planConfig(f).enabled).toBe(false);
  });

  it("returns null for a field with no provider anywhere", () => {
    expect(planConfig({ meta: {} })).toBeNull();
    expect(planConfig({})).toBeNull();
    expect(planConfig(null)).toBeNull();
  });

  it("reports a correctly-configured field as ALREADY done — the idempotency", () => {
    const f = { meta: { optionsSource: { searchProvider: { provider: "wger", enabled: true, fieldMap: {} } } } };
    expect(planConfig(f).already).toBe(true);
  });

  it("does NOT report done while the legacy key is still there", () => {
    // Two copies of one config is how they drift; the repair must still fire
    // to unset the old one even when the new path already looks right.
    const f = { meta: { searchProvider: { provider: "wger", fieldMap: {} },
                        optionsSource: { searchProvider: { provider: "wger", enabled: true, fieldMap: {} } } } };
    expect(planConfig(f).already).toBe(false);
  });
});
