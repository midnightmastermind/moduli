// client/src/ui/HeaderChevron.jsx
import React, { useContext, useMemo } from "react";
import { Filter } from "lucide-react";
import { GridActionsContext, useGridActions } from "../GridActionsContext";
import { getEffectiveFilterForOccurrence } from "../state/selectors";
import { summarizeSelection } from "./filterSummary";

// Muted swatches per user request — readable but not loud.
// active: any filter is effectively applied at this occurrence
// deactivated: occurrence has filters declared but all are muted / cleared
// none: no filter touches this occurrence — render default
const STATE_COLOR = {
  active:      "rgba(80, 150, 100, 0.85)",  // muted green
  deactivated: "rgba(170, 90, 90, 0.85)",   // muted red
  none:        null,
};

// Format a single filter value for the inline pill. Date fields use a
// compact "Mon, Mar 3" form; non-date fields fall back to a string
// cast. Supports both bare ISO date strings and the new period-shape
// `{ value, unit }` form (D/W/M/Y selector). Returns null when the
// value isn't worth rendering (empty / unresolvable).
function formatFilterValue(fieldId, value, fieldsById) {
  if (value == null || value === "") return null;
  const field = fieldsById?.[fieldId];
  const isDate = field?.type === "date";
  // Multi-shape detection: { kind: "multi", dates: ["YYYY-MM-DD", ...] }
  // List the actual days and contiguous ranges ("May 6, May 9–12, May 20").
  if (value && typeof value === "object" && value.kind === "multi" && Array.isArray(value.dates)) {
    if (!value.dates.length) return null;
    return summarizeSelection({ unit: "day", value: value.dates[0], dates: value.dates }, { maxSegments: 2 });
  }
  // Period-shape detection: { value: "YYYY-MM-DD", unit: "day|week|month|year" }
  const isPeriod = value && typeof value === "object" && "value" in value;
  if (isDate || isPeriod) {
    const dateStr = isPeriod ? value.value : value;
    const unit = isPeriod ? (value.unit || "day") : "day";
    if (typeof dateStr !== "string") return null;
    const span = isPeriod ? value.span : 1;
    const dates = isPeriod && Array.isArray(value.dates) ? value.dates : null;
    // Multi-day span / non-day period → shared listing (lists ranges + days).
    if (unit !== "day" || (span && span > 1) || (dates && dates.length)) {
      return summarizeSelection({ value: dateStr, unit, span, dates }, { maxSegments: 2 });
    }
    // Plain single day → keep the weekday for at-a-glance context.
    const d = new Date(dateStr.length === 10 ? `${dateStr}T00:00:00` : dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  if (typeof value === "object") {
    // Array (multi-select) or other shape — best-effort summary.
    if (Array.isArray(value)) return value.length ? `${value.length} selected` : null;
    return null;
  }
  return String(value);
}

/**
 * Detect filter state for this occurrence:
 *   - Grid's active named filter contributes its nav-condition fieldIds.
 *   - The occurrence's own `filters[]` entries (e.g. schedule's Time Slot)
 *     contribute their fieldIds when `active === true`.
 * For each contributing fieldId, "applied here" = the field is present in
 * the cascade-resolved `ownEffectiveFilter`. If any are applied → active;
 * if none are but some exist → deactivated; if no filters touch this
 * occurrence at all → none.
 */
function computeFilterState(occurrence, grid, ownEffectiveFilter) {
  if (!occurrence) return "none";
  const fieldIds = new Set();

  const activeFilter = (grid?.namedFilters || []).find(f => f.id === grid?.activeFilterId);
  for (const c of (activeFilter?.conditions || [])) {
    if (c?.fieldId && c?.isNav) fieldIds.add(c.fieldId);
  }
  for (const f of (occurrence.filters || [])) {
    if (f?.fieldId && f?.active !== false) fieldIds.add(f.fieldId);
  }

  if (!fieldIds.size) return "none";
  for (const fid of fieldIds) {
    if (fid in (ownEffectiveFilter || {})) return "active";
  }
  return "deactivated";
}

export default function HeaderChevron({ onClick, isOpen, occurrence = null }) {
  const ctx = useGridActions();
  const grid = ctx?.state?.grid;
  const occurrencesById = ctx?.occurrencesById;
  const fieldsById = ctx?.fieldsById;

  // Compute the cascade-resolved effective filter for this occurrence so the
  // icon color reflects the SAME thing FiltersSection's Active toggle uses.
  // Lazy: only when occurrence is passed (otherwise icon stays default-state).
  const ownEffectiveFilter = useMemo(() => {
    if (!occurrence) return null;
    return getEffectiveFilterForOccurrence(occurrence, { grid, occurrencesById });
  }, [occurrence, grid, occurrencesById]);

  const state = useMemo(
    () => computeFilterState(occurrence, grid, ownEffectiveFilter),
    [occurrence, grid, ownEffectiveFilter],
  );
  const color = STATE_COLOR[state];

  // Inline pill — shows the currently applied filter value(s) right next
  // to the filter button so the user can see what's filtered without
  // opening the chevron. One pill per effective-filter entry; date /
  // period values format compactly, multi-select shows "N selected".
  // Only renders when the filter is effectively ACTIVE (deactivated /
  // none state means there's nothing meaningful to surface).
  const pillEntries = useMemo(() => {
    if (state !== "active" || !ownEffectiveFilter) return [];
    return Object.entries(ownEffectiveFilter)
      .map(([fid, val]) => ({ fid, label: formatFilterValue(fid, val, fieldsById) }))
      .filter(e => e.label);
  }, [state, ownEffectiveFilter, fieldsById]);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <button
        type="button"
        onClick={onClick}
        className="header-chevron"
        aria-expanded={isOpen}
        title={
          state === "active" ? "Filters (active)"
            : state === "deactivated" ? "Filters (all deactivated)"
            : "Filters"
        }
        style={{
          background: "transparent", border: 0, padding: "2px 4px",
          cursor: "pointer", display: "inline-flex", alignItems: "center",
          opacity: isOpen ? 1 : 0.6,
        }}
      >
        <Filter
          size={13}
          // Filled when active OR deactivated — fills are the visible signal
          // the user asked for. Default (no filters) keeps the outline-only look.
          fill={color || "none"}
          stroke={color || "currentColor"}
        />
      </button>
      {pillEntries.map(({ fid, label }) => (
        <span
          key={fid}
          title={`Active filter: ${label}`}
          onClick={onClick}
          style={{
            display: "inline-flex", alignItems: "center",
            height: 18, padding: "0 6px",
            fontSize: 9, lineHeight: 1, whiteSpace: "nowrap",
            fontFamily: "var(--font-mono)",
            color: STATE_COLOR.active,
            background: "rgba(80, 150, 100, 0.10)",
            border: `1px solid rgba(80, 150, 100, 0.25)`,
            borderRadius: 999,
            cursor: "pointer", userSelect: "none",
          }}
        >
          {label}
        </span>
      ))}
    </span>
  );
}
