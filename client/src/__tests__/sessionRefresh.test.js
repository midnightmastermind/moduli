// @vitest-environment jsdom
// A tab left open renews its stored sign-in (2026-10-14): the token lived 7 days,
// the socket checked it only on connect, and REST callers were refused once it lapsed.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { bindSessionRefresh } from "../helpers/sessionRefresh";

function fakeSocket(connected = true) {
  const handlers = {};
  return {
    connected, auth: { token: "old" }, emitted: [],
    on(ev, fn) { (handlers[ev] ||= []).push(fn); },
    off(ev, fn) { handlers[ev] = (handlers[ev] || []).filter((f) => f !== fn); },
    emit(ev, p) { this.emitted.push(ev); },
    fire(ev, p) { (handlers[ev] || []).forEach((f) => f(p)); },
  };
}

describe("bindSessionRefresh", () => {
  beforeEach(() => localStorage.clear());

  it("asks at once, on every connect, and on the timer", () => {
    const s = fakeSocket();
    let tick;
    bindSessionRefresh(s, { setTimer: (fn) => { tick = fn; return 1; }, clearTimer: () => {} });
    expect(s.emitted).toEqual(["refresh_session"]);
    s.fire("connect"); tick();
    expect(s.emitted.filter((e) => e === "refresh_session")).toHaveLength(3);
  });

  it("stores the new token and uses it for the next reconnect", () => {
    const s = fakeSocket();
    bindSessionRefresh(s, { setTimer: () => 1, clearTimer: () => {} });
    s.fire("session_token", { token: "fresh", userId: "u1" });
    expect(localStorage.getItem("moduli-token")).toBe("fresh");
    expect(s.auth.token).toBe("fresh");
  });

  it("does not ask while disconnected, and unbinds cleanly", () => {
    const s = fakeSocket(false);
    const cleared = vi.fn();
    const off = bindSessionRefresh(s, { setTimer: () => 7, clearTimer: cleared });
    expect(s.emitted).toEqual([]);
    off();
    s.fire("session_token", { token: "x" });
    expect(localStorage.getItem("moduli-token")).toBeNull();
    expect(cleared).toHaveBeenCalledWith(7);
  });
});
