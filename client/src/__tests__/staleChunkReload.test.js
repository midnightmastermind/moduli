// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { shouldReloadForStaleChunk, installStaleChunkReload } from "../helpers/staleChunkReload";

function fakeWin(stored) {
  const listeners = {};
  const store = new Map(stored ? [["moduli-stale-chunk-reload", stored]] : []);
  return {
    listeners,
    reload: vi.fn(),
    addEventListener: (t, fn) => { listeners[t] = fn; },
    sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    get location() { return { reload: this.reload }; },
  };
}

describe("stale chunk reload", () => {
  it("reloads when no reload happened recently", () => {
    expect(shouldReloadForStaleChunk(null, 1e12)).toBe(true);
    expect(shouldReloadForStaleChunk(String(1e12 - 120_000), 1e12)).toBe(true);
  });
  it("does not reload twice within a minute (no loop)", () => {
    expect(shouldReloadForStaleChunk(String(1e12 - 5_000), 1e12)).toBe(false);
  });
  it("a failed chunk import reloads the page and suppresses the error", () => {
    const w = fakeWin();
    installStaleChunkReload(w);
    const ev = { preventDefault: vi.fn() };
    w.listeners["vite:preloadError"](ev);
    expect(w.reload).toHaveBeenCalledTimes(1);
    expect(ev.preventDefault).toHaveBeenCalled();
  });
  it("a second failure right after a reload lets the error through", () => {
    const w = fakeWin(String(Date.now()));
    installStaleChunkReload(w);
    const ev = { preventDefault: vi.fn() };
    w.listeners["vite:preloadError"](ev);
    expect(w.reload).not.toHaveBeenCalled();
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });
});
