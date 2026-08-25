// helpers/renderWindow — the bounded window that keeps a 993-row board from
// building 74,592 nodes, 7,377 ResizeObservers and 645 MB of heap in one task.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useRenderWindow, requestRenderAll, RENDER_ALL_EVENT,
  WINDOW_INITIAL, WINDOW_STEP, WINDOW_MIN,
} from "../helpers/renderWindow";

let observers = [];
beforeEach(() => {
  observers = [];
  global.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe() {} disconnect() {}
    trigger() { this.cb([{ isIntersecting: true }]); }
  };
});

describe("short lists take a byte-identical path", () => {
  it("renders EVERYTHING below the threshold, and offers no sentinel", () => {
    // ~1,300 containers on this grid hold a handful of rows. Windowing them
    // would cost a sentinel and an observer to save nothing.
    const { result } = renderHook(() => useRenderWindow(12));
    expect(result.current.count).toBe(12);
    expect(result.current.windowed).toBe(false);
    expect(result.current.hidden).toBe(0);
    expect(result.current.sentinelRef).toBeNull();
  });

  it("does not window a list exactly at the threshold", () => {
    const { result } = renderHook(() => useRenderWindow(WINDOW_MIN));
    expect(result.current.count).toBe(WINDOW_MIN);
    expect(result.current.windowed).toBe(false);
  });
});

describe("long lists are bounded, and report what they are holding back", () => {
  it("renders only the first chunk of a 993-row board", () => {
    const { result } = renderHook(() => useRenderWindow(993));
    expect(result.current.count).toBe(WINDOW_INITIAL);
    expect(result.current.windowed).toBe(true);
    expect(result.current.hidden).toBe(993 - WINDOW_INITIAL);
  });

  it("grows by a chunk when the sentinel comes into view", () => {
    const { result } = renderHook(() => useRenderWindow(993));
    act(() => { result.current.sentinelRef(document.createElement("div")); });
    act(() => { observers.forEach((o) => o.trigger()); });
    expect(result.current.count).toBe(WINDOW_INITIAL + WINDOW_STEP);
  });

  it("never grows past the real total", () => {
    const { result } = renderHook(() => useRenderWindow(WINDOW_MIN + 5));
    act(() => { result.current.sentinelRef(document.createElement("div")); });
    for (let i = 0; i < 20; i++) act(() => { observers.forEach((o) => o.trigger()); });
    expect(result.current.count).toBe(WINDOW_MIN + 5);
    expect(result.current.hidden).toBe(0);
  });
});

describe("the search escape hatch — a windowed row must never read as missing", () => {
  it("opens every window on the render-all event", () => {
    // jumpToOccurrence fires this on a miss, then retries. Without it, searching
    // for row 800 reports "filtered out", which is a lie about the data.
    const { result } = renderHook(() => useRenderWindow(993));
    expect(result.current.count).toBe(WINDOW_INITIAL);
    act(() => { requestRenderAll(); });
    expect(result.current.count).toBe(993);
    expect(result.current.hidden).toBe(0);
  });

  it("is a no-op for a list that was never windowed", () => {
    const { result } = renderHook(() => useRenderWindow(10));
    act(() => { requestRenderAll(); });
    expect(result.current.count).toBe(10);
  });

  it("unsubscribes on unmount — a stale listener would hold the whole list", () => {
    const spy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useRenderWindow(993));
    unmount();
    expect(spy).toHaveBeenCalledWith(RENDER_ALL_EVENT, expect.any(Function));
    spy.mockRestore();
  });
});

describe("a new list starts a new window", () => {
  it("resets the count when the child list changes", () => {
    // Without this, filtering a 993-row board down to 5 would leave the window
    // claiming it is showing 240 of them.
    const { result, rerender } = renderHook(
      ({ total, key }) => useRenderWindow(total, { resetKey: key }),
      { initialProps: { total: 993, key: "a" } });
    act(() => { result.current.sentinelRef(document.createElement("div")); });
    act(() => { observers.forEach((o) => o.trigger()); });
    expect(result.current.count).toBe(WINDOW_INITIAL + WINDOW_STEP);
    rerender({ total: 993, key: "b" });
    expect(result.current.count).toBe(WINDOW_INITIAL);
  });
});
