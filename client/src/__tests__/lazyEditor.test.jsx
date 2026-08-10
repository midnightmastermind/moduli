// The lazy seam. `forceLiveNow` is the load-bearing part: cross-block caret
// navigation focuses a NEIGHBOUR's inner .ProseMirror, so the neighbour has to be
// made live synchronously before the focus call, or the caret silently goes
// nowhere (see __tests__/textblockCaretNav.test.jsx).
import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useLazyEditor, forceLiveNow, LAZY_PLACEHOLDER_CLASS } from "../helpers/lazyEditor.js";

let observers;
beforeEach(() => {
  observers = [];
  class IO {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe(el) { this.el = el; }
    disconnect() { this.disconnected = true; }
    fire() { this.cb([{ isIntersecting: true }]); }
  }
  global.IntersectionObserver = IO;
});
afterEach(() => { delete global.IntersectionObserver; });

function Probe({ eager = false, occurrenceId = "occ-1" }) {
  const { live, ref, goLive } = useLazyEditor({ eager, occurrenceId });
  return (
    <div ref={ref} data-testid="host" onPointerDown={goLive}>
      {live ? <span data-testid="live" /> : <span className={LAZY_PLACEHOLDER_CLASS} />}
    </div>
  );
}

describe("useLazyEditor", () => {
  it("starts not-live and goes live on intersection", () => {
    render(<Probe />);
    expect(screen.queryByTestId("live")).toBeNull();
    act(() => observers[0].fire());
    expect(screen.getByTestId("live")).toBeInTheDocument();
  });

  it("starts live when eager, and never creates an observer", () => {
    render(<Probe eager />);
    expect(screen.getByTestId("live")).toBeInTheDocument();
    expect(observers.length).toBe(0);
  });

  it("goes live eagerly when IntersectionObserver is unavailable", () => {
    // jsdom has none by default, and so do old engines. A placeholder that could
    // never be replaced is worse than mounting eagerly.
    delete global.IntersectionObserver;
    render(<Probe />);
    expect(screen.getByTestId("live")).toBeInTheDocument();
  });

  it("stays live once live — the observer disconnects and nothing unmounts", () => {
    render(<Probe />);
    act(() => observers[0].fire());
    expect(observers[0].disconnected).toBe(true);
    expect(screen.getByTestId("live")).toBeInTheDocument();
  });

  it("forceLiveNow makes a registered editor live synchronously", () => {
    render(<Probe occurrenceId="occ-9" />);
    expect(screen.queryByTestId("live")).toBeNull();
    let result;
    act(() => { result = forceLiveNow("occ-9"); });
    expect(result).toBe(true);
    expect(screen.getByTestId("live")).toBeInTheDocument();
  });

  it("forceLiveNow returns false for an id nobody registered", () => {
    expect(forceLiveNow("nope")).toBe(false);
  });

  it("returns false for an ALREADY-LIVE editor, so callers can branch", () => {
    render(<Probe occurrenceId="occ-7" />);
    act(() => observers[0].fire());
    expect(forceLiveNow("occ-7")).toBe(false);
  });

  it("unregisters on unmount so a stale id cannot be forced", () => {
    const { unmount } = render(<Probe occurrenceId="occ-8" />);
    unmount();
    expect(forceLiveNow("occ-8")).toBe(false);
  });
});
