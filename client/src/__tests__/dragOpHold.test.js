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
