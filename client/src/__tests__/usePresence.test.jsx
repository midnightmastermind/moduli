// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import { usePresence } from "../hooks/usePresence";
import SlideDrawer from "../ui/SlideDrawer";

function Probe({ open, log }) {
  const p = usePresence(open, 200);
  log.push(p);
  return null;
}

afterEach(() => vi.useRealTimers());

describe("usePresence", () => {
  it("never mounts something that was never open", () => {
    vi.useFakeTimers();
    const log = [];
    render(<Probe open={false} log={log} />);
    act(() => { vi.advanceTimersByTime(300); });
    expect(log.every((p) => !p.mounted)).toBe(true);
  });

  it("keeps a closed thing mounted, closing, for its duration — with no unmounted frame between", () => {
    vi.useFakeTimers();
    const log = [];
    const { rerender } = render(<Probe open={true} log={log} />);
    log.length = 0;
    rerender(<Probe open={false} log={log} />);
    // What COMMITS after the close is still mounted and closing (the DOM half of
    // "no unmounted frame" is the SlideDrawer test below).
    expect(log.at(-1)).toEqual({ mounted: true, closing: true });
    act(() => { vi.advanceTimersByTime(250); });
    expect(log.at(-1)).toEqual({ mounted: false, closing: false });
  });

  it("re-opening while closing is open again, not closing", () => {
    vi.useFakeTimers();
    const log = [];
    const { rerender } = render(<Probe open={true} log={log} />);
    rerender(<Probe open={false} log={log} />);
    rerender(<Probe open={true} log={log} />);
    expect(log.at(-1)).toEqual({ mounted: true, closing: false });
  });
});

describe("SlideDrawer", () => {
  it("renders nothing closed, the box with an opening class when opened, a closing class when closed", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<SlideDrawer open={false} className="instance-doc-body">x</SlideDrawer>);
    expect(container.firstChild).toBeNull();
    rerender(<SlideDrawer open={true} className="instance-doc-body">x</SlideDrawer>);
    expect(container.firstChild.className).toBe("instance-doc-body slide-y-in");
    rerender(<SlideDrawer open={false} className="instance-doc-body">x</SlideDrawer>);
    expect(container.firstChild.className).toBe("instance-doc-body slide-y-out");
    act(() => { vi.advanceTimersByTime(250); });
    expect(container.firstChild).toBeNull();
  });

  it("drops the opening class once its animation ends (it carries overflow:hidden)", () => {
    const { container } = render(<SlideDrawer open={true} className="b">x</SlideDrawer>);
    // React listens for webkitAnimationEnd under jsdom (no AnimationEvent there); send both.
    fireEvent.animationEnd(container.firstChild);
    fireEvent(container.firstChild, new Event("webkitAnimationEnd", { bubbles: true }));
    expect(container.firstChild.className).toBe("b");
  });
});
