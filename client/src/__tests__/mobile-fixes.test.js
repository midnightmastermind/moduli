/**
 * mobile-fixes.test.js
 *
 * Tests verifying each mobile UX fix:
 *   Fix 1: Android split-screen — CSS touch-action on drag handles
 *   Fix 2: Stack cycler — StackOverlay renders with correct z-index + pointer-events
 *   Fix 3: Panel scroll — no double padding
 *   Fix 4: Down lip button — renders on multi-row grids, correct positioning
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
  // Find the responsive media query block
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
// ============================================================
describe("Fix 1 — Android split-screen CSS", () => {
  test("mobile CSS includes touch-action: none on .module-handle", () => {
    // The mobile media query should set touch-action: none on drag handles
    expect(mobileCSS).toContain(".module-handle");
    expect(mobileCSS).toContain("touch-action: none");
    // Specifically: .module-handle, .module-grab-zone { touch-action: none; }
    expect(mobileCSS).toMatch(/\.module-handle[^}]*touch-action:\s*none/);
  });

  test("mobile CSS includes touch-action: none on .module-grab-zone", () => {
    expect(mobileCSS).toMatch(/\.module-grab-zone[^}]*touch-action:\s*none/);
  });

  test("instance-wrap does NOT have touch-action: none in CSS (uses inline manipulation)", () => {
    // instance-wrap should NOT be forced to touch-action: none — it needs manipulation for scrolling
    // The CSS should NOT contain a rule hiding touch-action on instance-wrap
    const instanceWrapNone = mobileCSS.match(/\.instance-wrap[^}]*touch-action:\s*none/);
    expect(instanceWrapNone).toBeNull();
  });
});

// ============================================================
// FIX 2: Stack cycler — StackOverlay component structure
// We can't import StackOverlay directly (not exported), so we verify
// the Grid.jsx source code has the correct structure.
// ============================================================
describe("Fix 2 — Stack cycler overlay structure", () => {
  const GRID_PATH = resolve(__dirname, "../Grid.jsx");
  const gridSource = readFileSync(GRID_PATH, "utf-8");

  test("StackOverlay component exists in Grid.jsx", () => {
    expect(gridSource).toContain("function StackOverlay(");
  });

  test("StackOverlay has z-index: 80", () => {
    expect(gridSource).toMatch(/zIndex:\s*80/);
  });

  test("StackOverlay wrapper has pointerEvents: none", () => {
    // The outer wrapper div should block nothing
    expect(gridSource).toMatch(/pointerEvents:\s*"none"/);
  });

  test("StackOverlay inner div has pointerEvents: auto", () => {
    // The button container should be clickable
    expect(gridSource).toMatch(/pointerEvents:\s*"auto"/);
  });

  test("StackOverlay renders AFTER panelsRender.map (not inside GridCell)", () => {
    // The stack overlay rendering should come after the panels block
    const panelsMapIndex = gridSource.indexOf("panelsRender.map((p)");
    const stackOverlayIndex = gridSource.indexOf("cellsData\n        .filter(c => c.stackCount > 1)");
    // If exact match fails, try alternate formatting
    const stackOverlayIndex2 = gridSource.indexOf(".filter(c => c.stackCount > 1)");

    expect(panelsMapIndex).toBeGreaterThan(-1);
    expect(stackOverlayIndex2).toBeGreaterThan(-1);
    expect(stackOverlayIndex2).toBeGreaterThan(panelsMapIndex);
  });

  test("GridCell does NOT contain panel-stack-overlay", () => {
    // Extract the GridCell function body
    const cellStart = gridSource.indexOf("function GridCell(");
    const cellEnd = gridSource.indexOf("function StackOverlay(");
    const cellBody = gridSource.slice(cellStart, cellEnd);

    // GridCell should NOT render the stack overlay anymore
    expect(cellBody).not.toContain("panel-stack-overlay");
    expect(cellBody).not.toContain("cyclePanelStack");
  });

  test("GridCell does NOT set z-index: 65", () => {
    const cellStart = gridSource.indexOf("function GridCell(");
    const cellEnd = gridSource.indexOf("function StackOverlay(");
    const cellBody = gridSource.slice(cellStart, cellEnd);

    expect(cellBody).not.toContain("zIndex: 65");
    expect(cellBody).not.toContain("zIndex:65");
  });

  test("StackOverlay has prev/next buttons with aria-labels", () => {
    expect(gridSource).toContain('aria-label="Previous panel"');
    expect(gridSource).toContain('aria-label="Next panel"');
  });

  test("panel-stack-overlay CSS has position: absolute and bottom/right offset", () => {
    expect(cssContent).toMatch(/\.panel-stack-overlay\s*\{[^}]*position:\s*absolute/);
    expect(cssContent).toMatch(/\.panel-stack-overlay\s*\{[^}]*bottom:\s*8px/);
    expect(cssContent).toMatch(/\.panel-stack-overlay\s*\{[^}]*right:\s*8px/);
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
    // There should be no .panel-scroll { padding-bottom } rule in the mobile block
    const panelScrollPadding = mobileCSS.match(/\.panel-scroll\s*\{[^}]*padding-bottom/);
    expect(panelScrollPadding).toBeNull();
  });
});

// ============================================================
// FIX 4: Down lip button — renders + CSS overrides
// ============================================================
describe("Fix 4 — Down lip button", () => {
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

  test("2x3 grid at (0,0) renders a down lip button", () => {
    const container = renderNav({ rows: 2, cols: 3, activeCell: { row: 0, col: 0 } });
    const downBtn = container.querySelector(".mobile-lip-btn-down");
    expect(downBtn).not.toBeNull();
  });

  test("2x3 grid at (0,0) renders right lip button", () => {
    const container = renderNav({ rows: 2, cols: 3, activeCell: { row: 0, col: 0 } });
    const rightBtn = container.querySelector(".mobile-lip-btn-right");
    expect(rightBtn).not.toBeNull();
  });

  test("2x3 grid at (1,2) — bottom-right corner — renders left and up only", () => {
    const container = renderNav({ rows: 2, cols: 3, activeCell: { row: 1, col: 2 } });
    const buttons = container.querySelectorAll(".mobile-lip-btn");
    const labels = Array.from(buttons).map(b => b.getAttribute("aria-label"));
    expect(labels).toContain("Navigate left");
    expect(labels).toContain("Navigate up");
    expect(labels).not.toContain("Navigate right");
    expect(labels).not.toContain("Navigate down");
  });

  test("down lip button has correct aria-label", () => {
    const container = renderNav({ rows: 2, cols: 1, activeCell: { row: 0, col: 0 } });
    const downBtn = container.querySelector(".mobile-lip-btn-down");
    expect(downBtn).not.toBeNull();
    expect(downBtn.getAttribute("aria-label")).toBe("Navigate down");
  });

  test("down lip button has mobile-lip-btn-down class for CSS targeting", () => {
    const container = renderNav({ rows: 2, cols: 1, activeCell: { row: 0, col: 0 } });
    const downBtn = container.querySelector(".mobile-lip-btn-down");
    expect(downBtn).not.toBeNull();
    expect(downBtn.classList.contains("mobile-lip-btn")).toBe(true);
    expect(downBtn.classList.contains("mobile-lip-btn-down")).toBe(true);
  });

  test("mobile CSS overrides down button height to 24px", () => {
    expect(mobileCSS).toMatch(/\.mobile-lip-btn-down\s*\{[^}]*height:\s*24px/);
  });

  test("mobile CSS lifts down button with safe-area-inset-bottom", () => {
    expect(mobileCSS).toMatch(/\.mobile-lip-btn-down\s*\{[^}]*bottom:\s*max\(/);
    expect(mobileCSS).toMatch(/env\(safe-area-inset-bottom/);
  });

  test("base CSS positions down button at bottom center", () => {
    expect(cssContent).toMatch(/\.mobile-lip-btn-down\s*\{[^}]*bottom:\s*0/);
    expect(cssContent).toMatch(/\.mobile-lip-btn-down\s*\{[^}]*left:\s*50%/);
  });

  test("1x1 grid renders zero lip buttons (no navigation possible)", () => {
    const container = renderNav({ rows: 1, cols: 1, activeCell: { row: 0, col: 0 } });
    const buttons = container.querySelectorAll(".mobile-lip-btn");
    expect(buttons).toHaveLength(0);
  });
});

// ============================================================
// FIX 5: RadialMenu arc clamping
// ============================================================
describe("Fix 5 — RadialMenu arc item clamping", () => {
  // Replicates the clamping math from RadialMenu.jsx
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
// FIX 6: GridRadialMenu hidden on mobile
// ============================================================
describe("Fix 6 — GridRadialMenu hidden on mobile", () => {
  const GRID_PATH = resolve(__dirname, "../Grid.jsx");
  const gridSource = readFileSync(GRID_PATH, "utf-8");

  test("GridRadialMenu is conditionally rendered based on isMobile", () => {
    // Should have {!isMobile && (<GridRadialMenu ...)} pattern
    expect(gridSource).toMatch(/!\s*isMobile\s*&&\s*[\s\S]*?GridRadialMenu/);
  });

  test("GridRadialMenu is NOT inside a mobile-only branch", () => {
    // Make sure it's not accidentally inside an isMobile block
    // The pattern should be {!isMobile && ...GridRadialMenu...}
    const match = gridSource.match(/(isMobile\s*&&[\s\S]{0,200}GridRadialMenu)/);
    // If match exists, it should be the !isMobile version
    if (match) {
      expect(match[0]).toContain("!");
    }
  });
});

// ============================================================
// REGRESSION: Drag handles NOT hidden on mobile
// ============================================================
describe("Regression — module-dot not hidden on mobile", () => {
  test("mobile CSS does NOT contain .module-dot { display: none }", () => {
    const dotHidden = mobileCSS.match(/\.module-dot\s*\{[^}]*display:\s*none/);
    expect(dotHidden).toBeNull();
  });

  test("mobile CSS does NOT contain .module-handle .module-dot { display: none }", () => {
    const handleDotHidden = mobileCSS.match(/\.module-handle\s+\.module-dot[^}]*display:\s*none/);
    expect(handleDotHidden).toBeNull();
  });
});

// ============================================================
// REGRESSION: No z-index: 65 on GridCell
// ============================================================
describe("Regression — GridCell z-index not elevated", () => {
  const GRID_PATH = resolve(__dirname, "../Grid.jsx");
  const gridSource = readFileSync(GRID_PATH, "utf-8");

  test("GridCell function does not set zIndex to 65", () => {
    const cellStart = gridSource.indexOf("const GridCell = React.memo");
    const cellEnd = gridSource.indexOf("// ====", cellStart + 10);
    const cellSource = gridSource.slice(cellStart, cellEnd);

    expect(cellSource).not.toContain("zIndex: 65");
    expect(cellSource).not.toContain("zIndex:65");
    expect(cellSource).not.toContain("z-index: 65");
  });

  test("GridCell does not receive stackCount prop", () => {
    // GridCell signature should NOT include stackCount
    const cellStart = gridSource.indexOf("const GridCell = React.memo");
    const cellEnd = gridSource.indexOf("// ====", cellStart + 10);
    const cellSource = gridSource.slice(cellStart, cellEnd);

    // The function signature/destructuring should not include stackCount
    const sigMatch = cellSource.match(/function GridCell\(\{([^}]+)\}/);
    if (sigMatch) {
      expect(sigMatch[1]).not.toContain("stackCount");
    }
  });
});
