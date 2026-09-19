import { renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useMobileDetect, MOBILE_BREAKPOINT } from "../hooks/useMobileDetect";

// Configure matchMedia for a given viewport shape.
function setMedia({ coarse, portrait, width }) {
  window.matchMedia = vi.fn().mockImplementation((query) => {
    let matches = false;
    if (query.includes("pointer: coarse")) matches = coarse;
    else if (query.includes("orientation: portrait")) matches = portrait;
    else if (query.includes("max-width")) matches = width <= MOBILE_BREAKPOINT;
    return {
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };
  });
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
}

describe("useMobileDetect", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("tablet landscape: touch but desktop layout", () => {
    setMedia({ coarse: true, portrait: false, width: 1180 });
    const { result } = renderHook(() => useMobileDetect());
    expect(result.current.isTouch).toBe(true);
    expect(result.current.isMobileLayout).toBe(false);
  });

  it("tablet portrait: touch and mobile layout", () => {
    setMedia({ coarse: true, portrait: true, width: 834 });
    const { result } = renderHook(() => useMobileDetect());
    expect(result.current.isTouch).toBe(true);
    expect(result.current.isMobileLayout).toBe(true);
  });

  it("phone landscape: touch and mobile layout (narrow)", () => {
    setMedia({ coarse: true, portrait: false, width: 844 });
    const { result } = renderHook(() => useMobileDetect());
    expect(result.current.isTouch).toBe(true);
    expect(result.current.isMobileLayout).toBe(true);
  });

  it("desktop: neither", () => {
    setMedia({ coarse: false, portrait: false, width: 1440 });
    const { result } = renderHook(() => useMobileDetect());
    expect(result.current.isTouch).toBe(false);
    expect(result.current.isMobileLayout).toBe(false);
  });

  it("desktop narrow (<= MOBILE_BREAKPOINT): mobile layout via legacy fallback", () => {
    setMedia({ coarse: false, portrait: false, width: 500 });
    const { result } = renderHook(() => useMobileDetect());
    expect(result.current.isTouch).toBe(false);
    expect(result.current.isMobileLayout).toBe(true);
  });
});

describe("the raised breakpoint (2026-09-19)", () => {
  it("a 700px desktop window gets the mobile layout", () => {
    setMedia({ coarse: false, portrait: false, width: 700 });
    const { result } = renderHook(() => useMobileDetect());
    expect(result.current.isMobileLayout).toBe(true);
  });
  it("control: a 900px desktop window keeps the desktop layout", () => {
    setMedia({ coarse: false, portrait: false, width: 900 });
    const { result } = renderHook(() => useMobileDetect());
    expect(result.current.isMobileLayout).toBe(false);
  });
});
