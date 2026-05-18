// ui/commandCenter/GridSettingsTab.jsx
// Grid settings extracted from Toolbar floating popover → CC tab

import React, { useContext, useState, useEffect, useCallback, useMemo } from "react";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Check, ChevronDown, ChevronRight, Navigation } from "lucide-react";
import { GridActionsContext } from "../../GridActionsContext";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import { uid } from "../../uid";
import { COMPARATOR_OPTIONS } from "../../helpers/comparators";

const TIME_UNIT_OPTIONS = [
  { value: "day",   label: "Day" },
  { value: "week",  label: "Week" },
  { value: "month", label: "Month" },
  { value: "year",  label: "Year" },
];

const inputCls = "w-full h-7 text-[11px] px-2 rounded bg-backgroundScale-0 border border-borderScale-1 text-foreground outline-none focus:border-primary";
const selectCls = "h-6 text-[11px] px-1 rounded bg-backgroundScale-0 border border-borderScale-1 text-foreground outline-none focus:border-primary cursor-pointer";

export function GridSettingsTab() {
  const { state, dispatch, socket, fieldsById } = useContext(GridActionsContext);
  const grid = state?.grid;
  const gridId = state?.gridId || grid?._id;

  const [gridName, setGridName] = useState(grid?.name || "");
  const [rows, setRows] = useState(String(grid?.rows ?? 1));
  const [cols, setCols] = useState(String(grid?.cols ?? 1));

  // Sync from state when grid changes
  useEffect(() => {
    if (grid) {
      setGridName(grid.name || "");
      setRows(String(grid.rows ?? 1));
      setCols(String(grid.cols ?? 1));
    }
  }, [grid?._id, grid?.name, grid?.rows, grid?.cols]);

  const commitName = useCallback((name) => {
    if (!gridId || !name?.trim()) return;
    CommitHelpers.updateGrid({ dispatch, socket, gridId, grid: { name: name.trim() }, emit: true });
  }, [dispatch, socket, gridId]);

  const commitRows = useCallback((val) => {
    if (!gridId) return;
    const num = Math.max(1, Number(val) || 1);
    setRows(String(num));
    CommitHelpers.updateGrid({ dispatch, socket, gridId, grid: { rows: num }, emit: true });
  }, [dispatch, socket, gridId]);

  const commitCols = useCallback((val) => {
    if (!gridId) return;
    const num = Math.max(1, Number(val) || 1);
    setCols(String(num));
    CommitHelpers.updateGrid({ dispatch, socket, gridId, grid: { cols: num }, emit: true });
  }, [dispatch, socket, gridId]);

  const deleteGrid = useCallback(() => {
    if (!gridId) return;
    const ok = window.confirm(`Delete this grid${gridId ? ` (${gridId})` : ""}? This cannot be undone.`);
    if (!ok) return;
    CommitHelpers.deleteGrid({ dispatch, socket, gridId, emit: true });
  }, [dispatch, socket, gridId]);

  // ── Filter management ─────────────────────────────────────────────────────
  const namedFilters = grid?.namedFilters || [];
  const activeFilterId = grid?.activeFilterId || null;

  const allFields = useMemo(
    () => Object.values(fieldsById || {}),
    [fieldsById]
  );

  const saveFilters = useCallback((filters) => {
    CommitHelpers.updateGrid({ dispatch, socket, gridId, grid: { namedFilters: filters } });
  }, [dispatch, socket, gridId]);

  const activateFilter = useCallback((filterId) => {
    socket?.emit("update_grid_filter", { gridId, activeFilterId: filterId });
    dispatch?.({ type: "UPDATE_GRID", payload: { gridId, grid: { activeFilterId: filterId } } });
  }, [dispatch, socket, gridId]);

  const updateFilter = useCallback((filterId, patch) => {
    const next = namedFilters.map(f => f.id === filterId ? { ...f, ...patch } : f);
    saveFilters(next);
  }, [namedFilters, saveFilters]);

  const deleteFilter = useCallback((filterId) => {
    const next = namedFilters.filter(f => f.id !== filterId);
    saveFilters(next);
    if (activeFilterId === filterId && next.length > 0) activateFilter(next[0].id);
  }, [namedFilters, saveFilters, activeFilterId, activateFilter]);

  const addFilter = useCallback(() => {
    const firstDateField = allFields.find(f => f.type === "date");
    const newFilter = {
      id: "filter_" + uid(),
      name: "New Filter",
      conditions: firstDateField ? [{ fieldId: firstDateField.id, comparator: "SAME_DAY", isNav: true }] : [],
      timeUnit: "day",
    };
    saveFilters([...namedFilters, newFilter]);
  }, [namedFilters, saveFilters, allFields]);

  if (!grid) {
    return (
      <div className="p-4 text-xs text-foreground-scale-2 font-mono">No grid loaded.</div>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-0 font-mono max-w-sm">
      <div className="mb-3">
        <h4 className="text-sm font-semibold text-foreground">Grid settings</h4>
        <p className="text-[11px] pt-0.5 text-foregroundScale-2">
          Edit grid name, dimensions, and templates.
        </p>
      </div>

      <Separator className="mb-3" />

      {/* Grid Name */}
      <div className="mb-3">
        <label className="text-[10px] text-foregroundScale-2 block mb-1">Grid Name</label>
        <input
          className={inputCls}
          value={gridName}
          onChange={e => setGridName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.currentTarget.blur(); commitName(e.currentTarget.value); } }}
          onBlur={e => commitName(e.currentTarget.value)}
          placeholder="My grid"
        />
      </div>

      {/* Rows + Cols */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-[10px] text-foregroundScale-2 block mb-1">Rows</label>
          <input
            type="number"
            min={1}
            max={24}
            className={inputCls}
            value={rows}
            onChange={e => setRows(e.target.value)}
            onBlur={e => commitRows(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") commitRows(e.currentTarget.value); }}
          />
        </div>
        <div>
          <label className="text-[10px] text-foregroundScale-2 block mb-1">Cols</label>
          <input
            type="number"
            min={1}
            max={24}
            className={inputCls}
            value={cols}
            onChange={e => setCols(e.target.value)}
            onBlur={e => commitCols(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") commitCols(e.currentTarget.value); }}
          />
        </div>
      </div>

      <Separator className="mb-3" />

      {/* ── Filters ── */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-foreground">Filters</h4>
          <button
            onClick={addFilter}
            style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, padding: "2px 7px", borderRadius: 4, background: "var(--accent-green-bg)", border: "1px solid var(--accent-green-border)", color: "var(--accent-green-text)", cursor: "pointer" }}
          >
            <Plus size={9} /> New
          </button>
        </div>

        {namedFilters.length === 0 && (
          <p className="text-[10px] text-foregroundScale-2">No filters yet.</p>
        )}

        <div className="flex flex-col gap-1">
          {namedFilters.map(f => (
            <FilterRow
              key={f.id}
              filter={f}
              isActive={f.id === activeFilterId}
              allFields={allFields}
              onActivate={() => activateFilter(f.id)}
              onUpdate={(patch) => updateFilter(f.id, patch)}
              onDelete={() => deleteFilter(f.id)}
            />
          ))}
        </div>

        <p className="text-[10px] text-foregroundScale-2/70 mt-2 leading-relaxed">
          Active filter drives toolbar nav and occurrence visibility.
          Toggle the <Navigation size={8} style={{ display: "inline", verticalAlign: "middle" }} /> icon on any condition to enable nav arrows.
        </p>
      </div>

      <Separator className="mb-3" />

      {/* Danger zone */}
      <div>
        <h4 className="text-xs font-semibold text-red-400 mb-1">Danger zone</h4>
        <p className="text-[10px] text-foregroundScale-2/80 mb-2">
          This deletes the grid and all UI inside it.
        </p>
        <Button type="button" variant="destructive" size="sm" onClick={deleteGrid}>
          Delete Grid
        </Button>
      </div>
    </div>
  );
}

// ── FilterRow ─────────────────────────────────────────────────────────────────
function FilterRow({ filter, isActive, allFields, onActivate, onUpdate, onDelete }) {
  const [name, setName] = useState(filter.name || "");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => { setName(filter.name || ""); }, [filter.name]);

  const conditions = filter.conditions || [];

  const updateCondition = (idx, patch) => {
    const next = conditions.map((c, i) => i === idx ? { ...c, ...patch } : c);
    onUpdate({ conditions: next });
  };
  const deleteCondition = (idx) => onUpdate({ conditions: conditions.filter((_, i) => i !== idx) });
  const addCondition = () => {
    const firstField = allFields[0];
    onUpdate({ conditions: [...conditions, { fieldId: firstField?.id || "", comparator: "SAME_DAY", isNav: false }] });
  };

  return (
    <div style={{ borderRadius: 4, border: "1px solid var(--border-subtle)", background: isActive ? "rgba(100,180,255,0.07)" : "transparent", overflow: "hidden" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 6px" }}>
        {/* Active radio */}
        <button
          onClick={onActivate}
          title={isActive ? "Active" : "Set active"}
          style={{
            width: 14, height: 14, borderRadius: "50%", flexShrink: 0, padding: 0,
            border: isActive ? "2px solid var(--accent-blue)" : "2px solid var(--border-default)",
            background: isActive ? "var(--accent-blue)" : "transparent",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {isActive && <Check size={8} color="#fff" />}
        </button>

        {/* Name */}
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={() => { if (name.trim() !== filter.name) onUpdate({ name: name.trim() || "Untitled" }); }}
          onKeyDown={e => e.key === "Enter" && e.target.blur()}
          style={{ flex: 1, minWidth: 0, height: 22, fontSize: 11, padding: "0 4px", borderRadius: 3, background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text-primary)", fontFamily: "var(--font-mono)", outline: "none" }}
        />

        {/* Time unit */}
        <select
          value={filter.timeUnit || "day"}
          onChange={e => onUpdate({ timeUnit: e.target.value })}
          className={selectCls}
          title="Navigation step size"
        >
          {TIME_UNIT_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {/* Expand conditions */}
        <button
          onClick={() => setExpanded(v => !v)}
          title="Edit conditions"
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "1px 2px", display: "flex", alignItems: "center" }}
        >
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>

        {/* Delete */}
        <button
          onClick={onDelete}
          style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,80,80,0.5)", padding: "1px 2px", display: "flex", alignItems: "center" }}
          title="Delete filter"
        >
          <Trash2 size={11} />
        </button>
      </div>

      {/* Conditions panel */}
      {expanded && (
        <div style={{ padding: "0 6px 6px 6px", borderTop: "1px solid var(--border-subtle)", marginTop: 2, paddingTop: 4 }}>
          {conditions.length === 0 && (
            <p style={{ fontSize: 10, color: "var(--text-faint)", marginBottom: 4 }}>No conditions — shows all occurrences.</p>
          )}
          {conditions.map((cond, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
              {/* Field */}
              <select
                value={cond.fieldId || ""}
                onChange={e => updateCondition(idx, { fieldId: e.target.value })}
                className={selectCls}
                style={{ flex: 1, minWidth: 0 }}
              >
                <option value="">field…</option>
                {allFields.map(f => <option key={f.id} value={f.id}>{f.label || f.name}</option>)}
              </select>
              {/* Comparator */}
              <select
                value={String(cond.comparator || "SAME_DAY").toUpperCase()}
                onChange={e => updateCondition(idx, { comparator: e.target.value })}
                className={selectCls}
              >
                {COMPARATOR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {/* isNav toggle */}
              <button
                onClick={() => updateCondition(idx, { isNav: !cond.isNav })}
                title={cond.isNav ? "Nav enabled — click to disable" : "Enable nav arrows for this condition"}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 20, height: 20, borderRadius: 3, flexShrink: 0,
                  border: "1px solid " + (cond.isNav ? "var(--accent-blue)" : "var(--border-default)"),
                  background: cond.isNav ? "var(--accent-blue-bg)" : "transparent",
                  color: cond.isNav ? "var(--accent-blue-text)" : "var(--text-faint)",
                  cursor: "pointer", padding: 0,
                }}
              >
                <Navigation size={9} />
              </button>
              {/* Delete condition */}
              <button
                onClick={() => deleteCondition(idx)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,80,80,0.5)", padding: 0, display: "flex", alignItems: "center" }}
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
          <button
            onClick={addCondition}
            style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, padding: "2px 6px", borderRadius: 3, background: "var(--accent-green-bg)", border: "1px solid var(--accent-green-border)", color: "var(--accent-green-text)", cursor: "pointer", marginTop: 2 }}
          >
            <Plus size={9} /> Add condition
          </button>
        </div>
      )}
    </div>
  );
}
