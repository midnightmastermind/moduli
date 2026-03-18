// ui/ContextMenu.jsx
// ============================================================
// Portal-based right-click context menu
// Usage:
//   const [ctx, setCtx] = useState(null);
//   onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, items: [...] }); }}
//   <ContextMenu ctx={ctx} onClose={() => setCtx(null)} />
// ============================================================

import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * @param {{ x, y, items: Array<{ label, icon?, onClick, danger?, separator? }> }} ctx
 * @param {() => void} onClose
 */
export default function ContextMenu({ ctx, onClose }) {
  const ref = useRef(null);

  // Dismiss on outside click or Escape
  useEffect(() => {
    if (!ctx) return;
    const onPointer = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [ctx, onClose]);

  if (!ctx) return null;

  // Keep menu inside viewport
  const W = 168;
  const approxH = ctx.items.length * 30 + 8;
  const x = Math.min(ctx.x, window.innerWidth - W - 6);
  const y = Math.min(ctx.y, window.innerHeight - approxH - 6);

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed",
        top: y,
        left: x,
        width: W,
        zIndex: 2147483646,
        background: "var(--surface-card)",
        border: "1px solid rgba(80,120,180,0.35)",
        borderRadius: 8,
        boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
        padding: "4px 0",
        fontFamily: "monospace",
        fontSize: 12,
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {ctx.items.map((item, i) => {
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
            onClick={() => { item.onClick?.(); onClose(); }}
            disabled={item.disabled}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "5px 12px",
              background: "none",
              border: "none",
              cursor: item.disabled ? "default" : "pointer",
              color: item.danger
                ? "rgb(252,165,165)"
                : item.disabled
                  ? "var(--text-faint)"
                  : "var(--text-primary)",
              textAlign: "left",
              fontSize: 11,
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
                  width: 12,
                  height: 12,
                  flexShrink: 0,
                  opacity: item.disabled ? 0.4 : 0.7,
                }}
              />
            )}
            {item.label}
          </button>
        );
      })}
    </div>,
    document.body
  );
}
