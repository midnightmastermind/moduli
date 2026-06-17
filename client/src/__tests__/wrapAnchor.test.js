import { describe, it, expect } from "vitest";
import { sideFromFrac, anchorOffsetForDrop } from "../docs/wrapAnchor.js";

describe("sideFromFrac", () => {
  it("left for the left ~half, right for the right ~half (no dead middle)", () => {
    expect(sideFromFrac(0.1)).toBe("left");
    expect(sideFromFrac(0.49)).toBe("left");
    expect(sideFromFrac(0.51)).toBe("right");
    expect(sideFromFrac(0.9)).toBe("right");
  });
});

describe("anchorOffsetForDrop", () => {
  it("returns the drop Y minus the host prose top, clamped to >= 0", () => {
    expect(anchorOffsetForDrop({ dropY: 250, hostProseTop: 100 })).toBe(150);
    expect(anchorOffsetForDrop({ dropY: 80, hostProseTop: 100 })).toBe(0);
  });
  it("snaps to a provided line top when lineTops are given (nearest at-or-above)", () => {
    expect(anchorOffsetForDrop({ dropY: 133, hostProseTop: 100, lineTops: [0, 20, 40, 60] })).toBe(20);
    expect(anchorOffsetForDrop({ dropY: 158, hostProseTop: 100, lineTops: [0, 20, 40, 60] })).toBe(40);
  });
});
