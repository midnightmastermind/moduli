// client/src/ui/FiltersSection.jsx
// FiltersSection — renders inside HeaderDropdown.
// Shows each Grid.namedFilters[i] with:
//   - "Active" toggle (writes occurrence.filterOverride[primaryDateFieldId] = null to mute,
//     removes entry to re-inherit)
//   - "Show nav" toggle (writes occurrence.filterNavConfig[filter.id] = { visible, ... })
//   - Style select (auto / arrows / pills / input / custom)
//   - Inline nav widget (rendered via FilterNavWidget) when visible

import React, { useContext } from "react";
import { GridActionsContext } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import FilterNavWidget from "./FilterNavWidgets";

export default function FiltersSection({ occurrence }) {
  const ctx = useContext(GridActionsContext);
  const { dispatch, socket, fieldsById, occurrencesById, modulesById, state } = ctx;
  const grid = state?.grid;
  const filters = grid?.namedFilters || [];

  const overrides = occurrence?.filterOverride || {};
  const navConfig = occurrence?.filterNavConfig || {};
  const navValues = grid?.activeFilterValues || {};

  // Toggle a filter's mute via filterOverride: null = muted; missing key = inherit
  const setMuted = (filter, muted) => {
    const fieldId = filter.primaryDateFieldId;
    if (!fieldId) return;
    const next = { ...overrides };
    if (muted) next[fieldId] = null;
    else delete next[fieldId];
    // Use updateOccurrenceFilterOverride so NavigationOps fire with ancestor data
    CommitHelpers.updateOccurrenceFilterOverride({
      dispatch, socket, id: occurrence.id, filterOverride: next,
      occurrencesById, modulesById,
      navFieldId: fieldId, date: null,
    });
  };

  const setNavConfig = (filterId, patch) => {
    const next = { ...navConfig, [filterId]: { ...(navConfig[filterId] || {}), ...patch } };
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: occurrence.id, filterNavConfig: next },
      emit: true,
    });
  };

  if (!filters.length) {
    return (
      <section style={{ marginBottom: 8 }}>
        <header style={{ fontSize: 11, opacity: 0.7, marginBottom: 6 }}>Filters</header>
        <div style={{ fontSize: 11, opacity: 0.5 }}>No grid-level filters yet.</div>
      </section>
    );
  }

  return (
    <section style={{ marginBottom: 8 }}>
      <header style={{ fontSize: 11, opacity: 0.7, marginBottom: 6 }}>Filters</header>
      {filters.map(f => {
        const fieldId = f.primaryDateFieldId;
        const muted = fieldId ? overrides[fieldId] === null : false;
        const ownValue = fieldId ? overrides[fieldId] : undefined;
        const cfg = navConfig[f.id] || {};
        return (
          <div key={f.id} style={{ padding: "6px 0", borderTop: "1px solid var(--panel-border, #374151)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12 }}>{f.name || "(unnamed)"}</span>
              <label style={{ fontSize: 11, display: "inline-flex", gap: 4, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={!muted}
                  onChange={(e) => setMuted(f, !e.target.checked)}
                />
                Active
              </label>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <label style={{ fontSize: 11, display: "inline-flex", gap: 4, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={!!cfg.visible}
                  onChange={(e) => setNavConfig(f.id, { visible: e.target.checked })}
                />
                Show nav
              </label>
              <select
                value={cfg.style || ""}
                onChange={(e) => setNavConfig(f.id, { style: e.target.value || undefined })}
                style={{
                  fontSize: 11, background: "transparent", color: "inherit",
                  border: "1px solid var(--panel-border, #374151)", borderRadius: 4,
                }}
              >
                <option value="">auto</option>
                <option value="arrows">arrows</option>
                <option value="pills">pills</option>
                <option value="input">input</option>
                <option value="custom">custom</option>
              </select>
            </div>
            {cfg.visible && (
              <div style={{ marginTop: 6 }}>
                <FilterNavWidget
                  filter={f}
                  navConfig={cfg}
                  value={ownValue !== undefined ? ownValue : (fieldId ? navValues[fieldId] : undefined)}
                  fieldsById={fieldsById}
                  dispatch={dispatch}
                />
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
