import { describe, it, expect } from "vitest";
import { isSecondTap } from "../hooks/useDoubleTap";

describe("a double tap a controller can hit", () => {
  const first = { x: 100, y: 100, t: 1000 };
  it("counts a second tap a little off the first, soon after", () => {
    expect(isSecondTap(first, 118, 92, 1350)).toBe(true);
  });
  it("not when it lands far away, too late, or there was no first", () => {
    expect(isSecondTap(first, 160, 100, 1200)).toBe(false);
    expect(isSecondTap(first, 100, 100, 1700)).toBe(false);
    expect(isSecondTap(null, 100, 100, 1100)).toBe(false);
  });
});
