// A parent's child list written against a known base keeps children the writer
// never knew about (user, 2026-09-26: the Schedule's day column kept getting
// unlinked by a write carrying an older copy of the page's list).
import { describe, it, expect } from "vitest";
import { mergeChildListWithBase } from "../socketHandlers/occurrences.js";

describe("mergeChildListWithBase", () => {
  it("keeps a child added since the writer's copy (the lost day column)", () => {
    // stored: a,b,TODAY — the writer's copy was a,b and it reordered to b,a
    expect(mergeChildListWithBase(["a", "b", "today"], ["a", "b"], ["b", "a"])).toEqual(["b", "a", "today"]);
  });
  it("still removes what the writer removed on purpose", () => {
    expect(mergeChildListWithBase(["a", "b", "c"], ["a", "b", "c"], ["a", "c"])).toEqual(["a", "c"]);
  });
  it("applies the writer's additions", () => {
    expect(mergeChildListWithBase(["a", "b"], ["a", "b"], ["a", "x", "b"])).toEqual(["a", "x", "b"]);
  });
  it("an unknown child keeps its stored neighbourhood", () => {
    expect(mergeChildListWithBase(["a", "new", "b"], ["a", "b"], ["a", "b", "c"])).toEqual(["a", "new", "b", "c"]);
  });
  it("a removal and a concurrent add compose", () => {
    expect(mergeChildListWithBase(["a", "b", "today"], ["a", "b"], ["a"])).toEqual(["a", "today"]);
  });
  it("no base → the write is taken as sent", () => {
    expect(mergeChildListWithBase(["a", "b"], undefined, ["a"])).toEqual(["a"]);
  });
});
