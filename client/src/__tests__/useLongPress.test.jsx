import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useLongPress } from "../hooks/useLongPress";

function touch(x, y) {
  return { touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] };
}

// Touch long-press → context menu is DISABLED (user 2026-07-17: "hide right
// click menu on touch"). The hook returns NO touch handlers and never fires.
describe("useLongPress (disabled on touch)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns no touch handlers (menu never opens on touch)", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb, { delayMs: 450 }));
    expect(result.current.onTouchStart).toBeUndefined();
    expect(result.current).toEqual({});
  });

  it("never fires the callback even after a long hold", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb, { delayMs: 450 }));
    // No onTouchStart to call; even advancing time can't trigger it.
    act(() => result.current.onTouchStart?.(touch(100, 200)));
    act(() => vi.advanceTimersByTime(1000));
    expect(cb).not.toHaveBeenCalled();
  });
});
