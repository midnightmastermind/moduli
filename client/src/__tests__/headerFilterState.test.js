// The header filter icon is green when ANY filter is set here, declared locally or on an ancestor (user,
// 2026-11-11). The People container under a page declaring Relationship held "acquaintance" and read red with
// no pill, because only the container's OWN filters[] were counted.
import { describe, it, expect } from "vitest";
import { computeFilterState } from "../ui/HeaderChevron.jsx";

const REL = "rel", DATE = "date";
const grid = { activeFilterId: "nf", namedFilters: [{ id: "nf", conditions: [{ fieldId: DATE, isNav: true }] }] };
const page = { id: "page", occurrences: ["ctr"], filters: [{ id: "f1", fieldId: REL, active: true }] };
const ctr = { id: "ctr", occurrences: [] };
const occurrencesById = { page, ctr };

describe("computeFilterState", () => {
  it("an ancestor-declared filter with a value here is active (green)", () => {
    expect(computeFilterState(ctr, grid, { [REL]: ["acquaintance"] }, { occurrencesById })).toBe("active");
  });
  it("the date muted and the inherited filter empty is deactivated (red)", () => {
    expect(computeFilterState(ctr, grid, { [REL]: [] }, { occurrencesById })).toBe("deactivated");
  });
  it("a local filter with a value is active", () => {
    const own = { id: "own", filters: [{ id: "f2", fieldId: REL, active: true }] };
    expect(computeFilterState(own, {}, { [REL]: "friend" }, { occurrencesById: { own } })).toBe("active");
  });
  it("the grid's date alone is active", () => {
    expect(computeFilterState(ctr, grid, { [DATE]: "2026-11-11" }, { occurrencesById })).toBe("active");
  });
  it("an ancestor declaration switched off below does not count", () => {
    const off = { id: "ctr", occurrences: [], filters: [{ id: "f1", fieldId: REL, active: false }] };
    expect(computeFilterState(off, {}, { [REL]: ["acquaintance"] }, { occurrencesById: { page, ctr: off } })).toBe("none");
  });
  it("nothing declared anywhere is none", () => {
    expect(computeFilterState({ id: "x" }, {}, {}, { occurrencesById: {} })).toBe("none");
  });
});
