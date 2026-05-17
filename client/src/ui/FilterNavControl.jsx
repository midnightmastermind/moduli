// ui/FilterNavControl.jsx
// Field-type-aware nav control for a single filter.
// Renders appropriate input based on the filter's field type:
//   date   → prev/next day arrows + date label
//   select → chip list (click to toggle)
//   number → +/- stepper
//   boolean→ toggle
//   text   → text input

import React, { useContext, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { GridActionsContext } from "../GridActionsContext";
import { setFilterNavAction } from "../state/actions";
import { resolveOptions } from "../helpers/optionsResolver";

function localDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(isoDate, n) {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localDay(d);
}

function formatDate(isoDate) {
  if (!isoDate) return "";
  const d = new Date(isoDate + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function FilterNavControl({ filter, navValue, dispatch }) {
  const { fieldsById } = useContext(GridActionsContext);
  const field = filter?.fieldId ? fieldsById?.[filter.fieldId] : null;
  const fieldType = field?.type || "text";

  const set = useCallback((val) => {
    dispatch(setFilterNavAction(filter.id, val));
  }, [dispatch, filter.id]);

  if (fieldType === "date") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <button
          onClick={() => set(addDays(navValue || localDay(new Date()), -1))}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "0 2px" }}
        >
          <ChevronLeft size={13} />
        </button>
        <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", minWidth: 60, textAlign: "center" }}>
          {formatDate(navValue)}
        </span>
        <button
          onClick={() => set(addDays(navValue || localDay(new Date()), 1))}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "0 2px" }}
        >
          <ChevronRight size={13} />
        </button>
      </div>
    );
  }

  if (fieldType === "select") {
    const options = resolveOptions(field, {}).options.map(o => o.value);
    const current = Array.isArray(navValue) ? navValue : (navValue ? [navValue] : []);
    const toggle = (opt) => {
      const next = current.includes(opt)
        ? current.filter(v => v !== opt)
        : [...current, opt];
      set(next);
    };
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap" }}>
        {options.map(opt => (
          <button
            key={opt}
            onClick={() => toggle(opt)}
            style={{
              fontSize: 10, padding: "1px 6px", borderRadius: 999, cursor: "pointer",
              border: "1px solid var(--border-default)",
              background: current.includes(opt) ? "var(--accent-blue-bg)" : "transparent",
              color: current.includes(opt) ? "var(--accent-blue)" : "var(--text-muted)",
            }}
          >
            {opt}
          </button>
        ))}
      </div>
    );
  }

  if (fieldType === "number") {
    const val = typeof navValue === "number" ? navValue : 0;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <button onClick={() => set(val - 1)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>−</button>
        <span style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 24, textAlign: "center", fontFamily: "var(--font-mono)" }}>{val}</span>
        <button onClick={() => set(val + 1)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>+</button>
      </div>
    );
  }

  if (fieldType === "boolean") {
    return (
      <button
        onClick={() => set(!navValue)}
        style={{
          fontSize: 10, padding: "1px 8px", borderRadius: 999, cursor: "pointer",
          border: "1px solid var(--border-default)",
          background: navValue ? "var(--accent-blue-bg)" : "transparent",
          color: navValue ? "var(--accent-blue)" : "var(--text-muted)",
        }}
      >
        {navValue ? "On" : "Off"}
      </button>
    );
  }

  // text fallback
  return (
    <input
      value={navValue || ""}
      onChange={e => set(e.target.value)}
      placeholder={field?.label || "filter…"}
      style={{
        fontSize: 11, padding: "1px 4px", borderRadius: 3, width: 80,
        background: "var(--input-bg)", border: "1px solid var(--border-default)",
        color: "var(--text-muted)", fontFamily: "var(--font-mono)",
      }}
    />
  );
}
