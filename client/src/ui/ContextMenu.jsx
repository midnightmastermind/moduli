// ui/ContextMenu.jsx
// ============================================================
// Portal-based right-click context menu
// Usage:
//   const [ctx, setCtx] = useState(null);
//   onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, items: [...] }); }}
//   <ContextMenu ctx={ctx} onClose={() => setCtx(null)} />
// ============================================================

import React, { useEffect, useRef } from "react";
import MenuSurface, { isDrawerLayout } from "./MenuSurface.jsx";

// Callers build item arrays with conditional entries, so a filtered-out item
// can leave a separator with nothing above/below it (renders as a blank row).
// Drop leading/trailing separators and collapse consecutive ones.
export function normalizeMenuItems(items = []) {
  const out = [];
  for (const item of items) {
    if (item.separator) {
      if (out.length === 0 || out[out.length - 1].separator) continue;
    }
    out.push(item);
  }
  while (out.length && out[out.length - 1].separator) out.pop();
  return out;
}

/**
 * @param {{ x, y, items: Array<{ label, icon?, onClick, danger?, separator? }> }} ctx
 * @param {() => void} onClose
 */
export default function ContextMenu({ ctx, onClose }) {
  const ref = useRef(null);

  // Dismiss on any outside press (tap/click off) or Escape. Capture-phase
  // `pointerdown` covers mouse + touch + pen uniformly and can't be swallowed by
  // an ancestor that stops propagation in the bubble phase — the old
  // mousedown+touchstart pair missed taps on touch devices, so the menu wouldn't
  // go away when you tapped off (user 2026-07-19). A press ON a menu item is
  // inside `ref` → the item's own onClick handles it; a press anywhere else closes.
  useEffect(() => {
    if (!ctx) return;
    const onPointer = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [ctx, onClose]);

  if (!ctx) return null;

  const items = normalizeMenuItems(ctx.items);

  // Keep menu inside viewport. Width is content-sized within [168, 240];
  // height caps at 70vh with internal scroll (bulk multi-select menus were
  // overflowing small screens).
  const MAX_W = 240;
  const approxH = Math.min(items.length * 30 + 8, window.innerHeight * 0.7);
  const x = Math.min(ctx.x, window.innerWidth - MAX_W - 6);
  const y = Math.min(ctx.y, window.innerHeight - approxH - 6);

  // On a phone this opens as a bottom drawer instead (MenuSurface) — the x/y
  // above is then ignored, which is the point: a right-click menu anchored to a
  // long-press point is exactly what lands under the thumb that opened it.
  const drawer = isDrawerLayout();

  return (
    <MenuSurface
      surfaceRef={ref}
      position={{ top: y, left: x }}
      zIndex={2147483646}
      onClose={onClose}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        width: "max-content",
        minWidth: 168,
        maxWidth: MAX_W,
        maxHeight: "70vh",
        overflowY: "auto",
        background: "var(--surface-card)",
        border: "1px solid rgba(80,120,180,0.35)",
        borderRadius: 8,
        boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
        padding: "4px 0",
        fontFamily: "monospace",
        fontSize: 12,
      }}
    >
      {items.map((item, i) => {
        if (item.separator) {
          return (
            <div
              key={`sep-${i}`}
              style={{ height: 1, background: "var(--border-subtle)", margin: "3px 0" }}
            />
          );
        }
        const Icon = item.icon;
        return (
          <button
            key={item.label}
            className="context-menu-item"
            onClick={() => { item.onClick?.(); onClose(); }}
            disabled={item.disabled}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: drawer ? "12px 18px" : "5px 12px",
              background: "none",
              border: "none",
              cursor: item.disabled ? "default" : "pointer",
              color: item.danger
                ? "rgb(252,165,165)"
                : item.disabled
                  ? "var(--text-faint)"
                  : "var(--text-primary)",
              textAlign: "left",
              fontSize: drawer ? 14 : 11,
              fontFamily: "monospace",
              transition: "background 0.1s",
            }}
            onMouseEnter={(e) => {
              if (!item.disabled) e.currentTarget.style.background = "var(--border-subtle)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "none";
            }}
          >
            {Icon && (
              <Icon
                style={{
                  width: drawer ? 16 : 12,
                  height: drawer ? 16 : 12,
                  flexShrink: 0,
                  opacity: item.disabled ? 0.4 : 0.7,
                }}
              />
            )}
            {item.label}
          </button>
        );
      })}
    </MenuSurface>
  );
}
