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
import { patchAllItemsCache, effectsAreStructural, runMatchingOperations } from "../helpers/operationExecutor";

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
      { _effect: "UPDATE_ITEM_PARENT", itemId: "occ-1", toParentId: "x" },
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

// 2026-11-10: meta / textmap / fieldVisibility writes are patched too. On poms
// grid a date step rebuilt the 22k-row read model three times, twice because
// Build Schedule writes meta and Day Page: Build writes meta + textmap.
describe("which effects keep the read model", () => {
  it("meta, textmap, fieldVisibility and field writes are value-only", () => {
    for (const e of ["UPDATE_ITEM_FIELD", "UPDATE_ITEM_META", "UPDATE_ITEM_TEXTMAP", "UPDATE_ITEM_FIELD_VISIBILITY"]) {
      expect(effectsAreStructural([{ _effect: e, itemId: "a" }]), e).toBe(false);
    }
  });

  it("anything that can move structure or a filter still discards it", () => {
    for (const e of ["CREATE_ITEM", "DELETE_ITEM", "UPDATE_ITEM_PARENT", "LINK_OCCURRENCE_TO_PARENT", "UPDATE_ITEM_FILTER_OVERRIDE"]) {
      expect(effectsAreStructural([{ _effect: e, itemId: "a" }]), e).toBe(true);
    }
    // one structural effect among value-only ones is enough
    expect(effectsAreStructural([{ _effect: "UPDATE_ITEM_META" }, { _effect: "CREATE_ITEM" }])).toBe(true);
  });

  it("a meta write refreshes the cached entry", () => {
    const c = ctx();
    patchAllItemsCache(c, { "occ-1": { id: "occ-1", moduleId: "m-1", fields: { f1: { value: 1 } }, meta: { flag: "on" } } }, [
      { _effect: "UPDATE_ITEM_META", itemId: "occ-1", metaPath: ["flag"], value: "on" },
    ]);
    expect(c._allItemsCache).not.toBeNull();
    expect(c._allItemsCache[0]).toBe(c._item);
  });
});

// THE BEHAVIOUR THAT MATTERS: an op later in the same sweep reads what an
// earlier op wrote to meta, through the kept (patched) read model.
describe("a later op in the sweep sees an earlier op's meta write", () => {
  const step = (config) => ({ type: "action", config });
  const ops = [
    { id: "w", name: "writer", enabled: true, triggers: [{ type: "onLoad", priority: 1 }],
      pipeline: { steps: [
        step({ type: "INIT_VAR", name: "$x", expr: "$allItemsById.occ-1" }),
        step({ type: "UPDATE", path: "$x.meta.flag", value: "literal:on" }),
      ] } },
    { id: "r", name: "reader", enabled: true, triggers: [{ type: "onLoad", priority: 2 }],
      pipeline: { steps: [
        step({ type: "INIT_VAR", name: "$x", expr: "$allItemsById.occ-1" }),
        step({ type: "UPDATE", path: "$x.fields.f1.value", value: "$x.meta.flag" }),
      ] } },
  ];
  it("reads 'on'", () => {
    const occurrencesById = {
      "occ-1": { id: "occ-1", moduleId: "m-1", fields: { f1: { value: "off" } }, meta: { flag: "off" }, occurrences: [] },
    };
    const modulesById = { "m-1": { id: "m-1", role: "instance", label: "X", fieldBindings: [{ fieldId: "f1" }] } };
    const fieldsById = { f1: { id: "f1", name: "F", type: "text" } };
    const ctx = { state: { grid: {}, modules: Object.values(modulesById) }, occurrencesById, modulesById, fieldsById,
      operationsById: Object.fromEntries(ops.map(o => [o.id, o])) };
    const out = runMatchingOperations(ops, null, null, ctx);
    const meta = out.find(e => e._effect === "UPDATE_ITEM_META");
    expect(meta, "the writer emitted no meta write — fixture shape wrong").toBeTruthy();
    const fieldWrite = out.find(e => e._effect === "UPDATE_ITEM_FIELD" && e.itemId === "occ-1");
    expect(fieldWrite?.value).toBe("on");
  });
});
