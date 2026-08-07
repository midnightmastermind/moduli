// client/src/__tests__/allItemsCachePatch.test.js
//
// The executor caches the enriched $allItems read model on the sweep context
// and used to DISCARD it whenever an op touched the occurrence overlay. A field
// write qualifies — so a date navigation, which fires ~45 trackers that each
// write UPDATE_ITEM_FIELD, rebuilt the whole collection once per tracker.
// Measured on test grid 2 (7295 occurrences): **44 full rebuilds for one date
// change**, each re-walking every occurrence's ancestor chain and filter.
//
// A field write cannot change the SET of occurrences, anyone's parentage, or a
// role/kind/label — so the read model stays structurally valid and only the one
// entry is stale. It is now refreshed in place; everything else still discards.
//
// The risk this guards is a STALE READ, not a crash: if the refresh were wrong,
// a later op in the same sweep would aggregate yesterday's value and the number
// on screen would simply be wrong. So these tests assert what the next op SEES,
// not just that the cache survived.
import { describe, it, expect } from "vitest";
import { patchAllItemsCache } from "../helpers/operationExecutor";

function ctx() {
  const item = {
    id: "occ-1", moduleId: "m-1", label: "Water",
    fields: { f1: { value: 1 } },
    role: "instance", _ancestors: ["page-1"], _effectiveFilter: { d: "2026-08-07" },
  };
  const cache = [item];
  return {
    _allItemsCache: cache,
    _allItemsIndex: new Map([["occ-1", item]]),
    // Stand-in for the real enrichment closure: same contract — take the live
    // occurrence, return the enriched item.
    _allItemsEnrich: (occ) => ({
      id: occ.id, moduleId: occ.moduleId, label: "Water",
      fields: occ.fields, role: "instance",
      _ancestors: ["page-1"], _effectiveFilter: { d: "2026-08-07" },
    }),
    _item: item,
    _cache: cache,
  };
}

const liveOccsWith = (fields) => ({ "occ-1": { id: "occ-1", moduleId: "m-1", fields } });

describe("patchAllItemsCache — a field write refreshes one entry", () => {
  it("updates the cached entry to the new value", () => {
    const c = ctx();
    patchAllItemsCache(c, liveOccsWith({ f1: { value: 42 } }), [
      { _effect: "UPDATE_ITEM_FIELD", itemId: "occ-1", fieldId: "f1", value: 42 },
    ]);
    expect(c._allItemsCache).not.toBeNull();
    expect(c._allItemsCache[0].fields.f1.value).toBe(42);
  });

  it("preserves OBJECT IDENTITY so role slices holding it see the new value", () => {
    const c = ctx();
    // A role slice built by an earlier pipeline holds the same object.
    const allInstances = [c._item];
    patchAllItemsCache(c, liveOccsWith({ f1: { value: 7 } }), [
      { _effect: "UPDATE_ITEM_FIELD", itemId: "occ-1", fieldId: "f1", value: 7 },
    ]);
    // THE ASSERTION: the slice is not stale. Replacing the array entry instead
    // of mutating in place would leave this at 1.
    expect(allInstances[0].fields.f1.value).toBe(7);
    expect(allInstances[0]).toBe(c._allItemsCache[0]);
  });

  it("drops keys the refresh no longer produces (no stale leftovers)", () => {
    const c = ctx();
    c._item.staleKey = "should not survive";
    patchAllItemsCache(c, liveOccsWith({ f1: { value: 2 } }), [
      { _effect: "UPDATE_ITEM_FIELD", itemId: "occ-1", fieldId: "f1", value: 2 },
    ]);
    expect(c._allItemsCache[0].staleKey).toBeUndefined();
  });

  it("ignores effects that are not value-only", () => {
    const c = ctx();
    patchAllItemsCache(c, liveOccsWith({ f1: { value: 1 } }), [
      { _effect: "UPDATE_ITEM_TEXTMAP", itemId: "occ-1", textmap: {} },
    ]);
    expect(c._allItemsCache[0].fields.f1.value).toBe(1);
  });
});

describe("patchAllItemsCache — falls back to discarding when it cannot prove the patch", () => {
  it("discards when there is no index", () => {
    const c = { _allItemsCache: [{ id: "occ-1" }] };
    patchAllItemsCache(c, liveOccsWith({}), [
      { _effect: "UPDATE_ITEM_FIELD", itemId: "occ-1" },
    ]);
    expect(c._allItemsCache).toBeNull();
  });

  it("discards when the written id is not in the cache", () => {
    const c = ctx();
    patchAllItemsCache(c, { "occ-9": { id: "occ-9", fields: {} } }, [
      { _effect: "UPDATE_ITEM_FIELD", itemId: "occ-9" },
    ]);
    expect(c._allItemsCache).toBeNull();
  });

  it("discards when the occurrence is gone from the overlay", () => {
    const c = ctx();
    patchAllItemsCache(c, {}, [
      { _effect: "UPDATE_ITEM_FIELD", itemId: "occ-1" },
    ]);
    expect(c._allItemsCache).toBeNull();
  });
});
