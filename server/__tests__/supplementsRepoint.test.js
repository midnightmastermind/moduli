// 0235 — moving one dropdown off the wrong database.
import { describe, it, expect } from "vitest";
import { planRepoint, FROM, TO, FIELD } from "../migrations/0235-supplements-use-the-supplement-database.mjs";

describe("planRepoint", () => {
  it("repoints a field still on openFDA", () => {
    expect(planRepoint({ provider: "openfda", fieldMap: {} })).toMatchObject({ act: true, clearMap: false });
  });

  it("CLEARS a map authored against openFDA's key names", () => {
    // The discriminating case: DSLD answers `Brand` / `Form`, openFDA answers
    // `Generic name` / `Drug class`. Carrying the map across leaves one that
    // silently writes nothing — the inert-token class.
    expect(planRepoint({ provider: "openfda", fieldMap: { "Generic name": "f1" } }))
      .toMatchObject({ act: true, clearMap: true });
  });

  it("is idempotent — a second run does nothing", () => {
    expect(planRepoint({ provider: "dsld" })).toMatchObject({ act: false });
  });

  it("refuses a field somebody has since pointed elsewhere", () => {
    // Never overwrite a choice the user made after this migration was written.
    expect(planRepoint({ provider: "openfoodfacts" })).toMatchObject({ act: false });
  });

  it("does nothing when no provider is configured at all", () => {
    expect(planRepoint(null).act).toBe(false);
    expect(planRepoint({}).act).toBe(false);
  });

  it("touches Supplement only — Medication keeps openFDA, which is right for it", () => {
    expect(FIELD).toBe("Supplement");
    expect(FROM).toBe("openfda");
    expect(TO).toBe("dsld");
  });
});
