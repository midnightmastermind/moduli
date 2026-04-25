// ui/Multiselect.jsx — multi-select item list with checkboxes and a Done button.
import React, { useState, useMemo, useRef, useEffect } from "react";

const itemSt = (hovered) => ({
  display: "flex", alignItems: "center", gap: 8,
  padding: "5px 10px", cursor: "pointer", userSelect: "none",
  fontFamily: "var(--font-mono)", fontSize: 11,
  color: hovered ? "var(--accent-blue-text)" : "var(--text-primary)",
  background: hovered ? "var(--accent-blue-bg)" : "transparent",
});

const checkboxSt = (checked) => ({
  width: 12, height: 12, borderRadius: 2, flexShrink: 0,
  border: `1px solid ${checked ? "var(--accent-blue-border)" : "var(--border-default)"}`,
  background: checked ? "var(--accent-blue-bg)" : "transparent",
  display: "flex", alignItems: "center", justifyContent: "center",
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

const doneBtnSt = {
  width: "100%", padding: "5px 10px", textAlign: "center",
  fontSize: 10, fontFamily: "var(--font-mono)", cursor: "pointer",
  background: "var(--accent-blue-bg)", border: "none",
  borderTop: "1px solid var(--border-subtle)",
  color: "var(--accent-blue-text)", fontWeight: 600,
};

/**
 * Multi-select item list.
 * @param {{ items, selectedValues: string[], onDone: fn(selectedValues), searchable?: bool }} props
 */
export default function Multiselect({ items, selectedValues = [], onDone, searchable = false }) {
  const [selected, setSelected] = useState(new Set(selectedValues));
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

  const toggle = (value) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

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
      <div style={{ overflowY: "auto", maxHeight: 240 }}>
        {filtered.length === 0 && (
          <div style={{ padding: "8px 10px", fontSize: 10, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
            No results
          </div>
        )}
        {filtered.map((it, i) => {
          const checked = selected.has(it.value);
          return (
            <div
              key={it.value}
              style={{ ...itemSt(hoveredIdx === i), opacity: it.disabled ? 0.4 : 1 }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(-1)}
              onMouseDown={e => { e.preventDefault(); if (!it.disabled) toggle(it.value); }}
            >
              <div style={checkboxSt(checked)}>
                {checked && <span style={{ fontSize: 8, color: "var(--accent-blue-text)", lineHeight: 1 }}>✓</span>}
              </div>
              <span style={{ flex: 1, minWidth: 0 }}>
                {it.title}
                {it.sub && it.sub !== it.title && (
                  <span style={{ color: "var(--text-faint)", marginLeft: 6, fontSize: 9 }}>{it.sub}</span>
                )}
                {it.hint && <span style={hintSt}>{it.hint}</span>}
              </span>
            </div>
          );
        })}
      </div>
      <button style={doneBtnSt} onMouseDown={e => { e.preventDefault(); onDone([...selected]); }}>
        Done ({selected.size} selected)
      </button>
    </div>
  );
}
