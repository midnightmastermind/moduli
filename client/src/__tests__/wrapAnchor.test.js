import { describe, it, expect } from "vitest";
import { sideFromFrac, anchorOffsetForDrop, hasMidAnchor, classifyWrapShape } from "../docs/wrapAnchor.js";

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

describe("hasMidAnchor", () => {
  it("top anchor: no offset, no index", () => {
    expect(hasMidAnchor({ anchorIndex: 0, anchorOffset: null })).toBe(false);
    expect(hasMidAnchor({ anchorIndex: null, anchorOffset: 0 })).toBe(false);
  });
  it("line-level offset wins (anchorIndex null — the post-2026-06-17 shape)", () => {
    expect(hasMidAnchor({ anchorIndex: null, anchorOffset: 120 })).toBe(true);
  });
  it("anchorOffset 0 with a legacy anchorIndex set: offset is authoritative", () => {
    expect(hasMidAnchor({ anchorIndex: 2, anchorOffset: 0 })).toBe(false);
  });
  it("legacy nodes: anchorIndex > 0, no offset", () => {
    expect(hasMidAnchor({ anchorIndex: 2, anchorOffset: null })).toBe(true);
  });
});

describe("classifyWrapShape", () => {
  const geo = { neighborBottom: 400, hostBottom: 900 };
  it("top: anchored at the very top", () => {
    expect(classifyWrapShape({ anchorIndex: 0, anchorOffset: null, ...geo })).toBe("top");
  });
  it("middle: line-level offset with prose below the neighbor", () => {
    expect(classifyWrapShape({ anchorIndex: null, anchorOffset: 150, ...geo })).toBe("middle");
  });
  it("bottom: mid-anchored neighbor reaching the host bottom (within threshold)", () => {
    expect(classifyWrapShape({ anchorIndex: null, anchorOffset: 150, neighborBottom: 890, hostBottom: 900 })).toBe("bottom");
  });
});
