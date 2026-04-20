// ui/LocalFilterNav.jsx
// Per-panel/container filter date navigation.
// Replaces the deleted LocalIterationNav.jsx — reads from filterOverride, not iteration.
import React, { useContext } from "react";
import { ChevronLeft, ChevronRight, Lock, Unlock } from "lucide-react";
import { GridActionsContext } from "../GridActionsContext";
import { updateOccurrenceFilterOverride } from "../helpers/CommitHelpers";
import { getEffectiveFilterForOccurrence } from "../state/selectors";

export default function LocalFilterNav({ occurrence, compact = false }) {
  const { socket, dispatch, occurrencesById, state: ctxState } = useContext(GridActionsContext);
  if (!occurrence) return null;

  const grid = ctxState?.grid;
  const activeNamedFilter = (grid?.namedFilters || []).find(f => f.id === grid?.activeFilterId);
  const primaryDateFieldId = activeNamedFilter?.primaryDateFieldId;
  if (!primaryDateFieldId) return null;

  const effective = getEffectiveFilterForOccurrence(occurrence, { grid, occurrencesById });
  const currentDate = effective[primaryDateFieldId];

  const isInherit = occurrence.filterOverride == null;
  const timeUnit = activeNamedFilter?.timeUnit || "day";

  function navigate(dir) {
    const base = currentDate ? new Date(currentDate + "T00:00:00") : new Date();
    if (timeUnit === "week")       base.setDate(base.getDate() + dir * 7);
    else if (timeUnit === "month") base.setMonth(base.getMonth() + dir);
    else                           base.setDate(base.getDate() + dir);
    const next = base.toISOString().slice(0, 10);
    updateOccurrenceFilterOverride({
      socket, dispatch, id: occurrence.id,
      filterOverride: { [primaryDateFieldId]: next },
    });
  }

  function unlock() {
    updateOccurrenceFilterOverride({ socket, dispatch, id: occurrence.id, filterOverride: null });
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
