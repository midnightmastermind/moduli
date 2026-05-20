// client/src/ui/SortSection.jsx
// HeaderDropdown sort section. Sits next to FiltersSection.
//
// Per-occurrence LOCAL sort that affects direct children only. When set,
// children are auto-sorted by the picked key + direction regardless of
// drop position. When unset, drop position wins (default behavior).
//
// Persisted on `occurrence.meta.localSort = { fieldId, dir }`. Read by
// LayoutHelpers.applyLocalSort inside getContainerItemsWithOccurrences,
// and at the ModulePage containersList call site for board pages.

import React, { useContext, useMemo, useState } from "react";
import { ArrowUp, ArrowDown, X, ChevronDown } from "lucide-react";
import { GridActionsContext } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";

// SortSection reads `entity.meta.localSort` and persists either via the
// default occurrence update (when `entity` looks like an occurrence with
// an `id`) or via the supplied `onPersistSort(next)` callback (used by
// Grid.jsx to write through `CommitHelpers.updateGrid`). The two-mode
// design keeps the component reusable without subclassing.
//
// Back-compat shim: callers passing `occurrence={occ}` still work — the
// prop is treated as the entity. New callers should prefer
// `entity={entity} onPersistSort={(next) => ...}`.
export default function SortSection({ occurrence, entity, onPersistSort, labelOverride }) {
  const ctx = useContext(GridActionsContext);
  const { dispatch, socket, fieldsById } = ctx;
  const e = entity ?? occurrence ?? null;

  const localSort = e?.meta?.localSort || null;
  const [pickerOpen, setPickerOpen] = useState(false);

  const fields = useMemo(() => {
    if (!fieldsById) return [];
    return Object.values(fieldsById)
      .filter(f => f && f.name)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [fieldsById]);

  const currentLabel = useMemo(() => {
    if (!localSort) return null;
    if (localSort.fieldId === "label") return "Label";
    return fieldsById?.[localSort.fieldId]?.name || localSort.fieldId;
  }, [localSort, fieldsById]);

  const persist = (next) => {
    if (onPersistSort) { onPersistSort(next); return; }
    if (!e?.id) return;
    const nextMeta = { ...(e.meta || {}), localSort: next };
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: e.id, meta: nextMeta },
      emit: true,
    });
  };

  const pickField = (fieldId) => {
    persist({ fieldId, dir: localSort?.dir || "asc" });
    setPickerOpen(false);
  };

  const toggleDir = () => {
    if (!localSort) return;
    persist({ ...localSort, dir: localSort.dir === "asc" ? "desc" : "asc" });
  };

  const clear = () => persist(null);

  return (
    <div className="header-dropdown-section" style={{ padding: "6px 8px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
          {labelOverride || "Sort children"}
        </span>
        {localSort && (
          <button
            type="button"
            onClick={clear}
            title="Clear sort (use drop order)"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2, lineHeight: 0 }}
          >
            <X size={11} />
          </button>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 4, position: "relative" }}>
        <button
          type="button"
          onClick={() => setPickerOpen(v => !v)}
          style={{
            flex: 1, minWidth: 0,
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4,
            padding: "4px 8px",
            border: "1px solid var(--border-default, #374151)",
            borderRadius: 4,
            background: "var(--input-bg, transparent)",
            color: localSort ? "var(--text-primary)" : "var(--text-muted)",
            fontSize: 11, fontFamily: "var(--font-mono)",
            cursor: "pointer",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {currentLabel || "Pick field…"}
          </span>
          <ChevronDown size={10} />
        </button>
        <button
          type="button"
          onClick={toggleDir}
          disabled={!localSort}
          title={localSort?.dir === "desc" ? "Descending — click to flip" : "Ascending — click to flip"}
          style={{
            padding: "4px 6px",
            border: "1px solid var(--border-default, #374151)",
            borderRadius: 4,
            background: localSort ? "var(--input-bg)" : "transparent",
            color: localSort ? "var(--text-primary)" : "var(--text-faint)",
            cursor: localSort ? "pointer" : "not-allowed",
            display: "inline-flex", alignItems: "center",
          }}
        >
          {localSort?.dir === "desc" ? <ArrowDown size={11} /> : <ArrowUp size={11} />}
        </button>
      </div>

      {pickerOpen && (
        <div
          style={{
            position: "absolute", zIndex: 30,
            marginTop: 4,
            maxHeight: 240, overflowY: "auto",
            background: "hsl(var(--popover-1, 220 14% 14%))",
            border: "1px solid var(--border-default, #374151)",
            borderRadius: 4,
            boxShadow: "0 6px 16px rgba(0,0,0,0.35)",
            width: 220,
            padding: 4,
          }}
          onMouseLeave={() => setPickerOpen(false)}
        >
          <button
            type="button"
            onClick={() => pickField("label")}
            style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "5px 8px",
              background: localSort?.fieldId === "label" ? "var(--input-bg)" : "transparent",
              border: "none", color: "var(--text-primary)",
              cursor: "pointer", fontSize: 11, fontFamily: "var(--font-mono)",
              borderRadius: 3,
            }}
          >
            Label
          </button>
          {fields.map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => pickField(f.id)}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "5px 8px",
                background: localSort?.fieldId === f.id ? "var(--input-bg)" : "transparent",
                border: "none", color: "var(--text-primary)",
                cursor: "pointer", fontSize: 11, fontFamily: "var(--font-mono)",
                borderRadius: 3,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {f.name}
            </button>
          ))}
          {fields.length === 0 && (
            <div style={{ padding: "5px 8px", fontSize: 11, color: "var(--text-faint)" }}>
              (no fields)
            </div>
          )}
        </div>
      )}
    </div>
  );
}
