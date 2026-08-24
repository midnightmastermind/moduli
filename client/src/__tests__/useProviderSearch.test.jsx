// The remote half of a merged dropdown: debounced, abortable, and explicit about
// the difference between "searching" and "nothing found".
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useProviderSearch, SEARCH_DEBOUNCE_MS } from "../hooks/useProviderSearch";

const ok = (results) => ({ ok: true, json: async () => ({ ok: true, results }) });

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

const tick = async () => { await act(async () => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 20); }); };

describe("useProviderSearch", () => {
  it("stays DORMANT with no provider or no query — no request at all", async () => {
    const fetchImpl = vi.fn();
    const { result } = renderHook(() => useProviderSearch({ provider: null, query: "x", fetchImpl }));
    await tick();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.current.state).toBe("idle");

    renderHook(() => useProviderSearch({ provider: "wikipedia", query: "   ", fetchImpl }));
    await tick();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("DEBOUNCES — typing does not fire a request per keystroke", async () => {
    // TIME MUST PASS BETWEEN KEYSTROKES or this proves nothing. The first
    // version rerendered in a tight loop, so every cleanup ran before any timer
    // fired and a ZERO delay passed it just as happily — it was testing the
    // effect cleanup, not the debounce.
    const fetchImpl = vi.fn(async () => ok([]));
    const { rerender } = renderHook(({ q }) => useProviderSearch({ provider: "p", query: q, fetchImpl }),
                                    { initialProps: { q: "i" } });
    for (const q of ["in", "inc", "ince"]) {
      await act(async () => { vi.advanceTimersByTime(Math.floor(SEARCH_DEBOUNCE_MS / 3)); });
      rerender({ q });
    }
    await tick();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toContain("q=ince");
  });

  it("reports SEARCHING before it reports empty", async () => {
    // An empty list mid-flight must never be rendered as "nothing found".
    const fetchImpl = vi.fn(async () => ok([]));
    const { result } = renderHook(() => useProviderSearch({ provider: "p", query: "x", fetchImpl }));
    expect(result.current.state).toBe("searching");
    await tick();
    await waitFor(() => expect(result.current.state).toBe("done"));
  });

  it("passes the keys the grid already holds, so the server can merge", async () => {
    const fetchImpl = vi.fn(async () => ok([]));
    renderHook(() => useProviderSearch({ provider: "p", query: "x", haveKeys: ["p:1", "p:2"], fetchImpl }));
    await tick();
    expect(decodeURIComponent(fetchImpl.mock.calls[0][0])).toContain("have=p:1,p:2");
  });

  it("reports a failed response as ERROR, not as no results", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false }));
    const { result } = renderHook(() => useProviderSearch({ provider: "p", query: "x", fetchImpl }));
    await tick();
    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.results).toEqual([]);
  });

  it("swallows our OWN abort rather than calling it an error", async () => {
    const fetchImpl = vi.fn(async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; });
    const { result } = renderHook(() => useProviderSearch({ provider: "p", query: "x", fetchImpl }));
    await tick();
    expect(result.current.state).toBe("searching");   // never flips to error
  });

  it("clears results when the query is emptied", async () => {
    const fetchImpl = vi.fn(async () => ok([{ provider: "p", externalId: "1", title: "A" }]));
    const { result, rerender } = renderHook(({ q }) => useProviderSearch({ provider: "p", query: q, fetchImpl }),
                                            { initialProps: { q: "a" } });
    await tick();
    await waitFor(() => expect(result.current.results).toHaveLength(1));
    rerender({ q: "" });
    expect(result.current.results).toEqual([]);
    expect(result.current.state).toBe("idle");
  });
});
