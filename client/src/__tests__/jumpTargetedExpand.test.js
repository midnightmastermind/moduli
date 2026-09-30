// The search's jump: grow only the list that holds the row, keep looking until
// it mounts, and blink when it comes into VIEW (user, 2026-09-30: "6 seconds
// is way too long" / "theres a two second pause and then it flashes. it should
// flash right when it gets in the view").
import { describe, it, expect, vi, afterEach } from "vitest";
import { countForRequest, TARGET_TAIL, RENDER_ALL_EVENT } from "../helpers/renderWindow";
import { jumpToOccurrence, scrollAndFlash } from "../helpers/jumpToOccurrence";

afterEach(() => { vi.useRealTimers(); delete globalThis.IntersectionObserver; document.body.innerHTML = ""; });

describe("countForRequest", () => {
  const ids = Array.from({ length: 994 }, (_, i) => `m${i}`);
  const indexOf = (id) => ids.indexOf(id);

  it("grows the list holding the target only as far as the target", () => {
    expect(countForRequest(80, 994, { occId: "m600" }, indexOf)).toBe(600 + 1 + TARGET_TAIL);
  });
  it("leaves a list that does not hold the target alone", () => {
    expect(countForRequest(80, 994, { occId: "elsewhere" }, indexOf)).toBe(null);
  });
  it("never shrinks a window already past the target", () => {
    expect(countForRequest(800, 994, { occId: "m10" }, indexOf)).toBe(800);
  });
  // The control: an untargeted request still opens everything (the fallback).
  it("an untargeted request opens the whole list", () => {
    expect(countForRequest(80, 994, null, indexOf)).toBe(994);
  });
});

describe("the jump's expansion", () => {
  it("asks for the target first, and widens to every window only if that did not produce it", () => {
    vi.useFakeTimers();
    const heard = [];
    const on = (e) => heard.push(e.detail?.occId ?? null);
    window.addEventListener(RENDER_ALL_EVENT, on);
    jumpToOccurrence("deep", { retryMs: 50, onMissing: () => {} });
    expect(heard).toEqual(["deep"]);
    vi.advanceTimersByTime(1500);
    expect(heard).toEqual(["deep", null]);
    window.removeEventListener(RENDER_ALL_EVENT, on);
  });

  it("finds a row that takes seconds to mount (not a fixed poll count)", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="page"></div>`;
    const onMissing = vi.fn();
    setTimeout(() => {
      const el = document.createElement("div");
      el.setAttribute("data-occ-id", "slow");
      el.scrollIntoView = vi.fn();
      document.querySelector("#page").appendChild(el);
    }, 6000);
    jumpToOccurrence("slow", { root: () => document.querySelector("#page"), onMissing });
    vi.advanceTimersByTime(6500);
    expect(document.querySelector('[data-occ-id="slow"]').scrollIntoView).toHaveBeenCalled();
    expect(onMissing).not.toHaveBeenCalled();
  });
});

describe("the blink waits for the element to be in view", () => {
  function fakeIO() {
    const inst = [];
    globalThis.IntersectionObserver = class {
      constructor(cb) { this.cb = cb; inst.push(this); }
      observe(el) { this.el = el; }
      disconnect() { this.off = true; }
      enter() { if (!this.off) this.cb([{ isIntersecting: true, target: this.el }]); }
    };
    return inst;
  }

  it("does not blink during the scroll, blinks on entering view", () => {
    vi.useFakeTimers();
    const io = fakeIO();
    const el = document.createElement("div");
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);
    scrollAndFlash(el);
    expect(el.classList.contains("anchor-highlight")).toBe(false);   // still scrolling in
    io[0].enter();
    expect(el.classList.contains("anchor-highlight")).toBe(true);
  });

  it("blinks where it is if it never comes into view by the end of the settle", () => {
    vi.useFakeTimers();
    fakeIO();
    const el = document.createElement("div");
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);
    scrollAndFlash(el);
    vi.advanceTimersByTime(250 * 13);
    expect(el.classList.contains("anchor-highlight")).toBe(true);
  });
});
