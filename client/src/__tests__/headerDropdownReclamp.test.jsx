// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import HeaderDropdown from "../ui/HeaderDropdown.jsx";

let roCallbacks = [];
class FakeRO { constructor(cb) { roCallbacks.push(cb); } observe() {} disconnect() {} }

afterEach(() => { roCallbacks = []; vi.restoreAllMocks(); });

describe("HeaderDropdown — re-clamps when its content grows", () => {
  it("a tab switch that makes it taller than the space below moves it on screen", () => {
    globalThis.ResizeObserver = FakeRO;
    Object.defineProperty(window, "innerHeight", { value: 1000, configurable: true });
    let h = 60;
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => h);
    const anchorRect = { top: 880, bottom: 900, left: 10, right: 30, width: 20, height: 20 };
    const { container } = render(<HeaderDropdown anchorRect={anchorRect} onClose={() => {}}><div>tab</div></HeaderDropdown>);
    const surface = () => document.querySelector(".header-dropdown");
    expect(parseFloat(surface().style.top)).toBe(904);           // fits below at first
    h = 600;                                                       // the Layout tab opens
    act(() => roCallbacks.forEach((cb) => cb([])));
    const top = parseFloat(surface().style.top);
    expect(top + 600).toBeLessThanOrEqual(1000);                   // whole menu on screen
    void container;
  });
});
