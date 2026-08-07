import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { afterPaint } from "../helpers/afterPaint";

describe("afterPaint", () => {
  let rafs;
  beforeEach(() => {
    rafs = [];
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb) => { rafs.push(cb); return rafs.length; });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("does not run the work in the current task", () => {
    const fn = vi.fn();
    afterPaint(fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not run it in the animation frame either — that is still before the paint", () => {
    const fn = vi.fn();
    afterPaint(fn);
    rafs.forEach((cb) => cb(0));
    // A rAF callback runs BEFORE that frame's paint. Running the work here
    // would put it in the very frame that was supposed to paint, which is the
    // whole bug this helper exists to avoid.
    expect(fn).not.toHaveBeenCalled();
  });

  it("runs it in a task after the frame", () => {
    const fn = vi.fn();
    afterPaint(fn);
    rafs.forEach((cb) => cb(0));
    vi.advanceTimersByTime(0);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("can be cancelled before it runs", () => {
    const fn = vi.fn();
    const cancel = afterPaint(fn);
    cancel();
    rafs.forEach((cb) => cb(0));
    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();
  });

  it("falls back to a timer where there is no rAF (jsdom, a background tab)", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    const fn = vi.fn();
    afterPaint(fn);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
