/**
 * THE DROP IS DECIDED AT THE RELEASE POINT.
 *
 * User, 2026-09-01: *"i try to drop to the left side of an empty container ...
 * and it doesnt drop, i have to drop it in the middle of it"*, then *"i drop to
 * the last spot of a container (an instance) and it puts it after the
 * container"*, then *"the rect are off i think"*.
 *
 * `onEnd` dropped on `curTarget` — whatever the THROTTLED hover hit-test had
 * last resolved. That throttle is derived from its own cost, so on a tablet
 * measuring `hit avg=21ms` it backs off to ~85ms: the drop landed wherever the
 * finger had been up to a tenth of a second earlier. The edge compounded it,
 * being computed from FRESH coordinates against the STALE element — and a
 * point outside an element's rect still yields a confident "closest" edge.
 *
 * FIXTURE NOTE, load-bearing twice over: the touchmove that ACTIVATES the drag
 * returns before hit-testing, AND activation arms the throttle
 * (`lastHitTestTime = now`), so the next move is suppressed too. A hover target
 * therefore only exists after a second move that also clears `hitEveryMs` —
 * which is why a SHORT drag reached `onEnd` with no target at all under the old
 * code, and dropped nothing.
 * Written without that, the "throttled" move is really the first hit-test and
 * every case passes without exercising staleness at all — which is how three
 * of these were written, and what the A/B caught.
 *
 * These tests pin the release point as the decider. The discriminating case is
 * the second one: the finger moves to a NEW target inside the throttle window,
 * so the hover state still names the old one when the finger lifts.
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
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true, addEventListener: () => {}, removeEventListener: () => {},
  });
});

import { useDragDrop, useDroppable, DragContext, _TOUCH_HOLD_MS } from "../helpers/dragSystem.js";

const ctx = {
  handleDragStart: vi.fn(), handleDragMove: vi.fn(), handleDragOver: vi.fn(),
  handleDragEnd: vi.fn(), handleDrop: vi.fn(),
  dragMode: "move", setDragMode: () => {}, isDragging: false,
};

function Zone({ id }) {
  // `overAsAttribute` puts the hover state in the DOM. Without it `isOver` is
  // React state the test cannot see, and the highlight assertion below passes
  // whether or not anything clears it — vacuous, which the A/B caught.
  const { ref } = useDroppable({ type: "container", id, accepts: ["instance"], overAsAttribute: true });
  return <div ref={ref} data-testid={id} />;
}
function Row() {
  const { ref } = useDragDrop({ type: "instance", id: "i1", data: { label: "Row" } });
  return <div ref={ref} data-testid="row" />;
}

function mount() {
  const r = render(
    <DragContext.Provider value={ctx}>
      <Row /><Zone id="left" /><Zone id="right" />
    </DragContext.Provider>
  );
  return {
    row: r.getByTestId("row"),
    left: r.getByTestId("left"),
    right: r.getByTestId("right"),
  };
}

// jsdom implements neither elementsFromPoint nor layout. The stub is the whole
// fixture: x < 500 is over `left`, x >= 500 is over `right`. Every hit-test the
// code runs — hover or drop — goes through it, so a test can only pass by
// asking at the right MOMENT, which is the thing under test.
function stubPoints(left, right) {
  document.elementsFromPoint = (x) => [x < 500 ? left : right];
  document.elementFromPoint = (x) => (x < 500 ? left : right);
}

const touch = (el, kind, x, y) => {
  const t = { clientX: x, clientY: y, identifier: 1, target: el };
  const ev = new Event(kind, { bubbles: true, cancelable: true });
  ev.touches = kind === "touchend" ? [] : [t];
  ev.changedTouches = [t];
  el.dispatchEvent(ev);
};

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); document.body.innerHTML = ""; });

describe("drop lands where the finger was RELEASED", () => {
  it("drops on the target under the release point", () => {
    vi.useFakeTimers();
    const { row, left, right } = mount();
    stubPoints(left, right);
    touch(row, "touchstart", 100, 100);
    vi.advanceTimersByTime(_TOUCH_HOLD_MS + 5);  // past the hold gate
    touch(row, "touchmove", 200, 100);          // activates + hit-tests -> left
    touch(row, "touchend", 200, 100);
    expect(ctx.handleDrop).toHaveBeenCalledTimes(1);
    expect(ctx.handleDrop.mock.calls[0][0].id).toBe("left");
  });

  it("drops on a target the finger reached INSIDE the hover throttle window", () => {
    // THE REGRESSION. The second move is throttled (it arrives well inside
    // `hitEveryMs`), so the hover state still names `left` when the finger
    // lifts over `right`. Before the fix this dropped on `left`.
    vi.useFakeTimers();
    const { row, left, right } = mount();
    stubPoints(left, right);
    touch(row, "touchstart", 100, 100);
    vi.advanceTimersByTime(_TOUCH_HOLD_MS + 5);
    touch(row, "touchmove", 200, 100);          // ACTIVATES — and returns
    vi.advanceTimersByTime(40);                 // let one hover hit-test through
    touch(row, "touchmove", 210, 100);          // hover = `left`
    touch(row, "touchmove", 800, 100);          // throttled: no hit-test
    touch(row, "touchend", 800, 100);           // released over `right`
    expect(ctx.handleDrop).toHaveBeenCalledTimes(1);
    expect(ctx.handleDrop.mock.calls[0][0].id).toBe("right");
  });

  it("drops NOTHING when the release point is over no target at all", () => {
    // The other half of "it doesnt drop": a stale target must not manufacture
    // a drop the user did not make. Nothing registered under the release point
    // means no drop — not the last thing hovered.
    vi.useFakeTimers();
    const { row, left } = mount();
    document.elementsFromPoint = (x) => (x < 500 ? [left] : []);
    document.elementFromPoint = (x) => (x < 500 ? left : null);
    touch(row, "touchstart", 100, 100);
    vi.advanceTimersByTime(_TOUCH_HOLD_MS + 5);
    touch(row, "touchmove", 200, 100);          // ACTIVATES — and returns
    vi.advanceTimersByTime(40);
    touch(row, "touchmove", 210, 100);          // hover = `left`
    touch(row, "touchmove", 800, 100);          // throttled
    touch(row, "touchend", 800, 100);           // released over nothing
    expect(ctx.handleDrop).not.toHaveBeenCalled();
  });

  it("clears the hover highlight of the target it left", () => {
    // The stale target's `isOver` was cleared by the old code as part of
    // dropping on it. Re-resolving must not leak a highlight onto a container
    // the item did not land in.
    vi.useFakeTimers();
    const { row, left, right } = mount();
    stubPoints(left, right);
    touch(row, "touchstart", 100, 100);
    vi.advanceTimersByTime(_TOUCH_HOLD_MS + 5);
    touch(row, "touchmove", 200, 100);          // ACTIVATES — and returns
    vi.advanceTimersByTime(40);
    touch(row, "touchmove", 210, 100);          // hover = `left`
    touch(row, "touchmove", 800, 100);          // throttled
    expect(left.hasAttribute("data-drop-over")).toBe(true);   // it IS lit first
    touch(row, "touchend", 800, 100);
    expect(left.hasAttribute("data-drop-over")).toBe(false);
    expect(right.hasAttribute("data-drop-over")).toBe(false);  // and the drop clears its own
  });

  it("composes with lift-on-hold: a drag begun by the timer drops under the finger", () => {
    // Lift-on-hold activates with no touchmove at all, so a drag can begin
    // with `curTarget` null by construction. (Releasing without EVER moving is
    // deliberately a tap — dragLiftOnHold covers that — so the finger moves
    // once here, which is what makes it a drag rather than a tap.)
    vi.useFakeTimers();
    const { row, left, right } = mount();
    stubPoints(left, right);
    touch(row, "touchstart", 800, 100);
    vi.advanceTimersByTime(_TOUCH_HOLD_MS + 200);
    expect(ctx.handleDragStart).toHaveBeenCalledTimes(1);
    touch(row, "touchmove", 820, 100);
    touch(row, "touchend", 820, 100);
    expect(ctx.handleDrop).toHaveBeenCalledTimes(1);
    expect(ctx.handleDrop.mock.calls[0][0].id).toBe("right");
  });
});
