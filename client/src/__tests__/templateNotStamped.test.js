// Nothing created INSIDE a template is born carrying the filter's date.
//
// 2026-08-05 made every create stamp the parent's filter values (so a row made
// in a day column belongs to that day). A template is timeless — its dates come
// from APPLY_TEMPLATE's defaultFields when it is applied — yet building the
// rebuild grid's Schedule template by clicking (2026-09-28) stamped all 49 slots
// `Date = 2026-09-28`. Every day column copy-links those slots, so on any other
// day all 49 were filtered out: tomorrow's schedule rendered EMPTY.
import { describe, it, expect, beforeEach } from "vitest";
import { operationsBridge } from "../state/bindSocketToStore";
import { parentFilterFields } from "../helpers/CommitHelpers";
import { isInsideTemplate } from "../helpers/templateHelpers";

const GRID = "g1", DATE = "fDate";
const folders = [{ id: "tpl", gridId: GRID, name: "Templates", meta: { protected: true } }, { id: "root", gridId: GRID, name: "Root" }];
const occ = (id, parentId, extra = {}) => ({ id, parentId, occurrences: [], ...extra });
const occurrencesById = {
  tplPage: occ("tplPage", "tpl"), layout: occ("layout", "tplPage"),
  schedPage: occ("schedPage", "root"), dayCol: occ("dayCol", "schedPage"),
};
// The grid's active named filter navigates Date — what makes a create stamp at all
// (fixture shape from CommitHelpers.test.js "typed creates … filter values").
const state = {
  gridId: GRID, folders, occurrences: Object.values(occurrencesById),
  grid: { id: GRID, _id: GRID, activeFilterId: "fd", namedFilters: [{ id: "fd", conditions: [{ fieldId: DATE, isNav: true }] }], activeFilterValues: { [DATE]: "2026-09-28" } },
};

beforeEach(() => { operationsBridge.getFilterContext = () => ({ state, occurrencesById }); });

describe("templates are timeless", () => {
  it("knows what is inside the Templates folder, at any depth", () => {
    const lookups = { foldersById: Object.fromEntries(folders.map((f) => [f.id, f])), occurrencesById };
    expect(isInsideTemplate(occurrencesById.layout, lookups, GRID)).toBe(true);
    expect(isInsideTemplate(occurrencesById.dayCol, lookups, GRID)).toBe(false);
  });
  it("a slot created inside a template gets no date", () => {
    expect(parentFilterFields(occurrencesById.layout)).toBeNull();
  });
  it("CONTROL: a row created in an ordinary dated container is still stamped", () => {
    const f = parentFilterFields(occurrencesById.dayCol);
    expect(f?.[DATE]).toBeTruthy();
  });
});
