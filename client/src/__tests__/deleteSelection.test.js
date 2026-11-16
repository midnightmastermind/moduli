// helpers/deleteSelection — a delete pressed on one row of a multi-selection deletes all of it, after asking.
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("../helpers/CommitHelpers", () => ({ removeOccurrence: vi.fn() }));
import * as CommitHelpers from "../helpers/CommitHelpers";
import { selectionToDelete, deleteSelected } from "../helpers/deleteSelection";

const occMap = { p: { id: "p", occurrences: ["a", "b", "c"] }, a: { id: "a" }, b: { id: "b" }, c: { id: "c" } };

describe("selectionToDelete", () => {
  it("is the whole selection when the pressed row is in it", () => expect(selectionToDelete("a", new Set(["a", "b"]))).toEqual(["a", "b"]));
  it("is null for a row outside the selection (a single delete)", () => expect(selectionToDelete("c", new Set(["a", "b"]))).toBe(null));
  it("is null for a selection of one", () => expect(selectionToDelete("a", new Set(["a"]))).toBe(null));
});

describe("deleteSelected", () => {
  beforeEach(() => CommitHelpers.removeOccurrence.mockClear());
  it("asks, then removes every id with the row's parent found by who lists it", () => {
    const confirm = vi.fn(() => true); const clear = vi.fn();
    expect(deleteSelected({ ids: ["a", "b"], getOccMap: () => occMap, clear, confirm })).toBe(true);
    expect(confirm.mock.calls[0][0]).toMatch(/Delete 2 selected items/);
    expect(clear).toHaveBeenCalled();
    expect(CommitHelpers.removeOccurrence.mock.calls.map((c) => [c[0].occurrenceId, c[0].parentOccurrence?.id])).toEqual([["a", "p"], ["b", "p"]]);
  });
  it("does nothing when the answer is no", () => {
    const clear = vi.fn();
    expect(deleteSelected({ ids: ["a", "b"], getOccMap: () => occMap, clear, confirm: () => false })).toBe(false);
    expect(CommitHelpers.removeOccurrence).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });
});
