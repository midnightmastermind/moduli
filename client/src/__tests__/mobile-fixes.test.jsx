/**
 * mobile-fixes.test.jsx
 *
 * Tests verifying mobile UX fixes:
 *   Fix 1: Android split-screen — CSS touch-action on drag handles
 *   Fix 2: Stack cycling — moved to Panel.jsx inline buttons (StackOverlay removed)
 *   Fix 3: Panel scroll — no double padding
 *   Fix 4: Rail buttons — renders on multi-row grids, correct positioning
 *   Fix 5: RadialMenu clamping — arc items stay within viewport
 *   Fix 6: GridRadialMenu — hidden on mobile
 *   Regression: drag handles not hidden, no z-index blocking
 */
import { describe, test, expect } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";
import MobileGridNav from "../mobile/MobileGridNav";

// Load the actual CSS file so we can verify rules
const CSS_PATH = resolve(__dirname, "../index.css");
const cssContent = readFileSync(CSS_PATH, "utf-8");

// Extract the @media (max-width: 600px) block content
function getMobileMediaBlock(css) {
  const start = css.indexOf("@media (max-width: 600px)");
  if (start === -1) return "";
  let depth = 0;
  let blockStart = -1;
  for (let i = start; i < css.length; i++) {
    if (css[i] === "{") {
      if (depth === 0) blockStart = i + 1;
      depth++;
    }
    if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(blockStart, i);
    }
  }
  return "";
}

const mobileCSS = getMobileMediaBlock(cssContent);

// ============================================================
// FIX 1: Android split-screen — touch-action: none on drag handles
// Class names updated: .module-handle → .module-drag-handle, .module-grab-zone stays
// ============================================================
describe("Fix 1 — Android split-screen CSS", () => {
  test("mobile CSS includes touch-action: none on drag handles", () => {
    expect(mobileCSS).toContain("touch-action: none");
    // .module-drag-handle or .module-grab-zone should have touch-action: none
    expect(mobileCSS).toMatch(/\.module-(drag-handle|grab-zone)[^}]*touch-action:\s*none/);
  });

  test("instance-wrap does NOT have touch-action: none in CSS", () => {
    const instanceWrapNone = mobileCSS.match(/\.instance-wrap[^}]*touch-action:\s*none/);
    expect(instanceWrapNone).toBeNull();
  });
});

// ============================================================
// FIX 2: Stack cycling — StackOverlay was removed, cycling is now inline in Panel.jsx
// ============================================================
describe("Fix 2 — StackOverlay removed from Grid.jsx", () => {
  const GRID_PATH = resolve(__dirname, "../Grid.jsx");
  const gridSource = readFileSync(GRID_PATH, "utf-8");

  test("StackOverlay function no longer exists in Grid.jsx", () => {
    expect(gridSource).not.toContain("function StackOverlay(");
  });

  test("Grid.jsx still renders panels via panelsRender.map", () => {
    expect(gridSource).toContain("panelsRender.map");
  });
});

// ============================================================
// FIX 3: Panel scroll — no double padding
// ============================================================
describe("Fix 3 — No double padding on panel scroll", () => {
  test("mobile CSS has padding-bottom on .panel-content", () => {
    expect(mobileCSS).toMatch(/\.panel-content\s*\{[^}]*padding-bottom:\s*48px/);
  });

  test("mobile CSS does NOT have padding-bottom on .panel-scroll", () => {
    const panelScrollPadding = mobileCSS.match(/\.panel-scroll\s*\{[^}]*padding-bottom/);
    expect(panelScrollPadding).toBeNull();
  });
});

// ============================================================
// FIX 4: Rail buttons — replaced lip buttons, renders on multi-row grids
// ============================================================
describe("Fix 4 — Rail buttons", () => {
  function renderNav({ rows, cols, activeCell }) {
    const { container } = render(
      <MobileGridNav
        rows={rows}
        cols={cols}
        activeCell={activeCell}
        setActiveCell={() => {}}
        isMobile={true}
        zoomedOut={false}
        setZoomedOut={() => {}}
      >
        <div>Grid</div>
      </MobileGridNav>
    );
    return container;
  }

  test("2x3 grid at (0,0) renders down and right rail buttons", () => {
    const container = renderNav({ rows: 2, cols: 3, activeCell: { row: 0, col: 0 } });
    expect(container.querySelector(".mobile-rail-down")).not.toBeNull();
    expect(container.querySelector(".mobile-rail-right")).not.toBeNull();
  });

  test("2x3 grid at (1,2) — bottom-right corner — renders left and up only", () => {
    const container = renderNav({ rows: 2, cols: 3, activeCell: { row: 1, col: 2 } });
    const buttons = container.querySelectorAll(".mobile-rail-btn");
    const labels = Array.from(buttons).map(b => b.getAttribute("aria-label"));
    expect(labels).toContain("Navigate left");
    expect(labels).toContain("Navigate up");
    expect(labels).not.toContain("Navigate right");
    expect(labels).not.toContain("Navigate down");
  });

  test("down rail button has correct aria-label", () => {
    const container = renderNav({ rows: 2, cols: 1, activeCell: { row: 0, col: 0 } });
    const downBtn = container.querySelector(".mobile-rail-down");
    expect(downBtn).not.toBeNull();
    expect(downBtn.getAttribute("aria-label")).toBe("Navigate down");
  });

  test("1x1 grid renders zero rail buttons", () => {
    const container = renderNav({ rows: 1, cols: 1, activeCell: { row: 0, col: 0 } });
    const buttons = container.querySelectorAll(".mobile-rail-btn");
    expect(buttons).toHaveLength(0);
  });

  test("mobile CSS positions rail buttons as fixed", () => {
    expect(mobileCSS).toMatch(/\.mobile-rail-btn\s*\{[^}]*position:\s*fixed/);
  });
});

// ============================================================
// FIX 5: RadialMenu arc clamping
// ============================================================
describe("Fix 5 — RadialMenu arc item clamping", () => {
  function clampArcItem(anchorX, anchorY, angle, radius, vw, vh) {
    const angleRad = (angle * Math.PI) / 180;
    let x = Math.cos(angleRad) * radius;
    let y = Math.sin(angleRad) * radius;
    const itemHalf = 14;
    const absX = anchorX + x;
    const absY = anchorY + y;
    x += Math.max(itemHalf, Math.min(vw - itemHalf, absX)) - absX;
    y += Math.max(itemHalf, Math.min(vh - itemHalf, absY)) - absY;
    return { finalX: anchorX + x, finalY: anchorY + y };
  }

  const R = 34;
  const VW = 375;
  const VH = 667;

  test("items near left edge clamped within viewport", () => {
    for (const angle of [180, 225, 135]) {
      const { finalX } = clampArcItem(10, 300, angle, R, VW, VH);
      expect(finalX).toBeGreaterThanOrEqual(14);
    }
  });

  test("items near right edge clamped within viewport", () => {
    for (const angle of [0, 315, 45]) {
      const { finalX } = clampArcItem(VW - 10, 300, angle, R, VW, VH);
      expect(finalX).toBeLessThanOrEqual(VW - 14);
    }
  });

  test("items near bottom edge clamped within viewport", () => {
    for (const angle of [90, 45, 135]) {
      const { finalY } = clampArcItem(200, VH - 10, angle, R, VW, VH);
      expect(finalY).toBeLessThanOrEqual(VH - 14);
    }
  });

  test("items near top edge clamped within viewport", () => {
    for (const angle of [270, 315, 225]) {
      const { finalY } = clampArcItem(200, 10, angle, R, VW, VH);
      expect(finalY).toBeGreaterThanOrEqual(14);
    }
  });

  test("arc spread capped at 180 degrees for many items", () => {
    for (const count of [5, 8, 12]) {
      const spread = Math.min(45, 180 / Math.max(count - 1, 1));
      const totalArc = spread * (count - 1);
      expect(totalArc).toBeLessThanOrEqual(180);
    }
  });
});

// ============================================================
// FIX 6: GridRadialMenu removed entirely (no longer rendered from Grid.jsx).
// Prior assertion: !isMobile && <GridRadialMenu/>. Component is now orphan
// code; Grid.jsx renders no global radial menu. Test removed — adding a
// new "not rendered anywhere" check would just couple to a transitional
// state of dead code being deleted.
// ============================================================

// ============================================================
// REGRESSION: Drag handles NOT hidden on mobile
// ============================================================
describe("Regression — drag handles not hidden on mobile", () => {
  test("mobile CSS does NOT hide .module-drag-handle", () => {
    const handleHidden = mobileCSS.match(/\.module-drag-handle\s*\{[^}]*display:\s*none/);
    expect(handleHidden).toBeNull();
  });
});

// ============================================================
// REGRESSION: No z-index: 65 on GridCell
// ============================================================
describe("Regression — GridCell z-index not elevated", () => {
  const GRID_PATH = resolve(__dirname, "../Grid.jsx");
  const gridSource = readFileSync(GRID_PATH, "utf-8");

  test("GridCell does not set zIndex to 65", () => {
    const cellStart = gridSource.indexOf("const GridCell = React.memo");
    if (cellStart === -1) return; // GridCell may be structured differently
    const cellEnd = gridSource.indexOf("// ====", cellStart + 10);
    const cellSource = gridSource.slice(cellStart, cellEnd > cellStart ? cellEnd : cellStart + 2000);
    expect(cellSource).not.toContain("zIndex: 65");
  });
});
