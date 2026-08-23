// A parent listing the same child twice renders it twice. Found on today's Day
// Page column: Journal, Notes, Tasks Completed and Highlights each appeared at
// two positions with the SAME occurrence id — not cloned rows.
import { describe, it, expect } from "vitest";
import { dedupeChildList } from "../migrations/0198-a-child-listed-twice.mjs";

describe("dedupeChildList", () => {
  it("removes the repeat and keeps the FIRST position", () => {
    // Keeping the later one would move the section down the page; on a day
    // column the array IS the running order (0137 repaired a rotation once).
    expect(dedupeChildList(["a", "b", "a", "c"])).toEqual(["a", "b", "c"]);
  });

  it("returns null when there is nothing to do, so a no-op is never written", () => {
    expect(dedupeChildList(["a", "b", "c"])).toBeNull();
    expect(dedupeChildList([])).toBeNull();
  });

  it("handles the live shape — four repeats among ten entries", () => {
    const ids = ["wheel", "j", "n", "t", "h", "todo", "j", "n", "t", "h"];
    expect(dedupeChildList(ids)).toEqual(["wheel", "j", "n", "t", "h", "todo"]);
  });

  it("a non-array is null, not a crash", () => {
    expect(dedupeChildList(null)).toBeNull();
    expect(dedupeChildList(undefined)).toBeNull();
  });
});
