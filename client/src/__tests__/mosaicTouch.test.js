// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { setMosaicTouchHandler, mosaicTouchHover, mosaicTouchDrop, nearestEdge } from "../helpers/mosaicTouch";
import { touchDropStep } from "../helpers/dragSystem";

const panel = { type: "panel", data: { _occurrenceId: "p1" } };

describe("a panel dragged by touch reaches the mosaic", () => {
  it("names the nearest edge of the pane", () => {
    const r = { top: 0, left: 0, right: 200, bottom: 100 };
    expect(nearestEdge(r, 190, 50)).toBe("right");
    expect(nearestEdge(r, 100, 5)).toBe("top");
    expect(nearestEdge(r, 4, 60)).toBe("left");
  });
  it("only a panel drag is offered, and only while a mosaic is mounted", () => {
    const drop = vi.fn(() => true);
    expect(mosaicTouchDrop(1, 1, panel)).toBe(false);
    const off = setMosaicTouchHandler({ hover: () => true, drop, clear: () => {} });
    expect(mosaicTouchDrop(1, 1, { type: "instance", data: { _occurrenceId: "i" } })).toBe(false);
    expect(mosaicTouchHover(1, 1, panel)).toBe(true);
    expect(mosaicTouchDrop(3, 4, panel)).toBe(true);
    expect(drop).toHaveBeenCalledWith(3, 4, "p1");
    off();
    expect(mosaicTouchDrop(1, 1, panel)).toBe(false);
  });
  it("the touch release drops a panel on the mosaic before any other target", () => {
    const drop = vi.fn(() => true);
    const off = setMosaicTouchHandler({ hover: () => true, drop, clear: () => {} });
    const dragCtx = { handleDrop: vi.fn(), handleDragMove: vi.fn() };
    const out = touchDropStep({ x: 10, y: 20, payload: panel, cur: null, dragCtx });
    expect(out.dropped).toBe(true);
    expect(drop).toHaveBeenCalledWith(10, 20, "p1");
    expect(dragCtx.handleDrop).not.toHaveBeenCalled();
    off();
  });
});
