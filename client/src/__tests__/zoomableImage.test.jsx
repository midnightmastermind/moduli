// An opened image can be zoomed (2026-10-14): buttons, wheel, double-click.
import React from "react";
import { describe, it, expect } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import ZoomableImage from "../ui/ZoomableImage.jsx";

const setup = () => {
  render(<ZoomableImage frameStyle={{ width: 400, height: 300 }}><img alt="pic" src="x.png" /></ZoomableImage>);
  const box = screen.getByTestId("zoomable-image");
  box.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 });
  return box;
};
const level = () => screen.getByTestId("zoom-level").textContent;

describe("ZoomableImage", () => {
  it("starts at 100% and zooms in / out / fits with the buttons", () => {
    setup();
    expect(level()).toBe("100%");
    fireEvent.click(screen.getByLabelText("Zoom in"));
    expect(level()).toBe("140%");
    fireEvent.click(screen.getByLabelText("Fit"));
    expect(level()).toBe("100%");
  });
  it("the wheel zooms, and does not scroll the page", () => {
    const box = setup();
    const ev = new WheelEvent("wheel", { deltaY: -300, clientX: 200, clientY: 150, bubbles: true, cancelable: true });
    act(() => { box.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    expect(parseInt(level(), 10)).toBeGreaterThan(100);
  });
  it("double-click zooms in, and again fits", () => {
    const box = setup();
    fireEvent.doubleClick(box, { clientX: 100, clientY: 100 });
    expect(level()).toBe("250%");
    fireEvent.doubleClick(box, { clientX: 100, clientY: 100 });
    expect(level()).toBe("100%");
  });
});
