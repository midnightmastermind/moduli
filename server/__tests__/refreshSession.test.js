// A signed-in socket can renew its session token (2026-10-14); an anonymous one cannot.
import { describe, it, expect, vi } from "vitest";
vi.mock("../models/User.js", () => ({ default: {} }));
const { registerAuthHandlers } = await import("../socketHandlers/auth.js");

function fakeSocket(userId) {
  const h = {}; const out = [];
  return {
    data: { userId }, userId, out,
    on(ev, fn) { h[ev] = fn; },
    emit(ev, p) { out.push([ev, p]); },
    call(ev, p) { return h[ev](p); },
  };
}

describe("refresh_session", () => {
  it("a signed-in socket gets a fresh token for its own user", () => {
    const s = fakeSocket("u1");
    const signToken = vi.fn((p) => `tok:${p.userId}`);
    registerAuthHandlers(s, { signToken });
    s.call("refresh_session");
    expect(s.out).toEqual([["session_token", { token: "tok:u1", userId: "u1" }]]);
  });

  it("an anonymous socket gets nothing", () => {
    const s = fakeSocket(null);
    const signToken = vi.fn();
    registerAuthHandlers(s, { signToken });
    s.call("refresh_session");
    expect(s.out).toEqual([]);
    expect(signToken).not.toHaveBeenCalled();
  });
});
