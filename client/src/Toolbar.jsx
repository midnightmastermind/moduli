import React, { useCallback, useMemo, useState } from "react";
import PomodoroTimer from "./ui/PomodoroTimer";
import AlarmDropdown from "./ui/AlarmDropdown";
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
import { Terminal, Plus, EyeOff, Eye, LogOut, UserCog, Clock, Menu, X, Undo2, RotateCw } from "lucide-react";
import ToolbarFilterDropdown from "./ui/ToolbarFilterDropdown";
import SocketStatusBanner from "./ui/SocketStatusBanner";
import OpActivityPill from "./ui/OpActivityPill.jsx";
import TransactionNotificationStack from "./ui/TransactionNotificationStack";
import ClipboardStatusBanner from "./ui/ClipboardStatusBanner";
import SelectionStatusBanner from "./ui/SelectionStatusBanner";
import FilterNavWidget from "./ui/FilterNavWidgets";
import { useGridActions } from "./GridActionsContext";
import * as CommitHelpers from "./helpers/CommitHelpers";
import { useActiveCell, useZoomedOut, setZoomedOut } from "./state/activeCellStore";

export default function Toolbar({
  gridId,
  grid,
  availableGrids,

  onGridChange,
  onCreateNewGrid,
  // Undo. The machinery has been in `App` since the undo/redo rebuild — but
  // the only way to reach it was Ctrl+Z, which a tablet does not have. So on
  // the surface the user is most often on, undo was unreachable entirely.
  onUndo,
  canUndo = false,
  undoBusy = false,

  // Reload. A hard reload, not a re-sync: the states this exists for are the
  // ones where the TAB's own copy is the stale thing — an `occurrences[]` array
  // echoed back over a migration, a bundle from before a deploy. This file's
  // history is full of "restart pm2 AND reload the tab"; asking the server
  // again would fix neither. Injectable so a test does not reload the runner.
  onReload,

  // Command Center
  onCommandCenter,
  commandCenterOpen = false,
  // History
  onHistory,
  historyOpen = false,
  // Account
  userId,
  userEmail,
  onLogout,
  // Mobile grid navigation
  isMobileLayout,
}) {
  // Subscribed here — App no longer holds navigation state, so a cell change
  // never re-renders the root (see state/activeCellStore).
  const activeCell = useActiveCell();
  const zoomedOut = useZoomedOut();
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const [accountOpen, setAccountOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Grab the slices FilterNavWidget needs from context — same surface the
  // occurrence-header FiltersSection consumes, so the toolbar's date nav is
  // literally the same component with the same widget cascade.
  const { dispatch, socket, fieldsById, occurrencesById, modulesById, foldersById } = useGridActions();

  const activeFilter = useMemo(
    () => (grid?.namedFilters || []).find(f => f.id === grid?.activeFilterId) || null,
    [grid?.namedFilters, grid?.activeFilterId]
  );
  const navConditions = useMemo(
    () => (activeFilter?.conditions || []).filter(c => c.isNav && c.fieldId),
    [activeFilter]
  );
  const primaryNavFieldId = navConditions[0]?.fieldId || null;
  const primaryNavValue = primaryNavFieldId
    ? grid?.activeFilterValues?.[primaryNavFieldId]
    : null;

  // Widget commits per filter id by default; the toolbar writes to the GRID's
  // activeFilterValues map instead, fanning the same value into every nav
  // field so multi-field nav conditions stay in sync.
  const handleToolbarNav = useCallback((next) => {
    if (!navConditions.length || !gridId) return;
    const updatedValues = navConditions.reduce((acc, c) => {
      acc[c.fieldId] = next;
      return acc;
    }, { ...(grid?.activeFilterValues || {}) });
    CommitHelpers.updateGrid({
      dispatch, socket,
      gridId,
      grid: { activeFilterValues: updatedValues },
    });
  }, [navConditions, grid?.activeFilterValues, gridId, dispatch, socket]);

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

  // Mosaic grids navigate the UNDERLYING rows×cols placements on mobile
  // (MosaicMobileNav, 2026-07-14 — the old synthetic 1×N strip is gone), so
  // the mini map mirrors rows×cols for every grid shape.

  // The account rows show the EMAIL when the server knows it — the raw userId
  // is a UUID, which identifies the account to the database and to nobody else.
  // It stays as the fallback so a client that predates the server sending an
  // email still shows something rather than nothing.
  const accountLabel = userEmail || userId || null;
  // Avatar: first char of whatever identifies the account, uppercased
  const avatarChar = accountLabel ? String(accountLabel).charAt(0).toUpperCase() : "?";


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

  // One logo element, placed differently per layout: desktop keeps it at the head
  // of the left cluster; mobile puts it at the very left edge, ahead of the
  // status/notification pills (they used to sit left of it).
  const logoEl = (
    <div className="header-logo flex items-center shrink-0" style={{ minWidth: isMobileLayout ? 28 : 80 }}>
      <img src="/viafluere_sideways.png" alt="Via Fluere" style={{ height: 22, width: "auto", display: "block" }} />
    </div>
  );

  return (
    <div
      data-testid="toolbar"
      className="toolbar shadow-md relative flex w-full font-mono text-xs"
      style={{
        zIndex: 998,
        backgroundColor: "var(--body-bg)",
        padding: "2px 8px",
      }}
      onTouchStart={(e) => {
        if (!isMobileLayout) return;
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
      {/* Notification pills — full stack on desktop, compact count pill on mobile */}
      {isMobileLayout ? (
        // Logo only at the far left. The status / notification pills live in the
        // RIGHT cluster on mobile: sitting them between the logo and the mini
        // grid map meant every arriving notification shoved the map sideways.
        <div className="flex items-center shrink-0" style={{ zIndex: 5 }}>
          {logoEl}
        </div>
      ) : (
        <div
          className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 flex items-center gap-2"
          style={{ zIndex: 5 }}
        >
          <div className="pointer-events-auto flex items-center gap-1.5">
            <SocketStatusBanner />
            <OpActivityPill />
            <TransactionNotificationStack />
          </div>
          <div className="pointer-events-auto">
            <SelectionStatusBanner />
          </div>
          <div className="pointer-events-auto">
            <ClipboardStatusBanner />
          </div>
        </div>
      )}

      <div className="flex items-center flex-1 min-w-0 gap-1.5">
        {/* ── Left: Logo + Add Panel + Grid Select ── */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Logo — mobile renders it further left, ahead of the pills. */}
          {!isMobileLayout && logoEl}

          {/* Grid Select — desktop only (in drawer on mobile) */}
          {!isMobileLayout && (
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

          {/* Mini grid map — mobile only, shows when there are multiple cells.
              Mosaic grids page one panel per "cell" (1×N — see Grid.jsx
              MosaicMobileNav), so the map mirrors that shape instead of the
              rows×cols record. */}
          {isMobileLayout && (grid?.rows > 1 || grid?.cols > 1) && (
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

        {/* ── Center: Filter dropdown + Global date nav ── */}
        {/* Toolbar date nav is the same FilterNavWidget the occurrence-header
            FiltersSection mounts: arrows + NavPickerPopover with the on/link/off
            tri-state day cycle. onNav writes to grid.activeFilterValues so the
            widget stays the toolbar's source of truth. */}
        <ToolbarFilterDropdown />
        {/* Mobile gets the date nav too. It used to be desktop-only, which meant
            a phone had NO way to change the date at all and the mini-calendar
            simply did not exist there — a probe found 1 trigger on desktop and 0
            on mobile (2026-08-05). The widget is compact (two arrows + the
            calendar button) and shrinks, so it fits beside the drawer toggle. */}
        {activeFilter && primaryNavFieldId && (
          <FilterNavWidget
            filter={activeFilter}
            navConfig={null}
            value={primaryNavValue}
            fieldsById={fieldsById}
            occurrencesById={occurrencesById}
            modulesById={modulesById}
            foldersById={foldersById}
            dispatch={dispatch}
            onNav={handleToolbarNav}
          />
        )}

        {/* ── Right: Filter + Pomodoro + Terminal + Account ── */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Desktop-only items */}
          {!isMobileLayout && (
            <>
              <div className="w-px h-4 bg-border-default mx-0.5" />
              <PomodoroTimer />
              <AlarmDropdown />
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

          {/* Undo — beside the command center, and ALWAYS VISIBLE rather than
              desktop-only: the keyboard shortcut already covers desktop, and
              this exists for the surface that has no keyboard. Disabled rather
              than hidden when there is nothing to undo, so its place in the
              toolbar does not move under the thumb. */}
          <Button
            size="sm"
            variant="ghost"
            onClick={onUndo}
            disabled={!canUndo || undoBusy}
            title={canUndo ? "Undo (Ctrl+Z)" : "Nothing to undo"}
            style={{ height: 26, width: 26, padding: 0, opacity: canUndo && !undoBusy ? 1 : 0.35 }}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>

          {/* Reload — beside undo, same reasoning: always visible, because the
              surface with no keyboard also has no easy browser reload. */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => (onReload ? onReload() : window.location.reload())}
            title="Reload"
            style={{ height: 26, width: 26, padding: 0 }}
          >
            <RotateCw className="h-3.5 w-3.5" />
          </Button>

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
          {!isMobileLayout && (
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
                    {accountLabel && (
                      <div className="px-2 py-1 text-[11px] text-text-faint border-b border-border-subtle mb-0.5" title={accountLabel}>
                        {accountLabel}
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

          {/* Mobile-only: status + notification pills, then the drawer toggle. */}
          {isMobileLayout && (
            <div className="flex items-center gap-1 shrink-0">
              <SocketStatusBanner />
            <OpActivityPill />
              <TransactionNotificationStack compact />
            </div>
          )}

          {/* Mobile-only: Drawer toggle */}
          {isMobileLayout && (
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
      {isMobileLayout && drawerOpen && (
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
            <AlarmDropdown />

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
              {accountLabel && (
                <div style={{ fontSize: 10, color: "var(--text-faint)", padding: "2px 4px", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis" }} title={accountLabel}>
                  {accountLabel}
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
