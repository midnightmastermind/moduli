// Grid.jsx — DUMB COMPONENT
// ============================================================
// DRAG: None (grid itself is not draggable)
// DROP: GridCell accepts PANEL drops
// ============================================================

import React, {
  useContext,
  useMemo,
  useRef,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
} from "react";

import Panel from "./modules/ModulePanel";
import GridMosaic from "./modules/GridMosaic";
import ErrorBoundary from "./ui/ErrorBoundary";
import FullscreenOverlay from "./ui/FullscreenOverlay";
import { allPanelOccIds } from "./helpers/bspTree";

import { GridDataContext } from "./GridDataContext";
import { useGridActions } from "./GridActionsContext";
import { GridLiveContext } from "./GridLiveContext";
import { useActiveCell, useZoomedOut } from "./state/activeCellStore";
import { markCellSwitchCommit } from "./helpers/scrollDiag";

import { DragProvider } from "./helpers/DragProvider";
import { useDragContext, useDragStateContext, useDragHotContext, useDroppable, DropAccepts } from "./helpers/dragSystem";
import * as CommitHelpers from "./helpers/CommitHelpers";
import { getGridPanels } from "./state/selectors";
import { applyLocalSort, createPanelInGrid } from "./helpers/LayoutHelpers";
import { openPanelOnRootFolderPage } from "./helpers/importsFolder";
import { snapPanelInDirection } from "./helpers/gridSnap";
import MobileGridNav from "./mobile/MobileGridNav";
import { Layers } from "lucide-react";

// ============================================================
// GRID CELL - Drop zone for panels
// ============================================================
const GridCell = React.memo(function GridCell({ r, c, dark, hasPanel, hasHiddenStack, stackCount, rows, cols, onEmptyCellClick }) {
  const { cyclePanelStack } = useDragContext();
  const { isPanelDrag } = useDragStateContext();
  const { panelOverCellId } = useDragHotContext();

  const cellId = `cell-${r}-${c}`;

  // DROP ZONE: Accepts panels
  const { ref, isOver } = useDroppable({
    type: "grid-cell",
    id: cellId,
    context: { row: r, col: c, cellId },
    accepts: DropAccepts.GRID_CELL,
    disabled: !isPanelDrag,
  });

  const highlight = isPanelDrag && (panelOverCellId === cellId || isOver);

  // Mobile: Add padding on edges to accommodate rail buttons
  // Top edge: 10px (rail height) + 4px offset
  // Left/Right edges: 10px (rail width) + 4px offset
  // Bottom edge: 10px (rail height) + 4px offset
  const isTopEdge = r === 0;
  const isBottomEdge = r === rows - 1;
  const isLeftEdge = c === 0;
  const isRightEdge = c === cols - 1;

  return (
    <div
      ref={ref}
      data-id={cellId}
      data-edge-top={isTopEdge}
      data-edge-bottom={isBottomEdge}
      data-edge-left={isLeftEdge}
      data-edge-right={isRightEdge}
      className={[
        "grid-cell",
        highlight ? "is-highlight" : "",
      ].join(" ")}
      style={{
        gridRow: r + 1,
        gridColumn: c + 1,
        overflow: "visible",
      }}
    >
      {/* Panel switcher — only on empty cells; populated cells show the switcher inside the panel header */}
      {stackCount > 0 && !hasPanel && (
        <button
          className="panel-stack-btn-inline"
          style={{ border: "none", position: "absolute", top: 5, left: 28, minHeight: 21, zIndex: 90, pointerEvents: "auto" }}
          onClick={(e) => { e.stopPropagation(); cyclePanelStack?.({ cellKey: cellId, dir: 1 }); }}
          title="Cycle panels"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Layers size={9} />
          <span style={{ fontSize: 9, fontWeight: 600 }}>{stackCount}</span>
        </button>
      )}
      {/* Show pocket effect when cell is empty. Click → new panel opened on
          the root folder page (see GridInner.handleEmptyCellClick). */}
      {!hasPanel && (
        <div
          onClick={onEmptyCellClick ? () => onEmptyCellClick(r, c) : undefined}
          role={onEmptyCellClick ? "button" : undefined}
          title={onEmptyCellClick ? "Add a panel here (opens the root folder)" : undefined}
          style={{
            position: "absolute",
            inset: "6px",
            borderRadius: "8px",
            background: "rgba(69, 72, 74, 0.4)",
            border: "1px solid rgba(0, 0, 0, 0.5)",
            boxShadow: "inset 0 2px 4px rgba(0, 0, 0, 0.3)",
            pointerEvents: onEmptyCellClick ? "auto" : "none",
            cursor: onEmptyCellClick ? "pointer" : undefined,
          }}
        >
          <div
            className="text-xs text-muted-foreground p-2 text-center"
            style={{ fontStyle: "italic", opacity: 0.6, width: "100%", position: "absolute", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
          >
            Tap to add a panel
          </div>
        </div>
      )}
    </div>
  );
});


// ============================================================
// GRID RENDER
// ============================================================
function GridRender({
  gridRef,
  rows,
  cols,
  colTemplate,
  rowTemplate,
  colSizes,
  rowSizes,
  panelsRender,
  dispatch,
  socket,
  fullscreenPanelId,
  setFullscreenPanelId,
  addContainerToPanel,
  addInstanceToContainer,
  sizesRef,
  onStartColResize,
  onStartRowResize,
  onEmptyCellClick,
  isMobileLayout,
  isTouch,
}) {
  const [foregroundPanelId, setForegroundPanelId] = useState(null);

  // Detect cells whose primary panel is covered by another panel's multi-span
  const coveredCells = useMemo(() => {
    const result = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const localPanels = panelsRender.filter(p =>
          p.row === r && p.col === c && (p?.layout?.style?.display ?? "block") !== "none"
        );
        if (localPanels.length === 0) continue;

        const isCovered = panelsRender.some(p => {
          if (p.row === r && p.col === c) return false;
          if ((p?.layout?.style?.display ?? "block") === "none") return false;
          return r >= p.row && r < p.row + (p.width || 1)
              && c >= p.col && c < p.col + (p.height || 1);
        });

        if (isCovered) result.push({ r, c, panelId: localPanels[0].id });
      }
    }
    return result;
  }, [rows, cols, panelsRender]);
  const cellsData = useMemo(() => {
    const arr = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cellPanels = panelsRender.filter((p) => p.row === r && p.col === c);
        const visiblePanel = cellPanels.find((p) => (p?.layout?.style?.display ?? "block") !== "none");

        const hasPanel = !!visiblePanel;

        const hasHiddenStack = !hasPanel && cellPanels.length > 1;
        const stackCount = cellPanels.length;
        arr.push({ r, c, dark: (r + c) % 2 === 0, hasPanel, hasHiddenStack, stackCount });
      }
    }
    return arr;
  }, [rows, cols, panelsRender]);

  // Calculate positions for resize handles
  const getColPosition = useCallback((i) => {
    const total = colSizes.reduce((a, b) => a + b, 0);
    const before = colSizes.slice(0, i + 1).reduce((a, b) => a + b, 0);
    return (before / total) * 100;
  }, [colSizes]);

  const getRowPosition = useCallback((i) => {
    const total = rowSizes.reduce((a, b) => a + b, 0);
    const before = rowSizes.slice(0, i + 1).reduce((a, b) => a + b, 0);
    return (before / total) * 100;
  }, [rowSizes]);

  return (
    <div
      ref={gridRef}
      className={[
        "bg-background2 shadow-inner",
        isMobileLayout ? "" : "rounded-xl border border-border ring-1 ring-black/30",
        fullscreenPanelId !== null ? "pointer-events-none opacity-0" : "",
      ].join(" ")}
      style={{
        display: "grid",
        gridTemplateColumns: colTemplate,
        gridTemplateRows: rowTemplate,
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "visible",
        transition: "opacity 0.15s ease",
        boxSizing: "border-box",
        margin: isMobileLayout ? "-2px" : "0",
      }}
    >
      {cellsData.map(({ r, c, dark, hasPanel, hasHiddenStack, stackCount }) => (
        <GridCell key={`cell-${r}-${c}`} r={r} c={c} dark={dark} hasPanel={hasPanel} hasHiddenStack={hasHiddenStack} stackCount={stackCount} rows={rows} cols={cols} onEmptyCellClick={onEmptyCellClick} />
      ))}

      {/* Vertical resize handles (between columns) — hidden on mobile */}
      {!isMobileLayout && [...Array(cols - 1)].map((_, i) => (
        <div
          key={`col-resize-${i}`}
          onMouseDown={(e) => onStartColResize(e, i)}
          onTouchStart={(e) => onStartColResize(e, i)}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${getColPosition(i)}%`,
            // Touch: fat invisible lane (finger-sized); desktop keeps the slim 6px.
            width: isTouch ? 28 : 6,
            transform: 'translateX(-50%)',
            cursor: "col-resize",
            // touch-action:none is the actual gesture claim on touch — React's
            // onTouchStart is passive, so preventDefault can't stop the scroll.
            touchAction: "none",
            zIndex: 2,
            background: "transparent",
            borderRadius: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="4" height="16" viewBox="0 0 4 16" style={{ opacity: 0.6 }}>
            <circle cx="2" cy="4" r="1" fill="white" />
            <circle cx="2" cy="8" r="1" fill="white" />
            <circle cx="2" cy="12" r="1" fill="white" />
          </svg>
        </div>
      ))}

      {/* Horizontal resize handles (between rows) — hidden on mobile */}
      {!isMobileLayout && [...Array(rows - 1)].map((_, i) => (
        <div
          key={`row-resize-${i}`}
          onMouseDown={(e) => onStartRowResize(e, i)}
          onTouchStart={(e) => onStartRowResize(e, i)}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: `${getRowPosition(i)}%`,
            height: isTouch ? 28 : 6,
            transform: 'translateY(-50%)',
            cursor: "row-resize",
            touchAction: "none",
            zIndex: 2,
            background: "transparent",
            borderRadius: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="16" height="4" viewBox="0 0 16 4" style={{ opacity: 0.6 }}>
            <circle cx="4" cy="2" r="1" fill="white" />
            <circle cx="8" cy="2" r="1" fill="white" />
            <circle cx="12" cy="2" r="1" fill="white" />
          </svg>
        </div>
      ))}
      
      {panelsRender.map((p) => {
        const display = p?.layout?.style?.display ?? "block";
        if (display === "none") return null;

        return (
          <ErrorBoundary key={p._occurrenceId || p.id} label={p.label || "Panel"}>
            <Panel
              module={p}
              dispatch={dispatch}
              socket={socket}
              cols={cols}
              rows={rows}
              addContainerToPanel={addContainerToPanel}
              addInstanceToContainer={addInstanceToContainer}
              sizesRef={sizesRef}
              fullscreenPanelId={fullscreenPanelId}
              setFullscreenPanelId={setFullscreenPanelId}
              isForeground={p.id === foregroundPanelId}
            />
          </ErrorBoundary>
        );
      })}

      {/* Covered cell overlay buttons */}
      {coveredCells.map(({ r, c, panelId }) => (
        <div key={`covered-${r}-${c}`} style={{
          gridRow: r + 1, gridColumn: c + 1,
          position: "relative", pointerEvents: "none", zIndex: 85,
        }}>
          <button
            className="covered-cell-btn"
            onClick={() => setForegroundPanelId(prev => prev === panelId ? null : panelId)}
            style={{ pointerEvents: "auto" }}
            title="Bring panel to front"
          >
            <Layers size={10} />
          </button>
        </div>
      ))}

    </div>
  );
}

// ============================================================
// MOSAIC MOBILE NAV — one-panel-at-a-time pager for mosaic grids on mobile.
// Reuses MobileGridNav (rail buttons, overscroll-to-navigate, zoom-out cell
// picker) by modeling the tree's panel order as a 1×N cell space: each panel
// is one "cell" (its col index). Replaces the old plain scroll-stack, which
// had no way to switch cells (user: "the edge buttons to switch cells are no
// longer there").
// ============================================================
function MosaicMobileNav({ gridRef, layoutTree, visiblePanels, activeCell, setActiveCell, zoomedOut, setZoomedOut, isTouch, dispatch, socket, addContainerToPanel, addInstanceToContainer, sizesRef, fullscreenPanelId, setFullscreenPanelId, panelLabelResolver }) {
  const panelByOccId = useMemo(() => {
    const m = Object.create(null);
    for (const p of visiblePanels || []) if (p?._occurrenceId) m[p._occurrenceId] = p;
    return m;
  }, [visiblePanels]);
  // Tree order, filtered to panels that actually render right now.
  const order = useMemo(
    () => allPanelOccIds(layoutTree).filter((id) => panelByOccId[id]),
    [layoutTree, panelByOccId]
  );
  // The mosaic tree is the DESKTOP arrangement. On mobile, navigate the
  // UNDERLYING rows×cols cell map — visiblePanels already carry the real
  // `occurrence.placement` (row/col/width/height), which the mosaic
  // conversion never mutates. This restores the 2D map + 4-direction rail
  // buttons (2026-07-14: "no longer 3 by 2 with the 4 buttons around each
  // side… its just a line now" — the old synthetic 1×N strip). Panels
  // without distinct placements (all stacked at one cell) fall back to the
  // 1×N strip so a placement-less grid still navigates.
  const { rows, cols, navPanels } = useMemo(() => {
    const panels = order.map((occId) => panelByOccId[occId]);
    const distinctCells = new Set(panels.map((p) => `${p.row ?? 0}:${p.col ?? 0}`));
    if (panels.length > 1 && distinctCells.size <= 1) {
      return {
        rows: 1,
        cols: Math.max(1, panels.length),
        navPanels: panels.map((p, i) => ({ ...p, row: 0, col: i, width: 1, height: 1 })),
      };
    }
    return {
      rows: Math.max(1, ...panels.map((p) => (p.row ?? 0) + (p.height || 1)), 1),
      cols: Math.max(1, ...panels.map((p) => (p.col ?? 0) + (p.width || 1)), 1),
      navPanels: panels,
    };
  }, [order, panelByOccId]);
  // Clamp the persisted activeCell (which may carry a shape from a previous
  // layout) into the current cell space at RENDER time — no off-screen
  // flash — then write the clamp back so localStorage/state converge. Skip
  // persisting while order is still EMPTY (panels hydrating): clamping
  // against a 1×1 space then would clobber the user's saved cell on load.
  const row = Math.min(Math.max(activeCell?.row ?? 0, 0), rows - 1);
  const col = Math.min(Math.max(activeCell?.col ?? 0, 0), cols - 1);
  const hydrated = order.length > 0;
  useEffect(() => {
    if (!hydrated) return;
    if ((activeCell?.row ?? 0) !== row || (activeCell?.col ?? 0) !== col) setActiveCell({ row, col });
  }, [hydrated, row, col, activeCell?.row, activeCell?.col, setActiveCell]);
  return (
    <MobileGridNav
      rows={rows}
      cols={cols}
      activeCell={{ row, col }}
      setActiveCell={setActiveCell}
      isMobileLayout
      isTouch={isTouch}
      zoomedOut={zoomedOut}
      setZoomedOut={setZoomedOut}
      visiblePanels={navPanels}
      panelLabelResolver={panelLabelResolver}
    >
      <div
        ref={gridRef}
        className="bg-background2"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
          width: "100%",
          height: "100%",
        }}
      >
        {navPanels.map((p) => (
          <div
            key={p._occurrenceId}
            style={{
              gridColumn: `${(p.col ?? 0) + 1} / span ${p.width || 1}`,
              gridRow: `${(p.row ?? 0) + 1} / span ${p.height || 1}`,
              display: "flex", boxSizing: "border-box", padding: 4,
              minWidth: 0, minHeight: 0,
            }}
          >
            <ErrorBoundary label={p.label || "Panel"}>
              <Panel
                module={p}
                mosaic
                dispatch={dispatch}
                socket={socket}
                addContainerToPanel={addContainerToPanel}
                addInstanceToContainer={addInstanceToContainer}
                sizesRef={sizesRef}
                fullscreenPanelId={fullscreenPanelId}
                setFullscreenPanelId={setFullscreenPanelId}
              />
            </ErrorBoundary>
          </div>
        ))}
      </div>
    </MobileGridNav>
  );
}

// ============================================================
// GRID INNER (wraps with DragProvider)
// ============================================================
function GridInner() {
  const { state } = useContext(GridDataContext);

  const [dragTick, setDragTick] = useState(0);
  const onTick = useCallback(() => setDragTick((x) => x + 1), []);

  const {
    dispatch,
    socket,
    addContainerToPanel,
    addInstanceToContainer,
    createField,
    updateField,
    deleteField,
    occurrencesById,
    modulesById,
    manifestsById,
    viewsById,
  } = useGridActions();

  // Resolve a panel's ACTIVE PAGE label (what the panel is showing) for the
  // mobile nav rails — falls back to the raw panel label (user 2026-07-17:
  // "active page would be better" than "Panel A/B/C").
  const resolvePanelLabel = useCallback((panel) => {
    if (!panel) return null;
    const occ = panel._occurrenceId ? occurrencesById?.[panel._occurrenceId] : null;
    const viewId = occ?.viewId || (occ?.moduleId ? modulesById?.[occ.moduleId]?.viewId : null);
    const view = viewId ? viewsById?.[viewId] : null;
    const activeOcc = view?.activeOccurrenceId ? occurrencesById?.[view.activeOccurrenceId] : null;
    const pageMod = activeOcc?.moduleId ? modulesById?.[activeOcc.moduleId] : null;
    return pageMod?.label || panel.label || null;
  }, [occurrencesById, modulesById, viewsById]);

  const {
    canUndo,
    canRedo,
    undo,
    redo,
    isProcessing,
    isTouch,
    isMobileLayout,
    setActiveCell,
    setZoomedOut,
  } = useContext(GridLiveContext);
  // Subscribed here rather than pulled from the context, so a cell change
  // re-renders the grid shell WITHOUT invalidating the context that every
  // memoised panel and page consumes.
  const activeCell = useActiveCell();
  const zoomedOut = useZoomedOut();

  // Runs after React commits the new cell but before the browser paints, so it
  // is the dividing line between "React was slow" and "layout/paint was slow".
  useLayoutEffect(() => { markCellSwitchCommit(); }, [activeCell]);

  const grid = state.grid;
  const gridId = grid?._id;

  // Opt-in BSP / "mosaic" layout. When present the grid renders as a split-tree
  // mosaic (GridMosaic) instead of the rows×cols CSS grid below.
  const layoutTree = grid?.meta?.layoutTree || null;

  // Animation hook moved to App.jsx — captureAllPositions wraps undo, onUndoAnimation handles FLIP
  const rows = grid?.rows ?? 1;
  const cols = grid?.cols ?? 1;

  const gridRef = useRef(null);

  // Get panel occurrences with placement data from the grid.
  // When `grid.meta.localSort` is set, panels are sorted by the chosen key
  // and reflowed row-major into 1×1 cells — placement is overridden but the
  // underlying occurrence.placement is NOT mutated (clear sort → original
  // placement is back). rowSpan/colSpan collapse to 1 in sort mode; user
  // can re-resize after clearing sort.
  const visiblePanels = useMemo(() => {
    const panelOccurrences = getGridPanels(state);

    // Map occurrences to panels with placement merged in
    // occ.panel is set by autofillOccurrence when the linked module has role "panel"
    const placed = panelOccurrences
      .filter(occ => !!occ.panel)
      .map(occ => ({
        ...occ.panel,
        // Use placement from occurrence (the source of truth for position)
        row: occ.placement?.row ?? occ.panel?.row ?? 0,
        col: occ.placement?.col ?? occ.panel?.col ?? 0,
        width: occ.placement?.width ?? 1,
        height: occ.placement?.height ?? 1,
        // Keep occurrence reference for updates
        _occurrenceId: occ.id,
        _occurrence: occ,
      }));

    const gridSort = grid?.meta?.localSort || null;
    if (!gridSort?.fieldId || placed.length < 2) return placed;

    // Sort + reflow row-major. Use applyLocalSort against `{ instance,
    // occurrence }`-shaped wrappers so the helper's label / field-value
    // resolution paths apply unchanged. Hidden panels (display:none) keep
    // their relative order with the rest — the per-cell visibility hook
    // below still picks ONE visible panel per cell when needed.
    const items = placed.map(p => ({ instance: p, occurrence: p._occurrence }));
    const sorted = applyLocalSort(items, gridSort, state?.modulesById);
    const colsClamped = Math.max(1, cols);
    return sorted.map((it, i) => ({
      ...it.instance,
      row: Math.floor(i / colsClamped),
      col: i % colsClamped,
      width: 1,
      height: 1,
      _occurrenceId: it.occurrence?.id,
      _occurrence: it.occurrence,
    }));
  }, [state, grid?.meta?.localSort, cols]);

  // Defensive: Ensure at least one panel per cell is visible
  useEffect(() => {
    if (!visiblePanels || visiblePanels.length === 0) return;

    // Group panels by cell
    const cellMap = new Map();
    for (const panel of visiblePanels) {
      const key = `${panel.row}-${panel.col}`;
      if (!cellMap.has(key)) {
        cellMap.set(key, []);
      }
      cellMap.get(key).push(panel);
    }

    // Check each cell - if all panels are hidden, show the first one
    for (const [cellKey, panels] of cellMap) {
      if (panels.length === 0) continue;

      const allHidden = panels.every(p => {
        const display = p?.layout?.style?.display ?? "block";
        return display === "none";
      });

      if (allHidden) {
        // Fix: Show the first panel in this cell
        const firstPanel = panels[0];
        CommitHelpers.updateModule({
          dispatch,
          socket,
          module: {
            ...firstPanel,
            layout: {
              ...(firstPanel.layout || {}),
              style: {
                ...(firstPanel.layout?.style || {}),
                display: "block",
              },
            },
          },
          emit: true,
        });
      }
    }
  }, [visiblePanels, dispatch, socket]);

  const [fullscreenPanelId, setFullscreenPanelId] = useState(null);

  // Grid sizing
  const ensureSizes = (arr, count) => {
    if (!Array.isArray(arr) || arr.length === 0) return Array(count).fill(1);
    if (arr.length === count) return arr;
    if (arr.length < count) return [...arr, ...Array(count - arr.length).fill(1)];
    return arr.slice(0, count);
  };

  const sameArray = (a = [], b = []) => {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };

  const [colSizes, setColSizes] = useState(() => ensureSizes(grid?.colSizes, cols));
  const [rowSizes, setRowSizes] = useState(() => ensureSizes(grid?.rowSizes, rows));
  const sizesRef = useRef({ colSizes: [], rowSizes: [] });

  useEffect(() => { sizesRef.current = { colSizes, rowSizes }; }, [colSizes, rowSizes]);
  useEffect(() => {
    const next = ensureSizes(grid?.colSizes, cols);
    setColSizes((prev) => (sameArray(prev, next) ? prev : next));
  }, [cols, grid?._id]);
  useEffect(() => {
    const next = ensureSizes(grid?.rowSizes, rows);
    setRowSizes((prev) => (sameArray(prev, next) ? prev : next));
  }, [rows, grid?._id]);

  const colTemplate = colSizes.map((s) => `${s}fr`).join(" ");
  const rowTemplate = rowSizes.map((s) => `${s}fr`).join(" ");

  // Clamp activeCell when grid dimensions change
  useEffect(() => {
    if (!setActiveCell) return;
    setActiveCell(prev => ({
      row: Math.min(prev.row, rows - 1),
      col: Math.min(prev.col, cols - 1),
    }));
  }, [rows, cols, setActiveCell]);

  const panelsById = useMemo(() => {
    const m = Object.create(null);
    for (const p of state.panels || []) m[p.id] = p;
    return m;
  }, [state.panels]);

  // Grid resize functionality
  const resizePendingRef = useRef({ rowSizes: null, colSizes: null });

  const finalizeResize = useCallback(() => {
    const pending = resizePendingRef.current;
    if (!pending.rowSizes && !pending.colSizes) return;
    if (!gridId) return;

    const nextRowSizes = pending.rowSizes ?? rowSizes;
    const nextColSizes = pending.colSizes ?? colSizes;

    CommitHelpers.updateGrid({
      dispatch,
      socket,
      gridId,
      grid: { rowSizes: nextRowSizes, colSizes: nextColSizes },
      emit: true,
    });

    resizePendingRef.current = { rowSizes: null, colSizes: null };
  }, [gridId, rowSizes, colSizes, dispatch, socket]);

  const getGridWidth = () => gridRef.current?.clientWidth || 1;
  const getGridHeight = () => gridRef.current?.clientHeight || 1;

  const resizeColumn = useCallback((i, pixelDelta) => {
    const gridWidth = getGridWidth();
    setColSizes((sizes) => {
      const next = i + 1;
      if (next >= sizes.length) return sizes;

      const total = sizes.reduce((a, b) => a + b, 0);
      const frDelta = (pixelDelta / gridWidth) * total;

      const copy = [...sizes];
      copy[i] = Math.max(0.3, copy[i] + frDelta);
      copy[next] = Math.max(0.3, copy[next] - frDelta);

      resizePendingRef.current.colSizes = copy;
      return copy;
    });
  }, []);

  const resizeRow = useCallback((i, pixelDelta) => {
    const gridHeight = getGridHeight();
    setRowSizes((sizes) => {
      const next = i + 1;
      if (next >= sizes.length) return sizes;

      const total = sizes.reduce((a, b) => a + b, 0);
      const frDelta = (pixelDelta / gridHeight) * total;

      const copy = [...sizes];
      copy[i] = Math.max(0.3, copy[i] + frDelta);
      copy[next] = Math.max(0.3, copy[next] - frDelta);

      resizePendingRef.current.rowSizes = copy;
      return copy;
    });
  }, []);

  const getClientX = (e) => (e.touches ? e.touches[0].clientX : e.clientX);
  const getClientY = (e) => (e.touches ? e.touches[0].clientY : e.clientY);

  // ── Windows-style panel snap (desktop rows×cols grids) ────────────────────
  // Ctrl+Alt+Arrow moves the LAST-CLICKED panel one cell; at the grid boundary
  // it ADDS a row/col and moves the panel into the new track (Win+Arrow
  // semantics — the vacated cell stays free for new panels). Tablet landscape
  // gets the drag-to-edge variant (DragProvider getSnapEdge → snapPanelToEdge).
  const lastPanelIdRef = useRef(null);
  useEffect(() => {
    const onDown = (e) => {
      const el = e.target?.closest?.("[data-panel-id]");
      if (el) lastPanelIdRef.current = el.getAttribute("data-panel-id");
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  useEffect(() => {
    if (isMobileLayout || layoutTree) return; // rows×cols desktop only
    const DIR_BY_KEY = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
    const onKey = (e) => {
      if (!e.ctrlKey || !e.altKey) return;
      const direction = DIR_BY_KEY[e.key];
      if (!direction) return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;
      const panel = visiblePanels.find((p) => p.id === lastPanelIdRef.current) || visiblePanels[0];
      const occ = panel?._occurrenceId ? occurrencesById?.[panel._occurrenceId] : null;
      if (!occ) return;
      e.preventDefault();
      snapPanelInDirection({ direction, panelOcc: occ, grid, occurrencesById, dispatch, socket });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMobileLayout, layoutTree, visiblePanels, occurrencesById, grid, dispatch, socket]);

  // Click an EMPTY grid cell → mint a panel there whose active page is the
  // ROOT FOLDER page (the full card grid of everything on the grid), so an
  // empty cell is one tap away from useful content (2026-07-03, per user).
  const handleEmptyCellClick = useCallback((r, c) => {
    if (!grid || !state?.userId) return;
    const result = createPanelInGrid({
      dispatch, socket, grid,
      panel: {
        id: crypto.randomUUID(), userId: state.userId, gridId, kind: "board", label: "Panel",
        defaultDragMode: "move",
        layout: { name: "Panel", display: "flex", flow: "column", wrap: "nowrap", gapPx: 4, scrollY: "auto", padding: "sm" },
      },
      placement: { row: r, col: c, width: 1, height: 1 },
      userId: state.userId,
    });
    if (result?.occurrence?.id) {
      openPanelOnRootFolderPage({
        panelOccId: result.occurrence.id, grid, gridId,
        manifestsById, occurrencesById, modulesById, dispatch, socket, userId: state.userId,
      });
    }
  }, [grid, gridId, state?.userId, manifestsById, occurrencesById, modulesById, dispatch, socket]);

  const startColResize = useCallback((e, i) => {
    e.preventDefault();
    let startX = getClientX(e);

    const move = (ev) => {
      // Touch: claim the gesture so the browser doesn't treat it as a page
      // scroll (which fires touchcancel and strands the listeners — the
      // "resize works once then dies" bug). Needs the non-passive listener below.
      if (ev.cancelable) ev.preventDefault();
      const currentX = getClientX(ev);
      const delta = currentX - startX;
      startX = currentX;
      resizeColumn(i, delta);
    };

    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", stop);
      window.removeEventListener("touchcancel", stop);
      finalizeResize();
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", stop);
    window.addEventListener("touchcancel", stop);
  }, [resizeColumn, finalizeResize]);

  const startRowResize = useCallback((e, i) => {
    e.preventDefault();
    let startY = getClientY(e);

    const move = (ev) => {
      // See startColResize — non-passive + preventDefault keeps the gesture
      // from becoming a page scroll (touchcancel stranded the listeners).
      if (ev.cancelable) ev.preventDefault();
      const currentY = getClientY(ev);
      const delta = currentY - startY;
      startY = currentY;
      resizeRow(i, delta);
    };

    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", stop);
      window.removeEventListener("touchcancel", stop);
      finalizeResize();
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", stop);
    window.addEventListener("touchcancel", stop);
  }, [resizeRow, finalizeResize]);

  return (
    <DragProvider
      state={state}
      dispatch={dispatch}
      socket={socket}
      gridRef={gridRef}
      rows={rows}
      cols={cols}
      rowSizes={rowSizes}
      colSizes={colSizes}
      visiblePanels={visiblePanels}
      onTick={onTick}
      activeCell={activeCell}
      setActiveCell={setActiveCell}
      isTouch={isTouch}
      isMobileLayout={isMobileLayout}
    >
      {layoutTree && !isMobileLayout ? (
        <GridMosaic
          gridRef={gridRef}
          panelsRender={visiblePanels}
          grid={grid}
          dispatch={dispatch}
          socket={socket}
          fullscreenPanelId={fullscreenPanelId}
          setFullscreenPanelId={setFullscreenPanelId}
          addContainerToPanel={addContainerToPanel}
          addInstanceToContainer={addInstanceToContainer}
          sizesRef={sizesRef}
        />
      ) : layoutTree && isMobileLayout ? (
        <MosaicMobileNav
          gridRef={gridRef}
          layoutTree={layoutTree}
          visiblePanels={visiblePanels}
          activeCell={activeCell}
          setActiveCell={setActiveCell}
          zoomedOut={zoomedOut}
          setZoomedOut={setZoomedOut}
          isTouch={isTouch}
          dispatch={dispatch}
          socket={socket}
          addContainerToPanel={addContainerToPanel}
          addInstanceToContainer={addInstanceToContainer}
          sizesRef={sizesRef}
          fullscreenPanelId={fullscreenPanelId}
          setFullscreenPanelId={setFullscreenPanelId}
          panelLabelResolver={resolvePanelLabel}
        />
      ) : isMobileLayout ? (
        <MobileGridNav
          rows={rows}
          cols={cols}
          activeCell={activeCell}
          setActiveCell={setActiveCell}
          isMobileLayout={isMobileLayout}
          isTouch={isTouch}
          zoomedOut={zoomedOut}
          setZoomedOut={setZoomedOut}
          visiblePanels={visiblePanels}
          panelLabelResolver={resolvePanelLabel}
        >
          <GridRender
            gridRef={gridRef}
            rows={rows}
            cols={cols}
            colTemplate={colTemplate}
            rowTemplate={rowTemplate}
            colSizes={colSizes}
            rowSizes={rowSizes}
            panelsRender={visiblePanels}
            dispatch={dispatch}
            socket={socket}
            fullscreenPanelId={fullscreenPanelId}
            setFullscreenPanelId={setFullscreenPanelId}
            addContainerToPanel={addContainerToPanel}
            addInstanceToContainer={addInstanceToContainer}
            sizesRef={sizesRef}
            onStartColResize={startColResize}
            onStartRowResize={startRowResize}
            onEmptyCellClick={handleEmptyCellClick}
            isMobileLayout={isMobileLayout}
            isTouch={isTouch}
          />
        </MobileGridNav>
      ) : (
        <GridRender
          gridRef={gridRef}
          rows={rows}
          cols={cols}
          colTemplate={colTemplate}
          rowTemplate={rowTemplate}
          colSizes={colSizes}
          rowSizes={rowSizes}
          panelsRender={visiblePanels}
          dispatch={dispatch}
          socket={socket}
          fullscreenPanelId={fullscreenPanelId}
          setFullscreenPanelId={setFullscreenPanelId}
          addContainerToPanel={addContainerToPanel}
          addInstanceToContainer={addInstanceToContainer}
          sizesRef={sizesRef}
          onStartColResize={startColResize}
          onStartRowResize={startRowResize}
          onEmptyCellClick={handleEmptyCellClick}
          isMobileLayout={isMobileLayout}
          isTouch={isTouch}
        />
      )}

      <FullscreenOverlay
        fullscreenPanelId={fullscreenPanelId}
        setFullscreenPanelId={setFullscreenPanelId}
        panelsById={panelsById}
        cols={cols}
        rows={rows}
      />

      {/* Grid Radial Menu removed — undo/redo + history live in Toolbar.
          The fixed bottom-right placement was covering the bottom-right
          panel's resize handle. */}

    </DragProvider>
  );
}

export default GridInner;
