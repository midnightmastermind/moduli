// ui/FilterButton.jsx
// Small header button that opens FilterDropdown when the occurrence has active nav filters.
// Returns null when there are no active showNav filters.

import React, { useContext } from "react";
import { GridActionsContext } from "../GridActionsContext";
import FilterDropdown from "./FilterDropdown";
import { SlidersHorizontal } from "lucide-react";

export default function FilterButton({ occurrence, dispatch }) {
  const { filterNavState } = useContext(GridActionsContext);
  const activeNavFilters = (occurrence?.filters || []).filter(f => f.active && f.showNav);
  if (activeNavFilters.length === 0) return null;

  return (
    <FilterDropdown
      filters={occurrence.filters}
      filterNavState={filterNavState}
      dispatch={dispatch}
    >
      <button
        title="Filter nav"
        style={{
          background: "none", border: "none", cursor: "pointer",
          color: "var(--text-muted)", padding: "0 2px", display: "flex", alignItems: "center",
          opacity: 0.7,
        }}
      >
        <SlidersHorizontal size={11} />
      </button>
    </FilterDropdown>
  );
}
