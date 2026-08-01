// server/__tests__/txRecorder.test.js
//
// Covers the undo/redo capture layer (utils/txRecorder.js). The behaviours that
// matter and are easy to get wrong:
//   * a snapshot must be a COPY (the warm cache is mutated in place, so a live
//     ref would let `before` drift into `after` before the flush);
//   * textmap must be normalized to the COMPRESSED form the DB stores, or undo
//     writes one row shaped unlike every other;
//   * a cascade writes the same document many times — the FIRST `before` and
//     the LATEST `after` have to win, else undo restores a mid-cascade value;
//   * a write that changed nothing is not an undo step.
import { describe, it, expect, vi, beforeEach } from "vitest";

const saved = [];
vi.mock("../models/Transaction.js", () => {
  class FakeTransaction {
    constructor(doc) { Object.assign(this, doc); }
    async save() { saved.push(this); return this; }
    toJSON() { return { ...this }; }
    static findOne() {
      // Chainable stub for the sequence seed + prune lookups.
      const chain = {
        sort: () => chain, skip: () => chain, select: () => chain,
        lean: async () => null,
      };
      return chain;
    }
    static async deleteMany() { return { deletedCount: 0 }; }
  }
  return { default: FakeTransaction };
});

const { recordDoc, flushAction, snapshotDoc, _resetTxRecorder } =
  await import("../utils/txRecorder.js");
const { decompressTextmap, isCompressed } =
  await import("../utils/textmapCompression.js");

const base = { userId: "u1", gridId: "g1" };

beforeEach(() => { saved.length = 0; _resetTxRecorder(); });

describe("snapshotDoc", () => {
  it("strips _id/__v so a restore's $set is not rejected by Mongo", () => {
    const snap = snapshotDoc({ id: "a", _id: "mongo-oid", __v: 3, label: "x" });
    expect(snap).not.toHaveProperty("_id");
    expect(snap).not.toHaveProperty("__v");
    expect(snap.label).toBe("x");
  });

  it("compresses a raw textmap and round-trips it losslessly", () => {
    const textmap = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] };
    const snap = snapshotDoc({ id: "a", textmap });
    expect(isCompressed(snap.textmap)).toBe(true);
    expect(decompressTextmap(snap.textmap)).toEqual(textmap);
  });

  it("leaves an already-compressed textmap alone (no double-compression)", () => {
    const once = snapshotDoc({ id: "a", textmap: { type: "doc", content: [] } });
    const twice = snapshotDoc({ id: "a", textmap: once.textmap });
    expect(twice.textmap).toBe(once.textmap);
  });

  it("deep-copies, so later mutation of the source cannot corrupt the snapshot", () => {
    const live = { id: "a", fields: { f1: { value: 1, flow: "in" } } };
    const snap = snapshotDoc(live);
    live.fields.f1.value = 999;          // the warm cache mutates in place
    expect(snap.fields.f1.value).toBe(1);
  });

  it("returns null for a missing document (the create/delete sentinel)", () => {
    expect(snapshotDoc(null)).toBeNull();
  });
});

describe("grouping a user action with its cascade", () => {
  it("collapses repeated writes: first before, latest after", async () => {
    const actionId = "act-1";
    // A drop writes the occurrence, then the tracker cascade rewrites it twice.
    recordDoc({ ...base, actionId, model: "occurrence", id: "o1",
      before: { id: "o1", n: 1 }, after: { id: "o1", n: 2 } });
    recordDoc({ ...base, actionId, model: "occurrence", id: "o1",
      before: { id: "o1", n: 2 }, after: { id: "o1", n: 3 } });
    recordDoc({ ...base, actionId, model: "occurrence", id: "o1",
      before: { id: "o1", n: 3 }, after: { id: "o1", n: 4 } });

    await flushAction(actionId);

    expect(saved).toHaveLength(1);
    expect(saved[0].docs).toHaveLength(1);
    // Undo must return to the value from BEFORE the whole action, not mid-cascade.
    expect(saved[0].docs[0].before.n).toBe(1);
    expect(saved[0].docs[0].after.n).toBe(4);
  });

  it("puts every document touched by one action in ONE transaction", async () => {
    const actionId = "act-2";
    recordDoc({ ...base, actionId, model: "occurrence", id: "task", before: { id: "task", p: "a" }, after: { id: "task", p: "b" } });
    recordDoc({ ...base, actionId, model: "occurrence", id: "tracker1", before: { id: "tracker1", v: 3 }, after: { id: "tracker1", v: 4 } });
    recordDoc({ ...base, actionId, model: "occurrence", id: "tracker2", before: { id: "tracker2", v: 12 }, after: { id: "tracker2", v: 18 } });

    await flushAction(actionId);

    expect(saved).toHaveLength(1);
    expect(saved[0].docs.map(d => d.id).sort()).toEqual(["task", "tracker1", "tracker2"]);
    expect(saved[0].actionId).toBe(actionId);
  });

  it("drops writes that changed nothing — not an undo step", async () => {
    const actionId = "act-3";
    const same = { id: "o1", n: 1 };
    recordDoc({ ...base, actionId, model: "occurrence", id: "o1", before: same, after: { ...same } });
    await flushAction(actionId);
    expect(saved).toHaveLength(0);
  });

  it("marks an action-less write derived so the undo stack skips it", async () => {
    // No actionId = scheduler / feed sync / op sweep.
    const key = recordDoc({ ...base, actionId: null, model: "occurrence", id: "o1",
      before: { id: "o1", n: 1 }, after: { id: "o1", n: 2 } });
    await flushAction(key);
    expect(saved).toHaveLength(1);
    expect(saved[0].meta).toEqual({ derived: true });
    expect(saved[0].actionId).toBeNull();
  });

  it("records a create as before:null and a delete as after:null", async () => {
    recordDoc({ ...base, actionId: "c", model: "occurrence", id: "new", before: null, after: { id: "new" } });
    await flushAction("c");
    expect(saved[0].docs[0].before).toBeNull();

    saved.length = 0;
    recordDoc({ ...base, actionId: "d", model: "occurrence", id: "old", before: { id: "old" }, after: null });
    await flushAction("d");
    expect(saved[0].docs[0].after).toBeNull();
  });

  it("assigns increasing sequence numbers — the undo stack needs a total order", async () => {
    recordDoc({ ...base, actionId: "s1", model: "occurrence", id: "a", before: null, after: { id: "a" } });
    await flushAction("s1");
    recordDoc({ ...base, actionId: "s2", model: "occurrence", id: "b", before: null, after: { id: "b" } });
    await flushAction("s2");
    expect(saved[1].sequence).toBeGreaterThan(saved[0].sequence);
  });

  it("flushing an unknown action is a no-op", async () => {
    await expect(flushAction("never-existed")).resolves.toBeNull();
    expect(saved).toHaveLength(0);
  });
});
