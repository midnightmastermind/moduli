// The header of a Command Center category column — shared by the Fields and Operations tabs.
// A real category folder is renamed in place (blur or Enter commits a trimmed, non-blank, changed
// name); the Uncategorized column has no folder and renders as plain text.
import React from "react";

// `onDelete` (optional) adds a × that deletes the category after a confirm; the caller moves its
// members to Uncategorized (CommitHelpers.deleteCategory). `count` names how many will move.
export default function CategoryColumnHeader({ label, folder, onRename, onDelete, count = 0 }) {
  if (!folder) {
    return <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-faint)" }}>{label}</span>;
  }
  const commit = (e) => {
    const next = e.target.value.trim();
    if (next && next !== label) onRename?.(next);
  };
  const input = (
    <input
      defaultValue={label}
      key={label}
      aria-label="Category name"
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { commit(e); e.currentTarget.blur(); } }}
      style={{ background: "none", border: "none", outline: "none", fontSize: 10, fontFamily: "monospace", fontWeight: 600, color: "var(--text-muted)", width: "100%", cursor: "text" }}
    />
  );
  if (!onDelete) return input;
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 2, width: "100%" }}>
      {input}
      <button
        type="button"
        title="Delete category"
        aria-label={`Delete category ${label}`}
        onClick={() => { if (window.confirm(`Delete the "${label}" category?${count ? ` Its ${count} item${count === 1 ? "" : "s"} will move to Uncategorized.` : ""}`)) onDelete(); }}
        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-faint)", fontSize: 11, padding: "0 2px", lineHeight: 1 }}
      >×</button>
    </span>
  );
}
