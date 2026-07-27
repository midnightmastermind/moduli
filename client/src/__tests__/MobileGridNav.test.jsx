/**
 * MobileGridNav.test.jsx
 *
 * Tests rail button visibility based on grid dimensions and active cell position.
 * Rail buttons replaced lip buttons — class is now .mobile-rail-btn.
 */
import { describe, test, expect, vi } from "vitest";
import React from "react";
import { render, fireEvent } from "@testing-library/react";
import MobileGridNav from "../mobile/MobileGridNav";

// Helper: render MobileGridNav and return rendered rail button aria-labels
function renderNav({ rows, cols, activeCell }) {
  const { container } = render(
    <MobileGridNav
      rows={rows}
      cols={cols}
      activeCell={activeCell}
      setActiveCell={() => {}}
      isMobileLayout={true}
      zoomedOut={false}
      setZoomedOut={() => {}}
    >
      <div>Grid Content</div>
    </MobileGridNav>
  );
  const buttons = container.querySelectorAll(".mobile-rail-btn");
  return Array.from(buttons).map((b) => b.getAttribute("aria-label"));
}

describe("MobileGridNav rail buttons", () => {
  test("1x1 grid renders no rail buttons", () => {
    const labels = renderNav({ rows: 1, cols: 1, activeCell: { row: 0, col: 0 } });
    expect(labels).toHaveLength(0);
  });

  test("2x2 grid at (0,0) renders right + down buttons", () => {
    const labels = renderNav({ rows: 2, cols: 2, activeCell: { row: 0, col: 0 } });
    expect(labels).toContain("Navigate right");
    expect(labels).toContain("Navigate down");
    expect(labels).not.toContain("Navigate left");
    expect(labels).not.toContain("Navigate up");
  });

  test("2x2 grid at (1,1) renders left + up buttons", () => {
    const labels = renderNav({ rows: 2, cols: 2, activeCell: { row: 1, col: 1 } });
    expect(labels).toContain("Navigate left");
    expect(labels).toContain("Navigate up");
    expect(labels).not.toContain("Navigate right");
    expect(labels).not.toContain("Navigate down");
  });

  test("3x3 grid at (1,1) renders all four buttons", () => {
    const labels = renderNav({ rows: 3, cols: 3, activeCell: { row: 1, col: 1 } });
    expect(labels).toContain("Navigate left");
    expect(labels).toContain("Navigate right");
    expect(labels).toContain("Navigate up");
    expect(labels).toContain("Navigate down");
  });

  test("2x1 grid (2 rows, 1 col) at (0,0) renders only down button", () => {
    const labels = renderNav({ rows: 2, cols: 1, activeCell: { row: 0, col: 0 } });
    expect(labels).toEqual(["Navigate down"]);
  });
});

// --- Rail taps switch cells without waiting for the React commit -------------
// activeCell lives in App state, so the re-render it triggers is the slow part
// on a phone. The tap paints the target transform itself, in its own frame.

function renderTapNav({ rows = 1, cols = 2, activeCell = { row: 0, col: 0 }, setActiveCell = () => {} } = {}) {
  const view = render(
    <MobileGridNav
      rows={rows}
      cols={cols}
      activeCell={activeCell}
      setActiveCell={setActiveCell}
      isMobileLayout={true}
      zoomedOut={false}
      setZoomedOut={() => {}}
    >
      <div>Grid Content</div>
    </MobileGridNav>
  );
  return {
    ...view,
    slider: () => view.container.querySelector(".mobile-grid-slider"),
    rail: (dir) => view.container.querySelector(`.mobile-rail-${dir}`),
  };
}

// jsdom normalizes "-0%" to "0%" when it round-trips the style property.
const tf = (el) => el.style.transform.replace(/-0%/g, "0%");

function tap(el, { from = [10, 10], to = [10, 10] } = {}) {
  fireEvent.pointerDown(el, { clientX: from[0], clientY: from[1] });
  fireEvent.pointerUp(el, { clientX: to[0], clientY: to[1] });
  fireEvent.click(el, { clientX: to[0], clientY: to[1] });
}

describe("MobileGridNav rail tap latency", () => {
  test("the transform moves on the tap itself, before any state update lands", () => {
    // setActiveCell is a no-op: the parent never re-renders us.
    const { slider, rail } = renderTapNav({ setActiveCell: () => {} });
    expect(tf(slider())).toBe("translate(0%, 0%)");
    tap(rail("right"));
    expect(tf(slider())).toBe("translate(-50%, 0%)");
  });

  test("one tap navigates once (the trailing click is the same tap)", () => {
    const setActiveCell = vi.fn();
    const { rail } = renderTapNav({ setActiveCell });
    tap(rail("right"));
    expect(setActiveCell).toHaveBeenCalledTimes(1);
    expect(setActiveCell).toHaveBeenCalledWith({ row: 0, col: 1 });
  });

  test("a swipe that starts on the rail does not navigate", () => {
    const setActiveCell = vi.fn();
    const { rail } = renderTapNav({ setActiveCell });
    fireEvent.pointerDown(rail("right"), { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(rail("right"), { clientX: 10, clientY: 90 });
    expect(setActiveCell).not.toHaveBeenCalled();
  });

  test("an unrelated re-render before the state lands does not snap the cell back", () => {
    const { slider, rail, rerender } = renderTapNav({ setActiveCell: () => {} });
    tap(rail("right"));
    // Parent re-renders (any other state) still carrying the OLD activeCell.
    rerender(
      <MobileGridNav
        rows={1}
        cols={2}
        activeCell={{ row: 0, col: 0 }}
        setActiveCell={() => {}}
        isMobileLayout={true}
        zoomedOut={false}
        setZoomedOut={() => {}}
      >
        <div>Grid Content</div>
      </MobileGridNav>
    );
    expect(tf(slider())).toBe("translate(-50%, 0%)");
    // Rails already reflect the new cell too.
    expect(rail("left")).toBeTruthy();
    expect(rail("right")).toBeFalsy();
  });

  test("once the state catches up, it is the truth again", () => {
    const { slider, rerender } = renderTapNav({ setActiveCell: () => {} });
    const rerenderAt = (cellProp) => rerender(
      <MobileGridNav
        rows={1}
        cols={2}
        activeCell={cellProp}
        setActiveCell={() => {}}
        isMobileLayout={true}
        zoomedOut={false}
        setZoomedOut={() => {}}
      >
        <div>Grid Content</div>
      </MobileGridNav>
    );
    tap(document.querySelector(".mobile-rail-right"));
    rerenderAt({ row: 0, col: 1 });          // our target lands
    rerenderAt({ row: 0, col: 0 });          // something else moves the cell back
    expect(tf(slider())).toBe("translate(0%, 0%)");
  });
});
