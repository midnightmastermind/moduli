/**
 * COALESCING THE EFFECT FAN-OUT — 19 sweeps for 2 occurrences, 829ms, 0 effects.
 *
 * User, 2026-09-02: "why are those ops firing once a second" / "and why during
 * drag". The answer, from `opBy=[...:12x523ms/0fx ...:7x306ms/0fx]`: a create
 * emits 14 effects, applying them writes 14 fields, each write mints its own
 * MeasureOp, and each MeasureOp ran a full sweep over ~68 operations that found
 * nothing to do.
 *
 * The risk in merging them is not that it fails to merge — it is that it merges
 * TOO MUCH. `fireOperationsOptimistic` captures the fire depth, the ambient
 * action and the applying-ops set and restores all three around the deferred
 * continuation, each added after a defect caused by NOT carrying it. Merging
 * across contexts would run one write under another's scope: the same class of
 * defect, arriving through the optimisation. So the tests that carry the weight
 * are the ones asserting two writes stay SEPARATE.
 */
import { describe, it, expect } from "vitest";
import { measureCoalesceKey, mergeMeasureTransaction } from "../helpers/measureCoalesce.js";

const ctx = { depth: 1, actionId: "act-1", applyingKey: "opA,opB" };
const tx = (occurrenceId, fields) => ({ type: "MeasureOp", occurrenceId, instanceId: "m1", fields });

describe("which deferred MeasureOps may merge", () => {
  it("merges two writes to one occurrence in one context", () => {
    expect(measureCoalesceKey(tx("occ1", { f1: 1 }), ctx))
      .toBe(measureCoalesceKey(tx("occ1", { f2: 2 }), ctx));
  });

  it("keeps DIFFERENT occurrences apart", () => {
    expect(measureCoalesceKey(tx("occ1", {}), ctx))
      .not.toBe(measureCoalesceKey(tx("occ2", {}), ctx));
  });

  it("keeps different FIRE DEPTHS apart", () => {
    // Depth drives the `_FIRE_DEPTH_LIMIT` cap. Merging across it would let a
    // runaway loop spin in separate tasks instead of tripping the guard —
    // exactly when the guard is needed.
    expect(measureCoalesceKey(tx("occ1", {}), ctx))
      .not.toBe(measureCoalesceKey(tx("occ1", {}), { ...ctx, depth: 2 }));
  });

  it("keeps different ACTIONS apart", () => {
    // Merging across actions puts one gesture's write inside another's undo
    // step — the defect that made Ctrl+Z revert a tracker recomputation.
    expect(measureCoalesceKey(tx("occ1", {}), ctx))
      .not.toBe(measureCoalesceKey(tx("occ1", {}), { ...ctx, actionId: "act-2" }));
  });

  it("keeps different APPLYING-OPS sets apart", () => {
    // The cycle guard's marks are captured per fire. Merging across two
    // different sets would release the wrong ops.
    expect(measureCoalesceKey(tx("occ1", {}), ctx))
      .not.toBe(measureCoalesceKey(tx("occ1", {}), { ...ctx, applyingKey: "opC" }));
  });

  it("refuses to coalesce a transaction with no occurrence to key on", () => {
    // Fails OPEN to today's behaviour: it defers on its own rather than
    // merging into some unrelated pending fire.
    expect(measureCoalesceKey({ type: "MeasureOp", fields: {} }, ctx)).toBe(null);
    expect(measureCoalesceKey(null, ctx)).toBe(null);
  });

  it("treats a missing context as its own bucket rather than throwing", () => {
    expect(typeof measureCoalesceKey(tx("occ1", {}), undefined)).toBe("string");
  });
});

describe("merging the transaction", () => {
  it("keeps every field, so no write is lost", () => {
    const pending = tx("occ1", { f1: { value: 1 } });
    mergeMeasureTransaction(pending, tx("occ1", { f2: { value: 2 } }));
    expect(Object.keys(pending.fields).sort()).toEqual(["f1", "f2"]);
  });

  it("lets the LATER write win on the same field", () => {
    const pending = tx("occ1", { f1: { value: 1 } });
    mergeMeasureTransaction(pending, tx("occ1", { f1: { value: 9 } }));
    expect(pending.fields.f1).toEqual({ value: 9 });
  });

  it("MUTATES the pending object, because a continuation already holds it", () => {
    // Returning a new object would fire the pre-merge copy and silently drop
    // every field after the first — the failure would look like the trackers
    // going stale, not like a coalescing bug.
    const pending = tx("occ1", { f1: 1 });
    const same = mergeMeasureTransaction(pending, tx("occ1", { f2: 2 }));
    expect(same).toBe(pending);
  });

  it("does not touch the incoming transaction", () => {
    const incoming = tx("occ1", { f2: 2 });
    mergeMeasureTransaction(tx("occ1", { f1: 1 }), incoming);
    expect(incoming.fields).toEqual({ f2: 2 });
  });

  it("keeps the pending transaction's identity fields", () => {
    const pending = tx("occ1", { f1: 1 });
    mergeMeasureTransaction(pending, tx("occ1", { f2: 2 }));
    expect(pending.occurrenceId).toBe("occ1");
    expect(pending.type).toBe("MeasureOp");
  });

  it("survives an incoming transaction carrying no fields", () => {
    const pending = tx("occ1", { f1: 1 });
    mergeMeasureTransaction(pending, { type: "MeasureOp", occurrenceId: "occ1" });
    expect(pending.fields).toEqual({ f1: 1 });
  });
});
