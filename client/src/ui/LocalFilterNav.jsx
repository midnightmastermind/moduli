// ui/LocalFilterNav.jsx
// Per-panel/container/page filter navigation.
// Shows nav arrows for any filter condition with isNav: true.
import React, { useContext } from "react";
import { ChevronLeft, ChevronRight, Lock, Unlock } from "lucide-react";
import { GridActionsContext } from "../GridActionsContext";
import { updateOccurrenceFilterOverride } from "../helpers/CommitHelpers";
import { getEffectiveFilterForOccurrence } from "../state/selectors";
import { operationsBridge } from "../state/bindSocketToStore";

export default function LocalFilterNav({ occurrence, compact = false }) {
  const { socket, dispatch, occurrencesById, state: ctxState } = useContext(GridActionsContext);
  if (!occurrence) return null;

  const grid = ctxState?.grid;
  const activeNamedFilter = (grid?.namedFilters || []).find(f => f.id === grid?.activeFilterId);
  const navConditions = (activeNamedFilter?.conditions || []).filter(c => c.isNav && c.fieldId);
  if (!navConditions.length) return null;

  // Use first nav condition's fieldId for display and navigation
  const primaryNavFieldId = navConditions[0].fieldId;
  const effective = getEffectiveFilterForOccurrence(occurrence, { grid, occurrencesById });
  const currentDate = effective[primaryNavFieldId];

  const isInherit = occurrence.filterOverride == null;
  const timeUnit = activeNamedFilter?.timeUnit || "day";

  function navigate(dir) {
    const base = currentDate ? new Date(currentDate + "T00:00:00") : new Date();
    if (timeUnit === "week")       base.setDate(base.getDate() + dir * 7);
    else if (timeUnit === "month") base.setMonth(base.getMonth() + dir);
    else if (timeUnit === "year")  base.setFullYear(base.getFullYear() + dir);
    else                           base.setDate(base.getDate() + dir);
    const next = base.toISOString().slice(0, 10);
    // Update all nav condition fields in the override
    const overrideUpdate = navConditions.reduce((acc, c) => {
      acc[c.fieldId] = next;
      return acc;
    }, { ...(occurrence.filterOverride || {}) });
    updateOccurrenceFilterOverride({
      socket, dispatch, id: occurrence.id,
      filterOverride: overrideUpdate,
    });
    operationsBridge.fireOperations?.("NavigationOp", {
      type: "NavigationOp",
      occurrenceId: occurrence.id,
      fieldId: primaryNavFieldId,
      date: next,
      activeFilterValues: overrideUpdate,
    });
  }

  function unlock() {
    updateOccurrenceFilterOverride({ socket, dispatch, id: occurrence.id, filterOverride: null });
    operationsBridge.fireOperations?.("NavigationOp", {
      type: "NavigationOp",
      occurrenceId: occurrence.id,
      fieldId: primaryNavFieldId,
      date: null,
      activeFilterValues: {},
    });
  }

  const label = currentDate ? currentDate.slice(5) : "—";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 10 }}>
      <button onClick={() => navigate(-1)} title="Previous" style={NAV_BTN}>
        <ChevronLeft size={10} />
      </button>
      <span style={{ minWidth: compact ? 48 : 64, textAlign: "center", cursor: "default", userSelect: "none", color: "var(--text-muted)" }}>
        {label}
      </span>
      <button onClick={() => navigate(1)} title="Next" style={NAV_BTN}>
        <ChevronRight size={10} />
      </button>
      {!isInherit ? (
        <button onClick={unlock} title="Unlock — inherit grid filter" style={{ ...NAV_BTN, marginLeft: 2 }}>
          <Lock size={9} />
        </button>
      ) : (
        <span title="Inheriting grid filter" style={{ marginLeft: 2, color: "var(--text-faint)", display: "flex" }}>
          <Unlock size={9} />
        </span>
      )}
    </div>
  );
}

const NAV_BTN = {
  display: "flex", alignItems: "center", justifyContent: "center",
  padding: 2, border: "1px solid var(--border-subtle)", borderRadius: 3,
  background: "transparent", color: "var(--text-muted)", cursor: "pointer",
};
