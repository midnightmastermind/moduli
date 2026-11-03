// Every filter type, with the value shapes the filter menu writes (user, 2026-11-03: "make sure all filter types work").
// The People board's case first: the filter is DECLARED on the page and the container under it picks the value.
import { describe, it, expect } from "vitest";
import { isOccurrenceVisible, getInheritedLocalFilterConditions } from "../state/selectors.js";

const row = (fid, value) => ({ id: Math.random().toString(36).slice(2), fields: value === undefined ? {} : { [fid]: { value } } });
const vis = (occ, fid, filterValue, extra = {}) =>
  isOccurrenceVisible(occ, { [fid]: filterValue }, [{ fieldId: fid, comparator: "IS", ...extra }]);

describe("a filter declared above the container", () => {
  const occs = {
    page: { id: "page", occurrences: ["cont"], filters: [{ id: "f", fieldId: "rel", active: true, condition: null }], filterOverride: { rel: "friend" } },
    cont: { id: "cont", occurrences: [], filters: [], filterOverride: { rel: ["acquaintance"] } },
  };
  it("applies to the container's rows", () => {
    expect(getInheritedLocalFilterConditions(occs.cont, { occurrencesById: occs })).toEqual([{ fieldId: "rel", comparator: "IS" }]);
  });
  it("the nearest level can switch it off", () => {
    const off = { ...occs, cont: { ...occs.cont, filters: [{ id: "g", fieldId: "rel", active: false, condition: null }] } };
    expect(getInheritedLocalFilterConditions(off.cont, { occurrencesById: off })).toEqual([]);
  });
});

describe("each filter type", () => {
  it("select, picked as a list", () => {
    expect(vis(row("rel", "acquaintance"), "rel", ["acquaintance"])).toBe(true);
    expect(vis(row("rel", "friend"), "rel", ["acquaintance"])).toBe(false);
    expect(vis(row("rel", "friend"), "rel", ["acquaintance", "friend"])).toBe(true);
    expect(vis(row("rel", "friend"), "rel", [])).toBe(true);
  });
  it("select, a single value", () => {
    expect(vis(row("rel", "friend"), "rel", "friend")).toBe(true);
    expect(vis(row("rel", "family"), "rel", "friend")).toBe(false);
  });
  it("multi-select field against picks", () => {
    expect(vis(row("tags", ["physical", "social"]), "tags", ["social"])).toBe(true);
    expect(vis(row("tags", ["physical"]), "tags", ["social"])).toBe(false);
    expect(vis(row("tags", ["physical"]), "tags", "physical")).toBe(true);
  });
  it("occurrence field (a picked row's id)", () => {
    expect(vis(row("artist", "a1"), "artist", ["a1"])).toBe(true);
    expect(vis(row("artist", "a2"), "artist", "a1")).toBe(false);
    expect(vis(row("artist", ["a1", "a3"]), "artist", "a3")).toBe(true);
  });
  it("boolean", () => {
    expect(vis(row("done", true), "done", true)).toBe(true);
    expect(vis(row("done", false), "done", true)).toBe(false);
    expect(vis(row("done", false), "done", false)).toBe(true);
    expect(vis(row("done", true), "done", false)).toBe(false);
  });
  it("number / rating / duration", () => {
    expect(vis(row("n", 5), "n", 5)).toBe(true);
    expect(vis(row("n", 5), "n", "5")).toBe(true);
    expect(vis(row("n", 4), "n", 5)).toBe(false);
  });
  it("text", () => {
    expect(vis(row("t", "Work"), "t", "Work")).toBe(true);
    expect(vis(row("t", "Home"), "t", "Work")).toBe(false);
  });
  it("date: a day, a week, a month, several days", () => {
    const d = row("date", "2026-11-03");
    expect(vis(d, "date", "2026-11-03")).toBe(true);
    expect(vis(d, "date", "2026-11-04")).toBe(false);
    expect(vis(row("date", "2026-11-03T15:00:00.000Z"), "date", "2026-11-03")).toBe(true);
    expect(vis(d, "date", { value: "2026-11-03", unit: "day", kind: "single" })).toBe(true);
    expect(vis(d, "date", { value: "2026-11-02", unit: "week" })).toBe(true);
    expect(vis(d, "date", { value: "2026-11-01", unit: "month" })).toBe(true);
    expect(vis(d, "date", { value: "2026-10-01", unit: "month" })).toBe(false);
    expect(vis(d, "date", { kind: "multi", dates: ["2026-11-01", "2026-11-03"], unit: "day" })).toBe(true);
  });
  it("a row with no value shows, unless the filter hides blanks", () => {
    expect(vis(row("rel"), "rel", ["friend"])).toBe(true);
    expect(vis(row("rel"), "rel", ["friend"], { hideEmpty: true })).toBe(false);
  });
  it("no value picked anywhere is no filter", () => {
    expect(vis(row("rel", "friend"), "rel", null)).toBe(true);
    expect(vis(row("rel", "friend"), "rel", undefined)).toBe(true);
  });
});

describe("nothing picked", () => {
  it("an empty pick list shows every row, blanks included (togglePick: filterMultiPick.test)", () => {
    expect(vis(row("rel", "friend"), "rel", [])).toBe(true);
    expect(vis(row("rel"), "rel", [], { hideEmpty: true })).toBe(true);
    expect(isOccurrenceVisible(row("rel", "friend"), { rel: [] })).toBe(true);
  });
});

describe("the boards apply inherited filters", () => {
  it("containers, pages and search's keep-filters all read the inherited list", async () => {
    const fs = await import("node:fs"); const path = await import("node:path");
    for (const f of ["modules/ModuleContainer.jsx", "modules/ModulePage.jsx", "helpers/filterKeep.js"]) {
      const src = fs.readFileSync(path.resolve(__dirname, "..", f), "utf8");
      expect(src, f).toMatch(/getInheritedLocalFilterConditions\(/);
      expect(src, f).not.toMatch(/getLocalFilterConditions\(/);
    }
  });
});
