// ui/Select.jsx — single-select item list: used as one "page" inside SelectDrilldown.
import React, { useState, useMemo, useRef, useEffect } from "react";

const itemSt = (hovered) => ({
  display: "flex", alignItems: "center", gap: 6,
  padding: "5px 10px", cursor: "pointer", userSelect: "none",
  fontFamily: "var(--font-mono)", fontSize: 11,
  color: hovered ? "var(--accent-blue-text)" : "var(--text-primary)",
  background: hovered ? "var(--accent-blue-bg)" : "transparent",
});

const hintSt = {
  display: "block", fontSize: 9, color: "var(--text-faint)",
  fontFamily: "var(--font-mono)", marginTop: 1,
};

const searchSt = {
  width: "100%", boxSizing: "border-box",
  padding: "5px 10px", fontSize: 11, fontFamily: "var(--font-mono)",
  background: "transparent", border: "none", borderBottom: "1px solid var(--border-subtle)",
  color: "var(--text-primary)", outline: "none",
};

/**
 * Single-select item list.
 * @param {{ items: Array<{value,title,sub?,hint?,disabled?,hasChildren?}>, onSelect: fn, searchable?: bool }} props
 */
export default function Select({ items, onSelect, searchable = false }) {
  const [query, setQuery] = useState("");
  const [hoveredIdx, setHoveredIdx] = useState(-1);
  const searchRef = useRef(null);

  useEffect(() => {
    if (searchable) searchRef.current?.focus();
  }, [searchable]);

  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter(it => it.title.toLowerCase().includes(q) || it.sub?.toLowerCase().includes(q));
  }, [items, query]);

  return (
    <div>
      {searchable && (
        <input
          ref={searchRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setHoveredIdx(-1); }}
          placeholder="Search…"
          style={searchSt}
        />
      )}
      <div style={{ overflowY: "auto", maxHeight: 260 }}>
        {filtered.length === 0 && (
          <div style={{ padding: "8px 10px", fontSize: 10, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
            No results
          </div>
        )}
        {filtered.map((it, i) => (
          <div
            key={it.value}
            style={{ ...itemSt(hoveredIdx === i), opacity: it.disabled ? 0.4 : 1 }}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(-1)}
            onMouseDown={e => { e.preventDefault(); if (!it.disabled) onSelect(it); }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              {it.title}
              {it.sub && it.sub !== it.title && (
                <span style={{ color: "var(--text-faint)", marginLeft: 6, fontSize: 9 }}>{it.sub}</span>
              )}
              {it.hint && <span style={hintSt}>{it.hint}</span>}
            </span>
            {it.hasChildren && (
              <span style={{ color: "var(--text-faint)", fontSize: 10 }}>›</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
