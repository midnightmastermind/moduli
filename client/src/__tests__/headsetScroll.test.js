// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { installHeadsetScroll, SCROLL_GAIN } from "../helpers/headsetScroll.js";

describe("headset scroll", () => {
  it("scrolls the box under the wheel SCROLL_GAIN times as far", () => {
    const box = document.createElement("div");
    box.style.overflowY = "auto";
    Object.defineProperty(box, "scrollHeight", { value: 5000 });
    Object.defineProperty(box, "clientHeight", { value: 400 });
    const inner = document.createElement("p"); box.appendChild(inner); document.body.appendChild(box);
    const off = installHeadsetScroll(window);
    const ev = new WheelEvent("wheel", { deltaY: 50, bubbles: true, cancelable: true });
    inner.dispatchEvent(ev);
    expect(box.scrollTop).toBe(50 * SCROLL_GAIN);
    expect(ev.defaultPrevented).toBe(true);
    off();
    // control: removed, the browser's own scroll is left alone
    const ev2 = new WheelEvent("wheel", { deltaY: 50, bubbles: true, cancelable: true });
    inner.dispatchEvent(ev2);
    expect(ev2.defaultPrevented).toBe(false);
  });
});
