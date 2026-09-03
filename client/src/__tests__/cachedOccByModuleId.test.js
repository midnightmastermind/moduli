// "Which occurrence places this module?" — the index behind ModulePanel's
// `panelOccurrence`, which was a full scan of every occurrence on the grid
// re-running on every store write.
//
// The two properties that matter are FIRST-MATCH (a module may legitimately
// have several placements — the Schedule shares one slot across day columns, so
// choosing a different one is a behaviour change, not an optimisation) and
// INVALIDATION BY IDENTITY (a stale index answers with an occurrence that has
// been re-parented or deleted).
import { describe, it, expect } from "vitest";
import { cachedOccByModuleId } from "../helpers/dragHitTesting";

const occs = (...list) => Object.fromEntries(list.map((o) => [o.id, o]));

describe("cachedOccByModuleId", () => {
  it("answers with the occurrence placing the module", () => {
    const map = occs({ id: "o1", moduleId: "m1" }, { id: "o2", moduleId: "m2" });
    expect(cachedOccByModuleId(map).get("m2")).toBe(map.o2);
    expect(cachedOccByModuleId(map).get("nope")).toBeUndefined();
  });

  // The behaviour `.find()` had. A module with several placements must keep
  // resolving to the same one it always did.
  it("keeps FIRST match when a module has several placements", () => {
    const map = occs(
      { id: "first", moduleId: "shared" },
      { id: "second", moduleId: "shared" },
      { id: "third", moduleId: "shared" },
    );
    expect(cachedOccByModuleId(map).get("shared").id).toBe("first");
  });

  it("returns the SAME index for the same map object", () => {
    const map = occs({ id: "o1", moduleId: "m1" });
    expect(cachedOccByModuleId(map)).toBe(cachedOccByModuleId(map));
  });

  // THE ONE THAT MATTERS. The store swaps the map on every write, so a new map
  // object IS the invalidation signal — an index keyed on anything else (a
  // count, a length) would serve a deleted or re-pointed occurrence.
  it("rebuilds for a DIFFERENT map object at the same size", () => {
    const before = occs({ id: "o1", moduleId: "m1" });
    const after = occs({ id: "o9", moduleId: "m1" });
    expect(cachedOccByModuleId(before).get("m1").id).toBe("o1");
    expect(cachedOccByModuleId(after).get("m1").id).toBe("o9");
  });

  it("survives a null map and occurrences carrying no moduleId", () => {
    expect(cachedOccByModuleId(null).get("m1")).toBeUndefined();
    const map = occs({ id: "o1" }, { id: "o2", moduleId: "m1" });
    expect(cachedOccByModuleId(map).get("m1").id).toBe("o2");
  });
});
