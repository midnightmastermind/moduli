// server/__tests__/occurrenceHelpers.test.js
import { describe, it, expect } from "vitest";
import {
  getOccurrencesForGrid,
  autofillOccurrence,
  autofillOccurrences,
  createOccurrenceData,
} from "../utils/occurrenceHelpers.js";

// ── getOccurrencesForGrid ────────────────────────────────────────────────────
describe("getOccurrencesForGrid", () => {
  const uc = {
    occurrencesById: {
      "occ-1": { _id: "occ-1", gridId: "grid-A", targetType: "module" },
      "occ-2": { _id: "occ-2", gridId: "grid-B", targetType: "module" },
      "occ-3": { _id: "occ-3", gridId: "grid-A", targetType: "module" },
      "occ-4": { _id: "occ-4", gridId: "grid-C", targetType: "module" },
    },
  };

  it("returns only occurrences matching gridId", () => {
    const result = getOccurrencesForGrid("grid-A", uc);
    expect(result).toHaveLength(2);
    expect(result.map((o) => o._id)).toContain("occ-1");
    expect(result.map((o) => o._id)).toContain("occ-3");
  });

  it("returns empty array when no occurrences match", () => {
    const result = getOccurrencesForGrid("grid-Z", uc);
    expect(result).toHaveLength(0);
  });

  it("returns all when all occurrences match", () => {
    const ucAll = {
      occurrencesById: {
        a: { _id: "a", gridId: "same" },
        b: { _id: "b", gridId: "same" },
      },
    };
    const result = getOccurrencesForGrid("same", ucAll);
    expect(result).toHaveLength(2);
  });

  it("returns empty array when occurrencesById is empty", () => {
    const result = getOccurrencesForGrid("grid-A", { occurrencesById: {} });
    expect(result).toHaveLength(0);
  });

  it("returns empty array when occurrencesById is undefined", () => {
    const result = getOccurrencesForGrid("grid-A", {});
    expect(result).toHaveLength(0);
  });

  it("uses strict equality — similar but not equal gridId does not match", () => {
    const ucMixed = {
      occurrencesById: {
        x: { _id: "x", gridId: "grid-A " }, // trailing space
        y: { _id: "y", gridId: "GRID-A" }, // case mismatch
      },
    };
    const result = getOccurrencesForGrid("grid-A", ucMixed);
    expect(result).toHaveLength(0);
  });
});

// ── autofillOccurrence ───────────────────────────────────────────────────────
describe("autofillOccurrence", () => {
  const uc = {
    modulesById: {
      "mod-panel": { _id: "mod-panel", role: "panel", label: "My Panel" },
      "mod-cont": { _id: "mod-cont", role: "container", label: "My Container" },
      "mod-inst": { _id: "mod-inst", role: "instance", label: "My Instance" },
    },
  };

  it("fills module field for targetType module", () => {
    const occ = { targetType: "module", targetId: "mod-panel" };
    const result = autofillOccurrence(occ, uc);
    expect(result.module).toBeDefined();
    expect(result.module.label).toBe("My Panel");
    expect(result.panel).toBeDefined(); // backward compat alias
  });

  it("adds container alias when role is container", () => {
    const occ = { targetType: "module", targetId: "mod-cont" };
    const result = autofillOccurrence(occ, uc);
    expect(result.container).toBeDefined();
    expect(result.instance).toBeUndefined();
  });

  it("adds instance alias when role is instance", () => {
    const occ = { targetType: "module", targetId: "mod-inst" };
    const result = autofillOccurrence(occ, uc);
    expect(result.instance).toBeDefined();
    expect(result.container).toBeUndefined();
  });

  it("returns occurrence unchanged when null", () => {
    expect(autofillOccurrence(null, uc)).toBeNull();
  });

  it("returns occurrence unchanged when uc is null", () => {
    const occ = { targetType: "module", targetId: "mod-panel" };
    expect(autofillOccurrence(occ, null)).toEqual(occ);
  });

  it("leaves module undefined when targetId not in cache", () => {
    const occ = { targetType: "module", targetId: "missing" };
    const result = autofillOccurrence(occ, uc);
    expect(result.module).toBeUndefined();
  });
});

// ── autofillOccurrences ──────────────────────────────────────────────────────
describe("autofillOccurrences", () => {
  it("returns empty array for non-array input", () => {
    expect(autofillOccurrences(null, {})).toEqual([]);
    expect(autofillOccurrences(undefined, {})).toEqual([]);
  });

  it("maps over all occurrences", () => {
    const occs = [
      { targetType: "module", targetId: "m1" },
      { targetType: "module", targetId: "m2" },
    ];
    const uc = { modulesById: { m1: { role: "panel" }, m2: { role: "container" } } };
    const result = autofillOccurrences(occs, uc);
    expect(result).toHaveLength(2);
    expect(result[0].panel).toBeDefined();
    expect(result[1].container).toBeDefined();
  });
});

// ── createOccurrenceData ─────────────────────────────────────────────────────
describe("createOccurrenceData", () => {
  it("returns object with all required fields", () => {
    const result = createOccurrenceData({
      id: "occ-1",
      userId: "user-1",
      targetType: "module",
      targetId: "mod-1",
      gridId: "grid-1",
    });
    expect(result.id).toBe("occ-1");
    expect(result.userId).toBe("user-1");
    expect(result.targetType).toBe("module");
    expect(result.gridId).toBe("grid-1");
    expect(result.fields).toEqual({});
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it("defaults filterOverride to null and hidden to false", () => {
    const result = createOccurrenceData({ id: "x", userId: "u", targetType: "module", targetId: "t", gridId: "g" });
    expect(result.filterOverride).toBeNull();
    expect(result.hidden).toBe(false);
  });

  it("includes placement when provided", () => {
    const result = createOccurrenceData({
      id: "x", userId: "u", targetType: "module", targetId: "t", gridId: "g",
      placement: { row: 0, col: 1 },
    });
    expect(result.placement).toEqual({ row: 0, col: 1 });
  });

  it("omits placement when not provided", () => {
    const result = createOccurrenceData({ id: "x", userId: "u", targetType: "module", targetId: "t", gridId: "g" });
    expect(result.placement).toBeUndefined();
  });
});
