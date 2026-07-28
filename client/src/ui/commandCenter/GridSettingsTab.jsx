// ui/commandCenter/GridSettingsTab.jsx
// Grid settings extracted from Toolbar floating popover → CC tab

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Check, ChevronDown, ChevronRight, Navigation } from "lucide-react";
import { useGridActions } from "../../GridActionsContext";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import { uid } from "../../uid";
import { COMPARATOR_OPTIONS } from "../../helpers/comparators";
import { deriveTreeFromPlacements } from "../../helpers/bspTree";
import { LAYOUT_MODES } from "../../helpers/layoutRules";
import SortSection from "../SortSection";
import StyleEditor from "../StyleEditor";
import LayoutCascadeEditor from "../LayoutCascadeEditor";

const TIME_UNIT_OPTIONS = [
  { value: "day",   label: "Day" },
  { value: "week",  label: "Week" },
  { value: "month", label: "Month" },
  { value: "year",  label: "Year" },
];

const inputCls = "w-full h-7 text-[11px] px-2 rounded bg-backgroundScale-0 border border-borderScale-1 text-foreground outline-none focus:border-primary";
const selectCls = "h-6 text-[11px] px-1 rounded bg-backgroundScale-0 border border-borderScale-1 text-foreground outline-none focus:border-primary cursor-pointer";

export function GridSettingsTab() {
  const { state, dispatch, socket, fieldsById } = useGridActions();
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

  // ── Layout mode: rows×cols Grid vs BSP "Mosaic" ──────────────────────────
  const isMosaic = !!grid?.meta?.layoutTree;
  // Protected live data (server/utils/protectedGrids.js). The STAMP is what the
  // client reads — it's portable and survives a rename, whereas the server's
  // name list is for scripts. The server refuses the delete regardless.
  const isProtected = grid?.meta?.protected === true;
  const setLayoutMode = useCallback((mode) => {
    if (!gridId) return;
    const meta = { ...(grid?.meta || {}) };
    if (mode === "mosaic") {
      // Derive an initial split tree from the current panel positions so the
      // user's layout is preserved on convert (they re-tune via the splitters).
      const panels = (grid?.occurrences || [])
        .map((id) => state?.occurrencesById?.[id])
        .filter((o) => o && o.placement)
        .map((o) => ({
          _occurrenceId: o.id,
          row: o.placement.row ?? 0,
          col: o.placement.col ?? 0,
          layout: state?.modulesById?.[o.moduleId]?.layout,
        }));
      meta.layoutTree = deriveTreeFromPlacements(panels);
    } else {
      delete meta.layoutTree; // placements were never mutated → rows×cols resumes
    }
    CommitHelpers.updateGrid({ dispatch, socket, gridId, grid: { meta }, emit: true });
  }, [gridId, grid?.meta, grid?.occurrences, state?.occurrencesById, state?.modulesById, dispatch, socket]);

  // Panel occurrences with placement (the grid owns these ids).
  const panelOccs = useMemo(
    () => (grid?.occurrences || [])
      .map((id) => state?.occurrencesById?.[id])
      .filter((o) => o && o.placement),
    [state?.occurrencesById, grid?.occurrences],
  );

  // Distinct occupied indices along an axis ("col"/"row"), spanning width/height.
  // The MINIMUM size on that axis is the COUNT of distinct occupied lines —
  // because shrinking COMPACTS panels into the remaining lines (empty interior
  // lines are removed and outer panels shift inward). e.g. a single panel at
  // col 5 → 1 occupied col → min 1 (it compacts to col 0).
  const occupiedAxis = useCallback((axis) => {
    const set = new Set();
    for (const o of panelOccs) {
      const p = o.placement;
      const start = axis === "col" ? (p.col ?? 0) : (p.row ?? 0);
      const span = axis === "col" ? (p.width ?? 1) : (p.height ?? 1);
      for (let i = 0; i < Math.max(1, span); i++) set.add(start + i);
    }
    return [...set].sort((a, b) => a - b);
  }, [panelOccs]);

  const minRows = useMemo(() => Math.max(1, occupiedAxis("row").length), [occupiedAxis]);
  const minCols = useMemo(() => Math.max(1, occupiedAxis("col").length), [occupiedAxis]);

  // Resize one axis. On SHRINK, compact panels into a contiguous left/up-packed
  // range so empty interior lines are squeezed out (panels keep relative order +
  // span; spans stay contiguous because a panel's cells are all occupied). Can't
  // shrink below the occupied COUNT — that would force an overlap.
  const commitAxis = useCallback((axis, val) => {
    if (!gridId) return;
    const occ = occupiedAxis(axis);
    const minN = Math.max(1, occ.length);
    const num = Math.max(minN, Number(val) || 1);
    const curN = axis === "col" ? (grid?.cols ?? 1) : (grid?.rows ?? 1);
    if (num < curN) {
      // Map each occupied line to its contiguous rank (0,1,2,…).
      const rank = {};
      occ.forEach((line, i) => { rank[line] = i; });
      for (const o of panelOccs) {
        const p = o.placement;
        const start = axis === "col" ? (p.col ?? 0) : (p.row ?? 0);
        const next = rank[start];
        if (next === undefined || next === start) continue;
        const placement = axis === "col" ? { ...p, col: next } : { ...p, row: next };
        CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: o.id, placement }, emit: true });
      }
    }
    if (axis === "col") {
      setCols(String(num));
      CommitHelpers.updateGrid({ dispatch, socket, gridId, grid: { cols: num }, emit: true });
    } else {
      setRows(String(num));
      CommitHelpers.updateGrid({ dispatch, socket, gridId, grid: { rows: num }, emit: true });
    }
  }, [dispatch, socket, gridId, occupiedAxis, panelOccs, grid?.cols, grid?.rows]);

  const commitRows = useCallback((val) => commitAxis("row", val), [commitAxis]);
  const commitCols = useCallback((val) => commitAxis("col", val), [commitAxis]);

  // ── Responsive layout rules (grid.meta.layoutRules) ───────────────────────
  // Read-modify-write the whole meta (same pattern as the mosaic toggle) so
  // sibling meta keys survive.
  const saveLayoutRules = useCallback((rules) => {
    if (!gridId) return;
    const meta = { ...(grid?.meta || {}) };
    if (rules.length === 0) delete meta.layoutRules;
    else meta.layoutRules = rules;
    CommitHelpers.updateGrid({ dispatch, socket, gridId, grid: { meta }, emit: true });
  }, [gridId, grid?.meta, dispatch, socket]);

  const addLayoutRule = useCallback(() => {
    saveLayoutRules([...(grid?.meta?.layoutRules || []), { id: "lr_" + uid(), layout: "desktop" }]);
  }, [grid?.meta?.layoutRules, saveLayoutRules]);

  const updateLayoutRule = useCallback((ruleId, patch) => {
    saveLayoutRules((grid?.meta?.layoutRules || []).map(r => (r.id === ruleId ? { ...r, ...patch } : r)));
  }, [grid?.meta?.layoutRules, saveLayoutRules]);

  const deleteLayoutRule = useCallback((ruleId) => {
    saveLayoutRules((grid?.meta?.layoutRules || []).filter(r => r.id !== ruleId));
  }, [grid?.meta?.layoutRules, saveLayoutRules]);

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

      {/* Layout mode — rows×cols Grid vs BSP Mosaic */}
      <div className="mb-3">
        <label className="text-[10px] text-foregroundScale-2 block mb-1">Layout</label>
        <div className="flex gap-2">
          {[
            { id: "grid", label: "Grid", hint: "Uniform rows × columns" },
            { id: "mosaic", label: "Mosaic", hint: "Free split panes (resize both axes)" },
          ].map((opt) => {
            const active = (opt.id === "mosaic") === isMosaic;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => { if (!active) setLayoutMode(opt.id); }}
                title={opt.hint}
                className="flex-1 h-8 text-[11px] rounded border px-2 text-left"
                style={{
                  background: active ? "var(--accent-blue-bg, rgba(56,189,248,0.15))" : "transparent",
                  borderColor: active ? "var(--accent-blue, #38bdf8)" : "var(--border-subtle)",
                  color: active ? "var(--accent-blue-text, #bfe6ff)" : "var(--text-muted)",
                  cursor: active ? "default" : "pointer",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        {isMosaic && (
          <p className="text-[9px] text-foregroundScale-2 mt-1">
            Drag the splitter bars to resize panes; drag a panel onto another pane's edge to re-split.
          </p>
        )}
      </div>

      {/* Rows + Cols — hidden in mosaic mode (no global dimensions) */}
      {!isMosaic && (
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-[10px] text-foregroundScale-2 block mb-1">Rows{minRows > 1 ? ` (min ${minRows})` : ""}</label>
          <input
            type="number"
            min={minRows}
            max={24}
            className={inputCls}
            value={rows}
            onChange={e => setRows(e.target.value)}
            onBlur={e => commitRows(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") commitRows(e.currentTarget.value); }}
          />
        </div>
        <div>
          <label className="text-[10px] text-foregroundScale-2 block mb-1">Cols{minCols > 1 ? ` (min ${minCols})` : ""}</label>
          <input
            type="number"
            min={minCols}
            max={24}
            className={inputCls}
            value={cols}
            onChange={e => setCols(e.target.value)}
            onBlur={e => commitCols(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") commitCols(e.currentTarget.value); }}
          />
        </div>
      </div>
      )}

      {/* ── Responsive layout rules (grid.meta.layoutRules) ─────────
          The FIRST rule whose viewport bounds all match wins and pins the
          layout (desktop grid vs mobile stack); no match → the built-in
          heuristic. Lets a tablet pin BOTH orientations to the desktop grid
          so rotating never swaps (and remounts) the whole layout. */}
      <div className="mb-3">
        <label className="text-[10px] text-foregroundScale-2 block mb-1">
          Responsive layout rules
        </label>
        <p className="text-[9px] text-foregroundScale-2 mb-1.5">
          First matching rule wins. Blank bounds match any size; sizes are px.
          No match → automatic (touch + orientation heuristic).
        </p>
        {(grid?.meta?.layoutRules || []).map((rule) => (
          <div key={rule.id} className="flex items-center gap-1 mb-1">
            {[
              ["minWidth", "min W"], ["maxWidth", "max W"],
              ["minHeight", "min H"], ["maxHeight", "max H"],
            ].map(([k, ph]) => (
              <input
                key={k}
                type="number"
                min={0}
                placeholder={ph}
                title={ph}
                className={inputCls}
                style={{ width: 52, padding: "2px 4px" }}
                value={rule[k] ?? ""}
                onChange={(e) => updateLayoutRule(rule.id, { [k]: e.target.value === "" ? null : Number(e.target.value) })}
              />
            ))}
            <select
              className={inputCls}
              style={{ flex: 1, padding: "2px 4px" }}
              value={rule.layout || "desktop"}
              onChange={(e) => updateLayoutRule(rule.id, { layout: e.target.value })}
            >
              {LAYOUT_MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <button
              type="button"
              className="text-[11px] px-1"
              style={{ color: "var(--danger-text, #f87171)" }}
              title="Delete rule"
              onClick={() => deleteLayoutRule(rule.id)}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className="text-[10px] rounded border px-2 py-1 mt-0.5"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
          onClick={addLayoutRule}
        >
          + Add layout rule
        </button>
      </div>

      <Separator className="mb-3" />

      {/* ── Grid-wide default style — root of the cascade ───────────
          Writes to `grid.meta.defaultStyle`. Panels / pages / containers
          / instances inherit this and may override at their own level
          via their respective StyleEditors. The kind="grid" field set
          tailors the surfaced controls to grid-wide defaults (text
          color, fonts, borders, padding, opacity — not per-placement
          backgrounds, since the grid itself has no background slot
          users typically style directly). */}
      <div className="mb-3">
        <StyleEditor
          kind="grid"
          label="Grid default style"
          inheritLabel="(none — this is the cascade root)"
          styleMode={grid?.meta?.defaultStyle ? "own" : "inherit"}
          ownStyle={grid?.meta?.defaultStyle || null}
          onStyleModeChange={(mode) => {
            if (mode === "inherit") {
              const nextMeta = { ...(grid?.meta || {}) };
              delete nextMeta.defaultStyle;
              CommitHelpers.updateGrid({ dispatch, socket, gridId, grid: { meta: nextMeta }, emit: true });
            }
          }}
          onOwnStyleChange={(style) => {
            const nextMeta = { ...(grid?.meta || {}), defaultStyle: style };
            CommitHelpers.updateGrid({ dispatch, socket, gridId, grid: { meta: nextMeta }, emit: true });
          }}
        />
      </div>

      <Separator className="mb-3" />

      {/* ── Grid-wide layout cascade defaults — root of the layout cascade ───
          Writes to `grid.meta.layoutCascadeDefaults`. Every panel / page /
          container / instance inherits these rules (drag-in view, nav
          options, lock, show fields, repr field whitelist) and may override
          at their own level. */}
      <div className="mb-3">
        <LayoutCascadeEditor
          value={grid?.meta?.layoutCascadeDefaults || null}
          onChange={(next) => {
            const nextMeta = { ...(grid?.meta || {}) };
            if (next == null) delete nextMeta.layoutCascadeDefaults;
            else nextMeta.layoutCascadeDefaults = next;
            CommitHelpers.updateGrid({ dispatch, socket, gridId, grid: { meta: nextMeta }, emit: true });
          }}
          cascade={null}
          label="Grid layout cascade defaults"
          inheritLabel="(none — this is the cascade root)"
          showRepresentationFieldIds={false}
          fieldsList={[]}
        />
      </div>

      <Separator className="mb-3" />

      {/* ── Sort panels (reflows row-major when active) ── */}
      <div className="mb-3">
        <SortSection
          entity={grid}
          labelOverride="Sort panels"
          onPersistSort={(next) => {
            const nextMeta = { ...(grid?.meta || {}), localSort: next };
            CommitHelpers.updateGrid({ dispatch, socket, gridId, grid: { meta: nextMeta }, emit: true });
          }}
        />
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

      {/* Danger zone — absent entirely for protected live data. The server
          refuses the delete too (socketHandlers/crud.js); this is so the button
          isn't there to click in the first place. */}
      {isProtected ? (
        <div>
          <h4 className="text-xs font-semibold text-foregroundScale-2 mb-1">Protected grid</h4>
          <p className="text-[10px] text-foregroundScale-2/80">
            This grid holds live data and cannot be deleted. Back it up with
            the backup script, and change its structure through a migration.
          </p>
        </div>
      ) : (
        <div>
          <h4 className="text-xs font-semibold text-red-400 mb-1">Danger zone</h4>
          <p className="text-[10px] text-foregroundScale-2/80 mb-2">
            This deletes the grid and all UI inside it.
          </p>
          <Button type="button" variant="destructive" size="sm" onClick={deleteGrid}>
            Delete Grid
          </Button>
        </div>
      )}
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
