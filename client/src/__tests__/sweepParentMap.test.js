// One parent map per overlay VERSION, not per sweep: a page's date change runs
// one sweep per inheriting descendant, and rebuilding the whole-grid index each
// time was 5.3s of a 9.4s Day Page date step (prod profile, 2026-09-19).
import { describe, it, expect } from "vitest";
import { _sweepParentMapForTests as sweepParentMap } from "../helpers/operationExecutor";

const occs = () => ({ col: { id: "col", occurrences: ["a", "b"] }, a: { id: "a" }, b: { id: "b" } });

describe("sweepParentMap", () => {
  it("resolves children to their parent", () => {
    const m = sweepParentMap(occs(), 1);
    expect(m.a).toBe("col");
    expect(m.b).toBe("col");
  });

  it("shares ONE build across sweeps at the same version", () => {
    const o = occs();
    const m1 = sweepParentMap(o, 7), m2 = sweepParentMap(o, 7);
    expect(Object.getPrototypeOf(m1)).toBe(Object.getPrototypeOf(m2));
  });

  // THE LOAD-BEARING HALF: CREATE patches the map in place; a sweep's patch
  // must not appear in the next sweep's map.
  it("a sweep's own patch stays in that sweep", () => {
    const o = occs();
    const m1 = sweepParentMap(o, 3);
    m1.newChild = "col";
    expect(sweepParentMap(o, 3).newChild).toBeUndefined();
  });

  // The overlay is mutated IN PLACE (same object), so identity alone would go
  // stale — the version is what says it changed.
  it("rebuilds when the version changes on the same object", () => {
    const o = occs();
    sweepParentMap(o, 1);
    o.col.occurrences.push("c"); o.c = { id: "c" };
    expect(sweepParentMap(o, 1).c).toBeUndefined();   // same version: cached
    expect(sweepParentMap(o, 2).c).toBe("col");        // bumped: rebuilt
  });

  it("without a version, builds fresh every time (old behaviour)", () => {
    const o = occs();
    const a = sweepParentMap(o), b = sweepParentMap(o);
    expect(a).not.toBe(b);
    expect(a.a).toBe("col");
  });
});
