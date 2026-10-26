// @vitest-environment jsdom
import { glideStep } from "../helpers/headsetScroll";
import { describe, it, expect } from "vitest";
import { installHeadsetScroll, SCROLL_GAIN } from "../helpers/headsetScroll.js";

describe("headset scroll", () => {
  it("scrolls the box under the wheel SCROLL_GAIN times as far, eased over frames", () => {
    const frames = [];
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
    const box = document.createElement("div");
    box.style.overflowY = "auto";
    Object.defineProperty(box, "scrollHeight", { value: 5000 });
    Object.defineProperty(box, "clientHeight", { value: 400 });
    const inner = document.createElement("p"); box.appendChild(inner); document.body.appendChild(box);
    const off = installHeadsetScroll(window);
    const ev = new WheelEvent("wheel", { deltaY: 50, bubbles: true, cancelable: true });
    inner.dispatchEvent(ev);
    // Not all at once (that was the jagged step) ...
    expect(box.scrollTop).toBe(0);
    for (let i = 0; i < 200 && frames.length; i++) frames.shift()();
    // ... but all the way there.
    expect(box.scrollTop).toBe(50 * SCROLL_GAIN);
    window.requestAnimationFrame = raf;
    expect(ev.defaultPrevented).toBe(true);
    off();
    // control: removed, the browser's own scroll is left alone
    const ev2 = new WheelEvent("wheel", { deltaY: 50, bubbles: true, cancelable: true });
    inner.dispatchEvent(ev2);
    expect(ev2.defaultPrevented).toBe(false);
  });
  it("each frame covers a share of what is left, and lands exactly", () => {
    expect(glideStep(0, 300)).toBe(75);
    expect(glideStep(299.5, 300)).toBe(300);
    expect(glideStep(298, 300)).toBe(299);
    expect(glideStep(300, 0)).toBe(225);
  });
});
