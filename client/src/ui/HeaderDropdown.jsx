// client/src/ui/HeaderDropdown.jsx
import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export default function HeaderDropdown({ anchorRect, onClose, children }) {
  const ref = useRef(null);

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

  if (!anchorRect) return null;
  const top = anchorRect.bottom + 4;
  const left = anchorRect.left;

  return createPortal(
    <div
      ref={ref}
      className="header-dropdown"
      role="dialog"
      style={{
        position: "fixed", top, left, zIndex: 1000,
        minWidth: 280, maxWidth: 360,
        background: "var(--panel-bg, #1f2937)",
        color: "var(--panel-fg, #f3f4f6)",
        border: "1px solid var(--panel-border, #374151)",
        borderRadius: 8, padding: 12,
        boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
}
