import { describe, it, expect, vi } from "vitest";
import { bindFullStateRequest } from "../helpers/fullStateRequest";

// A socket stub that records emits and lets a test drive connect/disconnect.
function makeSocket({ connected = true } = {}) {
  const handlers = {};
  return {
    connected,
    emits: [],
    emit(ev, data) { this.emits.push([ev, data]); },
    on(ev, fn) { (handlers[ev] ||= []).push(fn); },
    off(ev, fn) { handlers[ev] = (handlers[ev] || []).filter(f => f !== fn); },
    fire(ev) { for (const fn of [...(handlers[ev] || [])]) fn(); },
    listenerCount(ev) { return (handlers[ev] || []).length; },
  };
}
const reqs = (s) => s.emits.filter(([ev]) => ev === "request_full_state");

describe("bindFullStateRequest", () => {
  // THE CONTROL. Every assertion below about a SECOND request is meaningless
  // unless a first one demonstrably happens.
  it("asks once when the socket is already connected at bind time", () => {
    const s = makeSocket({ connected: true });
    bindFullStateRequest(s, () => "grid-1");
    expect(reqs(s)).toHaveLength(1);
    expect(reqs(s)[0][1]).toEqual({ gridId: "grid-1" });
  });

  it("asks when a not-yet-connected socket connects", () => {
    const s = makeSocket({ connected: false });
    bindFullStateRequest(s, () => "grid-1");
    expect(reqs(s)).toHaveLength(0);
    s.fire("connect");
    expect(reqs(s)).toHaveLength(1);
  });

  // THE REGRESSION. This is the whole point: the old code latched per mount
  // (`didRequest` + `socket.once`), so a reconnect asked for nothing and a
  // truncated build was never topped up.
  it("asks AGAIN after a disconnect/reconnect", () => {
    const s = makeSocket({ connected: true });
    bindFullStateRequest(s, () => "grid-1");
    expect(reqs(s)).toHaveLength(1);
    s.fire("disconnect");
    s.fire("connect");
    expect(reqs(s)).toHaveLength(2);
    s.fire("disconnect");
    s.fire("connect");
    expect(reqs(s)).toHaveLength(3);
  });

  // The latch still has a job: an already-connected socket must not ask twice
  // when the `connect` event also fires.
  it("does not ask twice within one connection", () => {
    const s = makeSocket({ connected: true });
    bindFullStateRequest(s, () => "grid-1");
    s.fire("connect");
    s.fire("connect");
    expect(reqs(s)).toHaveLength(1);
  });

  it("omits the payload entirely when no grid is saved", () => {
    const s = makeSocket({ connected: true });
    bindFullStateRequest(s, () => null);
    expect(reqs(s)[0][1]).toBeUndefined();
  });

  it("unbinds both listeners so a remount cannot double-request", () => {
    const s = makeSocket({ connected: true });
    const off = bindFullStateRequest(s, () => "grid-1");
    off();
    expect(s.listenerCount("connect")).toBe(0);
    expect(s.listenerCount("disconnect")).toBe(0);
    s.fire("connect");
    expect(reqs(s)).toHaveLength(1);
  });
});
