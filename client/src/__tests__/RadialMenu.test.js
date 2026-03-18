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
