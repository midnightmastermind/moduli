// ui/commandCenter/ShortcutsTab.jsx
// ShortcutsTab — full audit of every keyboard / mouse / pointer
// shortcut wired up across the app (not aspirational — only what's
// actually handled in code). Organized by surface so a user can scan
// to the section relevant to where they're working.

import React from "react";

const SHORTCUT_GROUPS = [
  // ── App-wide ────────────────────────────────────────────────────
  {
    group: "Global",
    items: [
      { keys: ["Ctrl+Z"],       action: "Undo" },
      { keys: ["Ctrl+Y"],       action: "Redo" },
      { keys: ["Ctrl+Shift+Z"], action: "Redo (alt)" },
      { keys: ["Esc"],          action: "Close Command Center / dropdown / dialog" },
    ],
  },

  // ── Drag-and-drop modifiers ─────────────────────────────────────
  {
    group: "Drag & Drop",
    items: [
      { keys: ["Drag"],       action: "Move item to drop target" },
      { keys: ["Alt+Drag"],   action: "Copy item (mints a new occurrence)" },
      { keys: ["Shift+Drag"], action: "Copylink item (shares linkedGroupId — edits propagate)" },
    ],
  },

  // ── Multi-select ────────────────────────────────────────────────
  {
    group: "Multi-select",
    items: [
      { keys: ["Shift+click"],            action: "Add/remove instance or container from selection" },
      { keys: ["Shift+drag"],             action: "Rubber-band selects every CONTAINER fully inside the rectangle (+ their instances)" },
      { keys: ["Shift+Q (held)"],         action: "While rubber-banding: instance-only mode (≥ 1/3 overlap, containers excluded)" },
      { keys: ["Shift+Alt+drag"],         action: "Rubber-band REPLACES current selection (default adds)" },
      { keys: ["Esc"],                    action: "Cancel in-flight rubber-band drag (keeps existing selection)" },
      { keys: ["Right-click selected"],   action: "Bulk Copy / Move / Copy-link / Delete N items" },
      { keys: ["Right-click destination"], action: "Paste / Move / Paste-linked N items (alternate to hover-drop)" },
    ],
  },

  // ── Clipboard hover-drop mode (active while clipboard non-empty) ─
  {
    group: "Clipboard (after Copy / Move / Copy-link)",
    items: [
      { keys: ["Hover"],          action: "Mouse anywhere on grid highlights the hovered container/page in blue" },
      { keys: ["Click target"],   action: "Paste / Move / Paste-linked N items there" },
      { keys: ["Esc"],            action: "Clear clipboard + exit hover-drop mode" },
      { keys: ["Right-click anywhere"], action: "Clear clipboard" },
      { keys: ["Toolbar ✕"],     action: "Clear via the clipboard pill in the toolbar" },
    ],
  },

  // ── Inline rename (instance / container / page) ─────────────────
  {
    group: "Rename",
    items: [
      { keys: ["Dbl-click label"], action: "Edit instance / container / page label inline" },
      { keys: ["Enter"],           action: "Commit rename" },
      { keys: ["Esc"],             action: "Cancel rename" },
    ],
  },

  // ── Doc editor — formatting ─────────────────────────────────────
  {
    group: "Doc page · Formatting",
    items: [
      { keys: ["Ctrl+B"],  action: "Bold" },
      { keys: ["Ctrl+I"],  action: "Italic" },
      { keys: ["Ctrl+K"],  action: "Insert link" },
      { keys: ["# Space"], action: "Heading 1" },
      { keys: ["## Space"], action: "Heading 2" },
      { keys: ["### Space"], action: "Heading 3" },
      { keys: ["- Space"], action: "Bullet list" },
      { keys: ["1. Space"], action: "Ordered list" },
      { keys: ["> Space"], action: "Block quote" },
      { keys: ["```"],     action: "Code block" },
      { keys: ["---"],     action: "Horizontal rule" },
    ],
  },

  // ── Doc editor — pills, mentions, palette ───────────────────────
  {
    group: "Doc page · Pills & mentions",
    items: [
      { keys: ["@"],          action: "Insert field pill (picker opens)" },
      { keys: ["@:"],         action: "Embed a container by occurrence (picker opens)" },
      { keys: ["[["],         action: "Insert doc link" },
      { keys: ["="],          action: "Insert expression pill (live formula)" },
      { keys: ["/"],          action: "Open command palette (insert table / embed / etc.)" },
      { keys: ["Backspace"],  action: "Convert pill to plain text (or two-step delete)" },
      { keys: ["Shift+Backspace"], action: "Delete pill outright" },
    ],
  },

  // ── Doc editor — block handle / textblock sub-editor ────────────
  {
    group: "Doc page · Blocks & textblocks",
    items: [
      { keys: ["⠿ Drag"],     action: "Reorder block via gutter handle" },
      { keys: ["⋮"],          action: "Open block menu (change type / duplicate / delete)" },
      { keys: ["Enter"],      action: "Inside textblock — exit to next outer paragraph" },
      { keys: ["Shift+Enter"], action: "Inside textblock — soft break, or delete if empty" },
      { keys: ["ArrowUp/Down"], action: "Inside textblock — leaves the sub-editor at first/last line" },
    ],
  },

  // ── Table container — spreadsheet nav ───────────────────────────
  {
    group: "Table page / container",
    items: [
      { keys: ["Enter"],       action: "Commit cell and move down" },
      { keys: ["Shift+Enter"], action: "Soft break inside cell" },
      { keys: ["Tab"],         action: "Move right (commit cell)" },
      { keys: ["Shift+Tab"],   action: "Move left (commit cell)" },
      { keys: ["ArrowUp/Down"], action: "Move row when cursor at first/last line" },
      { keys: ["Esc"],         action: "Blur cell editor" },
      { keys: ["Fill-handle Drag"], action: "Copy / copylink across rows (Alt = copylink)" },
    ],
  },

  // ── Folder page — drilldown card grid ───────────────────────────
  {
    group: "Folder page",
    items: [
      { keys: ["Click card"],  action: "Drill into the card's page" },
      { keys: ["Esc"],         action: "Drill back out to parent folder" },
      { keys: ["ArrowLeft"],   action: "Peer nav — previous sibling page" },
      { keys: ["ArrowRight"],  action: "Peer nav — next sibling page" },
    ],
  },

  // ── Canvas page — drawing + connect tools ───────────────────────
  {
    group: "Canvas page",
    items: [
      { keys: ["Click toolbar"], action: "Switch tool (select / grab / connect / pen / line / rect / circle / eraser)" },
      { keys: ["Grab+Drag"],   action: "Pan the canvas world" },
      { keys: ["Drag to edge"], action: "Auto-scroll the world while dragging a card" },
      { keys: ["Connect+Drag card→card"], action: "Draw a bezier edge between cards" },
      { keys: ["Click edge"],  action: "(Connect mode) Delete the edge" },
      { keys: ["Undo"],        action: "Roll back the most recent stroke / edge — strokes + edges share one history" },
    ],
  },

  // ── Mobile grid nav ─────────────────────────────────────────────
  {
    group: "Mobile grid nav",
    items: [
      { keys: ["Rail tap"],    action: "Move active cell up / down / left / right" },
      { keys: ["MiniMap tap"], action: "Toggle zoomed-out grid overview" },
      { keys: ["Drag to edge"], action: "Pan active cell while dragging an item" },
    ],
  },

  // ── Picker / popover dismissals (Escape everywhere) ─────────────
  {
    group: "Dropdowns & pickers",
    items: [
      { keys: ["Esc"], action: "Close ContextMenu / RadialMenu / QuickAddMenu / HeaderDropdown" },
      { keys: ["Esc"], action: "Close ContainerKindSelector / PanelKindSelector / DrilldownPicker" },
      { keys: ["Esc"], action: "Close UserInputModal / PomodoroTimer panel / Toolbar filter dropdown" },
      { keys: ["ArrowUp/Down"], action: "Navigate items in command palette / doc-link suggestions" },
      { keys: ["Enter"],  action: "Select active item (or commit raw query)" },
    ],
  },
];

export function ShortcutsTab() {
  const keyBadge = (k, i) => (
    <span key={`${k}-${i}`} style={{
      padding: "1px 6px", borderRadius: 4, fontSize: 10, fontFamily: "monospace",
      background: "var(--border-subtle)", border: "1px solid var(--border-default)",
      color: "var(--text-primary)", boxShadow: "0 1px 2px rgba(0,0,0,0.4)",
      whiteSpace: "nowrap",
    }}>{k}</span>
  );

  return (
    <div style={{
      padding: "10px 14px",
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
      gap: 14,
    }}>
      {SHORTCUT_GROUPS.map(({ group, items }) => (
        <div key={group}>
          <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.8px" }}>
            {group}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {items.map(({ keys, action }, idx) => (
              <div key={`${action}-${idx}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>{action}</span>
                <span style={{ display: "flex", gap: 3, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {keys.map(keyBadge)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
