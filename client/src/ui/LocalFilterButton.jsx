// ui/LocalFilterButton.jsx
// Per-module filter button — always visible on module headers.
// Opens a dropdown with date navigation + per-occurrence filter override editor.
import React, { useState, useContext } from "react";
import { Filter, ChevronLeft, ChevronRight, Lock, Unlock, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GridActionsContext } from "../GridActionsContext";
import { updateOccurrenceFilterOverride } from "../helpers/CommitHelpers";
import { getEffectiveFilterForOccurrence } from "../state/selectors";

export default function LocalFilterButton({ occurrence }) {
  const [open, setOpen] = useState(false);
  const { socket, dispatch, occurrencesById, state: ctxState } = useContext(GridActionsContext);
  if (!occurrence) return null;

  const grid = ctxState?.grid;
  const namedFilters = grid?.namedFilters || [];
  const activeFilterId = grid?.activeFilterId;
  const activeNamedFilter = namedFilters.find(f => f.id === activeFilterId);
  const navConditions = (activeNamedFilter?.conditions || []).filter(c => c.isNav && c.fieldId);
  const primaryNavFieldId = navConditions[0]?.fieldId || null;
  const timeUnit = activeNamedFilter?.timeUnit || "day";

  const effective = primaryNavFieldId
    ? getEffectiveFilterForOccurrence(occurrence, { grid, occurrencesById })
    : {};
  const currentDate = primaryNavFieldId ? effective[primaryNavFieldId] : null;
  const isInherit = occurrence.filterOverride == null;
  const hasOverride = !isInherit;

  function navigate(dir) {
    if (!primaryNavFieldId) return;
    const base = currentDate ? new Date(currentDate + "T00:00:00") : new Date();
    if (timeUnit === "week")       base.setDate(base.getDate() + dir * 7);
    else if (timeUnit === "month") base.setMonth(base.getMonth() + dir);
    else if (timeUnit === "year")  base.setFullYear(base.getFullYear() + dir);
    else                           base.setDate(base.getDate() + dir);
    const next = base.toISOString().slice(0, 10);
    const overrideUpdate = navConditions.reduce((acc, c) => {
      acc[c.fieldId] = next;
      return acc;
    }, { ...(occurrence.filterOverride || {}) });
    updateOccurrenceFilterOverride({
      socket, dispatch, id: occurrence.id,
      filterOverride: overrideUpdate,
    });
  }

  function setDate(dateStr) {
    if (!primaryNavFieldId || !dateStr) return;
    const overrideUpdate = navConditions.reduce((acc, c) => {
      acc[c.fieldId] = dateStr;
      return acc;
    }, { ...(occurrence.filterOverride || {}) });
    updateOccurrenceFilterOverride({
      socket, dispatch, id: occurrence.id,
      filterOverride: overrideUpdate,
    });
  }

  function inherit() {
    updateOccurrenceFilterOverride({ socket, dispatch, id: occurrence.id, filterOverride: null });
  }

  const dateLabel = currentDate ? currentDate.slice(5) : "—";
  const filterName = activeNamedFilter?.name || "No filter";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          title="Local filter"
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            display: "flex", alignItems: "center", gap: 3,
            padding: "2px 5px", border: "1px solid var(--border-subtle)",
            borderRadius: 4, background: hasOverride ? "rgba(100,180,255,0.10)" : "transparent",
            color: hasOverride ? "rgba(100,180,255,0.9)" : "var(--text-muted)",
            cursor: "pointer", fontSize: 10, fontFamily: "var(--font-mono)",
          }}
        >
          <Filter size={10} />
          {primaryNavFieldId && <span>{dateLabel}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        collisionPadding={8}
        className="p-0"
        style={{ width: 220, zIndex: 1200 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
          {/* Header */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "6px 10px 4px", borderBottom: "1px solid var(--border-subtle)",
          }}>
            <span style={{ fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 10 }}>
              Local Filter
            </span>
            <button
              onClick={() => setOpen(false)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 1, color: "var(--text-muted)", display: "flex" }}
            >
              <X size={11} />
            </button>
          </div>

          <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Active filter name */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "var(--text-faint)", fontSize: 10 }}>Filter:</span>
              <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{filterName}</span>
            </div>

            {/* Date navigation — only when filter has a nav field */}
            {primaryNavFieldId && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ color: "var(--text-faint)", fontSize: 10 }}>Date</span>

                {/* Nav row */}
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <button onClick={() => navigate(-1)} title="Previous" style={NAV_BTN}>
                    <ChevronLeft size={11} />
                  </button>
                  <input
                    type="date"
                    value={currentDate || ""}
                    onChange={(e) => setDate(e.target.value)}
                    style={{
                      flex: 1, height: 24, padding: "0 4px",
                      background: "var(--input-bg)", border: "1px solid var(--input-border)",
                      borderRadius: 4, color: "var(--text-primary)", fontSize: 11,
                      fontFamily: "var(--font-mono)", outline: "none",
                    }}
                  />
                  <button onClick={() => navigate(1)} title="Next" style={NAV_BTN}>
                    <ChevronRight size={11} />
                  </button>
                </div>

                {/* Inherit / Override status */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {hasOverride ? (
                    <>
                      <Lock size={10} style={{ color: "rgba(100,180,255,0.8)" }} />
                      <span style={{ color: "var(--text-muted)", flex: 1 }}>Local override</span>
                      <button
                        onClick={inherit}
                        title="Inherit grid filter date"
                        style={{ ...NAV_BTN, padding: "2px 6px", fontSize: 10, gap: 3 }}
                      >
                        <Unlock size={9} /> Inherit
                      </button>
                    </>
                  ) : (
                    <>
                      <Unlock size={10} style={{ color: "var(--text-faint)" }} />
                      <span style={{ color: "var(--text-faint)", flex: 1 }}>Inheriting grid date</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* No filter active */}
            {!activeNamedFilter && (
              <span style={{ color: "var(--text-faint)", fontSize: 10 }}>
                No active filter. Set one in Filters tab.
              </span>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const NAV_BTN = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 2,
  padding: 3, border: "1px solid var(--border-subtle)", borderRadius: 3,
  background: "transparent", color: "var(--text-muted)", cursor: "pointer",
  fontFamily: "var(--font-mono)", fontSize: 10,
};
