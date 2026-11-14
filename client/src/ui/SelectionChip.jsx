// ui/SelectionChip.jsx
//
// Says that a selection exists, how big it is, and how to end it. A multi-selection was only visible as outlines on
// the rows themselves, and a staged paste (Copy / Move / Copy-link N selected) showed nothing at all, so a click
// "somewhere" pasted with no warning. Pressing the chip keeps the selection (`data-selection-keep`, read by
// state/SelectionContext.pressKeepsSelection); its × ends it, the same as Escape.

import { useContext } from "react";
import { X } from "lucide-react";
import { SelectionContext } from "../state/SelectionContext";

const MODE_VERB = { copy: "copy", move: "move", copylink: "copy-link" };

/** The chip's text, or null when there is nothing to say. Pure. */
export function selectionChipText({ count = 0, clipboard = null } = {}) {
  const staged = clipboard?.mode && Array.isArray(clipboard.ids) ? clipboard.ids.length : 0;
  if (staged > 0) return `Click a container or page to ${MODE_VERB[clipboard.mode] || "paste"} ${staged} here · Esc to cancel`;
  if (count > 0) return `${count} selected · Esc to clear`;
  return null;
}

export default function SelectionChip() {
  const selection = useContext(SelectionContext);
  const text = selectionChipText({ count: selection?.count || 0, clipboard: selection?.clipboard });
  if (!text) return null;
  const staged = !!selection?.clipboard?.mode;
  const end = () => (staged ? selection.clearClipboard?.() : selection.clear?.());
  return (
    <div
      data-selection-keep
      role="status"
      aria-live="polite"
      className="selection-chip"
      style={{
        position: "fixed", left: "50%", bottom: 16, transform: "translateX(-50%)", zIndex: 1200,
        display: "flex", alignItems: "center", gap: 8, padding: "6px 8px 6px 12px",
        borderRadius: 999, background: "var(--surface-card)", color: "var(--text-primary)",
        border: "1px solid var(--border-default)", boxShadow: "var(--menu-shadow-2)",
        fontSize: 12, whiteSpace: "nowrap", pointerEvents: "auto",
      }}
    >
      <span>{text}</span>
      <button
        type="button"
        aria-label={staged ? "Cancel the paste" : "Clear the selection"}
        onClick={end}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24,
          borderRadius: 999, border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
