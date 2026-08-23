// 0207's two decisions. The wider form of this migration was abandoned because
// it adopted children that are unlisted ON PURPOSE, so what is pinned here is
// mostly the refusal.
import { describe, it, expect } from "vitest";
import { unlistedChildrenOf, looksLikeDayBoard } from "../migrations/0207-relink-day-columns.mjs";

const D = "fDate";
const dated = (id, v) => ({ id, fields: v ? { [D]: { value: v } } : {} });
const board = (kids, listed) => ({ id: "b", occurrences: listed });

describe("unlistedChildrenOf", () => {
  it("finds a child that claims the parent while the parent does not claim it", () => {
    const all = [{ id: "b", occurrences: ["a"] }, { id: "a", parentId: "b" }, { id: "c", parentId: "b" }];
    expect(unlistedChildrenOf(all[0], all)).toEqual(["c"]);
  });

  it("is empty when everything is listed", () => {
    const all = [{ id: "b", occurrences: ["a"] }, { id: "a", parentId: "b" }];
    expect(unlistedChildrenOf(all[0], all)).toEqual([]);
  });

  it("ignores a child parented ELSEWHERE, even if the board once held it", () => {
    const all = [{ id: "b", occurrences: [] }, { id: "x", parentId: "other" }];
    expect(unlistedChildrenOf(all[0], all)).toEqual([]);
  });

  it("never adopts the parent itself", () => {
    const all = [{ id: "b", parentId: "b", occurrences: [] }];
    expect(unlistedChildrenOf(all[0], all)).toEqual([]);
  });
});

describe("looksLikeDayBoard", () => {
  const byId = new Map([
    ["d1", dated("d1", "2026-08-01")], ["d2", dated("d2", "2026-08-02")],
    ["d3", dated("d3", "2026-08-03")], ["u1", dated("u1", null)],
  ]);

  it("accepts a board whose listed children are ALL dated", () => {
    expect(looksLikeDayBoard(board(null, ["d1","d2","d3"]), byId, D)).toBe(true);
  });

  it("REFUSES when any listed child carries no date", () => {
    // The whole safety of this migration: a board that is not the day board
    // fails closed rather than adopting whatever it parents. The wider version
    // of this rule would have restored retired ingredients and old grocery rows.
    expect(looksLikeDayBoard(board(null, ["d1","d2","u1"]), byId, D)).toBe(false);
  });

  it("REFUSES a board with too few children to judge", () => {
    expect(looksLikeDayBoard(board(null, ["d1","d2"]), byId, D)).toBe(false);
    expect(looksLikeDayBoard(board(null, []), byId, D)).toBe(false);
  });

  it("REFUSES when a listed id resolves to nothing", () => {
    expect(looksLikeDayBoard(board(null, ["d1","d2","gone"]), byId, D)).toBe(false);
  });

  it("survives a missing board", () => {
    expect(looksLikeDayBoard(null, byId, D)).toBe(false);
  });
});
