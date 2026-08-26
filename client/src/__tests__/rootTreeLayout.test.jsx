import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ROOT_TREE_W, ROOT_TREE_PUSH_MIN_W, rootTreeCanPushAt } from "../helpers/rootTreeLayout";
import { useMinWidth } from "../hooks/useMinWidth";

// The regression this file exists for: the sidebar decided overlay-vs-push from
// `isMobileLayout`, which is TRUE for a tablet in PORTRAIT at 800-1180px — so it
// full-screened on a viewport with room to spare.
describe("root tree sidebar: overlay vs push", () => {
  it("the threshold is DERIVED from the sidebar width, not a picked number", () => {
    // If someone re-picks this as a literal, tablet portrait silently breaks again.
    expect(ROOT_TREE_PUSH_MIN_W).toBe(ROOT_TREE_W * 3);
  });

  it("pushes on the viewports that broke, overlays on the ones that must", () => {
    // THE BUG: every one of these is `isMobileLayout === true` (touch+portrait)
    // and every one has room for a 222px sidebar.
    expect(rootTreeCanPushAt(768)).toBe(true);  // iPad portrait
    expect(rootTreeCanPushAt(800)).toBe(true);  // 1280x800 tablet, rotated
    expect(rootTreeCanPushAt(820)).toBe(true);  // iPad Air portrait

    // Unchanged: already correct before the fix, and must stay correct.
    expect(rootTreeCanPushAt(1280)).toBe(true); // tablet landscape
    expect(rootTreeCanPushAt(1440)).toBe(true); // desktop

    // THE CONTROL — a phone genuinely cannot spare 222px, so the overlay is
    // right there. Without this the test would pass for "always push".
    expect(rootTreeCanPushAt(390)).toBe(false); // iPhone portrait
    expect(rootTreeCanPushAt(430)).toBe(false); // large phone portrait
  });

  it("refuses a non-number rather than pushing on NaN", () => {
    expect(rootTreeCanPushAt(undefined)).toBe(false);
    expect(rootTreeCanPushAt(null)).toBe(false);
  });
});

describe("useMinWidth", () => {
  let listeners;
  function setWidth(w) {
    listeners = [];
    window.matchMedia = vi.fn().mockImplementation((q) => {
      const min = Number(/min-width:\s*(\d+)px/.exec(q)?.[1] ?? 0);
      return {
        get matches() { return w >= min; },
        media: q,
        addEventListener: (_, fn) => listeners.push(fn),
        removeEventListener: () => {},
      };
    });
  }
  beforeEach(() => vi.restoreAllMocks());

  it("is correct on the FIRST render — no flash of the wrong branch", () => {
    setWidth(820);
    const { result } = renderHook(() => useMinWidth(ROOT_TREE_PUSH_MIN_W));
    expect(result.current).toBe(true);
  });

  it("reports false below the threshold", () => {
    setWidth(390);
    const { result } = renderHook(() => useMinWidth(ROOT_TREE_PUSH_MIN_W));
    expect(result.current).toBe(false);
  });

  it("follows a rotation — the change listener re-reads the query", () => {
    let w = 390;
    listeners = [];
    window.matchMedia = vi.fn().mockImplementation((q) => {
      const min = Number(/min-width:\s*(\d+)px/.exec(q)?.[1] ?? 0);
      return {
        get matches() { return w >= min; },
        media: q,
        addEventListener: (_, fn) => listeners.push(fn),
        removeEventListener: () => {},
      };
    });
    const { result } = renderHook(() => useMinWidth(ROOT_TREE_PUSH_MIN_W));
    expect(result.current).toBe(false);
    act(() => { w = 1024; listeners.forEach((fn) => fn()); });
    expect(result.current).toBe(true);
  });

  it("fails OPEN with no matchMedia — a missing API must not hide the sidebar", () => {
    window.matchMedia = undefined;
    const { result } = renderHook(() => useMinWidth(ROOT_TREE_PUSH_MIN_W));
    expect(result.current).toBe(true);
  });
});
