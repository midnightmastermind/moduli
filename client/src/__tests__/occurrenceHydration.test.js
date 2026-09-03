import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  setHydrationSink, requestHydration, flushHydration, releaseHydration,
  resetHydration, isPartial, _hydrationState,
} from "../helpers/occurrenceHydration";

describe("occurrence hydration", () => {
  beforeEach(() => { resetHydration(); setHydrationSink(null); });

  it("batches every row mounting in one commit into ONE request", () => {
    const sink = vi.fn(); setHydrationSink(sink);
    for (const id of ["a", "b", "c"]) requestHydration(id);
    expect(sink).not.toHaveBeenCalled();      // nothing sent synchronously
    flushHydration();
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0].sort()).toEqual(["a", "b", "c"]);
  });

  it("does NOT re-ask for an id whose reply is still in flight", () => {
    // The storm this prevents: a partial row re-renders while its own request
    // is outstanding, so it still looks partial and would queue itself again.
    const sink = vi.fn(); setHydrationSink(sink);
    requestHydration("a"); flushHydration();
    requestHydration("a"); flushHydration();
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it("asks again once the reply has landed — the control", () => {
    // Without this, "does not re-ask" would also be satisfied by never asking.
    const sink = vi.fn(); setHydrationSink(sink);
    requestHydration("a"); flushHydration();
    releaseHydration(["a"]);
    requestHydration("a"); flushHydration();
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it("a throwing sink leaves the id askable rather than stranded", () => {
    const sink = vi.fn(() => { throw new Error("socket gone"); });
    setHydrationSink(sink);
    requestHydration("a");
    expect(() => flushHydration()).not.toThrow();
    expect(_hydrationState().pending).toBe(0);
    const ok = vi.fn(); setHydrationSink(ok);
    requestHydration("a"); flushHydration();
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("is inert with no sink — no socket must never break a render", () => {
    expect(() => { requestHydration("a"); flushHydration(); }).not.toThrow();
  });

  it("isPartial is true ONLY for the server's marker", () => {
    expect(isPartial({ _partial: true })).toBe(true);
    for (const v of [{}, null, undefined, { _partial: false }, { _partial: "yes" }]) {
      expect(isPartial(v)).toBe(false);
    }
  });

  it("a reconnect clears everything in flight", () => {
    const sink = vi.fn(); setHydrationSink(sink);
    requestHydration("a"); flushHydration();
    resetHydration();
    requestHydration("a"); flushHydration();
    expect(sink).toHaveBeenCalledTimes(2);
  });
});
