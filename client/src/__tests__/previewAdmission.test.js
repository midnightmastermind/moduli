import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { requestPreviewSlot, __resetPreviewAdmission } from "../helpers/previewAdmission.js";

// The folder page froze because every card above the fold mounted its preview
// body in ONE synchronous task — the browser could not paint or dispatch a
// click until the whole batch finished. These tests pin the property that fixes
// it: admission is SERIAL, so the thread is handed back between mounts.
//
// A/B: with `requestPreviewSlot` reduced to `cb(); return () => {}` (admit
// everyone immediately — the pre-fix behaviour), the first two tests fail.

describe("previewAdmission — one preview at a time", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetPreviewAdmission();
  });
  afterEach(() => {
    __resetPreviewAdmission();
    vi.useRealTimers();
  });

  // Drive exactly ONE afterPaint cycle (rAF -> macrotask). Under fake timers
  // rAF fires on a ~16ms cadence and the macrotask is a 0ms timer, so 16ms is
  // one cycle; 20 clears it with room to spare while the NEXT rAF is not due
  // until ~32ms. 32 spans TWO cycles and silently admits an extra card, which is
  // what an earlier version of this test did.
  const tick = () => vi.advanceTimersByTime(20);

  it("does NOT admit every waiting card at once — the freeze", () => {
    const admitted = [];
    for (let i = 0; i < 5; i++) requestPreviewSlot(i, () => admitted.push(i));

    // Nothing may mount synchronously: the card chrome has to paint first.
    expect(admitted).toEqual([]);

    tick();
    expect(admitted).toEqual([0]); // exactly one, not five
  });

  it("admits the rest one cycle at a time, in reading order", () => {
    const admitted = [];
    // Register out of order — an IntersectionObserver fires in whatever order
    // it likes, and the grid should still fill top-left first.
    for (const i of [3, 1, 4, 0, 2]) requestPreviewSlot(i, () => admitted.push(i));

    tick(); expect(admitted).toEqual([0]);
    tick(); expect(admitted).toEqual([0, 1]);
    tick(); expect(admitted).toEqual([0, 1, 2]);
    tick(); tick();
    expect(admitted).toEqual([0, 1, 2, 3, 4]);
  });

  it("a cancelled card gives up its turn — a card scrolled out of view must not delay a visible one", () => {
    const admitted = [];
    const cancelFirst = requestPreviewSlot(0, () => admitted.push("scrolled-away"));
    requestPreviewSlot(1, () => admitted.push("visible"));

    cancelFirst();
    tick();

    expect(admitted).toEqual(["visible"]);
  });

  it("a THROWING card does not park the queue forever", () => {
    // The one path that leaves the queue permanently stuck: `cb` throws, the
    // trailing `pump()` never runs, and `running` is already false, so nothing
    // re-pumps. Every card behind the thrower waits forever — which is
    // indistinguishable from the folder page giving up part-way down.
    const admitted = [];
    requestPreviewSlot(0, () => { throw new Error("torn down mid-turn"); });
    requestPreviewSlot(1, () => admitted.push("behind-the-thrower"));

    expect(() => tick()).toThrow(/torn down mid-turn/);
    tick();

    expect(admitted).toEqual(["behind-the-thrower"]);
  });

  it("a card registered later still gets admitted", () => {
    const admitted = [];
    requestPreviewSlot(0, () => admitted.push("first"));
    tick();
    expect(admitted).toEqual(["first"]);

    // Scrolling down registers a new card long after the queue drained.
    requestPreviewSlot(9, () => admitted.push("late"));
    tick();
    expect(admitted).toEqual(["first", "late"]);
  });
});
