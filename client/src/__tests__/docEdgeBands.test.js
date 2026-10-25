// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { docEdgeBands, EDGE_INSERT_PX, EDGE_INSERT_COARSE_PX } from "../ui/Editor.jsx";

// Above / below a block vs wrapping beside it. The headset's ray needs a wider band, and the top of the first block
// is the only way to drop above everything (user, 2026-10-25).
describe("docEdgeBands", () => {
  it("a mouse keeps the 12px band (control: nothing changed off the headset)", () => {
    expect(docEdgeBands({ height: 300 })).toEqual({ top: EDGE_INSERT_PX, bottom: EDGE_INSERT_PX });
  });
  it("the headset gets the wider band", () => {
    expect(docEdgeBands({ height: 300, coarse: true })).toEqual({ top: EDGE_INSERT_COARSE_PX, bottom: EDGE_INSERT_COARSE_PX });
  });
  it("the first block's top is a third of it, so a drop above everything is easy to hit", () => {
    expect(docEdgeBands({ height: 300, first: true, coarse: true }).top).toBe(100);
    expect(docEdgeBands({ height: 300, first: true, coarse: true }).bottom).toBe(EDGE_INSERT_COARSE_PX);
  });
  it("a short block keeps a middle to wrap on", () => {
    const { top, bottom } = docEdgeBands({ height: 30, coarse: true });
    expect(top).toBe(10); expect(bottom).toBe(10);
  });
});
