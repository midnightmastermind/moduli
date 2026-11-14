// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { afterPaint, canPaintSoon } from "../helpers/afterPaint.js";

const setHidden = (v) => Object.defineProperty(document, "hidden", { configurable: true, get: () => v });

describe("afterPaint in a hidden tab", () => {
  afterEach(() => { vi.useRealTimers(); setHidden(false); });
  it("runs on a timer, because a hidden tab never fires requestAnimationFrame", () => {
    vi.useFakeTimers();
    const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1); // never calls back
    setHidden(true);
    expect(canPaintSoon()).toBe(false);
    const fn = vi.fn();
    afterPaint(fn, 50);
    vi.advanceTimersByTime(60);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(raf).not.toHaveBeenCalled();
    raf.mockRestore();
  });
  it("still waits for the paint when the tab is visible", () => {
    vi.useFakeTimers();
    const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1);
    setHidden(false);
    const fn = vi.fn();
    afterPaint(fn, 50);
    vi.advanceTimersByTime(200);
    expect(raf).toHaveBeenCalledTimes(1);
    expect(fn).not.toHaveBeenCalled(); // waiting on the frame
    raf.mockRestore();
  });
});
