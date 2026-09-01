/**
 * LIFT-ON-HOLD — the drag begins with the finger stationary.
 *
 * User, 2026-09-01, after the startup second had been removed: *"theres still
 * a pause between me holding it down and the buzz and the preview showing up,
 * still like a second."*
 *
 * It was never startup cost. `_TOUCH_HOLD_MS` is 80ms, but activation lived
 * inside `onMove`, so nothing happened until the finger travelled
 * `_TOUCH_THRESHOLD`. The probe's `hold` was therefore max(80ms, time until
 * you move 8px) — captures read 903-3591ms, and one read exactly 80 (the floor,
 * from a drag where the finger moved at once). Holding still, waiting for a
 * buzz that could not arrive, is the second being described.
 *
 * These tests are about the two halves that have to stay true together: a
 * stationary hold LIFTS, and a tap is still a TAP.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: () => () => {}, dropTargetForElements: () => () => {},
}));
vi.mock("@atlaskit/pragmatic-drag-and-drop/external/adapter", () => ({
  dropTargetForExternal: () => () => {},
}));
vi.mock("@atlaskit/pragmatic-drag-and-drop/combine", () => ({
  combine: (...fns) => () => fns.forEach((f) => typeof f === "function" && f()),
}));
vi.mock("@atlaskit/pragmatic-drag-and-drop-auto-scroll/element", () => ({
  autoScrollForElements: () => () => {},
}));
vi.mock("@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview", () => ({
  setCustomNativeDragPreview: vi.fn(),
}));
vi.mock("@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge", () => ({
  attachClosestEdge: (d) => d, extractClosestEdge: () => null,
}));

beforeAll(() => {
  // `_isTouch()` reads matchMedia — the touch path is the whole subject here.
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true, addEventListener: () => {}, removeEventListener: () => {},
  });
});

import { useDragDrop, DragContext, _TOUCH_LIFT_MS, _TOUCH_HOLD_MS } from "../helpers/dragSystem.js";

const ctx = {
  handleDragStart: vi.fn(), handleDragMove: vi.fn(),
  handleDragEnd: vi.fn(), handleDrop: vi.fn(),
  dragMode: "move", setDragMode: () => {}, isDragging: false,
};

function Probe() {
  const { ref } = useDragDrop({ type: "instance", id: "i1", data: { label: "Row" } });
  return <div ref={ref} data-testid="row" />;
}

function mount() {
  const r = render(<DragContext.Provider value={ctx}><Probe /></DragContext.Provider>);
  return r.getByTestId("row");
}

const touch = (el, kind, x, y) => {
  const t = { clientX: x, clientY: y, identifier: 1, target: el };
  const ev = new Event(kind, { bubbles: true, cancelable: true });
  ev.touches = kind === "touchend" ? [] : [t];
  ev.changedTouches = [t];
  el.dispatchEvent(ev);
};

const pills = () => document.querySelectorAll(".drag-pill, [data-drag-pill]").length;

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); document.body.innerHTML = ""; });

describe("lift-on-hold", () => {
  it("the lift delay is longer than the hold floor, or it could never fire", () => {
    // `onMove`'s hold gate returns early below _TOUCH_HOLD_MS. A lift delay at
    // or under it would be a dead constant that reads as a shipped feature.
    expect(_TOUCH_LIFT_MS).toBeGreaterThan(_TOUCH_HOLD_MS);
  });

  it("starts the drag from a STATIONARY hold — no touchmove at all", () => {
    vi.useFakeTimers();
    const el = mount();
    touch(el, "touchstart", 100, 100);
    expect(ctx.handleDragStart).not.toHaveBeenCalled();   // not yet: it is a hold
    vi.advanceTimersByTime(_TOUCH_LIFT_MS + 5);
    // THE REGRESSION. Before this, no touchmove meant no drag, ever.
    expect(ctx.handleDragStart).toHaveBeenCalledTimes(1);
  });

  it("does not lift before the delay", () => {
    vi.useFakeTimers();
    const el = mount();
    touch(el, "touchstart", 100, 100);
    vi.advanceTimersByTime(_TOUCH_LIFT_MS - 20);
    expect(ctx.handleDragStart).not.toHaveBeenCalled();
  });

  it("a release before the delay is still a TAP and lifts nothing", () => {
    // A tap on this handle opens the radial menu. If the lift fired for a
    // quick press the menu would stop opening — the feature would have taken
    // a working control away to add feedback.
    vi.useFakeTimers();
    const el = mount();
    touch(el, "touchstart", 100, 100);
    vi.advanceTimersByTime(60);
    touch(el, "touchend", 100, 100);
    vi.advanceTimersByTime(_TOUCH_LIFT_MS * 3);   // the timer must be cancelled
    expect(ctx.handleDragStart).not.toHaveBeenCalled();
  });

  it("a hold released WITHOUT moving unwinds the lift and stays a tap", () => {
    // Held long enough to lift, then let go having never moved. The pill must
    // come off and the gesture must not be reported as a drop.
    vi.useFakeTimers();
    const el = mount();
    touch(el, "touchstart", 100, 100);
    vi.advanceTimersByTime(_TOUCH_LIFT_MS + 5);
    expect(ctx.handleDragStart).toHaveBeenCalledTimes(1);
    touch(el, "touchend", 100, 100);
    expect(ctx.handleDrop).not.toHaveBeenCalled();
    expect(pills()).toBe(0);
  });

  it("still starts on MOVEMENT, so a fast drag does not wait for the timer", () => {
    // The original path. A quick flick must not sit through the lift delay.
    vi.useFakeTimers();
    const el = mount();
    touch(el, "touchstart", 100, 100);
    vi.advanceTimersByTime(_TOUCH_HOLD_MS + 5);   // past the hold gate, before the lift
    touch(el, "touchmove", 140, 100);             // > _TOUCH_THRESHOLD
    expect(ctx.handleDragStart).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(_TOUCH_LIFT_MS * 2);
    expect(ctx.handleDragStart).toHaveBeenCalledTimes(1);   // and not twice
  });
});
