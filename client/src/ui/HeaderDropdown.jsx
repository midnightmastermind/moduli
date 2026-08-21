// client/src/ui/HeaderDropdown.jsx
import React, { useEffect, useRef, useState, useLayoutEffect } from "react";
import MenuSurface, { isDrawerLayout } from "./MenuSurface.jsx";

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
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose?.(); };
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
  useLayoutEffect(() => {
    if (!anchorRect || !ref.current) return;
    // The drawer is pinned to the bottom edge — measuring an anchor it does not
    // use would just thrash state on every open.
    if (isDrawerLayout()) return;
    const el = ref.current;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = anchorRect.bottom + 4;
    let left = anchorRect.left;
    // Right edge: shift left so panel sits inside viewport.
    if (left + rect.width + VIEWPORT_MARGIN > vw) {
      left = Math.max(VIEWPORT_MARGIN, vw - rect.width - VIEWPORT_MARGIN);
    }
    // Left edge protection (unlikely but cheap).
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
    // Bottom edge: prefer below anchor; if it overflows AND there's room above,
    // flip to render upward. Otherwise cap height and let the body scroll.
    let maxHeight;
    if (top + rect.height + VIEWPORT_MARGIN > vh) {
      const spaceAbove = anchorRect.top - VIEWPORT_MARGIN;
      const spaceBelow = vh - top - VIEWPORT_MARGIN;
      if (spaceAbove > spaceBelow && rect.height <= spaceAbove) {
        top = anchorRect.top - rect.height - 4;
      } else {
        maxHeight = Math.max(120, spaceBelow);
      }
    }
    setPos((prev) =>
      prev.top === top && prev.left === left && prev.maxHeight === maxHeight
        ? prev
        : { top, left, maxHeight }
    );
  }, [anchorRect]);

  if (!anchorRect) return null;

  return (
    <MenuSurface
      surfaceRef={ref}
      className="header-dropdown"
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
        color: "var(--panel-fg, #f3f4f6)",
        border: "1px solid var(--panel-border, #374151)",
        borderRadius: 8, padding: 12,
        boxShadow: "var(--menu-shadow-2)",
      }}
    >
      {children}
    </MenuSurface>
  );
}
