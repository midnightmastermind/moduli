// ui/MenuTabs.jsx
// ============================================================
// TABS FOR THE PAGE / PANEL SETTINGS MENU.
//
// User, 2026-08-25: "put each part of that menu into tabbed areas, its too
// long atm". The page menu stacked EIGHT sections (Filters, Feed, Graph, Sort,
// Field visibility, Field bindings, View mode, Layout cascade) into one
// scrolling column, so reaching the cascade meant scrolling past everything.
//
// SORT IS ITS OWN TAB BESIDE FILTER, at the user's explicit direction, rather
// than folded in with it. They are the two controls that change what is ON
// SCREEN right now, so they sit first and neither is a click deeper than the
// other.
//
// A TAB WITH NO CONTENT IS NOT RENDERED, and that is what lets both call sites
// share one definition. `ModulePanel` carries four of the eight sections and
// simply has no Data tab — without this the panel menu would show an empty
// tab, and the alternative (a second tab list for panels) is the "two copies
// that drift" shape this repo keeps paying for.
//
// The tab strip does not scroll with the body: the dropdown caps its own
// height and scrolls its content, so a strip inside that scroller would leave
// you unable to switch tabs from the bottom of a long one.
// ============================================================
import { useState } from "react";

export default function MenuTabs({ tabs = [], initialId = null }) {
  const live = tabs.filter(t => t && t.content != null &&
    !(Array.isArray(t.content) && t.content.filter(Boolean).length === 0));
  const [activeId, setActiveId] = useState(initialId || live[0]?.id || null);
  if (live.length === 0) return null;
  // A remembered tab whose section is absent on THIS surface falls back to the
  // first rather than rendering nothing.
  const active = live.find(t => t.id === activeId) || live[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div
        role="tablist"
        style={{
          display: "flex", gap: 2, flexShrink: 0, padding: "2px 4px 0",
          borderBottom: "1px solid var(--border-subtle)", overflowX: "auto",
        }}
      >
        {live.map(t => {
          const on = t.id === active.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setActiveId(t.id)}
              style={{
                appearance: "none", background: "none", cursor: "pointer",
                border: 0, borderBottom: `2px solid ${on ? "var(--accent-blue)" : "transparent"}`,
                padding: "5px 9px", whiteSpace: "nowrap",
                fontFamily: "var(--font-mono)", fontSize: 12,
                fontWeight: on ? 600 : 500,
                // The 2026-08-25 contrast pass: an inactive tab still has to be
                // READ, so it takes muted ink rather than a faint wash.
                color: on ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div style={{ minHeight: 0, overflow: "auto" }}>{active.content}</div>
    </div>
  );
}
