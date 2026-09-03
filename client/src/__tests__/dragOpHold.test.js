/**
 * OPERATION FIRES ARE HELD FOR THE WHOLE DRAG, NOT JUST THE DROP.
 *
 * User, 2026-09-02: "is there also any way to speed up the beginning operations
 * or make them not affect the drag at all. drag is pretty bad when those are
 * running." Their own capture, a drag begun 13 seconds after a page load:
 *
 *     opSweeps=19  opMs=3404
 *     opBy=[load:1x2544ms/231fx  MeasureOp:11x532ms  MeasureOp:6x278ms]
 *     longTasks=152(27966ms)      <- 47% of a 59-second drag
 *
 * A 2,544ms sweep is a 2.5-second freeze with a finger on the screen. The drop
 * batch already deferred the fires a DROP causes; nothing covered the ones
 * arriving from elsewhere DURING the gesture.
 *
 * The bridge is built inside `bindSocketToStore`, which needs a socket and a
 * store, so what is tested here is the queue's own contract, extracted the way
 * this codebase tests every other decision that lives inside a big component.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeInteractionHold } from "../helpers/interactionHold.js";

let fired, hold;
beforeEach(() => {
  fired = [];
  hold = makeInteractionHold({ fire: (t, x) => fired.push([t, x?.occurrenceId]) });
});

describe("holding", () => {
  it("passes fires straight through when not holding", () => {
    expect(hold.take("MeasureOp", { occurrenceId: "a" })).toBe(false);
    expect(fired).toEqual([]);   // `take` reports; the caller fires
  });

  it("captures top-level fires while held", () => {
    hold.begin();
    expect(hold.take("MeasureOp", { occurrenceId: "a" })).toBe(true);
    expect(hold.size()).toBe(1);
  });

  it("DEDUPES by what the fire is about, not by count", () => {
    // A settling grid emits the same MeasureOp for one occurrence many times
    // across a long drag; without this the queue grows without bound and the
    // drain's op-level dedup cannot help — it runs after the queue.
    hold.begin();
    for (let i = 0; i < 50; i++) hold.take("MeasureOp", { occurrenceId: "a", fieldId: "f" });
    hold.take("MeasureOp", { occurrenceId: "b", fieldId: "f" });
    expect(hold.size()).toBe(2);
  });

  it("releases the queue on end, and stops holding", () => {
    hold.begin();
    hold.take("MeasureOp", { occurrenceId: "a" });
    const held = hold.end();
    expect(held.map(h => h.transaction.occurrenceId)).toEqual(["a"]);
    expect(hold.take("MeasureOp", { occurrenceId: "b" })).toBe(false);
  });
});

describe("it must never be able to starve the grid", () => {
  it("releases itself after the cap even if the gesture never ends", () => {
    vi.useFakeTimers();
    const onCap = vi.fn();
    const h = makeInteractionHold({ maxMs: 100, onCap });
    h.begin();
    h.take("MeasureOp", { occurrenceId: "a" });
    vi.advanceTimersByTime(150);
    expect(onCap).toHaveBeenCalledTimes(1);
    expect(onCap.mock.calls[0][0].map(x => x.transaction.occurrenceId)).toEqual(["a"]);
    // and it is no longer holding — a long drag keeps working, unheld
    expect(h.take("MeasureOp", { occurrenceId: "b" })).toBe(false);
    vi.useRealTimers();
  });

  it("cancels the cap when the gesture ends normally", () => {
    vi.useFakeTimers();
    const onCap = vi.fn();
    const h = makeInteractionHold({ maxMs: 100, onCap });
    h.begin();
    h.end();
    vi.advanceTimersByTime(500);
    expect(onCap).not.toHaveBeenCalled();   // or every drag drains twice
    vi.useRealTimers();
  });

  it("a second begin does not restart or clear an open hold", () => {
    hold.begin();
    hold.take("MeasureOp", { occurrenceId: "a" });
    hold.begin();
    expect(hold.size()).toBe(1);
  });
});

// ── A DEFERRED FIRE CARRIES A CONTINUATION, AND THAT CHANGES THE RULES ──────
//
// The first version of this hold checked `_fireDepth === 0` inside
// `fireOperations`, and the device said it caught almost nothing:
//
//     opSweeps=30 opMs=1663
//     opBy=[MeasureOp:kg860us2nhc:13x570ms/0fx
//           MeasureOp:1ve8fwc6c7k:11x506ms/0fx  NavigationOp:1x370ms/26fx]
//
// A MeasureOp written by an op's own effects is DEFERRED past the paint, and
// its continuation restores `_fireDepth = savedDepth` — 1, not 0 — so the gate
// never saw the 24 sweeps that were the whole cost. The hold takes the
// continuation instead, which restores its own depth, action scope and
// cycle-guard marks.
describe("deferred fires (continuations)", () => {
  it("queues a continuation and does not run it until the drain", () => {
    hold.begin();
    const run = vi.fn();
    expect(hold.take("MeasureOp", { occurrenceId: "a", fieldId: "f" }, run)).toBe(true);
    expect(run).not.toHaveBeenCalled();
    const held = hold.end();
    expect(held).toHaveLength(1);
    held[0].run();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("NEVER drops a continuation as a duplicate", () => {
    // The load-bearing case. A deferral retains an undo action and parks an
    // entry in `_pendingMeasure` BEFORE offering itself; only running the
    // continuation releases either. Dropping the second one on the key dedup
    // would leave the action buffer open forever AND leave a pending entry
    // that later writes merge into and nothing ever fires — a tracker that
    // silently stops recomputing.
    hold.begin();
    const a = vi.fn(), b = vi.fn();
    hold.take("MeasureOp", { occurrenceId: "a", fieldId: "f" }, a);
    hold.take("MeasureOp", { occurrenceId: "a", fieldId: "f" }, b);
    expect(hold.size()).toBe(2);
    for (const h of hold.end()) h.run();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("plain fires still dedupe beside continuations", () => {
    // The control: making continuations exempt must not disarm the dedup the
    // top-level path depends on.
    hold.begin();
    for (let i = 0; i < 20; i++) hold.take("MeasureOp", { occurrenceId: "a", fieldId: "f" });
    hold.take("MeasureOp", { occurrenceId: "a", fieldId: "f" }, () => {});
    expect(hold.size()).toBe(2);
  });

  it("drains itself once the queue passes the entry cap", () => {
    // The second fail-safe, on the same principle as the timer: a hold that
    // exempts continuations from the dedup must not be able to grow a queue
    // nobody bounded.
    const capped = [];
    const h = makeInteractionHold({ maxEntries: 5, onCap: (held) => capped.push(held.length) });
    h.begin();
    for (let i = 0; i < 5; i++) h.take("MeasureOp", { occurrenceId: `o${i}` }, () => {});
    expect(capped).toEqual([5]);
    expect(h.isHolding()).toBe(false);   // released, so the next fire runs normally
  });
});
