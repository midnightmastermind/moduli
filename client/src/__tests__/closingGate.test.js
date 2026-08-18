// The exit animation is a LIFECYCLE contract, not a visual one — jsdom cannot
// see a keyframe, but it can see whether the surface stays mounted long enough
// for one to run, and whether the close is reported exactly once.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useClosingGate, prefersReducedMotion } from "../helpers/closingGate";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const noMotionPreference = () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
};

describe("useClosingGate", () => {
  it("does NOT close immediately — the surface stays mounted for the animation", () => {
    noMotionPreference();
    const onClosed = vi.fn();
    const { result } = renderHook(() => useClosingGate(true, 200, onClosed));

    act(() => { result.current.requestClose(); });
    // This is the whole point: without the delay React unmounts first and the
    // exit keyframes never get a frame.
    expect(onClosed).not.toHaveBeenCalled();
    expect(result.current.closing).toBe(true);

    act(() => { vi.advanceTimersByTime(200); });
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("ignores repeat requests — Escape auto-repeats, and a double close pops two surfaces", () => {
    noMotionPreference();
    const onClosed = vi.fn();
    const { result } = renderHook(() => useClosingGate(true, 200, onClosed));

    act(() => {
      result.current.requestClose();
      result.current.requestClose();
      result.current.requestClose();
    });
    act(() => { vi.advanceTimersByTime(500); });
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("clears `closing` when reopened, or the surface comes back mid-exit and vanishes", () => {
    noMotionPreference();
    const onClosed = vi.fn();
    const { result, rerender } = renderHook(
      ({ open }) => useClosingGate(open, 200, onClosed),
      { initialProps: { open: true } },
    );

    act(() => { result.current.requestClose(); });
    expect(result.current.closing).toBe(true);

    // Reopen before the timer fires.
    rerender({ open: false });
    rerender({ open: true });
    expect(result.current.closing).toBe(false);

    // And the in-flight close must NOT fire afterwards.
    act(() => { vi.advanceTimersByTime(500); });
    expect(onClosed).not.toHaveBeenCalled();
  });

  it("closes instantly when the user asked for reduced motion", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const onClosed = vi.fn();
    const { result } = renderHook(() => useClosingGate(true, 200, onClosed));

    act(() => { result.current.requestClose(); });
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(result.current.closing).toBe(false);
  });

  it("never fires after unmount — a closed tab must not resurrect a dialog", () => {
    noMotionPreference();
    const onClosed = vi.fn();
    const { result, unmount } = renderHook(() => useClosingGate(true, 200, onClosed));

    act(() => { result.current.requestClose(); });
    unmount();
    act(() => { vi.advanceTimersByTime(500); });
    expect(onClosed).not.toHaveBeenCalled();
  });

  it("reads the LATEST callback, so an inline arrow does not close a stale surface", () => {
    noMotionPreference();
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ cb }) => useClosingGate(true, 200, cb),
      { initialProps: { cb: first } },
    );

    act(() => { result.current.requestClose(); });
    rerender({ cb: second });
    act(() => { vi.advanceTimersByTime(200); });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("prefersReducedMotion answers false when matchMedia is absent", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});
