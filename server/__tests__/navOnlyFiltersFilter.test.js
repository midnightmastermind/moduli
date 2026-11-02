import { describe, it, expect } from "vitest";
import { isNavOnlyAssistantFilter, planFilters } from "../migrations/0483-nav-only-filters-filter.mjs";

const dead = { id: "q", fieldId: "F", active: true, showNav: true, hides: false, style: "select", options: ["a"],
  condition: { operator: "OR", rules: [{ left: "$field.value", comparator: "CONTAINS", right: "$nav" }, { left: "$field.value", comparator: "IS_EMPTY" }] } };

describe("0483", () => {
  it("rewrites the assistant's nav-only filter to the plain shape", () => {
    expect(planFilters([dead])).toEqual([{ id: "q", fieldId: "F", active: true, showNav: true, condition: null }]);
  });
  it("a DATE field's nav-only filter is kept (poms' Trackers/Schedule date nav is nav-only on purpose)", () => {
    expect(planFilters([dead], () => "date")).toBe(null);
    expect(planFilters([dead], () => "select")).not.toBe(null);
  });
  it("leaves every other filter alone", () => {
    const plain = { id: "p", fieldId: "G", active: true, condition: null };
    const authored = { id: "a", active: true, hides: true, condition: { operator: "AND", rules: [{ left: "$occ.fields.X.value", comparator: "IS", right: "y" }] } };
    expect(planFilters([plain, authored])).toBe(null);
    expect(isNavOnlyAssistantFilter({ ...dead, hides: true })).toBe(false);
  });
});
