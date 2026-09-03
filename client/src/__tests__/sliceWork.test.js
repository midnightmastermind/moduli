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

  // THE MISTAKE THAT COST A DEPLOY. With a budget BELOW one item's cost the
  // loop yields after every item — 194 slices for 195 effects, measured on prod,
  // ~3s of pure scheduling. A useful budget batches several items per slice.
  it("batches several items per slice when the budget is above the item cost", async () => {
    const c = fakeClock(9);
    const yieldFn = vi.fn(async () => {});
    const items = Array.from({ length: 60 }, (_, i) => i);
    const r = await runSliced(items, () => c.tick(9), { budgetMs: 32, now: c.now, yieldFn });
    expect(r.slices).toBeLessThan(items.length / 3);   // NOT one slice per item
    expect(yieldFn.mock.calls.length).toBe(r.slices - 1);
  });

  it("degenerates to one item per slice when the budget is below the item cost", async () => {
    const c = fakeClock(9);
    const items = Array.from({ length: 20 }, (_, i) => i);
    const r = await runSliced(items, () => c.tick(9), { budgetMs: 8, now: c.now, yieldFn: async () => {} });
    expect(r.slices).toBe(20);   // the pathological case, pinned so it is recognisable
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

// ── THE BUDGET IS A DESKTOP NUMBER AND THE DEVICE IS NOT A DESKTOP ──────────
//
// 32ms was chosen against an item measured at ~9ms. On the tablet the same item
// costs ~94ms (`effects=22166ms` for 236 effects on the load line), so every
// item blows the budget and the loop yields after each one — the exact
// degeneracy this file's header records reverting once already, reached from
// the other side: the budget did not change, the item cost did. Each yield is a
// macrotask, and a macrotask ends React's auto-batching window, so one slice per
// effect also means one synchronous render pass per effect.
describe("runSliced adaptive budget", () => {
  /** Every item costs 100ms against a 32ms budget — the device's shape. */
  const expensive = (n) => {
    let t = 0;
    const now = () => t;
    return { items: Array.from({ length: n }, (_, i) => i), now, work: () => { t += 100; } };
  };

  it("degenerates to one slice per item WITHOUT it — the control", async () => {
    // Without this the test below proves nothing: "few slices" has to be
    // measured against the many-slices behaviour it replaces.
    const { items, now, work } = expensive(10);
    const r = await runSliced(items, work, { budgetMs: 32, now, yieldFn: async () => {} });
    expect(r.slices).toBe(10);
  });

  it("raises the budget above the measured item cost and batches", async () => {
    const { items, now, work } = expensive(10);
    const r = await runSliced(items, work, {
      budgetMs: 32, maxBudgetMs: 400, adaptiveBudget: true, now, yieldFn: async () => {},
    });
    // 100ms items, budget climbs to 150 — a slice then fits two.
    expect(r.slices).toBeLessThan(10);
    expect(r.items).toBe(10);
  });

  it("never raises past the cap — a slice must not become a long task", async () => {
    const { items, now, work } = expensive(20);
    const r = await runSliced(items, work, {
      budgetMs: 32, maxBudgetMs: 120, adaptiveBudget: true, now, yieldFn: async () => {},
    });
    // Capped at 120 against 100ms items, so a slice fits exactly two — never
    // the whole list, which is what "do not slice at all" would look like.
    expect(r.slices).toBeGreaterThan(1);
    expect(r.slices).toBeLessThan(20);
  });

  it("leaves a budget that already straddles the item cost alone", async () => {
    // Cheap items: the budget is doing its job and must not drift upward.
    let t = 0;
    const r = await runSliced(Array.from({ length: 12 }, (_, i) => i), () => { t += 1; }, {
      budgetMs: 32, adaptiveBudget: true, now: () => t, yieldFn: async () => {},
    });
    expect(r.slices).toBe(1);
  });

  it("is OFF by default — behaviour is unchanged for every existing caller", async () => {
    const { items, now, work } = expensive(6);
    const r = await runSliced(items, work, { budgetMs: 32, now, yieldFn: async () => {} });
    expect(r.slices).toBe(6);
  });
});
