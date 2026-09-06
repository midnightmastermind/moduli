// The decision behind holding the op cascade while the user is still tapping.
// The wiring is three lines at a seam no test mounts (`bindSocketToStore`), so
// what is worth pinning is WHEN it holds and — much more importantly — when it
// lets go.
import { describe, it, expect } from "vitest";
import { makeInputActivityHold, QUIET_MS } from "../helpers/inputActivityHold";

function harness({ quietMs = QUIET_MS, dragging = false } = {}) {
  let t = 1000;
  const timers = new Map();
  let nextId = 1;
  const log = [];
  const h = makeInputActivityHold({
    quietMs,
    begin: () => log.push("begin"),
    end: () => log.push("end"),
    isDragging: () => dragging,
    now: () => t,
    schedule: (fn, ms) => { const id = nextId++; timers.set(id, { fn, at: t + ms }); return id; },
    unschedule: (id) => timers.delete(id),
  });
  return {
    h, log,
    advance(ms) {
      t += ms;
      for (const [id, e] of [...timers]) if (e.at <= t) { timers.delete(id); e.fn(); }
    },
    setDragging(v) { dragging = v; },
    pending: () => timers.size,
  };
}

describe("input activity hold", () => {
  it("a LONE write does not arm the hold — the common case is unchanged", () => {
    // The point of holding from the second write: arming on every one would
    // delay a single tick's tracker update to fix a burst-only problem.
    const { h, log } = harness();
    expect(h.noteWrite()).toBe(false);
    expect(log).toEqual([]);
  });

  it("a SECOND write inside the window arms it", () => {
    const { h, log, advance } = harness();
    h.noteWrite();
    advance(100);
    expect(h.noteWrite()).toBe(true);
    expect(log).toEqual(["begin"]);
  });

  it("two writes FURTHER APART than the window never arm it", () => {
    // The control on "rapid": a tick a minute is not a burst.
    const { h, log, advance } = harness();
    h.noteWrite();
    advance(QUIET_MS + 50);
    expect(h.noteWrite()).toBe(false);
    expect(log).toEqual([]);
  });

  it("releases after the window, once", () => {
    const { h, log, advance } = harness();
    h.noteWrite(); advance(100); h.noteWrite();
    advance(QUIET_MS + 10);
    expect(log).toEqual(["begin", "end"]);
    expect(h.isArmed()).toBe(false);
  });

  it("a continuing burst keeps it held — the timer restarts on every write", () => {
    const { h, log, advance } = harness();
    h.noteWrite(); advance(100); h.noteWrite();
    for (let i = 0; i < 5; i++) { advance(QUIET_MS - 50); h.noteWrite(); }
    expect(log).toEqual(["begin"]);          // still holding
    advance(QUIET_MS + 10);
    expect(log).toEqual(["begin", "end"]);   // and lets go when it stops
  });

  it("NEVER releases while a drag is down", () => {
    // `interactionHold.begin()` is a FLAG, not a counter, so an `end()` from
    // here mid-drag would un-hold the rest of the gesture — the defect
    // 2026-09-03 fixed when a cap ended drags that ran 16-38 seconds.
    const th = harness();
    th.h.noteWrite(); th.advance(100); th.h.noteWrite();
    th.setDragging(true);
    th.advance(QUIET_MS + 10);
    expect(th.log).toEqual(["begin"]);
    expect(th.h.isArmed()).toBe(true);
  });

  it("flush lets go immediately, and is a no-op when nothing is held", () => {
    const { h, log, advance } = harness();
    expect(h.flush()).toBe(false);
    expect(log).toEqual([]);
    h.noteWrite(); advance(100); h.noteWrite();
    expect(h.flush()).toBe(true);
    expect(log).toEqual(["begin", "end"]);
    expect(h.flush()).toBe(false);           // idempotent
  });

  it("leaves no timer running once it has let go", () => {
    // A scheduling helper that keeps re-arming would wake the tab forever.
    const { h, advance, pending } = harness();
    h.noteWrite(); advance(100); h.noteWrite();
    advance(QUIET_MS + 10);
    expect(pending()).toBe(0);
  });
});
