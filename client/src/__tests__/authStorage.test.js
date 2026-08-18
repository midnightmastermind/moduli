import { describe, it, expect, beforeEach, vi } from "vitest";
import { persistAuth, clearAuth, readToken, hasSession, AUTH_KEYS } from "../helpers/authStorage.js";

beforeEach(() => localStorage.clear());

describe("authStorage", () => {
  it("persists token and userId", () => {
    persistAuth({ token: "t1", userId: "u1" });
    expect(localStorage.getItem(AUTH_KEYS.token)).toBe("t1");
    expect(localStorage.getItem(AUTH_KEYS.userId)).toBe("u1");
  });

  // A login response carrying only a token must still leave a usable session.
  it("writes each member independently", () => {
    persistAuth({ token: "t1" });
    expect(readToken()).toBe("t1");
    expect(localStorage.getItem(AUTH_KEYS.userId)).toBeNull();
  });

  it("ignores an empty payload rather than writing nulls", () => {
    persistAuth({});
    expect(readToken()).toBeNull();
    expect(localStorage.getItem(AUTH_KEYS.token)).toBeNull();
  });

  it("is safe with no argument", () => {
    expect(() => persistAuth()).not.toThrow();
    expect(readToken()).toBeNull();
  });

  // clearAuth must take gridId too: a stale gridId outlives the user it
  // belonged to and makes the next login request someone else's grid.
  it("clears every auth key including gridId", () => {
    persistAuth({ token: "t1", userId: "u1" });
    localStorage.setItem(AUTH_KEYS.gridId, "g1");
    clearAuth();
    expect(readToken()).toBeNull();
    expect(localStorage.getItem(AUTH_KEYS.userId)).toBeNull();
    expect(localStorage.getItem(AUTH_KEYS.gridId)).toBeNull();
  });

  it("hasSession reflects the token only", () => {
    expect(hasSession()).toBe(false);
    persistAuth({ token: "t1" });
    expect(hasSession()).toBe(true);
  });

  // The promo entry split reads this before React mounts. If localStorage
  // throws (Safari private mode, disabled storage), the visitor must get the
  // landing page rather than a white screen.
  it("hasSession returns false when localStorage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(hasSession()).toBe(false);
    spy.mockRestore();
  });
});
