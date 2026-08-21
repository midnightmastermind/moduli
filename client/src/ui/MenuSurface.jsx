// ui/MenuSurface.jsx
// The ONE way a floating menu presents itself.
//
// On desktop it is what every one of these menus already was: a portal into
// document.body at a fixed anchor position. On MOBILE it is a bottom drawer —
// full width, pinned to the bottom edge, sliding up over a backdrop (user
// 2026-08-05: "any dropdown menu opened on mobile should slide up as a drawer
// from the bottom of the screen"). An anchored dropdown on a phone is cramped,
// gets clipped by panel overflow, and lands under your thumb by accident.
//
// WHAT THIS OWNS: the portal, the drawer-vs-anchored decision, the backdrop, the
// grab handle, and the safe-area inset. WHAT IT DELIBERATELY DOES NOT OWN: the
// desktop anchor math. ContextMenu clamps a click point, QuickAddMenu flips
// above a button (`menuPosition`, unit-tested), HeaderDropdown measures itself
// and flips — three real behaviours with their own tests. Folding them into one
// clamp would be a rewrite of three positioning strategies to ship a drawer.
// Callers pass the position they already compute; on mobile it is ignored.
import React from "react";
import { createPortal } from "react-dom";

// App stamps `document.body.dataset.layout` on every layout change, so a
// portalled menu can read the layout without any of its hosts threading a prop
// down to it (several of them are mounted from places that never see it).
export function isDrawerLayout() {
  if (typeof document === "undefined") return false;
  return document.body?.dataset?.layout === "mobile";
}

// The drawer's own chrome, kept here so every menu that opens as one looks the
// same. Height is capped rather than fixed: a 3-item menu should be a short
// sheet, not an 80%-tall panel with a hole in it.
const DRAWER_STYLE = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: 0,
  top: "auto",
  width: "auto",
  minWidth: 0,
  maxWidth: "none",
  overflowY: "auto",
  // Wide content (the 400px date-picker calendar on a 390px phone) scrolls
  // inside the sheet rather than bleeding off it — the same rule the rest of
  // the app uses for tables and diagrams.
  overflowX: "auto",
  borderRadius: "14px 14px 0 0",
  borderBottom: "none",
  borderLeft: "none",
  borderRight: "none",
  boxShadow: "0 -8px 32px var(--menu-shadow-color, rgba(0,0,0,0.55))",
  paddingBottom: "max(12px, env(safe-area-inset-bottom))",
};

// Cap the sheet at ~72% of the viewport, 560px hard ceiling. Computed in JS
// rather than written as `min(72vh, 560px)`: a CSS function inside an INLINE
// style is dropped WHOLE by an engine that does not parse it (jsdom does
// exactly that — the test caught it), and a dropped maxHeight is a full-height
// sheet with no scroll cap. Read at render; a drawer does not outlive a resize.
function drawerMaxHeight() {
  const vh = typeof window !== "undefined" ? window.innerHeight : 0;
  return vh ? Math.min(Math.round(vh * 0.72), 560) : 560;
}

/**
 * @param {object} position  desktop-only `{ top, left }` (whatever the caller computed)
 * @param {object} style     the caller's own surface styling (background, border, …)
 * @param {number} zIndex    the caller's stacking level; the backdrop sits one below
 * @param {() => void} onClose  called when the backdrop is tapped
 * @param {React.Ref} surfaceRef  forwarded to the surface element (outside-click tests use it)
 */
export default function MenuSurface({
  position = null,
  style = {},
  zIndex = 1100,
  className = "",
  onClose,
  surfaceRef,
  onClick,
  onContextMenu,
  onMouseDown,
  children,
}) {
  const drawer = isDrawerLayout();

  const surface = (
    <div
      ref={surfaceRef}
      className={`menu-surface${drawer ? " menu-surface--drawer" : ""}${className ? ` ${className}` : ""}`}
      style={{
        ...style,
        zIndex,
        ...(drawer
          ? { ...DRAWER_STYLE, maxHeight: drawerMaxHeight() }
          : { position: "fixed", top: position?.top, left: position?.left }),
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseDown={onMouseDown}
    >
      {drawer && <div className="menu-surface-grab" aria-hidden="true" />}
      {children}
    </div>
  );

  return createPortal(
    <>
      {drawer && (
        // Tapping off already dismisses every one of these menus (each has its
        // own outside-pointerdown handler, and the backdrop is outside their
        // ref) — `onClose` here is belt and braces, and the element itself is
        // what stops a tap meant for "close" from landing on the page behind.
        <div
          className="menu-surface-backdrop"
          style={{ zIndex: zIndex - 1 }}
          onPointerDown={() => onClose?.()}
        />
      )}
      {surface}
    </>,
    document.body
  );
}
