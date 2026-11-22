import { describe, it, expect, vi } from "vitest";
vi.mock("../socket", () => ({ default: null }));
import { feedScopeOfPatch } from "../helpers/CommitHelpers";

// 2026-11-22: a Schedule date step ran several passes over every feed. Only what a feed can read asks for one.
describe("feedScopeOfPatch", () => {
  it("text, label and meta writes move no feed", () => {
    expect(feedScopeOfPatch({ id: "a", textmap: {} })).toBe("none");
    expect(feedScopeOfPatch({ id: "a", label: "Today's Water" })).toBe("none");
    expect(feedScopeOfPatch({ id: "a", meta: { x: 1 } })).toBe("none");
  });
  it("a date-filter write names its fields; a cleared filter is everything", () => {
    expect(feedScopeOfPatch({ id: "p", filterOverride: { date: "2026-11-23" } })).toEqual({ fieldIds: ["date"] });
    expect(feedScopeOfPatch({ id: "p", filterOverride: {} })).toEqual({});
    expect(feedScopeOfPatch({ id: "p", filterOverride: null })).toEqual({});
  });
  it("field edits name their fields; structure is everything", () => {
    expect(feedScopeOfPatch({ id: "a", fields: {} }, { fieldId: "f1" })).toEqual({ fieldIds: ["f1"] });
    expect(feedScopeOfPatch({ id: "a", occurrences: ["x"] })).toEqual({});
    expect(feedScopeOfPatch({ id: "a", parentId: "p", label: "x" })).toEqual({});
  });
});
