// ui/SelectionStatusBanner.jsx
// Toolbar pill showing the current multi-select count (rubber-band or
// shift+click). Visible only when at least one item is selected.
//
//   [☑ 5 selected]  ✕
//
// Clicking ✕ clears the selection. Clipboard pill is separate (see
// ClipboardStatusBanner) — selection becomes clipboard via the
// right-click bulk-actions menu.

import React, { useContext } from "react";
import { CheckSquare, X } from "lucide-react";
import { SelectionContext } from "../state/SelectionContext";

export default function SelectionStatusBanner() {
  const selection = useContext(SelectionContext);
  const count = selection?.count ?? 0;
  if (count === 0) return null;

  return (
    <div
      className="selection-status-banner"
      title="Right-click any selected item for Copy / Move / Copy-link / Delete bulk actions."
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "3px 8px", borderRadius: 999,
        background: "rgba(59,130,246,0.16)",
        border: "1px solid rgba(59,130,246,0.55)",
        color: "rgb(191,219,254)",
        fontSize: 11, fontFamily: "var(--font-mono)",
        userSelect: "none",
      }}
    >
      <CheckSquare size={12} style={{ flexShrink: 0 }} />
      <span style={{ whiteSpace: "nowrap" }}>
        {count} selected
      </span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); selection.clear(); }}
        title="Clear selection (Esc)"
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: "transparent", border: "none", cursor: "pointer",
          color: "rgb(191,219,254)", opacity: 0.75, padding: 0, marginLeft: 2,
        }}
      >
        <X size={12} />
      </button>
    </div>
  );
}
