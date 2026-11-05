// UI sweep 2026-11-04. Removing a local filter wrote `filterOverride: {}` when it held nothing else — an EMPTY override
// clears EVERY filter at that level (selectors.js), so the board stopped filtering by date. And the Filters editor
// offered a field an ancestor already filters: the new declaration was hidden from the menu (it lists that field under
// Ancestor filters), so it could not be removed.
import { describe, it, expect, vi } from "vitest";
vi.mock("../helpers/CommitHelpers", () => ({ updateOccurrence: vi.fn(), updateOccurrenceFilterOverride: vi.fn() }));
import * as CommitHelpers from "../helpers/CommitHelpers";
import { removeDeclaredFilter } from "../helpers/filterConfig";
import { filterEditorFields } from "../ui/FilterEditor.jsx";

const sent = () => CommitHelpers.updateOccurrence.mock.calls.at(-1)[0].occurrence;

describe("removeDeclaredFilter", () => {
  it("removing the only filter leaves no override, never {}", () => {
    removeDeclaredFilter({ dispatch: () => {}, socket: null, occurrence: { id: "c", filters: [{ fieldId: "g" }], filterOverride: null }, fieldId: "g" });
    expect(sent().filters).toEqual([]);
    expect(sent()).not.toHaveProperty("filterOverride");
  });
  it("drops the field's own value; the last one goes to null", () => {
    removeDeclaredFilter({ dispatch: () => {}, socket: null, occurrence: { id: "c", filters: [{ fieldId: "g" }], filterOverride: { g: ["x"] } }, fieldId: "g" });
    expect(sent().filterOverride).toBe(null);
    removeDeclaredFilter({ dispatch: () => {}, socket: null, occurrence: { id: "c", filters: [{ fieldId: "g" }], filterOverride: { g: ["x"], d: "2026-11-04" } }, fieldId: "g" });
    expect(sent().filterOverride).toEqual({ d: "2026-11-04" });
  });
  it("a deliberate page-wide clear ({}) is left as it is — the control", () => {
    removeDeclaredFilter({ dispatch: () => {}, socket: null, occurrence: { id: "c", filters: [{ fieldId: "g" }], filterOverride: {} }, fieldId: "g" });
    expect(sent()).not.toHaveProperty("filterOverride");
  });
});

describe("the fields the Filters editor offers", () => {
  const fields = [{ id: "date", name: "Date" }, { id: "g", name: "Gender" }, { id: "t", name: "Tags" }];
  it("leaves out fields an ancestor filters and fields another row already uses", () => {
    expect(filterEditorFields(fields, { ancestorFieldIds: new Set(["date"]), usedFieldIds: ["t"], own: null }).map((f) => f.id)).toEqual(["g"]);
  });
  it("a row keeps its own field", () => {
    expect(filterEditorFields(fields, { ancestorFieldIds: new Set(["date"]), usedFieldIds: ["t"], own: "t" }).map((f) => f.id)).toEqual(["g", "t"]);
  });
});

describe("wiring", () => {
  it("the menu's × and the editor go through the safe helpers", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(`${process.cwd()}/src/ui/FiltersSection.jsx`, "utf8");
    expect(src).toMatch(/filterConfig\.removeDeclaredFilter\(/);
    expect(src).not.toMatch(/filterOverride:\s*nextOverrides/);
    expect(src).toMatch(/excludeFieldIds=\{ancestorFieldIds\}/);
  });
});
