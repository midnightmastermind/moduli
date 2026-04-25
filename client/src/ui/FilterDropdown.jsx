// ui/FilterDropdown.jsx
// Popover showing all active filters for an occurrence with nav controls.
// Props:
//   filters       — the occurrence's filters[] array
//   filterNavState — global nav values map
//   dispatch      — Redux dispatch (for setFilterNavAction)
//   children      — trigger element

import React, { useState, useRef, useEffect } from "react";
import FilterNavControl from "./FilterNavControl";
import { SlidersHorizontal } from "lucide-react";

export default function FilterDropdown({ filters, filterNavState, dispatch, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activeFilters = (filters || []).filter(f => f.active && f.showNav);
  if (activeFilters.length === 0) return null;

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <div onPointerDown={e => { e.stopPropagation(); setOpen(v => !v); }}>
        {children || (
          <button
            title="Filter nav"
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--text-muted)", padding: "0 2px", display: "flex", alignItems: "center",
            }}
          >
            <SlidersHorizontal size={11} />
          </button>
        )}
      </div>

      {open && (
        <div
          style={{
            position: "absolute", top: "100%", right: 0, zIndex: 200,
            background: "var(--surface-card)", border: "1px solid var(--border-default)",
            borderRadius: 6, padding: "8px 10px", minWidth: 160,
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            display: "flex", flexDirection: "column", gap: 8,
          }}
          onPointerDown={e => e.stopPropagation()}
        >
          {activeFilters.map(filter => (
            <div key={filter.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 9, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {filter.label || filter.fieldId || "filter"}
              </span>
              <FilterNavControl
                filter={filter}
                navValue={filterNavState?.[filter.id] ?? null}
                dispatch={dispatch}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
