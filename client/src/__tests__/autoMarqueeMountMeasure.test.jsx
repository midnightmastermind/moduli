// A PAGE SWITCH FROZE THE APP FOR ~11s (user, 2026-09-15: opening a bookmark).
// The profile put 8s of it in AutoMarquee's mount: each instance read
// `scrollWidth` synchronously in its layout effect, forcing one full layout per
// marquee. The ResizeObserver it already sets up delivers the first measurement
// for every element in one batch after layout — so mount must NOT read layout
// itself when a ResizeObserver exists.
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, act } from "@testing-library/react";
import AutoMarquee from "../ui/AutoMarquee.jsx";

const realRO = globalThis.ResizeObserver;
afterEach(() => { globalThis.ResizeObserver = realRO; vi.restoreAllMocks(); });

function spyScrollWidth() {
  let reads = 0;
  const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth")
    || Object.getOwnPropertyDescriptor(Element.prototype, "scrollWidth");
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function () {
    reads += 1;
    return desc?.get ? desc.get.call(this) : 0;
  });
  return () => reads;
}

describe("AutoMarquee mount", () => {
  it("does not read layout while mounting when a ResizeObserver exists", () => {
    const observers = [];
    globalThis.ResizeObserver = class {
      constructor(cb) { this.cb = cb; observers.push(this); }
      observe() {}
      disconnect() {}
    };
    const reads = spyScrollWidth();
    render(<>{Array.from({ length: 50 }, (_, i) => <AutoMarquee key={i}>label {i}</AutoMarquee>)}</>);
    expect(reads(), "a mount forced a synchronous layout read").toBe(0);
    // …and the observer is what measures, once it reports.
    act(() => { observers.forEach((o) => o.cb([])); });
    expect(reads()).toBe(50);
  });

  // The control: an engine with no ResizeObserver must still measure, or a label
  // that overflows would never scroll there.
  it("still measures inline when there is no ResizeObserver", () => {
    globalThis.ResizeObserver = undefined;
    const reads = spyScrollWidth();
    render(<AutoMarquee>a label</AutoMarquee>);
    expect(reads()).toBe(1);
  });
});
