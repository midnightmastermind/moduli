// client/src/ui/HeaderChevron.jsx
import React, { useContext, useMemo } from "react";
import { Filter } from "lucide-react";
import { GridActionsContext } from "../GridActionsContext";
import { getEffectiveFilterForOccurrence } from "../state/selectors";

// Muted swatches per user request — readable but not loud.
// active: any filter is effectively applied at this occurrence
// deactivated: occurrence has filters declared but all are muted / cleared
// none: no filter touches this occurrence — render default
const STATE_COLOR = {
  active:      "rgba(80, 150, 100, 0.85)",  // muted green
  deactivated: "rgba(170, 90, 90, 0.85)",   // muted red
  none:        null,
};

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
  const ctx = useContext(GridActionsContext);
  const grid = ctx?.state?.grid;
  const occurrencesById = ctx?.occurrencesById;

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

  return (
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
  );
}
