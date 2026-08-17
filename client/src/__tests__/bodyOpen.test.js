// WHICH instance body is open — exactly one, app-wide.
//
// A per-component boolean cannot enforce this: the row that ought to close is
// precisely the one no longer receiving events, so it can never know a sibling
// opened. Same shape as `helpers/gapHover.js claimExclusiveGap`, which solved
// the identical problem for doc insert-gaps on 2026-08-01 (9).
import { describe, it, expect, beforeEach } from "vitest";
import {
  claimBodyOpen, releaseBodyOpen, getOpenBodyId, subscribeBodyOpen,
} from "../helpers/bodyOpen.js";

beforeEach(() => { releaseBodyOpen(getOpenBodyId()); });

describe("bodyOpen — one open body, app-wide", () => {
  it("claiming publishes the id", () => {
    claimBodyOpen("occ-a");
    expect(getOpenBodyId()).toBe("occ-a");
  });

  it("a second claim REPLACES the first (that is the whole point)", () => {
    claimBodyOpen("occ-a");
    claimBodyOpen("occ-b");
    expect(getOpenBodyId()).toBe("occ-b");
  });

  it("notifies subscribers on every change", () => {
    const seen = [];
    const off = subscribeBodyOpen((id) => seen.push(id));
    claimBodyOpen("occ-a");
    claimBodyOpen("occ-b");
    releaseBodyOpen("occ-b");
    off();
    claimBodyOpen("occ-c");            // after unsubscribe — must not be seen
    expect(seen).toEqual(["occ-a", "occ-b", null]);
  });

  it("release is IGNORED when another body already holds the claim", () => {
    // Row A unmounts AFTER row B opened. Without this guard A's cleanup would
    // close B — a body closed by someone else's unmount.
    claimBodyOpen("occ-a");
    claimBodyOpen("occ-b");
    releaseBodyOpen("occ-a");
    expect(getOpenBodyId()).toBe("occ-b");
  });

  it("re-claiming the same id does not re-notify", () => {
    claimBodyOpen("occ-a");
    const seen = [];
    const off = subscribeBodyOpen((id) => seen.push(id));
    claimBodyOpen("occ-a");
    off();
    expect(seen).toEqual([]);
  });

  it("a throwing subscriber does not stop the others", () => {
    // One bad row must not leave every other row stuck open.
    const seen = [];
    const offBad = subscribeBodyOpen(() => { throw new Error("boom"); });
    const offGood = subscribeBodyOpen((id) => seen.push(id));
    claimBodyOpen("occ-a");
    offBad(); offGood();
    expect(seen).toEqual(["occ-a"]);
  });
});

// ── useBodyOpen: the React binding ─────────────────────────────────────────
// These are the Task-2 exclusivity cases. They test the HOOK rather than
// `ModuleInstance` because that file is 1300 lines and mounting it needs the
// whole grid store — the plan named this fallback explicitly so the cases
// could not be quietly dropped. What is NOT covered here is the button's DOM
// (a browser probe covers that); what IS covered is the behaviour that made
// this feature necessary: a row closing when a SIBLING opens.
import { renderHook, act } from "@testing-library/react";
import { useBodyOpen } from "../helpers/bodyOpen.js";

describe("useBodyOpen", () => {
  it("opening B closes A", () => {
    const a = renderHook(() => useBodyOpen("occ-a"));
    const b = renderHook(() => useBodyOpen("occ-b"));

    act(() => { a.result.current[1](); });          // toggle A open
    expect(a.result.current[0]).toBe(true);
    expect(b.result.current[0]).toBe(false);

    act(() => { b.result.current[1](); });          // toggle B open
    expect(b.result.current[0]).toBe(true);
    expect(a.result.current[0]).toBe(false);        // A closed without an event
  });

  it("toggling the open one closes it", () => {
    const a = renderHook(() => useBodyOpen("occ-a"));
    act(() => { a.result.current[1](); });
    expect(a.result.current[0]).toBe(true);
    act(() => { a.result.current[1](); });
    expect(a.result.current[0]).toBe(false);
    expect(getOpenBodyId()).toBe(null);
  });

  it("unmounting a row with an open body releases the claim", () => {
    const a = renderHook(() => useBodyOpen("occ-a"));
    act(() => { a.result.current[1](); });
    expect(getOpenBodyId()).toBe("occ-a");
    a.unmount();
    expect(getOpenBodyId()).toBe(null);
  });

  it("unmounting a CLOSED row does not close the open one", () => {
    // React commits the new row before running the old row's cleanup, so this
    // ordering is the normal case, not a corner.
    const a = renderHook(() => useBodyOpen("occ-a"));
    const b = renderHook(() => useBodyOpen("occ-b"));
    act(() => { b.result.current[1](); });
    a.unmount();
    expect(getOpenBodyId()).toBe("occ-b");
  });

  it("an occurrence with no id never opens", () => {
    const n = renderHook(() => useBodyOpen(undefined));
    act(() => { n.result.current[1](); });
    expect(n.result.current[0]).toBe(false);
    expect(getOpenBodyId()).toBe(null);
  });
});
