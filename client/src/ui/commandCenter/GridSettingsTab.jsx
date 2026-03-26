// ui/commandCenter/GridSettingsTab.jsx
// Grid settings extracted from Toolbar floating popover → CC tab

import React, { useContext, useState, useEffect, useCallback } from "react";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { GridActionsContext } from "../../GridActionsContext";
import * as CommitHelpers from "../../helpers/CommitHelpers";

export function GridSettingsTab() {
  const { state, dispatch, socket } = useContext(GridActionsContext);
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
          className="w-full h-7 text-[11px] px-2 rounded bg-backgroundScale-0 border border-borderScale-1 text-foreground outline-none focus:border-primary"
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
            className="w-full h-7 text-[11px] px-2 rounded bg-backgroundScale-0 border border-borderScale-1 text-foreground outline-none focus:border-primary"
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
            className="w-full h-7 text-[11px] px-2 rounded bg-backgroundScale-0 border border-borderScale-1 text-foreground outline-none focus:border-primary"
            value={cols}
            onChange={e => setCols(e.target.value)}
            onBlur={e => commitCols(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") commitCols(e.currentTarget.value); }}
          />
        </div>
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
