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
