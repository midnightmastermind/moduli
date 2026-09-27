// $activeDate must come from the field the filter NAVIGATES, not the first
// date-shaped value in the map.
//
// `grid.activeFilterValues` is keyed by field id and nothing prunes it, so a grid
// whose named filter is re-pointed at a different date field keeps the abandoned
// field's last value. Measured on the rebuild grid 2026-09-27: the Daily filter
// had moved from `Logged On` to `Date`, the toolbar navigated `Date`, and
// $activeDate resolved to `Logged On`'s stale 2026-09-21 — so every op on that
// grid computed against a date the user could neither see nor change.
import { describe, it, expect } from "vitest";
import { pickActivePeriod, navFieldIds, isDateShaped } from "../helpers/activePeriod";

const LOGGED_ON = "1790015317546-bwr6gfp3o";
const DATE = "1790525022905-6wtnl0ddl";

// The rebuild grid's real shape at the moment the defect was measured.
const REBUILD_GRID = {
  activeFilterId: "filter_1790015438018-rk5b0l16t",
  namedFilters: [{
    id: "filter_1790015438018-rk5b0l16t",
    name: "Daily",
    conditions: [{ fieldId: DATE, comparator: "SAME_DAY", isNav: true }],
  }],
};
const REBUILD_EFV = { [LOGGED_ON]: "2026-09-21", [DATE]: "2026-09-27" };

describe("pickActivePeriod", () => {
  it("prefers the field the ACTIVE filter navigates over an abandoned one", () => {
    expect(pickActivePeriod(REBUILD_EFV, REBUILD_GRID)).toBe("2026-09-27");
  });

  it("insertion order is what made it wrong — the stale value comes FIRST", () => {
    // Pins the fixture: if the abandoned key stopped leading the map, the test
    // above would pass without the fix and prove nothing.
    expect(Object.values(REBUILD_EFV)[0]).toBe("2026-09-21");
  });

  it("falls back to the first date-shaped value when the grid has no named filter", () => {
    // 4 of 10 grids carry none; this IS their answer, unchanged.
    expect(pickActivePeriod(REBUILD_EFV, {})).toBe("2026-09-21");
    expect(pickActivePeriod(REBUILD_EFV, null)).toBe("2026-09-21");
  });

  it("falls back when the navigated field holds no date", () => {
    // An ancestor filterOverride can key a date the filter never mentions.
    const efv = { other: "2026-08-01" };
    expect(pickActivePeriod(efv, REBUILD_GRID)).toBe("2026-08-01");
  });

  it("returns undefined for a map with no date at all", () => {
    // "no date filter" must stay distinguishable from "a date of null".
    expect(pickActivePeriod({ x: "hello", y: 3 }, REBUILD_GRID)).toBeUndefined();
    expect(pickActivePeriod({}, REBUILD_GRID)).toBeUndefined();
    expect(pickActivePeriod(null, REBUILD_GRID)).toBeUndefined();
  });

  it("honours the date-range object shape, not just a bare string", () => {
    const range = { value: "2026-09-27", unit: "week", span: 1 };
    expect(pickActivePeriod({ [LOGGED_ON]: "2026-09-21", [DATE]: range }, REBUILD_GRID)).toBe(range);
  });

  it("CONTROL: a grid whose filter still owns the only date is unchanged", () => {
    // This is every OTHER grid. Measured: 9 of 10 resolve identically before and
    // after, which is what makes the change safe rather than merely correct.
    const efv = { [DATE]: "2026-09-27" };
    expect(pickActivePeriod(efv, REBUILD_GRID)).toBe("2026-09-27");
    expect(pickActivePeriod(efv, {})).toBe("2026-09-27");
  });
});

describe("navFieldIds", () => {
  it("reads the active filter's condition fields, in order", () => {
    expect(navFieldIds(REBUILD_GRID)).toEqual([DATE]);
  });

  it("puts primaryDateFieldId first when the filter names one", () => {
    const g = {
      activeFilterId: "f",
      namedFilters: [{ id: "f", primaryDateFieldId: "pd", conditions: [{ fieldId: "c1" }, { fieldId: "c2" }] }],
    };
    expect(navFieldIds(g)).toEqual(["pd", "c1", "c2"]);
  });

  it("is empty when no filter is active, so the caller falls back", () => {
    expect(navFieldIds({ namedFilters: [{ id: "other", conditions: [{ fieldId: "x" }] }], activeFilterId: "f" })).toEqual([]);
    expect(navFieldIds({})).toEqual([]);
    expect(navFieldIds(null)).toEqual([]);
  });

  it("drops duplicate and empty field ids", () => {
    const g = { activeFilterId: "f", namedFilters: [{ id: "f", conditions: [{ fieldId: "a" }, { fieldId: "a" }, {}, { fieldId: "" }] }] };
    expect(navFieldIds(g)).toEqual(["a"]);
  });
});

describe("isDateShaped", () => {
  it("accepts a bare day string and a range object", () => {
    expect(isDateShaped("2026-09-27")).toBe(true);
    expect(isDateShaped({ value: "2026-09-27", unit: "month" })).toBe(true);
  });
  it("rejects everything else", () => {
    for (const v of [null, undefined, "", "hello", 3, {}, { value: "nope" }, ["2026-09-27"]]) {
      expect(isDateShaped(v), String(v)).toBe(false);
    }
  });
});

// ── pruning the map that let the stale value exist ──────────────────────────
import fs from "node:fs";
import path from "node:path";
import { pruneOrphanFilterValues, filterFieldIds } from "../helpers/activePeriod";

describe("pruneOrphanFilterValues", () => {
  it("drops a value no named filter references", () => {
    // The rebuild grid's real state: the Daily filter moved to `Date` and
    // `Logged On`'s last value stayed behind. Measured across every grid — this
    // was the ONLY orphan key anywhere, so the prune is a one-row repair.
    expect(pruneOrphanFilterValues(REBUILD_EFV, REBUILD_GRID)).toEqual({ [DATE]: "2026-09-27" });
  });

  it("keeps values belonging to the grid's OTHER named filters", () => {
    // A grid can carry several; switching between them must keep each one's
    // value, so "the ACTIVE filter does not name it" is the wrong question.
    const g = {
      activeFilterId: "daily",
      namedFilters: [
        { id: "daily", conditions: [{ fieldId: DATE }] },
        { id: "weekly", conditions: [{ fieldId: LOGGED_ON }] },
      ],
    };
    expect(pruneOrphanFilterValues(REBUILD_EFV, g)).toEqual(REBUILD_EFV);
  });

  it("FAILS CLOSED: a grid with no named filters prunes nothing", () => {
    // An empty reference set would otherwise wipe every value, and "no filters
    // declared" is a normal state, not permission to delete data.
    expect(pruneOrphanFilterValues(REBUILD_EFV, {})).toEqual(REBUILD_EFV);
    expect(pruneOrphanFilterValues(REBUILD_EFV, { namedFilters: [] })).toEqual(REBUILD_EFV);
    expect(pruneOrphanFilterValues(REBUILD_EFV, null)).toEqual(REBUILD_EFV);
  });

  it("returns the SAME object when nothing is orphaned, so a caller can skip a write", () => {
    const clean = { [DATE]: "2026-09-27" };
    expect(pruneOrphanFilterValues(clean, REBUILD_GRID)).toBe(clean);
  });

  it("counts a filter's primaryDateFieldId as referenced", () => {
    const g = { activeFilterId: "f", namedFilters: [{ id: "f", primaryDateFieldId: LOGGED_ON, conditions: [] }] };
    expect(pruneOrphanFilterValues(REBUILD_EFV, g)).toEqual({ [LOGGED_ON]: "2026-09-21" });
  });

  it("filterFieldIds spans every filter, not just the active one", () => {
    const g = {
      activeFilterId: "daily",
      namedFilters: [{ id: "daily", conditions: [{ fieldId: "a" }] }, { id: "weekly", conditions: [{ fieldId: "b" }] }],
    };
    expect([...filterFieldIds(g)].sort()).toEqual(["a", "b"]);
    expect([...filterFieldIds({})]).toEqual([]);
  });
});

describe("the toolbar's nav write prunes", () => {
  const SRC = fs.readFileSync(path.join(__dirname, "..", "Toolbar.jsx"), "utf8");
  it("does not spread the raw map", () => {
    // `{ ...(grid?.activeFilterValues || {}) }` is what preserved the stale key.
    expect(SRC).toContain("pruneOrphanFilterValues(grid?.activeFilterValues || {}, grid)");
    expect(SRC).not.toMatch(/\}, \{ \.\.\.\(grid\?\.activeFilterValues \|\| \{\}\) \}\);/);
  });
  it("control: it still writes the nav fields it is given", () => {
    expect(SRC).toContain("acc[c.fieldId] = next;");
    expect(SRC).toContain("activeFilterValues: updatedValues");
  });
});
