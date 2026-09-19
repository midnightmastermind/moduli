// The executor's parent map is SHARED across the sweeps of one overlay version.
//
// A page's date change fires one NavigationOp sweep per inheriting descendant,
// and each sweep used to rebuild the whole-grid child->parent index — 5.3s of a
// 9.4s Day Page date step on the live grid (prod profile, 2026-09-19). The cache
// is keyed on the overlay object AND its write counter, and each sweep gets its
// own prototype layer so CREATE's in-place patches never leak.
//
// THE HAZARD would be ops rewriting `occurrences[]` on that same object without
// bumping the version. They do not: a sweep writes to its own `liveOccs` copy.
// The last test drives a real ADD_CHILD sweep and pins exactly that.
import { describe, it, expect } from "vitest";
import { runMatchingOperations, _sweepParentMapForTests as sweepParentMap } from "../helpers/operationExecutor";

const occs = () => ({
  page: { id: "page", occurrences: ["col"] },
  col: { id: "col", occurrences: [] },
  row: { id: "row", occurrences: [] },
});

describe("sweepParentMap", () => {
  it("reuses one index for the same overlay object and version", () => {
    const o = occs();
    const a = sweepParentMap(o, 7);
    const b = sweepParentMap(o, 7);
    expect(a.col).toBe("page");
    // Both are layers over ONE shared index (an uncached build has a null
    // prototype on each, which would make a bare equality check vacuous).
    expect(Object.getPrototypeOf(a)).not.toBeNull();
    expect(Object.getPrototypeOf(a)).toBe(Object.getPrototypeOf(b));
  });

  it("rebuilds when the version moves", () => {
    const o = occs();
    const a = sweepParentMap(o, 1);
    o.col = { ...o.col, occurrences: ["row"] };
    const b = sweepParentMap(o, 2);
    expect(a.row).toBeUndefined();
    expect(b.row).toBe("col");
  });

  it("keeps one sweep's patches out of the next sweep", () => {
    const o = occs();
    const a = sweepParentMap(o, 3);
    a.row = "col"; // what operationActions CREATE does mid-sweep
    expect(sweepParentMap(o, 3).row).toBeUndefined();
  });

  it("builds per call when no version is passed (callers outside the store)", () => {
    const o = occs();
    const a = sweepParentMap(o, undefined);
    const b = sweepParentMap(o, undefined);
    expect(a).not.toBe(b);
    expect(a.col).toBe("page");
  });

  it("a sweep's ADD_CHILD never touches the overlay the index is keyed on", () => {
    const o = occs();
    const op = {
      id: "op-add", name: "Add Row", enabled: true,
      triggerTypes: ["onFilterChange"],
      triggerObjects: [{ eventType: "onFilterChange", subjectType: "grid" }],
      pipeline: { sources: [], steps: [
        { id: "s1", type: "action", config: { type: "ADD_CHILD", parentId: "col", childId: "row" } },
      ] },
    };
    const colBefore = o.col;
    const ctx = { occurrencesById: o, modulesById: {}, fieldsById: {}, operationsById: { [op.id]: op },
      state: { grid: { activeFilterValues: {} }, occurrencesById: o }, _occVersion: 9 };
    const updates = runMatchingOperations([op], "NavigationOp", {}, ctx, {});
    // Positive control: the op ran and emitted the parent's new child list.
    const upd = updates.find((u) => u.occurrence?.id === "col");
    expect(upd?.occurrence.occurrences).toEqual(["row"]);
    // The overlay is untouched, so the cached index still describes it.
    expect(o.col).toBe(colBefore);
    expect(o.col.occurrences).toEqual([]);
    expect(sweepParentMap(o, 9).row).toBeUndefined();
  });
});
