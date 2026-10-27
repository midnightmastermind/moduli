// ui/LayoutDragOverlay.jsx
// The row-layout editor's drag feedback: the blue line where the drop lands and the
// chip that follows the pointer. Portalled to <body>: the settings popup is transformed,
// and a transformed ancestor makes position:fixed relative to IT (measured 73px/234px
// off the chip it named, 2026-10-27).
import React from "react";
import { createPortal } from "react-dom";

export default function LayoutDragOverlay({ drag, chipStyle }) {
  if (!drag) return null;
  return createPortal(
    <>
      {drag.target && (
        <div data-testid="layout-drop-line" style={{
          position: "fixed", ...drag.target.line, background: "var(--accent-blue)", borderRadius: 2,
          pointerEvents: "none", zIndex: 99999,
        }} />
      )}
      <div style={{
        position: "fixed", left: drag.x + 12, top: drag.y + 8, ...chipStyle, padding: "3px 10px",
        pointerEvents: "none", zIndex: 99999, opacity: 0.9, boxShadow: "var(--menu-shadow-1)",
      }}>{drag.label}</div>
    </>,
    document.body,
  );
}
