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

import React, { useMemo } from "react";
import { ArrowUp, ArrowDown, X } from "lucide-react";
import FieldSelect from "./FieldSelect.jsx";
import { useGridActions } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { MENU_CAPTION } from "./menuText";

// SortSection reads `entity.meta.localSort` and persists either via the
// default occurrence update (when `entity` looks like an occurrence with
// an `id`) or via the supplied `onPersistSort(next)` callback (used by
// Grid.jsx to write through `CommitHelpers.updateGrid`). The two-mode
// design keeps the component reusable without subclassing.
//
// Back-compat shim: callers passing `occurrence={occ}` still work — the
// prop is treated as the entity. New callers should prefer
// `entity={entity} onPersistSort={(next) => ...}`.
const SORT_EXTRA_OPTIONS = [{ value: "label", label: "Label", hint: "name" }];

export default function SortSection({ occurrence, entity, onPersistSort, labelOverride }) {
  const ctx = useGridActions();
  const { dispatch, socket, fieldsById } = ctx;
  const e = entity ?? occurrence ?? null;

  const localSort = e?.meta?.localSort || null;

  const fields = useMemo(() => {
    if (!fieldsById) return [];
    return Object.values(fieldsById)
      .filter(f => f && f.name)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [fieldsById]);

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
    if (!fieldId) { persist(null); return; }
    persist({ fieldId, dir: localSort?.dir || "asc" });
  };

  const toggleDir = () => {
    if (!localSort) return;
    persist({ ...localSort, dir: localSort.dir === "asc" ? "desc" : "asc" });
  };

  const clear = () => persist(null);

  return (
    <div className="header-dropdown-section" style={{ padding: "6px 8px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={MENU_CAPTION}>
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
        {/* The searchable field picker every other "which field?" uses. This
            list was hand-rolled buttons, so the 2026-09-28 sweep (which looked
            for native <select>s) missed it and the sort stayed a scroll through
            every field on the grid. */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <FieldSelect
            fields={fields}
            value={localSort?.fieldId || null}
            onChange={pickField}
            extraOptions={SORT_EXTRA_OPTIONS}
            placeholder="Pick field…"
            searchPlaceholder="Search fields to sort by…"
            ariaLabel="Sort by field"
          />
        </div>
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
            color: localSort ? "var(--text-primary)" : "var(--text-muted)",
            cursor: localSort ? "pointer" : "not-allowed",
            display: "inline-flex", alignItems: "center",
          }}
        >
          {localSort?.dir === "desc" ? <ArrowDown size={11} /> : <ArrowUp size={11} />}
        </button>
      </div>

    </div>
  );
}
