// Time-slicing the load sweep so it stops blocking scroll.
//
// The tablet reported the main thread blocked 8,680ms of a 12,117ms scroll; the
// cause is two single tasks after load — the op sweep (2,076ms) and its effect
// loop (1,766ms). A frame cannot start while a task runs, so the fix is to make
// the work INTERRUPTIBLE rather than smaller.
import { describe, it, expect, vi } from "vitest";
import { runSliced } from "../helpers/sliceWork";

/** A clock the test drives, so nothing depends on real timing. */
function fakeClock(perItemMs) {
  let t = 0;
  return { now: () => t, tick: (n = perItemMs) => { t += n; } };
}

describe("runSliced", () => {
  it("does every item, once, in order", async () => {
    const seen = [];
    await runSliced([1, 2, 3, 4, 5], (v, i) => seen.push([v, i]), { yieldFn: async () => {} });
    expect(seen).toEqual([[1,0],[2,1],[3,2],[4,3],[5,4]]);
  });

  it("yields between slices, not between items", async () => {
    const c = fakeClock(3);
    const yieldFn = vi.fn(async () => {});
    // 3ms per item, 8ms budget → 3 items per slice (checked AFTER each item)
    const r = await runSliced([1,2,3,4,5,6,7,8,9], () => c.tick(), { budgetMs: 8, now: c.now, yieldFn });
    expect(r.items).toBe(9);
    expect(r.slices).toBeGreaterThan(1);
    expect(r.slices).toBeLessThan(9);
    expect(yieldFn).toHaveBeenCalledTimes(r.slices - 1);   // no trailing yield
  });

  // THE ONE THAT PREVENTS A HANG. An item slower than the entire budget must
  // still run — and some genuinely are: one op in the real sweep measures 450ms
  // against an 8ms budget. Checking the budget BEFORE the item would skip it
  // forever and spin.
  it("always does at least one item per slice, even when it blows the budget", async () => {
    const c = fakeClock(0);
    const seen = [];
    const r = await runSliced([1,2,3], (v) => { seen.push(v); c.tick(1000); },
      { budgetMs: 8, now: c.now, yieldFn: async () => {} });
    expect(seen).toEqual([1,2,3]);
    expect(r.slices).toBe(3);   // one item each — and it terminated
  });

  it("never yields for an empty or single-item list", async () => {
    const yieldFn = vi.fn(async () => {});
    expect(await runSliced([], () => {}, { yieldFn })).toEqual({ slices: 0, items: 0 });
    await runSliced([1], () => {}, { yieldFn });
    expect(yieldFn).not.toHaveBeenCalled();
  });

  it("tolerates a non-array", async () => {
    await expect(runSliced(null, () => {}, { yieldFn: async () => {} })).resolves.toEqual({ slices: 0, items: 0 });
  });

  // A throwing item must not strand the rest — the caller guards per item, and
  // this pins that the loop itself does not swallow or stop.
  it("propagates a throw rather than hiding it", async () => {
    await expect(runSliced([1,2,3], (v) => { if (v === 2) throw new Error("boom"); },
      { yieldFn: async () => {} })).rejects.toThrow("boom");
  });
});
