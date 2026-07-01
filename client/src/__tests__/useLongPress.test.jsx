import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useLongPress } from "../hooks/useLongPress";

function touch(x, y) {
  return { touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] };
}

describe("useLongPress", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires after the hold delay with the touch position", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb, { delayMs: 450 }));
    act(() => result.current.onTouchStart(touch(100, 200)));
    act(() => vi.advanceTimersByTime(450));
    expect(cb).toHaveBeenCalledWith({ x: 100, y: 200 });
  });

  it("cancels when the finger moves beyond tolerance", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb, { delayMs: 450, moveTolerance: 10 }));
    act(() => result.current.onTouchStart(touch(100, 200)));
    act(() => result.current.onTouchMove(touch(100, 230))); // moved 30px
    act(() => vi.advanceTimersByTime(450));
    expect(cb).not.toHaveBeenCalled();
  });

  it("cancels when the finger lifts before the delay", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb, { delayMs: 450 }));
    act(() => result.current.onTouchStart(touch(0, 0)));
    act(() => result.current.onTouchEnd(touch(0, 0)));
    act(() => vi.advanceTimersByTime(450));
    expect(cb).not.toHaveBeenCalled();
  });
});
