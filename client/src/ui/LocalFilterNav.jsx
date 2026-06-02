// ui/LocalFilterNav.jsx
// Renders per-filter nav widgets. Default: any active grid filter whose conditions
// include `isNav: true` shows nav for the configured field. Per-occurrence opt-in
// via `filterNavConfig[filterId].visible === true` adds extras; opt-out via
// `filterNavConfig[filterId].visible === false` hides defaults for THIS occurrence.
// Auto-hide: if the filter's nav field isn't in this occurrence's effective
// filter (cleared by own override or any ancestor), the widget is suppressed
// even when defaults would otherwise show it. Matches FiltersSection's
// effectivelyActive check + the user's "deactivated → no nav" rule.
import React, { useContext, useMemo } from "react";
import { GridActionsContext, useGridActions } from "../GridActionsContext";
import FilterNavWidget from "./FilterNavWidgets";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { getEffectiveFilterForOccurrence } from "../state/selectors";

export default function LocalFilterNav({ occurrence, compact = false }) {
  const { state: ctxState, dispatch, fieldsById, occurrencesById, modulesById, foldersById, socket } = useGridActions();
  if (!occurrence) return null;

  const grid = ctxState?.grid;
  const filters = grid?.namedFilters || [];
  const activeFilterId = grid?.activeFilterId;
  const navConfig = occurrence.filterNavConfig || {};
  const overrides = occurrence.filterOverride || {};
  const navValues = grid?.activeFilterValues || {};

  // Cascade-resolved effective filter for this occurrence — same source of
  // truth FiltersSection's Active toggle uses. Field missing here = filter
  // doesn't apply at this level → don't render its nav widget.
  const ownEffectiveFilter = useMemo(
    () => getEffectiveFilterForOccurrence(occurrence, { grid, occurrencesById }),
    [occurrence, grid, occurrencesById],
  );

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
    // Auto-hide: filter is deactivated at this level (cascade cleared the
    // field). Skip the widget — no nav for an inactive filter.
    if (fieldId && !(fieldId in ownEffectiveFilter)) continue;
    items.push({ filter: f, fieldId, cfg });
  }

  if (!items.length) return null;

  // Writes the new nav value into this occurrence's filterOverride map.
  // This is what makes `$parentFilter` resolve to the new date for ops like
  // "Schedule: Build Day" — the executor walks the trigger occurrence's chain
  // and merges its filterOverride on top of grid.activeFilterValues, so the
  // override has to live on the occurrence (not the global filterNavState map)
  // for date-driven pipelines to see the new date.
  const makeOnNav = (fieldId) => (value) => {
    if (!fieldId) return;
    const nextOverride = { ...overrides, [fieldId]: value };
    CommitHelpers.updateOccurrenceFilterOverride({
      dispatch, socket,
      id: occurrence.id,
      filterOverride: nextOverride,
      occurrencesById, modulesById,
      navFieldId: fieldId,
      date: value,
    });
  };

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
            occurrencesById={occurrencesById}
            modulesById={modulesById}
            foldersById={foldersById}
            dispatch={dispatch}
            onNav={makeOnNav(fieldId)}
          />
        );
      })}
    </div>
  );
}
