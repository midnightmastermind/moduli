/**
 * RadialMenu.test.js
 *
 * Tests the calcOpenDirection logic to ensure the arc menu never opens off-screen.
 * Using viewport 1200x800, spread=58 (sm size: radius 34 + 24).
 */
import { describe, test, expect } from "vitest";
import { calcOpenDirection } from "../ui/RadialMenu";

const VW = 1200;
const VH = 800;
const SPREAD = 58;

describe("calcOpenDirection", () => {
  test("handle in left column (near left edge) → opens right", () => {
    // Panel column 1 handle: x≈16px
    expect(calcOpenDirection(16, 300, VW, VH, SPREAD)).toBe("right");
  });

  test("handle in left half of viewport → opens right", () => {
    expect(calcOpenDirection(400, 300, VW, VH, SPREAD)).toBe("right");
  });

  test("handle in right half of viewport → opens left", () => {
    expect(calcOpenDirection(800, 300, VW, VH, SPREAD)).toBe("left");
  });

  test("handle near right edge → opens left", () => {
    expect(calcOpenDirection(1180, 300, VW, VH, SPREAD)).toBe("left");
  });

  test("handle near bottom edge → opens up", () => {
    expect(calcOpenDirection(600, 760, VW, VH, SPREAD)).toBe("up");
  });

  test("handle near top edge → opens down", () => {
    expect(calcOpenDirection(600, 20, VW, VH, SPREAD)).toBe("down");
  });

  test("bottom edge check takes priority over horizontal split", () => {
    // Near bottom-left: bottomEdge < spread → up (not right)
    expect(calcOpenDirection(200, 760, VW, VH, SPREAD)).toBe("up");
  });

  test("top edge check takes priority over horizontal split", () => {
    // Near top-right: topEdge < spread → down (not left)
    expect(calcOpenDirection(900, 20, VW, VH, SPREAD)).toBe("down");
  });

  test("exact viewport center goes right (left-half boundary)", () => {
    // centerX = VW/2 - 1 → left half → right
    expect(calcOpenDirection(VW / 2 - 1, 300, VW, VH, SPREAD)).toBe("right");
    // centerX = VW/2 + 1 → right half → left
    expect(calcOpenDirection(VW / 2 + 1, 300, VW, VH, SPREAD)).toBe("left");
  });
});

// =============================================================
// Arc item viewport clamping tests
// =============================================================
describe("arc item viewport clamping", () => {
  // Simulates the clamping logic from RadialMenu.jsx
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

  const RADIUS = 34;
  const MOBILE_VW = 375;
  const MOBILE_VH = 667;

  test("arc items near left edge (anchor x=30) stay within viewport", () => {
    // Anchor near left edge, arc opens right (0 degrees) — items at 315, 0, 45 degrees
    const angles = [315, 0, 45];
    for (const angle of angles) {
      const { finalX, finalY } = clampArcItem(30, 300, angle, RADIUS, MOBILE_VW, MOBILE_VH);
      expect(finalX).toBeGreaterThanOrEqual(14);
      expect(finalX).toBeLessThanOrEqual(MOBILE_VW - 14);
      expect(finalY).toBeGreaterThanOrEqual(14);
      expect(finalY).toBeLessThanOrEqual(MOBILE_VH - 14);
    }
  });

  test("arc items near bottom-right corner stay within viewport", () => {
    // Anchor near bottom-right corner
    const anchorX = MOBILE_VW - 20;
    const anchorY = MOBILE_VH - 20;
    // Arc opens up (270 degrees) — items at 225, 270, 315 degrees
    const angles = [225, 270, 315];
    for (const angle of angles) {
      const { finalX, finalY } = clampArcItem(anchorX, anchorY, angle, RADIUS, MOBILE_VW, MOBILE_VH);
      expect(finalX).toBeGreaterThanOrEqual(14);
      expect(finalX).toBeLessThanOrEqual(MOBILE_VW - 14);
      expect(finalY).toBeGreaterThanOrEqual(14);
      expect(finalY).toBeLessThanOrEqual(MOBILE_VH - 14);
    }
  });

  test("8 items don't wrap beyond 180 degrees", () => {
    // With 8 items, spread = min(45, 180/7) ≈ 25.7 degrees
    const count = 8;
    const spread = Math.min(45, 180 / Math.max(count - 1, 1));
    const totalArc = spread * (count - 1);
    expect(totalArc).toBeLessThanOrEqual(180);
    // Each item's spread should be ~25.7 degrees
    expect(spread).toBeCloseTo(180 / 7, 1);
  });
});
