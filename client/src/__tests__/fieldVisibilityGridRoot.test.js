// The shown cascade had no ROOT until 2026-08-11. User: "hide tags everywhere,
// and hide date everywhere thats not tasks, schedule, trackers" — a default with
// three exceptions, which is a cascade rooted somewhere. Writing "everywhere"
// onto all 71 pages would need re-writing for every page created after.
import { describe, it, expect } from "vitest";
import { getEffectiveFieldVisibilityForOccurrence } from "../state/selectors";

const TAGS = "f-tags", DATE = "f-date";
const GRID = { meta: { fieldVisibility: { mode: "hide", fieldIds: [TAGS, DATE] } } };
const OCCS = {
  page: { id: "page", occurrences: ["cont"] },
  cont: { id: "cont", occurrences: ["row"] },
  row: { id: "row" },
};
const at = (id, occs = OCCS, grid = GRID) =>
  getEffectiveFieldVisibilityForOccurrence(occs[id], { occurrencesById: occs, grid });

describe("the shown cascade, rooted at the grid", () => {
  it("applies the grid default when nothing in the chain says otherwise", () => {
    expect(at("row")).toEqual({ mode: "hide", fieldIds: [TAGS, DATE] });
  });

  // The three exception pages.
  it("a nearer HIDE list wins, so a page can show Date again", () => {
    const occs = { ...OCCS, page: { ...OCCS.page, fieldVisibility: { mode: "hide", fieldIds: [TAGS] } } };
    expect(at("row", occs)).toEqual({ mode: "hide", fieldIds: [TAGS] });
  });

  it("mode:'off' still clears the constraint for that subtree", () => {
    const occs = { ...OCCS, cont: { ...OCCS.cont, fieldVisibility: { mode: "off" } } };
    expect(at("row", occs)).toBeNull();
  });

  it("a grid naming none behaves exactly as before — null", () => {
    expect(at("row", OCCS, {})).toBeNull();
    expect(at("row", OCCS, { meta: {} })).toBeNull();
  });

  it("an off-mode grid default is no constraint", () => {
    expect(at("row", OCCS, { meta: { fieldVisibility: { mode: "off" } } })).toBeNull();
  });

  it("a null occurrence resolves to the grid default rather than throwing", () => {
    expect(getEffectiveFieldVisibilityForOccurrence(null, { occurrencesById: OCCS, grid: GRID }))
      .toEqual({ mode: "hide", fieldIds: [TAGS, DATE] });
  });

  it("normalises a malformed grid default instead of passing it through", () => {
    const g = { meta: { fieldVisibility: { mode: "hide" } } };
    expect(at("row", OCCS, g)).toEqual({ mode: "hide", fieldIds: [] });
  });
});
