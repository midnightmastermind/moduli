// modules/containerPopups.jsx
// Portal popups used by Container.jsx
// Extracted to reduce Container.jsx size.

import React, { useRef, useEffect } from "react";

// ── Filter override popup ────────────────────────────────────
export function FilterOverridePopup({ pos, occurrence, activeFilterValues, onClose, onSet }) {
  const ref = useRef(null);
  useEffect(() => {
    const handle = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose]);

  const current = occurrence?.filterOverride;
  const isInherit = current === null || current === undefined;
  const isShowAll = current !== null && current !== undefined && typeof current === "object" && Object.keys(current).length === 0;
  const isOwn = !isInherit && !isShowAll;
  const hasActive = Object.keys(activeFilterValues).length > 0;

  return (
    <div
      ref={ref}
      style={{
        position: "fixed", zIndex: 2147483647,
        top: pos.y, left: pos.x,
        background: "var(--surface-card)", border: "1px solid var(--border-default)",
        borderRadius: 8, padding: 8, minWidth: 200,
        boxShadow: "var(--menu-shadow-2)",
        fontSize: 12, fontFamily: "var(--font-mono)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={{ marginBottom: 6, color: "var(--text-muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>Filter Override</div>
      {[
        { label: "Inherit from parent", desc: "Uses parent panel / grid filter", active: isInherit, value: null },
        { label: "Show All", desc: "Ignore all filters — show everything", active: isShowAll, value: {} },
        hasActive && { label: "Use Active Filter", desc: `${Object.keys(activeFilterValues).length} condition(s)`, active: isOwn, value: { ...activeFilterValues } },
      ].filter(Boolean).map((opt) => (
        <button
          key={opt.label}
          onClick={() => onSet(opt.value)}
          style={{
            display: "flex", flexDirection: "column", gap: 2,
            width: "100%", textAlign: "left", padding: "6px 8px",
            borderRadius: 6, marginBottom: 2, cursor: "pointer",
            background: opt.active ? "rgba(100,150,255,0.18)" : "transparent",
            border: opt.active ? "1px solid rgba(100,150,255,0.35)" : "1px solid transparent",
            color: opt.active ? "rgba(180,200,255,0.9)" : "var(--text-primary)",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 12 }}>{opt.label}</span>
          <span style={{ fontSize: 12, opacity: 0.55 }}>{opt.desc}</span>
        </button>
      ))}
    </div>
  );
}

