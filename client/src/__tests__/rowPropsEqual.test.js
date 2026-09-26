// A row must not re-render just because its container gained or lost a child
// (user, 2026-09-26: deleting one person froze the 1,200-row People board).
import { describe, it, expect } from "vitest";
import { rowPropsEqual } from "../modules/ModuleInstance";

const occ = { id: "row" };
describe("rowPropsEqual", () => {
  it("a container whose child list changed (same id) is equal", () => {
    expect(rowPropsEqual(
      { occurrence: occ, containerOccurrence: { id: "c", occurrences: ["a", "row"] } },
      { occurrence: occ, containerOccurrence: { id: "c", occurrences: ["row"] } },
    )).toBe(true);
  });
  it("a different container is not", () => {
    expect(rowPropsEqual({ occurrence: occ, containerOccurrence: { id: "c" } },
      { occurrence: occ, containerOccurrence: { id: "d" } })).toBe(false);
  });
  it("any other changed prop still re-renders", () => {
    expect(rowPropsEqual({ occurrence: occ, containerOccurrence: { id: "c" } },
      { occurrence: { id: "row" }, containerOccurrence: { id: "c" } })).toBe(false);
    expect(rowPropsEqual({ occurrence: occ }, { occurrence: occ, renderBody: () => null })).toBe(false);
  });
});
