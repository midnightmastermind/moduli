// The load-time scroll gives up when the user takes over.
//
// Reported from the device: "the first two failed to drop cause 1 of the last
// ops was the scroll to the timeslot on fresh load and that canceled out my
// drag." The ops arrive in waves over most of a minute, the poll runs ~6s, so
// the target can land mid-gesture and yank the page.
import { describe, test, expect, vi } from "vitest";
import { autoScrollWhenReady, browserTakeoverSubscription, TAKEOVER_EVENTS } from "../helpers/autoScrollOnLoad";

/** A hand-driven clock — the poll is 250ms x 24 and must not run in real time. */
function fakeClock() {
  let next = 1; const q = new Map();
  return {
    schedule: (fn) => { const id = next++; q.set(id, fn); return id; },
    unschedule: (id) => q.delete(id),
    tick() { const due = [...q.entries()]; q.clear(); for (const [, fn] of due) fn(); },
    get pending() { return q.size; },
  };
}

describe("autoScrollWhenReady", () => {
  test("polls until the target lands, then scrolls once", () => {
    const c = fakeClock();
    let ready = false;
    const jump = vi.fn(() => ready);
    autoScrollWhenReady({ jump, schedule: c.schedule, unschedule: c.unschedule });
    c.tick(); c.tick();
    expect(jump).toHaveBeenCalledTimes(2);
    ready = true;
    c.tick();
    expect(jump).toHaveBeenCalledTimes(3);
    // Landed — it must stop rather than keep polling for the rest of the 6s.
    expect(c.pending).toBe(0);
    c.tick();
    expect(jump).toHaveBeenCalledTimes(3);
  });

  test("ABANDONS when a drag starts between two polls — the reported case", () => {
    const c = fakeClock();
    let busy = false;
    const jump = vi.fn(() => false);
    autoScrollWhenReady({ jump, isUserBusy: () => busy, schedule: c.schedule, unschedule: c.unschedule });
    c.tick();
    expect(jump).toHaveBeenCalledTimes(1);
    busy = true;              // the finger goes down
    c.tick();
    // Never attempted again — and, crucially, nothing is left queued, so it
    // cannot fire the moment the drag ends.
    expect(jump).toHaveBeenCalledTimes(1);
    expect(c.pending).toBe(0);
    busy = false;
    c.tick();
    expect(jump).toHaveBeenCalledTimes(1);
  });

  test("ABANDONS on any user input, not only a drag", () => {
    const c = fakeClock();
    let fire = null;
    const jump = vi.fn(() => false);
    autoScrollWhenReady({
      jump, schedule: c.schedule, unschedule: c.unschedule,
      subscribe: (cb) => { fire = cb; return () => { fire = null; }; },
    });
    c.tick();
    fire();                   // a wheel / keypress — they are reading something
    c.tick();
    expect(jump).toHaveBeenCalledTimes(1);
  });

  test("gives up after the bounded retries — a target that never renders", () => {
    // The control on the two abandon tests above: without it, "stops polling"
    // would also be satisfied by something that never polled at all.
    const c = fakeClock();
    const jump = vi.fn(() => false);
    autoScrollWhenReady({ jump, schedule: c.schedule, unschedule: c.unschedule, maxTries: 4 });
    for (let i = 0; i < 10; i++) c.tick();
    expect(jump).toHaveBeenCalledTimes(4);
    expect(c.pending).toBe(0);
  });

  test("unsubscribes from input once it is done", () => {
    const c = fakeClock();
    const unsub = vi.fn();
    autoScrollWhenReady({
      jump: () => true, schedule: c.schedule, unschedule: c.unschedule,
      subscribe: () => unsub,
    });
    c.tick();
    expect(unsub).toHaveBeenCalled();
  });
});

describe("browserTakeoverSubscription", () => {
  test("listens for real input and removes every listener on unsubscribe", () => {
    const added = [], removed = [];
    const target = {
      addEventListener: (e, fn, o) => added.push([e, fn, o]),
      removeEventListener: (e, fn, o) => removed.push([e, fn, o]),
    };
    const onTakeover = vi.fn();
    const unsub = browserTakeoverSubscription(target)(onTakeover);
    expect(added.map((a) => a[0])).toEqual(TAKEOVER_EVENTS);
    // Passive, so observing input can never delay it.
    expect(added.every((a) => a[2].passive && a[2].capture)).toBe(true);
    added[0][1]();
    expect(onTakeover).toHaveBeenCalled();
    unsub();
    // `once` is per-listener, so the OTHERS still have to be removed by hand.
    expect(removed.map((r) => r[0])).toEqual(TAKEOVER_EVENTS);
  });

  test("a target with no addEventListener is a silent no-op", () => {
    expect(() => browserTakeoverSubscription(null)(() => {})()).not.toThrow();
  });
});
