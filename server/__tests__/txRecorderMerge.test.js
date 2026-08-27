// server/__tests__/txRecorderMerge.test.js
//
// ONE USER ACTION MUST BE ONE UNDO STEP, however many times its buffer flushes.
//
// `closeAction` debounces 250ms and then `flushAction` DELETES the buffer, so
// the next write carrying the same `actionId` opened a fresh one and became a
// SECOND transaction. A tracker cascade runs ~30 seconds with pauses far longer
// than 250ms, so one gesture flushed over and over.
//
// MEASURED ON THE LIVE GRID, one checkbox tick:
//
//   distinct action ids                1     <- the client groups perfectly
//   transactions created              31
//     of them UNDOABLE                29     (28 holding a SINGLE doc)
//
// And that is what "undo is broken" actually was. Reproduced through the UI:
// tick a row, press Ctrl+Z, and the switch does not move —
//
//   undo_result  docs=1  occurrence 1ve8fwc6c7k   <- the Workouts tracker tile
//                contains the toggled row? NO
//
// Ctrl+Z popped the last FRAGMENT of the cascade instead of the thing the user
// did. Redo then answered "Nothing to redo", because a later fragment had
// already superseded that branch.
//
// The fix is on the flush, not on the timer: a flush for an action that has
// already produced a transaction MERGES into it. Raising CLOSE_FLUSH_MS is the
// tempting version and is wrong — a picked constant racing a cascade whose
// length is data-dependent.
import { describe, it, expect, vi, beforeEach } from "vitest";

const store = [];
const updateManyCalls = [];
vi.mock("../models/Transaction.js", () => {
  class FakeTransaction {
    constructor(doc) { Object.assign(this, doc); }
    async save() { if (!store.includes(this)) store.push(this); return this; }
    toJSON() { return { ...this }; }
    static findOne(filter = {}) {
      // The merge lookup is keyed by actionId and awaited directly; every other
      // caller (sequence seed, prune) uses the chainable form.
      if (filter.actionId !== undefined) {
        return Promise.resolve(
          store.find(t => t.actionId === filter.actionId
            && (filter.state === undefined || t.state === filter.state)) || null,
        );
      }
      const chain = { sort: () => chain, skip: () => chain, select: () => chain, lean: async () => null };
      return chain;
    }
    static async updateMany(filter, patch) { updateManyCalls.push({ filter, patch }); return { modifiedCount: 0 }; }
    static async deleteMany() { return { deletedCount: 0 }; }
    static async deleteOne(filter) {
      const i = store.findIndex(t => t.id === filter.id);
      if (i >= 0) store.splice(i, 1);
      return { deletedCount: 1 };
    }
  }
  return { default: FakeTransaction };
});

const { recordDoc, flushAction, _resetTxRecorder } = await import("../utils/txRecorder.js");

const base = { userId: "u1", gridId: "g1" };
const write = (actionId, id, before, after) =>
  recordDoc({ ...base, actionId, model: "occurrence", id, before, after, label: "Changed a value" });
const v = (n) => ({ id: "x", fields: { f: { value: n } } });

beforeEach(() => { store.length = 0; updateManyCalls.length = 0; _resetTxRecorder(); });

describe("a late write joins the transaction its action already created", () => {
  it("two flushes of ONE action produce ONE transaction", async () => {
    write("act-1", "row", v(0), v(1));
    await flushAction("act-1");
    write("act-1", "tracker", v(0), v(5));       // the cascade, a flush later
    await flushAction("act-1");
    expect(store.length).toBe(1);
    expect(store[0].docs.map(d => d.id).sort()).toEqual(["row", "tracker"]);
  });

  it("the FIRST before and the LATEST after win, exactly as they do in-buffer", async () => {
    write("act-1", "row", v(0), v(1));
    await flushAction("act-1");
    write("act-1", "row", v(1), v(2));
    await flushAction("act-1");
    const doc = store[0].docs.find(d => d.id === "row");
    expect(doc.before.fields.f.value).toBe(0);   // undo restores where we STARTED
    expect(doc.after.fields.f.value).toBe(2);
  });

  it("A DIFFERENT ACTION STILL MAKES ITS OWN TRANSACTION — the control", async () => {
    // Without this the merge would swallow the next thing the user did.
    write("act-1", "row", v(0), v(1));
    await flushAction("act-1");
    write("act-2", "row", v(1), v(2));
    await flushAction("act-2");
    expect(store.length).toBe(2);
  });

  it("never merges into a transaction that has been UNDONE", async () => {
    // Merging into it would silently change what redo replays, and would
    // resurrect a step the user has already reversed.
    write("act-1", "row", v(0), v(1));
    await flushAction("act-1");
    store[0].state = "undone";
    write("act-1", "tracker", v(0), v(5));
    await flushAction("act-1");
    expect(store.length).toBe(2);
    expect(store[0].docs.map(d => d.id)).toEqual(["row"]);
  });

  it("a merge does not re-supersede the redo branch", async () => {
    // The first flush already killed it. Re-running would also kill anything
    // the user undid in between — see the `!buf.derived` note on the original.
    write("act-1", "row", v(0), v(1));
    await flushAction("act-1");
    const after1 = updateManyCalls.length;
    write("act-1", "tracker", v(0), v(5));
    await flushAction("act-1");
    expect(updateManyCalls.length).toBe(after1);
  });

  it("a merge keeps the original sequence — the stack order is the gesture's", async () => {
    write("act-1", "row", v(0), v(1));
    await flushAction("act-1");
    const seq = store[0].sequence;
    write("act-1", "tracker", v(0), v(5));
    await flushAction("act-1");
    expect(store[0].sequence).toBe(seq);
  });

  it("a merge that nets to NOTHING removes the step rather than leaving a no-op", async () => {
    write("act-1", "row", v(0), v(1));
    await flushAction("act-1");
    write("act-1", "row", v(1), v(0));           // put it back
    await flushAction("act-1");
    expect(store.length).toBe(0);
  });

  it("DERIVED writes never merge with each other — each is its own record", async () => {
    // They carry no actionId, so they must not collapse into one another.
    recordDoc({ ...base, actionId: null, model: "occurrence", id: "a", before: v(0), after: v(1) });
    const k1 = recordDoc({ ...base, actionId: null, model: "occurrence", id: "b", before: v(0), after: v(1) });
    recordDoc({ ...base, actionId: null, model: "occurrence", id: "c", before: v(0), after: v(1) });
    await flushAction(k1);
    expect(store.length).toBe(1);
    expect(store[0].meta.derived).toBe(true);
  });
});
