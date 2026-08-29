// The touch guards that were costing every swipe its momentum.
//
// `DragProvider` attached non-passive `touchmove`/`touchstart` to `document` for
// the WHOLE SESSION on any touch device. A non-passive touch listener means the
// browser cannot know whether preventDefault will be called until JS runs, so it
// may not hand the gesture to the compositor — every swipe waits on the main
// thread. Measured on prod at a tablet viewport (2026-08-29, via CDP):
//
//     document  touchstart  passive=false   <- ours
//     document  touchmove   passive=false   <- ours
//
// These tests pin the contract: the guards exist ONLY while a drag is running.
import { describe, it, expect, vi } from "vitest";
import { attachDragTouchGuards, shouldGuardTouch, DRAG_TOUCH_EVENTS }
  from "../helpers/dragTouchGuards";

/** A target that records exactly what was registered, options included. */
function fakeTarget() {
  const added = [], removed = [];
  return {
    added, removed,
    addEventListener: (type, fn, opts) => added.push({ type, fn, opts }),
    removeEventListener: (type, fn, opts) => removed.push({ type, fn, opts }),
    live: () => added.filter(a => !removed.some(r => r.type === a.type && r.fn === a.fn)),
  };
}

describe("shouldGuardTouch — the gate", () => {
  // THE WHOLE POINT. On a touch device with no drag running there must be no
  // guards, or ordinary scrolling stays main-thread-gated.
  it("is false on a touch device that is NOT dragging", () => {
    expect(shouldGuardTouch(true, false)).toBe(false);
  });

  it("is true only while a touch device IS dragging", () => {
    expect(shouldGuardTouch(true, true)).toBe(true);
  });

  // …and the inverse, so the gate cannot degrade into "never attach".
  it("is false on a non-touch device however it is dragging", () => {
    expect(shouldGuardTouch(false, true)).toBe(false);
    expect(shouldGuardTouch(false, false)).toBe(false);
  });
});

describe("attachDragTouchGuards", () => {
  it("registers both touch guards NON-PASSIVELY — they call preventDefault", () => {
    const t = fakeTarget();
    attachDragTouchGuards(t, { onTouchMove: () => {}, onTouchStart: () => {} });
    const types = t.added.map(a => a.type).sort();
    expect(types).toEqual([...DRAG_TOUCH_EVENTS].sort());
    for (const a of t.added) expect(a.opts.passive).toBe(false);
  });

  // Capture phase on touchstart: an edge touch has to be seen before anything
  // downstream gets it. Losing this would silently un-fix the OS-gesture bug
  // these guards were written for.
  it("keeps touchstart on the CAPTURE phase", () => {
    const t = fakeTarget();
    attachDragTouchGuards(t, { onTouchMove: () => {}, onTouchStart: () => {} });
    expect(t.added.find(a => a.type === "touchstart").opts.capture).toBe(true);
  });

  // A LEAK HERE IS THE ORIGINAL BUG. If detach does not remove them, the guards
  // survive the drag and every later swipe is blocked again — the exact state
  // this change exists to end.
  it("detach removes every listener it added, with matching options", () => {
    const t = fakeTarget();
    const onTouchMove = () => {}, onTouchStart = () => {};
    const detach = attachDragTouchGuards(t, { onTouchMove, onTouchStart });
    expect(t.live()).toHaveLength(2);
    detach();
    expect(t.live()).toHaveLength(0);
    // removeEventListener must be given the SAME capture flag or the browser
    // keeps the listener — a silent leak that reads as "the fix did nothing".
    expect(t.removed.find(r => r.type === "touchstart").opts.capture).toBe(true);
  });

  it("detach is idempotent", () => {
    const t = fakeTarget();
    const detach = attachDragTouchGuards(t, { onTouchMove: () => {}, onTouchStart: () => {} });
    detach(); detach(); detach();
    expect(t.removed).toHaveLength(2);
  });

  it("does nothing, and does not throw, without a usable target", () => {
    for (const bad of [null, undefined, {}, 5]) {
      expect(() => attachDragTouchGuards(bad, { onTouchMove: () => {} })()).not.toThrow();
    }
  });

  it("attaches only the handlers it is given", () => {
    const t = fakeTarget();
    attachDragTouchGuards(t, { onTouchMove: () => {} });
    expect(t.added.map(a => a.type)).toEqual(["touchmove"]);
  });

  it("the handlers it registers are the ones passed in", () => {
    const t = fakeTarget();
    const onTouchMove = vi.fn(), onTouchStart = vi.fn();
    attachDragTouchGuards(t, { onTouchMove, onTouchStart });
    expect(t.added.find(a => a.type === "touchmove").fn).toBe(onTouchMove);
    expect(t.added.find(a => a.type === "touchstart").fn).toBe(onTouchStart);
  });
});
