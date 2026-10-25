// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { headsetMenuGuard } from "../helpers/dragSystem.js";

// In the headset a held trigger is a long press: the window's browser fired `contextmenu` half a second into every
// drag, the app's menu opened and the press was cancelled. While a handle press is down the menu is swallowed.
const fire = () => {
  const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  const seen = vi.fn();
  document.body.addEventListener("contextmenu", seen);
  document.body.dispatchEvent(ev);
  document.body.removeEventListener("contextmenu", seen);
  return { prevented: ev.defaultPrevented, reachedApp: seen.mock.calls.length > 0 };
};

describe("headset long-press menu guard", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("swallows the menu while a handle press is down", () => {
    headsetMenuGuard(true);
    expect(fire()).toEqual({ prevented: true, reachedApp: false });
    headsetMenuGuard(false);
  });

  it("still swallows one arriving just behind the release", () => {
    headsetMenuGuard(true);
    headsetMenuGuard(false);
    expect(fire().reachedApp).toBe(false);
  });

  it("lets the menu through once the press is long over (control)", () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    headsetMenuGuard(true);
    headsetMenuGuard(false);
    vi.advanceTimersByTime(1000);
    expect(fire()).toEqual({ prevented: false, reachedApp: true });
  });
});
