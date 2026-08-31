// `applyEffectsToLiveOccs` — the overlay every op in a sweep reads.
//
// The executor applies each op's effects to `liveOccs` before running the next
// op, so this overlay IS what later ops see. Whenever it disagrees with
// `bindSocketToStore`'s handler — the one that actually persists — an op reads
// something that will never be true, and the divergence is invisible to any
// test that only checks the effects leaving the executor.
//
// Both cases below were found that way, while building an op that moved an
// occurrence and stamped its origin. Neither had a test.
import { describe, it, expect } from "vitest";
import { applyEffectsToLiveOccs } from "../helpers/operationExecutor";

const world = () => ({
  from: { id: "from", occurrences: ["kid", "other"] },
  to:   { id: "to",   occurrences: [] },
  kid:  { id: "kid",  parentId: "from", meta: { keep: 1 } },
  other:{ id: "other", parentId: "from" },
});

describe("UPDATE_ITEM_PARENT is a MOVE — three writes, not one", () => {
  it("unlists from the old parent, re-parents, and lists under the new one", () => {
    const w = world();
    applyEffectsToLiveOccs(w, [{ _effect: "UPDATE_ITEM_PARENT", itemId: "kid", toParentId: "to" }]);
    expect(w.kid.parentId).toBe("to");
    expect(w.from.occurrences).toEqual(["other"]);   // <- was left holding "kid"
    expect(w.to.occurrences).toEqual(["kid"]);       // <- was left empty
  });

  it("leaves the old parent's other children alone", () => {
    const w = world();
    applyEffectsToLiveOccs(w, [{ _effect: "UPDATE_ITEM_PARENT", itemId: "kid", toParentId: "to" }]);
    expect(w.from.occurrences).toContain("other");
    expect(w.other.parentId).toBe("from");
  });

  it("is idempotent — re-applying the same move does not double-list", () => {
    const w = world();
    const eff = [{ _effect: "UPDATE_ITEM_PARENT", itemId: "kid", toParentId: "to" }];
    applyEffectsToLiveOccs(w, eff);
    applyEffectsToLiveOccs(w, eff);
    expect(w.to.occurrences).toEqual(["kid"]);
  });

  it("a move to an unknown parent still re-parents and touches nothing else", () => {
    const w = world();
    applyEffectsToLiveOccs(w, [{ _effect: "UPDATE_ITEM_PARENT", itemId: "kid", toParentId: "ghost" }]);
    expect(w.kid.parentId).toBe("ghost");
    expect(w.from.occurrences).toEqual(["other"]);
  });
});

describe("UPDATE_ITEM_META accepts both emit shapes", () => {
  // `applyUpdate` emits metaPath for every `$occ.meta.x` write; only the legacy
  // metaPatch was handled, so meta writes were invisible to the rest of the sweep.
  it("applies a metaPath write and preserves the other meta keys", () => {
    const w = world();
    applyEffectsToLiveOccs(w, [
      { _effect: "UPDATE_ITEM_META", itemId: "kid", metaPath: ["filedFrom"], value: "from" },
    ]);
    expect(w.kid.meta.filedFrom).toBe("from");
    expect(w.kid.meta.keep).toBe(1);
  });

  it("deep-sets a nested metaPath without dropping siblings", () => {
    const w = world();
    w.kid.meta = { table: { columns: ["a"], cells: { "0:0": "x" } } };
    applyEffectsToLiveOccs(w, [
      { _effect: "UPDATE_ITEM_META", itemId: "kid", metaPath: ["table", "cells", "1:1"], value: "y" },
    ]);
    expect(w.kid.meta.table.cells).toEqual({ "0:0": "x", "1:1": "y" });
    expect(w.kid.meta.table.columns).toEqual(["a"]);
  });

  it("still honours the legacy shallow metaPatch", () => {
    const w = world();
    applyEffectsToLiveOccs(w, [
      { _effect: "UPDATE_ITEM_META", itemId: "kid", metaPatch: { added: true } },
    ]);
    expect(w.kid.meta).toEqual({ keep: 1, added: true });
  });
});

// CREATE_ITEM DROPPED `meta`, AND THE SCHEDULE RE-COPIED ITSELF FOREVER.
//
// The overlay builds its row from an explicit field list. `role`/`kind`/`label`
// were added to it when clones turned up invisible to `$allContainers`, and
// `identitySignature` when merge could not find a node it had just cloned —
// both "the thing a clone is identified by". `meta` is the third, and it was
// missed: COPY_LINK stamps `meta.copyLinkSource` for exactly this purpose, and
// the Schedule's slot dedupe is `meta.copyLinkSource IS $tplChildId AND
// parentId IS $dayColId`.
//
// Live, 2026-08-31: one day column with 245 children — 49 distinct sources,
// EXACTLY 5 copies each — and the grid growing +49 occurrences per page load
// without bound.
describe("CREATE_ITEM carries meta — what a COPY_LINK clone is identified by", () => {
  const create = (instance) => {
    const w = {};
    applyEffectsToLiveOccs(w, [{ _effect: "CREATE_ITEM", template: null, instance }]);
    return w[instance.id];
  };

  it("keeps meta.copyLinkSource, so the dedupe FIND can match the copy", () => {
    const occ = create({ id: "copy1", templateId: "m1", parentId: "col",
      meta: { createdByOperation: true, copyLinkSource: "slot-7am" } });
    expect(occ.meta.copyLinkSource).toBe("slot-7am");
  });

  it("matches bindSocketToStore's shape, which is what actually persists", () => {
    // The overlay's whole job is to predict the persisted row. That handler
    // writes `{ createdByOperation: true, ...inst.meta }`; anything else here
    // is an op reading something that will never be true.
    expect(create({ id: "c2", templateId: "m1", meta: { x: 1 } }).meta)
      .toEqual({ createdByOperation: true, x: 1 });
  });

  it("stamps createdByOperation even when the effect carries no meta", () => {
    // The control: an instance with no meta at all must not produce `undefined`
    // and must not throw — most CREATE_ITEMs are not copy-links.
    expect(create({ id: "c3", templateId: "m1" }).meta).toEqual({ createdByOperation: true });
  });

  it("lets the effect's own meta win over the default", () => {
    expect(create({ id: "c4", templateId: "m1", meta: { createdByOperation: false } }).meta.createdByOperation)
      .toBe(false);
  });
});

