// MenuSurface decides how EVERY floating menu presents itself: anchored on
// desktop, a bottom drawer on mobile. The decision reads
// document.body.dataset.layout, which App stamps on every layout change.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import MenuSurface, { isDrawerLayout } from "../ui/MenuSurface.jsx";
import ContextMenu from "../ui/ContextMenu.jsx";

const setLayout = (v) => { document.body.dataset.layout = v; };
afterEach(() => { delete document.body.dataset.layout; });

const surface = () => document.querySelector(".menu-surface");
const backdrop = () => document.querySelector(".menu-surface-backdrop");

describe("isDrawerLayout", () => {
  it("follows the layout App stamps on the body", () => {
    expect(isDrawerLayout()).toBe(false);       // unset = desktop
    setLayout("desktop");
    expect(isDrawerLayout()).toBe(false);
    setLayout("mobile");
    expect(isDrawerLayout()).toBe(true);
  });
});

describe("MenuSurface", () => {
  it("desktop: sits at the position the caller computed, with no backdrop", () => {
    setLayout("desktop");
    render(<MenuSurface position={{ top: 120, left: 300 }}>hi</MenuSurface>);
    const el = surface();
    expect(el.style.position).toBe("fixed");
    expect(el.style.top).toBe("120px");
    expect(el.style.left).toBe("300px");
    expect(backdrop()).toBeNull();
    expect(document.querySelector(".menu-surface-grab")).toBeNull();
  });

  it("mobile: pinned to the bottom edge, full width, and the anchor is IGNORED", () => {
    setLayout("mobile");
    render(<MenuSurface position={{ top: 120, left: 300 }} style={{ width: 260, maxWidth: 300 }}>hi</MenuSurface>);
    const el = surface();
    expect(el.className).toContain("menu-surface--drawer");
    expect(el.style.bottom).toBe("0px");
    expect(el.style.left).toBe("0px");
    expect(el.style.right).toBe("0px");
    // The anchor is what makes a phone menu open under the thumb that opened it.
    expect(el.style.top).toBe("auto");
    // The caller's own width must not survive, or the sheet is a narrow column
    // floating at the bottom of the screen.
    expect(el.style.width).toBe("auto");
    expect(el.style.maxWidth).toBe("none");
    expect(document.querySelector(".menu-surface-grab")).toBeTruthy();
  });

  it("mobile: the backdrop sits one level BELOW its own sheet and closes on tap", () => {
    setLayout("mobile");
    const onClose = vi.fn();
    render(<MenuSurface zIndex={1100} onClose={onClose}>hi</MenuSurface>);
    expect(Number(backdrop().style.zIndex)).toBe(1099);
    expect(Number(surface().style.zIndex)).toBe(1100);
    fireEvent.pointerDown(backdrop());
    expect(onClose).toHaveBeenCalled();
  });

  it("mobile: the drawer overrides a caller that fixes its own width and clips overflow", () => {
    // QuickAddMenu's surface is `width: 260, maxHeight: 360, overflow: hidden`.
    // Spread order is what makes the drawer win — assert it, because a caller
    // adding a style later could silently reintroduce a narrow clipped sheet.
    setLayout("mobile");
    render(
      <MenuSurface style={{ width: 260, maxHeight: 360, overflow: "hidden" }}>hi</MenuSurface>
    );
    const el = surface();
    expect(el.style.width).toBe("auto");
    expect(el.style.overflowY).toBe("auto");
    // A plain px cap, not a CSS min() — see drawerMaxHeight(). jsdom reports
    // its 768px viewport, so 72% of that.
    expect(el.style.maxHeight).toBe(`${Math.min(Math.round(window.innerHeight * 0.72), 560)}px`);
  });
});

describe("ContextMenu through MenuSurface", () => {
  const ctx = { x: 400, y: 300, items: [{ label: "Rename", onClick: () => {} }] };

  it("desktop keeps the anchored menu", () => {
    setLayout("desktop");
    render(<ContextMenu ctx={ctx} onClose={() => {}} />);
    expect(surface().className).not.toContain("menu-surface--drawer");
    expect(backdrop()).toBeNull();
  });

  it("mobile opens it as a drawer with thumb-sized rows", () => {
    setLayout("mobile");
    render(<ContextMenu ctx={ctx} onClose={() => {}} />);
    expect(surface().className).toContain("menu-surface--drawer");
    expect(backdrop()).toBeTruthy();
    // Row padding is set INLINE (a stylesheet rule would lose to it), so the
    // touch size has to be chosen in the component — assert it actually is.
    const row = screen.getByText("Rename").closest("button");
    expect(row.style.padding).toBe("12px 18px");
    expect(row.style.fontSize).toBe("14px");
  });
});
