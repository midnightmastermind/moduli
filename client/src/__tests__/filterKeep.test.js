// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { makeFilterKeeper } from "../helpers/filterKeep.js";

const D = "f-date";
const grid = { activeFilterId: "daily", namedFilters: [{ id: "daily", conditions: [{ fieldId: D, comparator: "SAME_DAY", isNav: true }] }], activeFilterValues: { [D]: "2026-10-13" } };
const modulesById = { mp: { id: "mp", role: "page" }, mc: { id: "mc", role: "container" }, mi: { id: "mi", role: "instance" } };
const world = () => ({
  page: { id: "page", moduleId: "mp", occurrences: ["today", "tomorrow", "plain"] },
  today: { id: "today", moduleId: "mc", fields: { [D]: { value: "2026-10-13" } }, occurrences: ["r1"] },
  tomorrow: { id: "tomorrow", moduleId: "mc", fields: { [D]: { value: "2026-10-14" } }, occurrences: ["r2"] },
  plain: { id: "plain", moduleId: "mc", occurrences: ["r3", "r4"] },
  r1: { id: "r1", moduleId: "mi" },
  r2: { id: "r2", moduleId: "mi" },
  r3: { id: "r3", moduleId: "mi", fields: { [D]: { value: "2026-10-12" } } },
  r4: { id: "r4", moduleId: "mi" },
});

describe("makeFilterKeeper", () => {
  const keep = makeFilterKeeper({ grid, occurrencesById: world(), modulesById });
  it("keeps a row in today's column", () => expect(keep("r1")).toBe(true));
  it("drops a row whose COLUMN the date hides, though the row itself carries no date", () => expect(keep("r2")).toBe(false));
  it("drops a row the date hides directly", () => expect(keep("r3")).toBe(false));
  it("keeps an undated row in an undated container (persistent)", () => expect(keep("r4")).toBe(true));
  it("keeps everything when no filter is active (control)", () => {
    const k = makeFilterKeeper({ grid: { ...grid, activeFilterId: null, activeFilterValues: {} }, occurrencesById: world(), modulesById });
    expect(["r1", "r2", "r3", "r4"].map(k)).toEqual([true, true, true, true]);
  });
  it("respects a page that turned the date filter off", () => {
    const w = world(); w.page.filterOverride = { [D]: null };
    const k = makeFilterKeeper({ grid, occurrencesById: w, modulesById });
    expect(k("r2")).toBe(true);
  });
});
