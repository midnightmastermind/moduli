// A row's reference to an occurrence that no longer exists printed the raw id ("Meal: 99ff4ade-…", 2026-11-05 sweep).
import { describe, it, expect } from "vitest";
import { occurrenceValueLabel } from "../helpers/occurrenceLabel";

const maps = { occurrencesById: { a: { id: "a", moduleId: "m", label: "Oatmeal" } }, modulesById: { m: { id: "m", label: "Meal" } } };
describe("occurrenceValueLabel", () => {
  it("the option's label wins", () => {
    expect(occurrenceValueLabel("a", { options: [{ value: "a", label: "Picked" }], ...maps })).toBe("Picked");
  });
  it("a live row outside the option list is named by its placement", () => {
    expect(occurrenceValueLabel("a", { options: [], ...maps })).toBe("Oatmeal");
  });
  it("a row that is gone says so, never the id", () => {
    expect(occurrenceValueLabel("gone-id", { options: [], ...maps })).toBe("(deleted)");
  });
  it("while the rest of the grid is still arriving it waits — the row may just not be here yet", () => {
    expect(occurrenceValueLabel("gone-id", { options: [], ...maps, awaiting: true })).toBe("…");
  });
  it("no value is a dash", () => {
    expect(occurrenceValueLabel(null, { options: [], ...maps })).toBe("—");
  });
});
