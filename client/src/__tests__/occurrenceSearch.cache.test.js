// __tests__/occurrenceSearch.cache.test.js
import { describe, it, expect } from "vitest";
import { getSearchIndex } from "../helpers/occurrenceSearch";

const modulesById = { m: { id: "m", role: "instance", kind: "list", label: "Item" } };
// Stable across calls, exactly as the store hands these maps over — a new object
// literal per call would (correctly) invalidate every cached entry.
const fieldsById = {};
const mk = (id, label) => ({ id, gridId: "g1", moduleId: "m", label });

describe("getSearchIndex", () => {
  it("returns the same index object for an unchanged map", () => {
    const occurrencesById = { a: mk("a", "Alpha") };
    const args = { occurrencesById, modulesById, fieldsById, gridId: "g1" };
    expect(getSearchIndex(args)).toBe(getSearchIndex(args));
  });

  it("reuses entries for occurrences that did not change", () => {
    const a = mk("a", "Alpha");
    const first = getSearchIndex({ occurrencesById: { a }, modulesById, fieldsById, gridId: "g1" });
    const second = getSearchIndex({
      occurrencesById: { a, b: mk("b", "Beta") },   // new map, `a` unchanged
      modulesById, fieldsById, gridId: "g1",
    });
    expect(second.byId.get("a")).toBe(first.byId.get("a"));
    expect(second.byId.get("b").label).toBe("Beta");
  });

  it("rebuilds the entry for an occurrence that did change", () => {
    const a = mk("a", "Alpha");
    const first = getSearchIndex({ occurrencesById: { a }, modulesById, fieldsById, gridId: "g1" });
    const second = getSearchIndex({
      occurrencesById: { a: { ...a, label: "Renamed" } },
      modulesById, fieldsById, gridId: "g1",
    });
    expect(second.byId.get("a")).not.toBe(first.byId.get("a"));
    expect(second.byId.get("a").label).toBe("Renamed");
  });

  it("rebuilds every entry when a parent is renamed, so paths never go stale", () => {
    const parent = { id: "p", gridId: "g1", moduleId: "m", label: "Parent", occurrences: ["c"] };
    const child = { id: "c", gridId: "g1", moduleId: "m", label: "Child" };
    const first = getSearchIndex({
      occurrencesById: { p: parent, c: child }, modulesById, fieldsById, gridId: "g1",
    });
    expect(first.byId.get("c").pathLabels).toEqual(["Parent"]);
    const second = getSearchIndex({
      occurrencesById: { p: { ...parent, label: "Renamed" }, c: child },
      modulesById, fieldsById, gridId: "g1",
    });
    expect(second.byId.get("c").pathLabels).toEqual(["Renamed"]);
  });
});
