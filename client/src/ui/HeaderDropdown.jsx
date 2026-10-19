// client/src/ui/HeaderDropdown.jsx
import React, { useEffect, useRef, useState, useLayoutEffect } from "react";
import MenuSurface, { isDrawerLayout } from "./MenuSurface.jsx";
import { clickedInsidePortalLayer } from "../helpers/outsideClick";

const VIEWPORT_MARGIN = 8;
const DEFAULT_WIDTH = 320;

export default function HeaderDropdown({ anchorRect, onClose, children }) {
  const ref = useRef(null);
  // Initial position uses the anchor's bottom-left, but we clamp after the
  // dropdown's actual dimensions are measured so it never renders off-screen.
  const [pos, setPos] = useState(() => ({
    top: anchorRect ? anchorRect.bottom + 4 : 0,
    left: anchorRect ? anchorRect.left : 0,
    maxHeight: undefined,
  }));

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    const onClick = (e) => {
      if (clickedInsidePortalLayer(e.target)) return;
      if (ref.current && !ref.current.contains(e.target)) onClose?.();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  // Clamp the dropdown into the viewport after it renders. Measured layout
  // wins over the initial guess so a right-edge anchor doesn't push the
  // panel off-screen, and a near-bottom anchor doesn't get clipped.
  //
  // RE-CLAMPED ON EVERY RESIZE, not only on open: the dropdown opens on its
  // short first tab, and switching to a long one (Layout, then "Own") grew it
  // past the bottom of the screen with nothing measuring again, so its last
  // rows could not be reached. The natural height is `scrollHeight`, which a
  // previous cap does not shrink.
  useLayoutEffect(() => {
    if (!anchorRect || !ref.current) return undefined;
    // The drawer is pinned to the bottom edge — measuring an anchor it does not
    // use would just thrash state on every open.
    if (isDrawerLayout()) return undefined;
    const el = ref.current;
    const clamp = () => {
      const rect = el.getBoundingClientRect();
      const height = el.scrollHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let top = anchorRect.bottom + 4;
      let left = anchorRect.left;
      // Right edge: shift left so panel sits inside viewport.
      if (left + rect.width + VIEWPORT_MARGIN > vw) {
        left = Math.max(VIEWPORT_MARGIN, vw - rect.width - VIEWPORT_MARGIN);
      }
      if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
      // Bottom edge: prefer below anchor; if it overflows AND there's room
      // above, flip to render upward. Otherwise cap height and let it scroll.
      let maxHeight;
      if (top + height + VIEWPORT_MARGIN > vh) {
        const spaceAbove = anchorRect.top - VIEWPORT_MARGIN;
        const spaceBelow = vh - top - VIEWPORT_MARGIN;
        if (spaceAbove > spaceBelow && height <= spaceAbove) {
          top = anchorRect.top - height - 4;
        } else if (spaceAbove > spaceBelow) {
          top = VIEWPORT_MARGIN;
          maxHeight = Math.max(120, anchorRect.top - 4 - VIEWPORT_MARGIN);
        } else {
          maxHeight = Math.max(120, spaceBelow);
        }
      }
      setPos((prev) =>
        prev.top === top && prev.left === left && prev.maxHeight === maxHeight
          ? prev
          : { top, left, maxHeight }
      );
    };
    clamp();
    if (typeof ResizeObserver === "undefined") return undefined;
    // Observe the CONTENT, not the capped box: a tab switch changes what is
    // inside while a capped surface keeps the same outer size.
    const ro = new ResizeObserver(() => clamp());
    for (const child of el.children) ro.observe(child);
    ro.observe(el);
    return () => ro.disconnect();
  }, [anchorRect]);

  if (!anchorRect) return null;

  return (
    <MenuSurface
      surfaceRef={ref}
      className="header-dropdown"
      fixedDrawerHeight
      position={{ top: pos.top, left: pos.left }}
      zIndex={1000}
      onClose={onClose}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        minWidth: 280,
        maxWidth: 360,
        width: DEFAULT_WIDTH,
        ...(pos.maxHeight ? { maxHeight: pos.maxHeight, overflowY: "auto" } : {}),
        background: "var(--panel-bg, #1f2937)",
        // `--panel-fg` WAS NEVER DEFINED — not in index.css, not in the skin
        // registry, nowhere. So this always fell through to its hardcoded
        // fallback, a near-white grey: correct on a dark theme by accident,
        // and invisible on the three light skins. Measured on prod with the
        // menu open under Stardew, every inheriting row painted that near-white
        // on a cream surface. `--text-primary` is defined by every theme and
        // resolves to 12.31:1 there.
        color: "var(--text-primary)",
        border: "1px solid var(--panel-border, #374151)",
        borderRadius: 8, padding: 12,
        boxShadow: "var(--menu-shadow-2)",
      }}
    >
      {children}
    </MenuSurface>
  );
}
