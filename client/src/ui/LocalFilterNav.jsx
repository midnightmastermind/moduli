// ui/LocalFilterNav.jsx
// Renders per-filter nav widgets. Default: any active grid filter whose conditions
// include `isNav: true` shows nav for the configured field. Per-occurrence opt-in
// via `filterNavConfig[filterId].visible === true` adds extras; opt-out via
// `filterNavConfig[filterId].visible === false` hides defaults for THIS occurrence.
import React, { useContext } from "react";
import { GridActionsContext } from "../GridActionsContext";
import FilterNavWidget from "./FilterNavWidgets";

export default function LocalFilterNav({ occurrence, compact = false }) {
  const { state: ctxState, dispatch, fieldsById } = useContext(GridActionsContext);
  if (!occurrence) return null;

  const grid = ctxState?.grid;
  const filters = grid?.namedFilters || [];
  const activeFilterId = grid?.activeFilterId;
  const navConfig = occurrence.filterNavConfig || {};
  const overrides = occurrence.filterOverride || {};
  const navValues = grid?.activeFilterValues || {};

  // Decide which filters render nav
  const items = [];
  for (const f of filters) {
    const cfg = navConfig[f.id];
    const explicitOff = cfg && cfg.visible === false;
    if (explicitOff) continue;
    const explicitOn = cfg && cfg.visible === true;
    const isActiveDefault = f.id === activeFilterId
      && Array.isArray(f.conditions)
      && f.conditions.some(c => c?.isNav);
    if (!explicitOn && !isActiveDefault) continue;

    // For default-driven nav, the "field" is the first isNav condition's fieldId.
    // For opt-in, fall back to filter.primaryDateFieldId.
    const navCondition = (f.conditions || []).find(c => c?.isNav && c.fieldId);
    const fieldId = navCondition?.fieldId || f.primaryDateFieldId || null;
    items.push({ filter: f, fieldId, cfg });
  }

  if (!items.length) return null;

  return (
    <div style={{
      display: "flex", flexWrap: "wrap", alignItems: "center",
      gap: compact ? 6 : 10,
      fontSize: 10,
    }}>
      {items.map(({ filter, fieldId, cfg }) => {
        const own = fieldId ? overrides[fieldId] : undefined;
        const value = own !== undefined ? own : (fieldId ? navValues[fieldId] : undefined);
        return (
          <FilterNavWidget
            key={filter.id}
            filter={fieldId && !filter.primaryDateFieldId ? { ...filter, primaryDateFieldId: fieldId } : filter}
            navConfig={cfg}
            value={value}
            fieldsById={fieldsById}
            dispatch={dispatch}
          />
        );
      })}
    </div>
  );
}
