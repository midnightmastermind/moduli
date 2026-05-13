// ui/LocalFilterNav.jsx
// Renders per-filter nav widgets for an occurrence based on occurrence.filterNavConfig.
// Each entry in filterNavConfig that has { visible: true } produces a FilterNavWidget
// dispatched by style (arrows / pills / input / custom).
import React, { useContext } from "react";
import { GridActionsContext } from "../GridActionsContext";
import FilterNavWidget from "./FilterNavWidgets";

export default function LocalFilterNav({ occurrence, compact = false }) {
  const { state: ctxState, dispatch, fieldsById } = useContext(GridActionsContext);
  if (!occurrence) return null;

  const grid = ctxState?.grid;
  const filters = grid?.namedFilters || [];
  const navConfig = occurrence.filterNavConfig || {};
  const overrides = occurrence.filterOverride || {};
  const navValues = grid?.activeFilterValues || {};

  const visible = filters.filter(f => navConfig[f.id]?.visible);
  if (!visible.length) return null;

  return (
    <div style={{
      display: "flex", flexWrap: "wrap", alignItems: "center",
      gap: compact ? 6 : 10,
      fontSize: 10,
    }}>
      {visible.map(f => {
        const fieldId = f.primaryDateFieldId;
        const own = fieldId ? overrides[fieldId] : undefined;
        const value = own !== undefined ? own : (fieldId ? navValues[fieldId] : undefined);
        return (
          <FilterNavWidget
            key={f.id}
            filter={f}
            navConfig={navConfig[f.id]}
            value={value}
            fieldsById={fieldsById}
            dispatch={dispatch}
          />
        );
      })}
    </div>
  );
}
