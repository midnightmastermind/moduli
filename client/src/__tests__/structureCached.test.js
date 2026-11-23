// 2026-11-23: the parent indexes are reused across occurrence maps that differ only in field values.
import { describe, it, expect } from "vitest";
import { sameStructure, cachedParentMap, cachedParentsMap, cachedAncestorsOf } from "../helpers/dragHitTesting";

const base = () => ({
  p: { id: "p", occurrences: ["a", "b"] },
  a: { id: "a", parentId: "p", occurrences: ["c"], fields: { f: { value: 1 } } },
  b: { id: "b", parentId: "p", occurrences: [] },
  c: { id: "c", parentId: "a" },
});

describe("sameStructure", () => {
  it("a field write keeps the structure", () => {
    const m1 = base(); const m2 = { ...m1, a: { ...m1.a, fields: { f: { value: 2 } } } };
    expect(sameStructure(m1, m2)).toBe(true);
  });
  it("a moved child, a new list, a new parentId, a new row or a new order all change it", () => {
    const m1 = base();
    expect(sameStructure(m1, { ...m1, p: { ...m1.p, occurrences: ["b", "a"] } })).toBe(false);
    expect(sameStructure(m1, { ...m1, c: { ...m1.c, parentId: "b" } })).toBe(false);
    expect(sameStructure(m1, { ...m1, d: { id: "d" } })).toBe(false);
    const { p, ...rest } = m1; expect(sameStructure(m1, { ...rest, p })).toBe(false);
  });
});

describe("the caches", () => {
  it("reuse across a field write, rebuild after a move — and the answer follows the move", () => {
    const m1 = base(); const m2 = { ...m1, a: { ...m1.a, fields: { f: { value: 2 } } } };
    expect(cachedParentMap(m2)).toBe(cachedParentMap(m1));
    expect(cachedParentsMap(m2)).toBe(cachedParentsMap(m1));
    expect(cachedAncestorsOf(m2)("c")).toEqual(["a", "p"]);
    const m3 = { ...m2, a: { ...m2.a, occurrences: [] }, b: { ...m2.b, occurrences: ["c"] }, c: { ...m2.c, parentId: "b" } };
    expect(cachedParentMap(m3)).not.toBe(cachedParentMap(m2));
    expect(cachedParentMap(m3).c).toBe("b");
    expect(cachedAncestorsOf(m3)("c")).toEqual(["b", "p"]);
  });
});
