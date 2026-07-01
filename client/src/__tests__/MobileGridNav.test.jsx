/**
 * MobileGridNav.test.jsx
 *
 * Tests rail button visibility based on grid dimensions and active cell position.
 * Rail buttons replaced lip buttons — class is now .mobile-rail-btn.
 */
import { describe, test, expect } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
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
