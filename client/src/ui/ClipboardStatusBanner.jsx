// ui/ClipboardStatusBanner.jsx
// Toolbar pill showing the current clipboard state (post Copy / Move /
// Copy-link from the selection right-click menu). Visible only when the
// clipboard is non-empty.
//
//   [📋 Copying 3 items]  ✕
//   [📋 Moving 1 item]    ✕
//   [📋 Copy-linking 2 items]  ✕
//
// Clicking the ✕ clears the clipboard. Clicking the pill itself is a
// no-op — pasting happens by clicking any container/page on the grid
// (handled by ClipboardDropOverlay).
//
// Mode → label + tint:
//   copy     — green   — "Copying N item(s)"
//   move     — amber   — "Moving N item(s)"
//   copylink — purple  — "Copy-linking N item(s)"

import React, { useContext } from "react";
import { Clipboard, X } from "lucide-react";
import { SelectionContext } from "../state/SelectionContext";

const MODE_LABEL = {
  copy:     "Copying",
  move:     "Moving",
  copylink: "Copy-linking",
};
const MODE_TINT = {
  copy:     { bg: "rgba(134,239,172,0.16)", border: "rgba(134,239,172,0.55)", text: "rgb(187,247,208)" },
  move:     { bg: "rgba(252,211,77,0.16)",  border: "rgba(252,211,77,0.55)",  text: "rgb(254,240,138)" },
  copylink: { bg: "rgba(196,181,253,0.16)", border: "rgba(196,181,253,0.55)", text: "rgb(221,214,254)" },
};

export default function ClipboardStatusBanner() {
  const selection = useContext(SelectionContext);
  const clip = selection?.clipboard;
  if (!clip || !clip.mode || !Array.isArray(clip.ids) || clip.ids.length === 0) return null;

  const tint = MODE_TINT[clip.mode] || MODE_TINT.copy;
  const label = MODE_LABEL[clip.mode] || clip.mode;
  const count = clip.ids.length;

  return (
    <div
      className="clipboard-status-banner"
      title="Click any container or page to paste. Right-click anywhere to clear."
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "3px 8px", borderRadius: 999,
        background: tint.bg, border: `1px solid ${tint.border}`,
        color: tint.text, fontSize: 11, fontFamily: "var(--font-mono)",
        userSelect: "none",
      }}
    >
      <Clipboard size={12} style={{ flexShrink: 0 }} />
      <span style={{ whiteSpace: "nowrap" }}>
        {label} {count} item{count === 1 ? "" : "s"}
      </span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); selection.clearClipboard(); }}
        title="Clear clipboard"
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: "transparent", border: "none", cursor: "pointer",
          color: tint.text, opacity: 0.75, padding: 0, marginLeft: 2,
        }}
      >
        <X size={12} />
      </button>
    </div>
  );
}
