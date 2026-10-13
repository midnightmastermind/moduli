// A container whose rows are ALL hidden by the active filter rendered empty with an
// "Add new item" bar — nothing said why (checkGrid: container-filtered-empty, 13 on poms).
// The hint names WHICH filter (and field) hides them, read off the real visibility test,
// never assuming the field is Date (user, 2026-10-13).
import { describe, it, expect } from "vitest";
import { filterHiddenHint, filterHiddenHintText } from "../helpers/filterHiddenHint.js";

const fieldsById = { D: { id: "D", name: "Date" }, T: { id: "T", name: "Time Slot" }, K: { id: "K", name: "Kind" } };
const row = (id, fields) => ({ id, fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { value: v }])) });

describe("filterHiddenHint", () => {
  it("names the grid filter and the field that hides every row", () => {
    const rows = [row("a", { D: "2026-10-31" }), row("b", { D: "2026-11-26" })];
    const h = filterHiddenHint({
      occurrences: rows, visibleCount: 0,
      effectiveFilters: { D: "2026-10-13" },
      conditions: [{ fieldId: "D", comparator: "SAME_DAY", __filterName: "Daily" }],
      fieldsById,
    });
    expect(h).toEqual({ count: 2, sources: [{ filterName: "Daily", fieldNames: ["Date"] }] });
    expect(filterHiddenHintText(h)).toBe("2 items hidden by the Daily filter (Date)");
  });

  it("is not about Date: a local Time Slot filter is named by its field", () => {
    const rows = [row("a", { T: "7:00am" })];
    const h = filterHiddenHint({
      occurrences: rows, visibleCount: 0,
      effectiveFilters: { T: "9:00pm" },
      conditions: [{ fieldId: "T", comparator: "IS", __filterName: null }],
      fieldsById,
    });
    expect(filterHiddenHintText(h)).toBe("1 item hidden by the Time Slot filter");
  });

  it("names only the condition that actually hides rows", () => {
    const rows = [row("a", { D: "2026-10-31", K: "x" })];
    const h = filterHiddenHint({
      occurrences: rows, visibleCount: 0,
      effectiveFilters: { D: "2026-10-13", K: "x" },
      conditions: [
        { fieldId: "K", comparator: "IS", __filterName: null },
        { fieldId: "D", comparator: "SAME_DAY", __filterName: "Daily" },
      ],
      fieldsById,
    });
    expect(h.sources).toEqual([{ filterName: "Daily", fieldNames: ["Date"] }]);
  });

  it("works without conditions (the legacy effective-filter path)", () => {
    const rows = [row("a", { K: "x" })];
    const h = filterHiddenHint({ occurrences: rows, visibleCount: 0, effectiveFilters: { K: "y" }, conditions: null, fieldsById });
    expect(filterHiddenHintText(h)).toBe("1 item hidden by the Kind filter");
  });

  it("CONTROL: nothing to say when anything is visible, the list is empty, or rows are hidden by hand", () => {
    const rows = [row("a", { D: "2026-10-31" })];
    const base = { effectiveFilters: { D: "2026-10-13" }, conditions: [{ fieldId: "D", comparator: "SAME_DAY", __filterName: "Daily" }], fieldsById };
    expect(filterHiddenHint({ ...base, occurrences: rows, visibleCount: 1 })).toBeNull();
    expect(filterHiddenHint({ ...base, occurrences: [], visibleCount: 0 })).toBeNull();
    expect(filterHiddenHint({ ...base, occurrences: [{ ...rows[0], hidden: true }], visibleCount: 0 })).toBeNull();
  });
});

import fs from "node:fs";
import path from "node:path";
describe("ModuleContainer shows the hint", () => {
  it("computes it from the container's own rows and renders it as a button that opens the filters", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../modules/ModuleContainer.jsx"), "utf8");
    expect(src).toMatch(/filterHiddenHint\(\{/);
    expect(src).toMatch(/className="container-filter-hint" onClick=\{openDropdown\}/);
    expect(src).toMatch(/filterHiddenHintText\(filterHint\)/);
  });
});
