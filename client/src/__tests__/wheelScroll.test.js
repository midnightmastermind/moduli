import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isPreciseScroll,
  wheelDeltaPx,
  scaledWheelDelta,
  canScroll,
  scrollableFor,
  installFastWheel,
  WHEEL_SPEED,
  PRECISE_SPEED,
  LINE_HEIGHT_PX,
} from "../helpers/wheelScroll";

const ev = (o) => ({ deltaMode: 0, deltaX: 0, deltaY: 0, ...o });

describe("isPreciseScroll — the trackpad must not be sped up", () => {
  it("LINE mode is a notched wheel (Firefox mouse wheel)", () => {
    expect(isPreciseScroll(ev({ deltaMode: 1, deltaY: 3 }))).toBe(false);
  });

  it("PAGE mode is a notched wheel", () => {
    expect(isPreciseScroll(ev({ deltaMode: 2, deltaY: 1 }))).toBe(false);
  });

  it("a big whole-pixel delta is a notched wheel (Chrome ~100/notch)", () => {
    expect(isPreciseScroll(ev({ deltaY: 100 }))).toBe(false);
    expect(isPreciseScroll(ev({ deltaY: -100 }))).toBe(false);
  });

  it("a SMALL pixel delta is a trackpad", () => {
    expect(isPreciseScroll(ev({ deltaY: 8 }))).toBe(true);
  });

  it("a FRACTIONAL delta is a trackpad reporting sub-pixel movement", () => {
    expect(isPreciseScroll(ev({ deltaY: 120.5 }))).toBe(true);
  });

  it("simultaneous two-axis movement is a trackpad, however large", () => {
    expect(isPreciseScroll(ev({ deltaX: 60, deltaY: 80 }))).toBe(true);
  });

  it("a horizontal-only notch still counts as a wheel (tilt wheel)", () => {
    expect(isPreciseScroll(ev({ deltaX: 100, deltaY: 0 }))).toBe(false);
  });

  it("answers PRECISE for a missing event — ambiguity must never speed anything up", () => {
    expect(isPreciseScroll(null)).toBe(true);
    expect(isPreciseScroll(ev({}))).toBe(true);
  });
});

describe("wheelDeltaPx", () => {
  it("passes pixel mode through untouched", () => {
    expect(wheelDeltaPx(ev({ deltaY: 100 }))).toEqual({ dx: 0, dy: 100 });
  });

  it("converts LINE mode to pixels", () => {
    expect(wheelDeltaPx(ev({ deltaMode: 1, deltaY: 3 }))).toEqual({ dx: 0, dy: 3 * LINE_HEIGHT_PX });
  });

  it("converts PAGE mode using the viewport", () => {
    expect(wheelDeltaPx(ev({ deltaMode: 2, deltaY: 1 }), { pageHeight: 800 })).toEqual({ dx: 0, dy: 800 });
  });
});

describe("scaledWheelDelta", () => {
  it("multiplies a wheel notch by WHEEL_SPEED", () => {
    const r = scaledWheelDelta(ev({ deltaY: 100 }));
    expect(r.dy).toBe(100 * WHEEL_SPEED);
    expect(r.speed).toBe(WHEEL_SPEED);
  });

  it("leaves a trackpad at PRECISE_SPEED — which is 1, i.e. unchanged", () => {
    const r = scaledWheelDelta(ev({ deltaY: 8 }));
    expect(r.speed).toBe(PRECISE_SPEED);
    expect(PRECISE_SPEED).toBe(1);
    expect(r.dy).toBe(8);
  });

  it("scales a LINE-mode notch through the pixel conversion", () => {
    expect(scaledWheelDelta(ev({ deltaMode: 1, deltaY: 3 })).dy).toBe(3 * LINE_HEIGHT_PX * WHEEL_SPEED);
  });
});

describe("canScroll", () => {
  const box = (o) => ({ scrollTop: 0, scrollLeft: 0, clientHeight: 100, scrollHeight: 100, clientWidth: 100, scrollWidth: 100, ...o });

  it("can go down when there is room below", () => {
    expect(canScroll(box({ scrollHeight: 500 }), 0, 100)).toBe(true);
  });

  it("cannot go down at the end", () => {
    expect(canScroll(box({ scrollHeight: 500, scrollTop: 400 }), 0, 100)).toBe(false);
  });

  it("cannot go up at the top, but can once scrolled", () => {
    expect(canScroll(box({ scrollHeight: 500 }), 0, -100)).toBe(false);
    expect(canScroll(box({ scrollHeight: 500, scrollTop: 50 }), 0, -100)).toBe(true);
  });

  it("handles the horizontal axis", () => {
    expect(canScroll(box({ scrollWidth: 500 }), 100, 0)).toBe(true);
    expect(canScroll(box({ scrollWidth: 500, scrollLeft: 400 }), 100, 0)).toBe(false);
  });

  it("is false for a null element", () => {
    expect(canScroll(null, 0, 100)).toBe(false);
  });
});

// --- DOM-backed cases -------------------------------------------------------

function makeScroller({ scrollHeight = 1000, clientHeight = 200, scrollTop = 0, overflowY = "auto" } = {}) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(el, "scrollWidth", { value: 100, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: 100, configurable: true });
  el.scrollTop = scrollTop;
  el.style.overflowY = overflowY;
  el.scrollBy = vi.fn();
  return el;
}

afterEach(() => { document.body.innerHTML = ""; });

describe("scrollableFor", () => {
  it("finds the nearest ancestor that can move in this direction", () => {
    const outer = makeScroller();
    const inner = document.createElement("div");
    outer.appendChild(inner);
    expect(scrollableFor(inner, 0, 100)).toBe(outer);
  });

  it("WALKS PAST a scroller already at its end, so chaining still works", () => {
    const outer = makeScroller();
    const spent = makeScroller({ scrollTop: 800 });   // 800 + 200 === 1000: done
    outer.appendChild(spent);
    const inner = document.createElement("div");
    spent.appendChild(inner);
    expect(scrollableFor(inner, 0, 100)).toBe(outer);
  });

  it("ignores an element that is tall but not actually scrollable", () => {
    const el = makeScroller({ overflowY: "hidden" });
    const inner = document.createElement("div");
    el.appendChild(inner);
    expect(scrollableFor(inner, 0, 100)).toBeNull();
  });

  it("returns null when nothing can take the scroll", () => {
    const flat = makeScroller({ scrollHeight: 200 });
    expect(scrollableFor(flat, 0, 100)).toBeNull();
  });
});

describe("installFastWheel", () => {
  // Every install is detached in afterEach rather than at the end of each test:
  // an assertion that throws would otherwise leak a document-level listener into
  // the next test, and the A/B showed exactly that — a mutation in one guard
  // failed "cleanup detaches the listener" as collateral.
  let cleanups = [];
  const install = () => { const off = installFastWheel(document); cleanups.push(off); return off; };
  afterEach(() => { cleanups.forEach((off) => off()); cleanups = []; });

  const fire = (el, init) => {
    const e = new Event("wheel", { bubbles: true, cancelable: true });
    Object.assign(e, { deltaMode: 0, deltaX: 0, deltaY: 0, ctrlKey: false, ...init });
    el.dispatchEvent(e);
    return e;
  };

  it("scrolls a wheel notch further and takes the event", () => {
    const el = makeScroller();
    const off = install();
    const e = fire(el, { deltaY: 100 });
    expect(el.scrollBy).toHaveBeenCalledWith({ left: 0, top: 100 * WHEEL_SPEED, behavior: "instant" });
    expect(e.defaultPrevented).toBe(true);
  });

  it("LEAVES A TRACKPAD ALONE — no scrollBy, event untouched", () => {
    const el = makeScroller();
    const off = install();
    const e = fire(el, { deltaY: 8 });
    expect(el.scrollBy).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("does not touch a ctrl+wheel zoom gesture", () => {
    const el = makeScroller();
    const off = install();
    const e = fire(el, { deltaY: 100, ctrlKey: true });
    expect(el.scrollBy).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("yields to anything that already handled the gesture (the chart's zoom)", () => {
    const el = makeScroller();
    el.addEventListener("wheel", (e) => e.preventDefault());
    const off = install();
    fire(el, { deltaY: 100 });
    expect(el.scrollBy).not.toHaveBeenCalled();
  });

  it("leaves the event alone at the end of a list, so the page still chains", () => {
    const el = makeScroller({ scrollTop: 800 });
    const off = install();
    const e = fire(el, { deltaY: 100 });
    expect(el.scrollBy).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("does not hijack the wheel over a FOCUSED number input", () => {
    const el = makeScroller();
    const input = document.createElement("input");
    input.type = "number";
    el.appendChild(input);
    input.focus();
    const off = install();
    const e = fire(input, { deltaY: 100 });
    expect(el.scrollBy).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("STILL scrolls over an UNfocused input — the control only owns its own wheel while focused", () => {
    const el = makeScroller();
    const input = document.createElement("input");
    input.type = "number";
    el.appendChild(input);
    const off = install();
    fire(input, { deltaY: 100 });
    expect(el.scrollBy).toHaveBeenCalled();
  });

  it("cleanup detaches the listener", () => {
    const el = makeScroller();
    const off = install();
    off();
    fire(el, { deltaY: 100 });
    expect(el.scrollBy).not.toHaveBeenCalled();
  });
});
