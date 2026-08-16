import { describe, it, expect } from "vitest";
import { render, act } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import LoadingImage from "../ui/LoadingImage.jsx";

// These pin the two states a picture can be in that a bare <img> cannot
// express, plus the CACHED case — which is the one that regresses silently,
// because it only appears the SECOND time you open a surface.

const spinner = (c) => c.querySelector(".img-load-status:not(.img-load-status--error)");
const errored = (c) => c.querySelector(".img-load-status--error");

describe("LoadingImage", () => {
  it("shows a spinner before the image loads", () => {
    const { container } = render(<LoadingImage src="/a.png" />);
    expect(spinner(container)).toBeTruthy();
    expect(errored(container)).toBeFalsy();
  });

  it("clears the spinner once the image loads", () => {
    const { container } = render(<LoadingImage src="/a.png" />);
    act(() => { fireEvent.load(container.querySelector("img")); });
    expect(spinner(container)).toBeFalsy();
    expect(errored(container)).toBeFalsy();
  });

  it("shows the error glyph — never a silent empty frame — when the src is broken", () => {
    const { container } = render(<LoadingImage src="/gone.png" />);
    act(() => { fireEvent.error(container.querySelector("img")); });
    expect(errored(container)).toBeTruthy();
    expect(spinner(container)).toBeFalsy();
  });

  // The load event never fires for an image already in cache, so without the
  // `complete` check on mount a re-opened dropdown spins forever over pictures
  // that are already on screen.
  it("does not spin over an image that was already complete on mount", () => {
    // The load event is NOT fired here on purpose: for a cached image the
    // browser never fires it, so firing one would make this pass with or
    // without the `complete` check and prove nothing.
    const proto = window.HTMLImageElement.prototype;
    const wasComplete = Object.getOwnPropertyDescriptor(proto, "complete");
    const wasNatural = Object.getOwnPropertyDescriptor(proto, "naturalWidth");
    Object.defineProperty(proto, "complete", { get: () => true, configurable: true });
    Object.defineProperty(proto, "naturalWidth", { get: () => 120, configurable: true });
    try {
      const { container } = render(<LoadingImage src="/cached.png" />);
      expect(spinner(container)).toBeFalsy();
      expect(errored(container)).toBeFalsy();
    } finally {
      if (wasComplete) Object.defineProperty(proto, "complete", wasComplete);
      else delete proto.complete;
      if (wasNatural) Object.defineProperty(proto, "naturalWidth", wasNatural);
      else delete proto.naturalWidth;
    }
  });

  it("keeps the img mounted in every state, so the frame never resizes", () => {
    const { container } = render(<LoadingImage src="/a.png" />);
    expect(container.querySelector("img")).toBeTruthy();
    act(() => { fireEvent.error(container.querySelector("img")); });
    expect(container.querySelector("img")).toBeTruthy();
  });

  it("lets the caller own the frame box, so the overlay can be positioned", () => {
    const { container } = render(
      <LoadingImage src="/a.png" frameStyle={{ position: "relative", width: 18, height: 18 }} />,
    );
    const wrap = container.querySelector(".img-load-wrap");
    expect(wrap.style.position).toBe("relative");
    expect(wrap.style.width).toBe("18px");
  });
});
