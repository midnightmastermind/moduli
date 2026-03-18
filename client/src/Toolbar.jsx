import React, { useMemo, useState, useEffect } from "react";
import FilterNav from "./ui/FilterNav";
import PomodoroTimer from "./ui/PomodoroTimer";
import MiniGridMap from "./mobile/MiniGridMap";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PlusSquare, Terminal, Plus, EyeOff, Eye, LogOut, UserCog, Clock } from "lucide-react";

export default function Toolbar({
  gridId,
  availableGrids,

  onGridChange,
  onCreateNewGrid,
  onAddPanel,
  // Filter system props
  grid,
  fieldsById,
  onSelectFilter,
  onFilterValueChange,
  // Command Center
  onCommandCenter,
  commandCenterOpen = false,
  // History
  onHistory,
  historyOpen = false,
  // Account
  userId,
  onLogout,
  // Mobile grid navigation
  isMobile,
  activeCell,
  setActiveCell,
  zoomedOut,
  setZoomedOut,
}) {
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const [accountOpen, setAccountOpen] = useState(false);

  // F5: Ctrl+[ / Ctrl+] to cycle through named filters
  useEffect(() => {
    const filters = grid?.namedFilters || [];
    if (filters.length < 2) return;
    const handleKey = (e) => {
      if (!e.ctrlKey || !["[", "]"].includes(e.key)) return;
      // Don't fire inside text inputs
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      const currentIdx = filters.findIndex(f => f.id === grid?.activeFilterId);
      const n = filters.length;
      const nextIdx = e.key === "]"
        ? (currentIdx + 1) % n
        : (currentIdx - 1 + n) % n;
      onSelectFilter?.(filters[nextIdx].id);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [grid?.namedFilters, grid?.activeFilterId, onSelectFilter]);

  const gridOptions = useMemo(
    () =>
      (availableGrids || []).map((g) => {
        const id = g.id || g._id;
        const name = g.name || g.gridName || "";
        return {
          value: id,
          label: name || `Grid ${String(id).slice(-4)}`,
        };
      }),
    [availableGrids]
  );

  // Avatar: first char of userId, uppercased
  const avatarChar = userId ? String(userId).charAt(0).toUpperCase() : "?";


  if (!toolbarVisible) {
    return (
      <div
        data-testid="toolbar"
        className="fixed top-1.5 left-1.5 z-[999] flex items-center justify-center"
      >
        <button
          title="Show toolbar"
          onClick={() => setToolbarVisible(true)}
          className="h-7 w-7 rounded-md flex items-center justify-center bg-background/80 border border-border-default text-text-muted hover:text-foreground hover:bg-accent transition-colors"
        >
          <Eye className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="toolbar"
      className="toolbar shadow-md relative flex w-full font-mono text-xs"
      style={{
        zIndex: 998,
        backgroundColor: "var(--body-bg)",
        borderBottom: "2px solid var(--border-default)",
        padding: "2px 8px",
      }}
      onTouchStart={(e) => {
        if (!isMobile) return;
        const startY = e.touches[0].clientY;
        const onMove = (ev) => {
          const dy = ev.touches[0].clientY - startY;
          if (dy > 8 && !commandCenterOpen) { onCommandCenter?.(); done(); }
          if (dy < -8 && commandCenterOpen) { onCommandCenter?.(); done(); }
        };
        const done = () => {
          window.removeEventListener("touchmove", onMove);
          window.removeEventListener("touchend", done);
        };
        window.addEventListener("touchmove", onMove, { passive: true });
        window.addEventListener("touchend", done, { passive: true });
      }}
    >
      <div className="flex items-center w-full gap-1.5">
        {/* ── Left: Logo + Add Panel + Grid Select ── */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Logo */}
          <div className="header-logo flex items-center shrink-0" style={{ minWidth: 80 }}>
            <img src="/moduli_logo.png" alt="Moduli" style={{ height: 18, width: "auto", display: "block" }} />
            <span className="text-[10px] px-1 text-text-muted font-mono whitespace-nowrap">+moduli+</span>
          </div>

          {/* Add Panel button */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onAddPanel?.("board")}
            title="Add panel"
            style={{ height: 26, width: 26, padding: 0 }}
          >
            <PlusSquare className="h-3.5 w-3.5" />
          </Button>

          {/* Grid Select */}
          <Select
            value={gridId || "__none__"}
            onValueChange={(val) => { if (val !== "__none__") onGridChange?.({ target: { value: val } }); }}
          >
            <SelectTrigger style={{ minWidth: 110, maxWidth: 150, height: 24, fontSize: 11 }}>
              <SelectValue placeholder="Select grid…" />
            </SelectTrigger>
            <SelectContent>
              {!gridId && <SelectItem value="__none__">Select grid…</SelectItem>}
              {gridOptions.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Mini grid map — mobile only, shows when grid has multiple cells */}
          {isMobile && (grid?.rows > 1 || grid?.cols > 1) && (
            <MiniGridMap
              rows={grid?.rows || 1}
              cols={grid?.cols || 1}
              activeRow={activeCell?.row ?? 0}
              activeCol={activeCell?.col ?? 0}
              onMapClick={() => setZoomedOut?.(prev => !prev)}
            />
          )}
        </div>

        {/* ── Spacer ── */}
        <div className="flex-1" />

        {/* ── Right: Filter + Pomodoro + Terminal + Account ── */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Filter Navigation — compact, inline */}
          <FilterNav
            grid={grid}
            fieldsById={fieldsById}
            onSelectFilter={onSelectFilter}
            onFilterValueChange={onFilterValueChange}
            compact
            isMobile={isMobile}
          />

          <div className="w-px h-4 bg-border-default mx-0.5" />

          <PomodoroTimer />

          <div className="w-px h-4 bg-border-default mx-0.5" />

          {/* History */}
          <Button
            size="sm"
            variant={historyOpen ? "secondary" : "ghost"}
            onClick={onHistory}
            title="Transaction history"
            style={{ height: 26, width: 26, padding: 0 }}
          >
            <Clock className="h-3.5 w-3.5" />
          </Button>

          {/* Terminal / Command Center */}
          <Button
            size="sm"
            variant={commandCenterOpen ? "secondary" : "ghost"}
            onClick={onCommandCenter}
            title={commandCenterOpen ? "Collapse command center" : "Open command center"}
            style={{ height: 26, width: 26, padding: 0 }}
          >
            <Terminal className="h-3.5 w-3.5" />
          </Button>

          {/* Hide toolbar */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setToolbarVisible(false)}
            title="Hide toolbar"
            style={{ height: 26, width: 26, padding: 0, opacity: 0.45 }}
          >
            <EyeOff className="h-3 w-3" />
          </Button>

          {/* Account avatar */}
          <Popover open={accountOpen} onOpenChange={setAccountOpen}>
            <PopoverTrigger asChild>
              <button
                title="Account"
                className="h-[26px] w-[26px] rounded-full bg-foreground/10 border border-border-default text-foreground/85 text-[11px] font-semibold cursor-pointer flex items-center justify-center font-mono shrink-0 hover:bg-foreground/15 transition-colors"
              >
                {avatarChar}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              side="bottom"
              className="p-1 w-[180px]"
              style={{ zIndex: 1200 }}
            >
              <div className="flex flex-col gap-px">
                {userId && (
                  <div className="px-2 py-1 text-[11px] text-text-faint border-b border-border-subtle mb-0.5">
                    {userId}
                  </div>
                )}
                <button
                  className="flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-accent w-full text-left"
                  onClick={() => { setAccountOpen(false); onCreateNewGrid?.(); }}
                >
                  <Plus className="h-3.5 w-3.5 opacity-70" />
                  Add new grid
                </button>
                <button
                  className="flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-accent w-full text-left"
                  onClick={() => { setAccountOpen(false); onCommandCenter?.(); }}
                >
                  <UserCog className="h-3.5 w-3.5 opacity-70" />
                  User settings
                </button>
                <div className="h-px bg-border-subtle my-0.5" />
                <button
                  className="flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-accent w-full text-left text-red-400"
                  onClick={() => { setAccountOpen(false); onLogout?.(); }}
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Log out
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}
