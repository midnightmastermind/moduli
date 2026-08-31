// THE CYCLE GUARD HAD TO SURVIVE A DEFERRAL, AND DID NOT.
//
// `setOpApplyingEffects` marks an op while its own effects are being applied,
// so a write those effects make cannot re-trigger the op that made it. That
// works for SYNCHRONOUS nested fires — the marks are still in place. A
// MeasureOp fire is deferred past the paint, and the deferral already carries
// `_fireDepth` and the ambient action across the gap for the same class of
// reason. The guard was the third thing that had to travel and the one that
// did not, so the marks were released a task before the fire they were meant
// to stop.
//
// Measured on prod against an IDLE page (2026-08-31): 27 MeasureOp sweeps and
// 3,826 field renders after one load, `occ=1ve8fwc6` — the Workouts tracker
// tile — re-firing ten times over.
import { describe, it, expect } from "vitest";
import {
  setOpApplyingEffects, isOpApplyingEffects, snapshotOpsApplying, markOpsApplying,
} from "../helpers/operationExecutor";

describe("carrying the applying-ops guard across a deferral", () => {
  it("restores the marks a deferred fire would otherwise have lost", () => {
    setOpApplyingEffects("opA", true);
    const carried = snapshotOpsApplying();
    setOpApplyingEffects("opA", false);          // the synchronous phase ends
    expect(isOpApplyingEffects("opA")).toBe(false);

    const release = markOpsApplying(carried);     // …the deferred fire runs
    expect(isOpApplyingEffects("opA")).toBe(true);
    release();
    expect(isOpApplyingEffects("opA")).toBe(false);
  });

  it("releases ONLY what it added, so a nested fire cannot unmark its caller", () => {
    // The one that would corrupt the synchronous path: a deferred fire nested
    // inside a live application must not clear that application's marks when
    // it finishes.
    setOpApplyingEffects("outer", true);
    const release = markOpsApplying(["outer", "inner"]);
    release();
    expect(isOpApplyingEffects("outer"), "the deferred fire cleared its caller's mark").toBe(true);
    expect(isOpApplyingEffects("inner")).toBe(false);
    setOpApplyingEffects("outer", false);
  });

  it("snapshots null when nothing is applying, and marking null is a no-op", () => {
    // The control: most fires are not inside an effect application at all, and
    // must not pay for this or accidentally mark anything.
    expect(snapshotOpsApplying()).toBe(null);
    const release = markOpsApplying(null);
    expect(typeof release).toBe("function");
    expect(() => release()).not.toThrow();
  });

  it("takes a copy, so later changes do not reach through the snapshot", () => {
    setOpApplyingEffects("opX", true);
    const carried = snapshotOpsApplying();
    setOpApplyingEffects("opY", true);
    expect(carried).toEqual(["opX"]);
    setOpApplyingEffects("opX", false);
    setOpApplyingEffects("opY", false);
  });
});
