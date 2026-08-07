import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useStagedContent } from "../hooks/useStagedContent";
import { enableStagedMount, resetStagedMount } from "../helpers/stagedMount";

function Probe({ seen }) {
  const ready = useStagedContent("panel:x", 0);
  seen.push(ready);
  return <div data-testid="probe">{ready ? "content" : "hold"}</div>;
}

describe("useStagedContent", () => {
  beforeEach(() => { vi.useFakeTimers(); resetStagedMount(); });
  afterEach(() => { resetStagedMount(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("with staging OFF the content is ready on the very first render", () => {
    const seen = [];
    render(<Probe seen={seen} />);
    // A surface that never has to wait must not render a waiting state at all,
    // not even for one commit.
    expect(seen[0]).toBe(true);
    expect(screen.getByTestId("probe").textContent).toBe("content");
  });

  it("holds until its turn, then flips once", () => {
    enableStagedMount();
    vi.stubGlobal("requestAnimationFrame", (cb) => { setTimeout(cb, 16); return 1; });
    const seen = [];
    render(<Probe seen={seen} />);
    expect(seen[0]).toBe(false);
    expect(screen.getByTestId("probe").textContent).toBe("hold");
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByTestId("probe").textContent).toBe("content");
  });

  // The regression this file exists for: the hold's loader must not depend on a
  // JS timer. The hook no longer schedules one, so a blocked main thread cannot
  // delay the loader — its 150ms delay lives in CSS (.staged-hold-spinner).
  it("schedules NO timer of its own for the loader", () => {
    enableStagedMount();
    vi.stubGlobal("requestAnimationFrame", () => 1); // never fires: stay in the hold
    const spy = vi.spyOn(globalThis, "setTimeout");
    render(<Probe seen={[]} />);
    const delays = spy.mock.calls.map((c) => c[1]);
    expect(delays).not.toContain(150);
    spy.mockRestore();
  });
});
