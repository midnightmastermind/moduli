// The header of a Command Center category column — shared by the Fields and Operations tabs.
// A real category folder is renamed in place (blur or Enter commits a trimmed, non-blank, changed
// name); the Uncategorized column has no folder and renders as plain text.
import React from "react";

export default function CategoryColumnHeader({ label, folder, onRename }) {
  if (!folder) {
    return <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-faint)" }}>{label}</span>;
  }
  const commit = (e) => {
    const next = e.target.value.trim();
    if (next && next !== label) onRename?.(next);
  };
  return (
    <input
      defaultValue={label}
      key={label}
      aria-label="Category name"
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { commit(e); e.currentTarget.blur(); } }}
      style={{ background: "none", border: "none", outline: "none", fontSize: 10, fontFamily: "monospace", fontWeight: 600, color: "var(--text-muted)", width: "100%", cursor: "text" }}
    />
  );
}
