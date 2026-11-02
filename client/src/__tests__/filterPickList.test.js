// __tests__/filterPickList.test.js
// User 2026-11-02: "the filters arent working for the select fields. the nav should be a multiselect".
// A select-field filter's nav now writes a LIST of picks, and a multi-select field (Tags) stores a list. The plain
// "field IS value" test compared strings, so a row tagged [physical, social] never matched "social".
import { describe, it, expect } from "vitest";
import { isOccurrenceVisible, getLocalFilterConditions } from "../state/selectors";

const row = (v) => ({ id: "r", fields: { F: { value: v } } });
const conds = [{ fieldId: "F", comparator: "IS" }];
const vis = (v, pick) => isOccurrenceVisible(row(v), { F: pick }, conds);

describe("a select filter with a list on either side", () => {
  it("several picks: a row matching any of them shows", () => {
    expect(vis("social", ["social", "media"])).toBe(true);
    expect(vis("website", ["social", "media"])).toBe(false);
  });
  it("a multi-select row value matches a pick it contains", () => {
    expect(vis(["physical", "social"], "social")).toBe(true);
    expect(vis(["physical", "social"], ["media", "social"])).toBe(true);
    expect(vis(["physical"], ["media"])).toBe(false);
  });
  it("an empty pick list is no filter", () => {
    expect(vis("website", [])).toBe(true);
  });
  it("control: a single value against a single pick is unchanged", () => {
    expect(vis("friend", "friend")).toBe(true);
    expect(vis("friend", "family")).toBe(false);
  });
});

describe("a filter Jonah built is a real filter", () => {
  it("the add_filter shape (no condition) becomes a field test", () => {
    const occ = { filters: [{ id: "x", fieldId: "F", active: true, showNav: true, condition: null }] };
    expect(getLocalFilterConditions(occ)).toEqual([{ fieldId: "F", comparator: "IS" }]);
  });
});
