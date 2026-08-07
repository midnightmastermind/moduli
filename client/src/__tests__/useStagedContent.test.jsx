import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { useStagedContent } from "../hooks/useStagedContent";
import { enableStagedMount, resetStagedMount } from "../helpers/stagedMount";

function Probe({ seen }) {
  const [ready, showSpinner] = useStagedContent("panel:x", 0);
  seen.push({ ready, showSpinner });
  return <div data-testid="probe">{ready ? "content" : showSpinner ? "spinner" : "hold"}</div>;
}

describe("useStagedContent", () => {
  beforeEach(() => { vi.useFakeTimers(); resetStagedMount(); });
  afterEach(() => { resetStagedMount(); vi.useRealTimers(); });

  it("with staging OFF the content is ready on the very first render", () => {
    const seen = [];
    render(<Probe seen={seen} />);
    expect(seen[0].ready).toBe(true);
    // The whole point: a surface that never had to wait must not render a
    // waiting state at all, not even for one frame.
    expect(seen.every((s) => s.showSpinner === false)).toBe(true);
  });

  it("NEVER flashes a spinner for a wait shorter than the delay", () => {
    enableStagedMount();
    const seen = [];
    render(<Probe seen={seen} />);
    expect(seen[0].ready).toBe(false);
    // Released at 100ms — before the 150ms spinner delay.
    act(() => { vi.advanceTimersByTime(100); resetSpy(); });
    function resetSpy() {}
    act(() => { vi.advanceTimersByTime(0); });
    // Nothing has shown a spinner yet…
    expect(seen.some((s) => s.showSpinner)).toBe(false);
  });

  it("shows the loader once the wait passes the delay", () => {
    enableStagedMount();
    // No rAF → the scheduler's fallback timer drives it, and we simply never
    // advance far enough to release, so the surface stays waiting.
    vi.stubGlobal("requestAnimationFrame", () => 0);
    const seen = [];
    render(<Probe seen={seen} />);
    act(() => { vi.advanceTimersByTime(149); });
    expect(seen[seen.length - 1].showSpinner).toBe(false);
    act(() => { vi.advanceTimersByTime(2); });
    expect(seen[seen.length - 1].showSpinner).toBe(true);
    vi.unstubAllGlobals();
  });
});
