import React, { useMemo, useState } from "react";
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
import { PlusSquare, Terminal, Plus, EyeOff, Eye, LogOut, UserCog, Clock, Menu, X, ChevronLeft, ChevronRight } from "lucide-react";

export default function Toolbar({
  gridId,
  grid,
  availableGrids,

  onGridChange,
  onCreateNewGrid,
  onAddPanel,
  // Command Center
  onCommandCenter,
  commandCenterOpen = false,
  // History
  onHistory,
  historyOpen = false,
  // Filter navigation
  onFilterNav,
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
  const [drawerOpen, setDrawerOpen] = useState(false);

  const activeFilter = useMemo(
    () => (grid?.namedFilters || []).find(f => f.id === grid?.activeFilterId) || null,
    [grid?.namedFilters, grid?.activeFilterId]
  );
  const primaryNavFieldId = useMemo(() => {
    const nav = (activeFilter?.conditions || []).find(c => c.isNav && c.fieldId);
    return nav?.fieldId || null;
  }, [activeFilter]);
  const primaryDate = useMemo(() => {
    if (!primaryNavFieldId) return null;
    const val = grid?.activeFilterValues?.[primaryNavFieldId];
    return val ? new Date(val + "T00:00:00") : new Date();
  }, [primaryNavFieldId, grid?.activeFilterValues]);

  const formatNavDate = (d) =>
    d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

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
          <div className="header-logo flex items-center shrink-0" style={{ minWidth: isMobile ? 28 : 80 }}>
            <img src="/moduli_logo.png" alt="Moduli" style={{ height: 18, width: "auto", display: "block" }} />
            {!isMobile && <span className="text-[10px] px-1 text-text-muted font-mono whitespace-nowrap">+moduli+</span>}
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

          {/* Grid Select — desktop only (in drawer on mobile) */}
          {!isMobile && (
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
          )}

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

        {/* ── Center: Global date nav ── */}
        {primaryDate && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onFilterNav?.(-1)}
              className="h-7 w-7 rounded flex items-center justify-center hover:bg-accent text-text-muted hover:text-foreground transition-colors"
              title="Previous"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span
              className="text-xs font-mono text-text-primary px-1 min-w-[110px] text-center select-none"
            >
              {formatNavDate(primaryDate)}
            </span>
            <button
              onClick={() => onFilterNav?.(1)}
              className="h-7 w-7 rounded flex items-center justify-center hover:bg-accent text-text-muted hover:text-foreground transition-colors"
              title="Next"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* ── Right: Filter + Pomodoro + Terminal + Account ── */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Desktop-only items */}
          {!isMobile && (
            <>
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
            </>
          )}

          {/* Terminal / Command Center — always visible */}
          <Button
            size="sm"
            variant={commandCenterOpen ? "secondary" : "ghost"}
            onClick={onCommandCenter}
            title={commandCenterOpen ? "Collapse command center" : "Open command center"}
            style={{ height: 26, width: 26, padding: 0 }}
          >
            <Terminal className="h-3.5 w-3.5" />
          </Button>

          {/* Desktop-only: Hide toolbar + Account */}
          {!isMobile && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setToolbarVisible(false)}
                title="Hide toolbar"
                style={{ height: 26, width: 26, padding: 0, opacity: 0.45 }}
              >
                <EyeOff className="h-3 w-3" />
              </Button>

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
            </>
          )}

          {/* Mobile-only: Drawer toggle */}
          {isMobile && (
            <Button
              size="sm"
              variant={drawerOpen ? "secondary" : "ghost"}
              onClick={() => setDrawerOpen(true)}
              title="Open menu"
              style={{ height: 26, width: 26, padding: 0 }}
            >
              <Menu className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* ── Mobile slide-out drawer ── */}
      {isMobile && drawerOpen && (
        <>
          {/* Backdrop */}
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100 }}
            onClick={() => setDrawerOpen(false)}
          />
          {/* Drawer panel */}
          <div
            style={{
              position: "fixed", top: 0, right: 0, bottom: 0, width: 220,
              background: "var(--bg-primary, hsl(var(--background)))",
              borderLeft: "1px solid var(--border-default)",
              zIndex: 1101, padding: 12,
              display: "flex", flexDirection: "column", gap: 8,
              animation: "slide-in-right 150ms ease-out",
              fontFamily: "var(--font-mono)",
            }}
          >
            {/* Close */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => setDrawerOpen(false)}
                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 4 }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Grid Select */}
            <div style={{ fontSize: 11 }}>
              <div style={{ fontSize: 10, color: "var(--text-faint)", marginBottom: 4 }}>Grid</div>
              <Select
                value={gridId || "__none__"}
                onValueChange={(val) => { if (val !== "__none__") { onGridChange?.({ target: { value: val } }); setDrawerOpen(false); } }}
              >
                <SelectTrigger style={{ width: "100%", height: 28, fontSize: 11 }}>
                  <SelectValue placeholder="Select grid…" />
                </SelectTrigger>
                <SelectContent style={{ zIndex: 1200 }}>
                  {!gridId && <SelectItem value="__none__">Select grid…</SelectItem>}
                  {gridOptions.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div style={{ height: 1, background: "var(--border-default)" }} />

            {/* Pomodoro */}
            <PomodoroTimer />

            <div style={{ height: 1, background: "var(--border-default)" }} />

            {/* History */}
            <button
              onClick={() => { onHistory?.(); setDrawerOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "6px 4px",
                background: "none", border: "none", color: "var(--text-primary)", cursor: "pointer",
                fontSize: 12, fontFamily: "var(--font-mono)",
              }}
            >
              <Clock size={14} style={{ opacity: 0.7 }} />
              Transaction History
            </button>

            {/* Hide toolbar */}
            <button
              onClick={() => { setToolbarVisible(false); setDrawerOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "6px 4px",
                background: "none", border: "none", color: "var(--text-primary)", cursor: "pointer",
                fontSize: 12, fontFamily: "var(--font-mono)",
              }}
            >
              <EyeOff size={14} style={{ opacity: 0.7 }} />
              Hide Toolbar
            </button>

            <div style={{ flex: 1 }} />

            {/* Account section */}
            <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {userId && (
                <div style={{ fontSize: 10, color: "var(--text-faint)", padding: "2px 4px", marginBottom: 2 }}>
                  {userId}
                </div>
              )}
              <button
                onClick={() => { setDrawerOpen(false); onCreateNewGrid?.(); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 4px",
                  background: "none", border: "none", color: "var(--text-primary)", cursor: "pointer",
                  fontSize: 12, fontFamily: "var(--font-mono)",
                }}
              >
                <Plus size={14} style={{ opacity: 0.7 }} />
                Add new grid
              </button>
              <button
                onClick={() => { setDrawerOpen(false); onCommandCenter?.(); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 4px",
                  background: "none", border: "none", color: "var(--text-primary)", cursor: "pointer",
                  fontSize: 12, fontFamily: "var(--font-mono)",
                }}
              >
                <UserCog size={14} style={{ opacity: 0.7 }} />
                User Settings
              </button>
              <button
                onClick={() => { setDrawerOpen(false); onLogout?.(); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 4px",
                  background: "none", border: "none", color: "var(--text-primary)", cursor: "pointer",
                  fontSize: 12, fontFamily: "var(--font-mono)",
                }}
              >
                <LogOut size={14} />
                Log out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
