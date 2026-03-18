// ui/commandCenter/ShortcutsTab.jsx
// ShortcutsTab

import React from "react";

const SHORTCUT_GROUPS = [
  {
    group: "Global",
    items: [
      { keys: ["Ctrl+Z"], action: "Undo" },
      { keys: ["Ctrl+Y"], action: "Redo" },
      { keys: ["Ctrl+Shift+Z"], action: "Redo (alt)" },
    ],
  },
  {
    group: "Drag & Drop",
    items: [
      { keys: ["Drag"], action: "Move item" },
      { keys: ["Alt+Drag"], action: "Copy item" },
      { keys: ["Shift+Drag"], action: "Copylink item" },
    ],
  },
  {
    group: "Doc Editor",
    items: [
      { keys: ["@"], action: "Insert field pill" },
      { keys: ["[["], action: "Insert doc link" },
      { keys: ["Ctrl+B"], action: "Bold" },
      { keys: ["Ctrl+I"], action: "Italic" },
      { keys: ["Ctrl+K"], action: "Insert link" },
      { keys: ["# Space"], action: "Heading 1" },
      { keys: ["## Space"], action: "Heading 2" },
      { keys: ["- Space"], action: "Bullet list" },
      { keys: ["1. Space"], action: "Ordered list" },
      { keys: ["[ ]"], action: "Task item" },
    ],
  },
  {
    group: "Panel / Container",
    items: [
      { keys: ["Dbl-click item"], action: "Focus instance" },
      { keys: ["Esc"], action: "Exit focused view" },
      { keys: ["Handle+Drag"], action: "Move panel/container" },
    ],
  },
];

export function ShortcutsTab() {
  const keyBadge = (k) => (
    <span key={k} style={{
      padding: "1px 6px", borderRadius: 4, fontSize: 10, fontFamily: "monospace",
      background: "var(--border-subtle)", border: "1px solid var(--border-default)",
      color: "var(--text-primary)", boxShadow: "0 1px 2px rgba(0,0,0,0.4)",
    }}>{k}</span>
  );

  return (
    <div style={{
      padding: "10px 14px",
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
      gap: 12,
    }}>
      {SHORTCUT_GROUPS.map(({ group, items }) => (
        <div key={group}>
          <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.8px" }}>
            {group}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {items.map(({ keys, action }) => (
              <div key={action} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>{action}</span>
                <span style={{ display: "flex", gap: 3, flexShrink: 0 }}>{keys.map(keyBadge)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
