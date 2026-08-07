import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  enableStagedMount,
  disableStagedMount,
  resetStagedMount,
  requestStagedMount,
  isStagedMountReleased,
} from "../helpers/stagedMount";

// The scheduler releases on a DOUBLE rAF (paint, then release), so a frame is
// two callbacks deep. This drives it deterministically.
function frames(n) {
  // rAF is stubbed away below, so the scheduler's fallback timer (16ms) IS the
  // frame. One tick per frame — advancing further would release several and
  // hide an ordering bug.
  for (let i = 0; i < n; i++) vi.advanceTimersByTime(16);
}

describe("stagedMount", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStagedMount();
    // No rAF in this environment → the scheduler falls back to setTimeout,
    // which fake timers drive. Asserted below so the fallback can't rot.
    vi.stubGlobal("requestAnimationFrame", undefined);
  });
  afterEach(() => {
    resetStagedMount();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("releases IMMEDIATELY when staging is disabled (the default)", () => {
    const notify = vi.fn();
    requestStagedMount("a", 0, notify);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(isStagedMountReleased("a")).toBe(false); // never queued, never marked
  });

  it("holds a registrant until its frame, then releases exactly once", () => {
    enableStagedMount();
    const notify = vi.fn();
    requestStagedMount("a", 0, notify);
    expect(notify).not.toHaveBeenCalled();
    frames(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(isStagedMountReleased("a")).toBe(true);
  });

  it("releases ONE per frame, lowest priority number first", () => {
    enableStagedMount();
    const order = [];
    requestStagedMount("far", 5, () => order.push("far"));
    requestStagedMount("near", 0, () => order.push("near"));
    requestStagedMount("mid", 2, () => order.push("mid"));

    frames(1);
    expect(order).toEqual(["near"]);
    frames(1);
    expect(order).toEqual(["near", "mid"]);
    frames(1);
    expect(order).toEqual(["near", "mid", "far"]);
  });

  it("a key released once never stages again (a remount must not flicker)", () => {
    enableStagedMount();
    requestStagedMount("a", 0, () => {});
    frames(1);
    const second = vi.fn();
    requestStagedMount("a", 0, second);
    expect(second).toHaveBeenCalledTimes(1); // synchronous, no wait
  });

  it("unsubscribing before the turn drops the registrant", () => {
    enableStagedMount();
    const notify = vi.fn();
    const off = requestStagedMount("a", 0, notify);
    off();
    frames(3);
    expect(notify).not.toHaveBeenCalled();
  });

  it("HARD RELEASE: everything waiting is freed if the frame pump never runs", () => {
    enableStagedMount();
    // Kill the pump entirely — the tab-backgrounded / rAF-starved case. Without
    // the deadline this content would be hidden forever, which is the one
    // failure mode a paint optimisation must not have.
    vi.stubGlobal("setTimeout", ((fn, ms) => (ms >= 4000 ? globalThis.__realSetTimeout(fn, ms) : 0)));
    resetStagedMount();
    enableStagedMount();
    vi.unstubAllGlobals();
    vi.stubGlobal("requestAnimationFrame", () => 0); // registers, never fires

    const notify = vi.fn();
    requestStagedMount("a", 0, notify);
    expect(notify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4000);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("disabling releases everything still waiting", () => {
    enableStagedMount();
    vi.stubGlobal("requestAnimationFrame", () => 0);
    const notify = vi.fn();
    requestStagedMount("a", 0, notify);
    expect(notify).not.toHaveBeenCalled();
    disableStagedMount();
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
