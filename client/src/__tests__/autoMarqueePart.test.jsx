// AutoMarquee `part`: only the named element's run scrolls; the rest (a field pill's label) stays still (2026-10-31).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import AutoMarquee from "../ui/AutoMarquee";

let roCallbacks = [];
beforeEach(() => {
  roCallbacks = [];
  global.ResizeObserver = class { constructor(cb) { roCallbacks.push(cb); } observe() {} disconnect() {} };
  global.IntersectionObserver = undefined;
});
afterEach(() => { delete global.ResizeObserver; });

const sized = (el, { scrollWidth, clientWidth }) => {
  Object.defineProperty(el, "scrollWidth", { configurable: true, get: () => scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, get: () => clientWidth });
};

function mount(part) {
  const r = render(
    <AutoMarquee part={part}>
      <span className="name">Tracker Date:</span>
      <span className="field-pill-value"><span className="field-pill-value-run">Oct 31 · today</span></span>
    </AutoMarquee>,
  );
  const box = r.container.querySelector(".auto-marquee");
  const inner = r.container.querySelector(".auto-marquee-inner");
  const clip = r.container.querySelector(".field-pill-value");
  sized(box, { scrollWidth: 100, clientWidth: 100 });
  sized(inner, { scrollWidth: 140, clientWidth: 100 });
  sized(clip, { scrollWidth: 40, clientWidth: 40 });
  sized(clip.firstElementChild, { scrollWidth: 60, clientWidth: 60 });
  act(() => roCallbacks.forEach((cb) => cb([])));
  return { inner, run: clip.firstElementChild };
}

describe("AutoMarquee part", () => {
  it("moves only the run, by the run's own overflow", () => {
    const { inner, run } = mount(".field-pill-value");
    expect(run.style.animation).toMatch(/auto-marquee-scroll/);
    expect(run.style.getPropertyValue("--mq-shift")).toBe("-20px");
    expect(inner.style.animation || "").toBe("");
    expect(inner.classList.contains("auto-marquee-inner--moving")).toBe(false);
  });
  it("without part the whole content moves (unchanged)", () => {
    const { inner, run } = mount(null);
    expect(inner.style.animation).toMatch(/auto-marquee-scroll/);
    expect(inner.style.getPropertyValue("--mq-shift")).toBe("-40px");
    expect(run.style.animation || "").toBe("");
  });
});
