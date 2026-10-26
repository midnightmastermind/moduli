import { describe, it, expect } from "vitest";
import { isOccurrenceVisible, getLocalFilterConditions } from "../state/selectors.js";

describe("a filter's Hide blanks", () => {
  const board = { filters: [{ id: "f", fieldId: "artist", active: true, comparator: "IS", hides: false, hideEmpty: true }] };
  const conds = getLocalFilterConditions(board);
  const noArtist = { id: "x", fields: {} };
  const theirs = { id: "a", fields: { artist: { value: "eminem" } } };
  it("hides a row with no value while the filter has one", () => {
    expect(isOccurrenceVisible(noArtist, { artist: "eminem" }, conds)).toBe(false);
    expect(isOccurrenceVisible(theirs, { artist: "eminem" }, conds)).toBe(true);
  });
  it("shows it again once the filter is let go of", () => {
    expect(isOccurrenceVisible(noArtist, {}, conds)).toBe(true);
  });
  it("without it a row with no value passes (control: undated rows on dated pages)", () => {
    const plain = getLocalFilterConditions({ filters: [{ id: "f", fieldId: "artist", active: true, comparator: "IS", hides: false }] });
    expect(isOccurrenceVisible(noArtist, { artist: "eminem" }, plain)).toBe(true);
  });
});
