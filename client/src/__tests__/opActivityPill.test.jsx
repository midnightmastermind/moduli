/**
 * The pill itself — that it is ABSENT when the grid is idle is the half worth
 * testing. A "wait" indicator that is always on screen is wallpaper, and then
 * it is not there on the load that mattered.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import React from "react";
import OpActivityPill from "../ui/OpActivityPill.jsx";
import { noteOpSweep, _resetOpActivity } from "../helpers/opActivity.js";

afterEach(() => { _resetOpActivity(); vi.useRealTimers(); document.body.innerHTML = ""; });

describe("OpActivityPill", () => {
  it("renders nothing while the grid is idle", () => {
    const { container } = render(<OpActivityPill />);
    expect(container.textContent).toBe("");
  });

  it("appears once a burst of sweeps is running", () => {
    vi.useFakeTimers();
    const { container } = render(<OpActivityPill />);
    act(() => { noteOpSweep(800); });
    expect(container.textContent).toContain("Operations running");
  });

  it("disappears again when the sweeps stop", () => {
    vi.useFakeTimers();
    const { container } = render(<OpActivityPill />);
    act(() => { noteOpSweep(800); });
    expect(container.textContent).toContain("Operations running");
    act(() => { vi.advanceTimersByTime(5000); });
    expect(container.textContent).toBe("");
  });
});
