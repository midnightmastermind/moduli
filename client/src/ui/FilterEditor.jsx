// ui/FilterEditor.jsx
// Full overlay editor for defining filters[] on an occurrence.
// Each filter specifies: fieldId, active, showNav, timeUnit, defaultNavValue, condition.
// Props:
//   occurrence — the occurrence being edited
//   dispatch, socket — for CommitHelpers
//   onClose — close callback

import React, { useState, useCallback, useEffect, useRef } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import { useGridActions } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";

const TIME_UNITS = ["day", "week", "month", "year"];
const NAV_DEFAULTS = ["today", "startOfWeek", "startOfMonth"];

function uid() { return crypto.randomUUID(); }

export default function FilterEditor({ occurrence, dispatch, socket, onClose, focusFieldId = null }) {
  const { fieldsById } = useGridActions();
  const [filters, setFilters] = useState(() => occurrence?.filters || []);
  const rowRefs = useRef({});

  // If FiltersSection opened the editor on a specific row (cog button per row),
  // seed an empty row for that fieldId when missing and scroll it into view on mount.
  useEffect(() => {
    if (!focusFieldId) return;
    setFilters(prev => {
      if (prev.some(f => f.fieldId === focusFieldId)) return prev;
      return [...prev, {
        id: uid(), fieldId: focusFieldId, active: true, showNav: true,
        timeUnit: "day", defaultNavValue: "today", condition: null,
      }];
    });
    const t = requestAnimationFrame(() => {
      const el = rowRefs.current[focusFieldId];
      if (el?.scrollIntoView) el.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(t);
  }, [focusFieldId]);

  const save = useCallback(() => {
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: occurrence.id, filters }, emit: true });
    onClose?.();
  }, [occurrence, filters, dispatch, socket, onClose]);

  const update = (idx, patch) => {
    setFilters(prev => prev.map((f, i) => i === idx ? { ...f, ...patch } : f));
  };

  const add = () => {
    setFilters(prev => [...prev, {
      id: uid(), fieldId: "", active: true, showNav: true,
      timeUnit: "day", defaultNavValue: "today", condition: null,
    }]);
  };

  const remove = (idx) => setFilters(prev => prev.filter((_, i) => i !== idx));

  const dateFields = Object.values(fieldsById || {}).filter(f => f.type === "date");
  const allFields = Object.values(fieldsById || {});

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 500,
        background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onPointerDown={e => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        style={{
          background: "var(--surface-card)", border: "1px solid var(--border-default)",
          borderRadius: 8, padding: 20, width: 460, maxHeight: "80vh",
          overflow: "auto", display: "flex", flexDirection: "column", gap: 12,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
            Filters
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
            <X size={14} />
          </button>
        </div>

        {/* Filter rows */}
        {filters.map((f, idx) => (
          <div
            key={f.id}
            ref={el => { if (f.fieldId) rowRefs.current[f.fieldId] = el; }}
            style={{
              border: f.fieldId === focusFieldId ? "1px solid var(--accent-blue)" : "1px solid var(--border-default)",
              borderRadius: 6, padding: "10px 12px",
              display: "flex", flexDirection: "column", gap: 8, background: "var(--input-bg)",
            }}
          >
            {/* Row 1: field + active + showNav + delete */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <select
                value={f.fieldId}
                onChange={e => update(idx, { fieldId: e.target.value })}
                style={{ flex: 1, fontSize: 11, background: "var(--input-bg)", border: "1px solid var(--border-default)", color: "var(--text-muted)", borderRadius: 4, padding: "2px 4px" }}
              >
                <option value="">— field —</option>
                {allFields.map(field => (
                  <option key={field.id} value={field.id}>{field.label || field.name}</option>
                ))}
              </select>

              <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "var(--text-muted)", cursor: "pointer" }}>
                <input type="checkbox" checked={!!f.active} onChange={e => update(idx, { active: e.target.checked })} />
                active
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "var(--text-muted)", cursor: "pointer" }}>
                <input type="checkbox" checked={!!f.showNav} onChange={e => update(idx, { showNav: e.target.checked })} />
                nav
              </label>
              <button onClick={() => remove(idx)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--danger-text, #e55)" }}>
                <Trash2 size={12} />
              </button>
            </div>

            {/* Row 2: nav options — only date fields show unit/default. Selects show options list. */}
            {f.showNav && (() => {
              const selectedField = fieldsById?.[f.fieldId];
              const ftype = selectedField?.type;
              if (ftype === "date") {
                return (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 10, color: "var(--text-faint)" }}>unit:</span>
                    <select
                      value={f.timeUnit || "day"}
                      onChange={e => update(idx, { timeUnit: e.target.value })}
                      style={{ fontSize: 11, background: "var(--input-bg)", border: "1px solid var(--border-default)", color: "var(--text-muted)", borderRadius: 4, padding: "1px 4px" }}
                    >
                      {TIME_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <span style={{ fontSize: 10, color: "var(--text-faint)" }}>default:</span>
                    <select
                      value={f.defaultNavValue || "today"}
                      onChange={e => update(idx, { defaultNavValue: e.target.value })}
                      style={{ fontSize: 11, background: "var(--input-bg)", border: "1px solid var(--border-default)", color: "var(--text-muted)", borderRadius: 4, padding: "1px 4px" }}
                    >
                      {NAV_DEFAULTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                );
              }
              if (ftype === "select" || ftype === "boolean") {
                return (
                  <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
                    {ftype === "boolean" ? "nav: true / false toggle" : "nav: pick from field options"}
                  </div>
                );
              }
              if (ftype === "number" || ftype === "text") {
                return (
                  <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
                    nav: free {ftype} input
                  </div>
                );
              }
              return null;
            })()}

            {/* Row 3: allow-blank toggle + condition summary */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: "var(--text-faint)" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={!!f.allowBlank}
                  onChange={e => update(idx, { allowBlank: e.target.checked })}
                />
                allow blank
              </label>
              <span>
                {f.condition
                  ? `condition: ${f.condition.operator || "OR"} (${(f.condition.rules || []).length} rule${(f.condition.rules||[]).length !== 1 ? "s" : ""})`
                  : "no condition — always show"}
              </span>
            </div>
          </div>
        ))}

        {/* Add filter */}
        <button
          onClick={add}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            background: "none", border: "1px dashed var(--border-default)", borderRadius: 6,
            padding: "6px 10px", cursor: "pointer", color: "var(--text-muted)", fontSize: 11,
          }}
        >
          <Plus size={11} /> Add filter
        </button>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 4 }}>
          <button onClick={onClose} style={{ fontSize: 11, padding: "4px 12px", borderRadius: 4, background: "none", border: "1px solid var(--border-default)", cursor: "pointer", color: "var(--text-muted)" }}>
            Cancel
          </button>
          <button onClick={save} style={{ fontSize: 11, padding: "4px 12px", borderRadius: 4, background: "var(--accent-blue-bg)", border: "1px solid var(--accent-blue)", cursor: "pointer", color: "var(--accent-blue)" }}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
