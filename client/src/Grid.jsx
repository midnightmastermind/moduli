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
  useCallback,
} from "react";

import Panel from "./modules/Panel";
import ErrorBoundary from "./ui/ErrorBoundary";
import FullscreenOverlay from "./ui/FullscreenOverlay";
import GridFieldsBank from "./ui/GridFieldsBank";
import GridRadialMenu from "./ui/GridRadialMenu";

import { GridDataContext } from "./GridDataContext";
import { GridActionsContext } from "./GridActionsContext";
import { GridLiveContext } from "./GridLiveContext";

import { DragProvider } from "./helpers/DragProvider";
import { useDragContext, useDragHotContext, useDroppable, DragType, DropAccepts } from "./helpers/dragSystem";
import * as CommitHelpers from "./helpers/CommitHelpers";
import { getGridPanels } from "./state/selectors";
import MobileGridNav from "./mobile/MobileGridNav";
import { Layers } from "lucide-react";

// ============================================================
// GRID CELL - Drop zone for panels
// ============================================================
const GridCell = React.memo(function GridCell({ r, c, dark, hasPanel, hasHiddenStack, stackCount }) {
  const { isPanelDrag, cyclePanelStack } = useDragContext();
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

  return (
    <div
      ref={ref}
      data-id={cellId}
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
      {/* Panel switcher — always top-left, cycles through stack including empty */}
      {stackCount > 0 && (
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
      {/* Show pocket effect when cell is empty */}
      {!hasPanel && (
        <div
          style={{
            position: "absolute",
            inset: "6px",
            borderRadius: "8px",
            background: "rgba(69, 72, 74, 0.4)",
            border: "1px solid rgba(0, 0, 0, 0.5)",
            boxShadow: "inset 0 2px 4px rgba(0, 0, 0, 0.3)",
            pointerEvents: "none",
          }}
        >
          <div
            className="text-xs text-muted-foreground p-2 text-center"
            style={{ fontStyle: "italic", opacity: 0.6, width: "100%", position: "absolute", top: "50%", transform: "translateY(-50%)" }}
          >
            Drop panel here
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
  isMobile,
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
        console.log(cellPanels);
        const hasPanel = !!visiblePanel;
        console.log(hasPanel);
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
        "bg-background2 rounded-xl border border-border shadow-inner ring-1 ring-black/30",
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
        borderRadius: isMobile ? 0 : 12,
        transition: "opacity 0.15s ease",
        paddingTop: isMobile ? 0 : 10,
        boxSizing: "border-box",
      }}
    >
      {cellsData.map(({ r, c, dark, hasPanel, hasHiddenStack, stackCount }) => (
        <GridCell key={`cell-${r}-${c}`} r={r} c={c} dark={dark} hasPanel={hasPanel} hasHiddenStack={hasHiddenStack} stackCount={stackCount} />
      ))}

      {/* Vertical resize handles (between columns) — hidden on mobile */}
      {!isMobile && [...Array(cols - 1)].map((_, i) => (
        <div
          key={`col-resize-${i}`}
          onMouseDown={(e) => onStartColResize(e, i)}
          onTouchStart={(e) => onStartColResize(e, i)}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${getColPosition(i)}%`,
            width: 6,
            transform: 'translateX(-50%)',
            cursor: "col-resize",
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
      {!isMobile && [...Array(rows - 1)].map((_, i) => (
        <div
          key={`row-resize-${i}`}
          onMouseDown={(e) => onStartRowResize(e, i)}
          onTouchStart={(e) => onStartRowResize(e, i)}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: `${getRowPosition(i)}%`,
            height: 6,
            transform: 'translateY(-50%)',
            cursor: "row-resize",
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
// GRID INNER (wraps with DragProvider)
// ============================================================
function GridInner() {
  const { state } = useContext(GridDataContext);

  const [dragTick, setDragTick] = useState(0);
  const onTick = useCallback(() => setDragTick((x) => x + 1), []);

  // Fields Bank dialog state
  const [fieldsBankOpen, setFieldsBankOpen] = useState(false);

  const {
    dispatch,
    socket,
    addContainerToPanel,
    addInstanceToContainer,
    createField,
    updateField,
    deleteField,
  } = useContext(GridActionsContext);

  const {
    canUndo,
    canRedo,
    undo,
    redo,
    isProcessing,
    isMobile,
    activeCell,
    setActiveCell,
    zoomedOut,
    setZoomedOut,
  } = useContext(GridLiveContext);

  const grid = state.grid;
  const gridId = grid?._id;

  // Animation hook moved to App.jsx — captureAllPositions wraps undo, onUndoAnimation handles FLIP
  const rows = grid?.rows ?? 1;
  const cols = grid?.cols ?? 1;

  const gridRef = useRef(null);

  // Get panel occurrences with placement data from the grid
  const visiblePanels = useMemo(() => {
    const panelOccurrences = getGridPanels(state);

    // Map occurrences to panels with placement merged in
    // occ.panel is set by autofillOccurrence for both targetType "panel" and "module" with role "panel"
    return panelOccurrences
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
  }, [state]);

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

  const startColResize = useCallback((e, i) => {
    e.preventDefault();
    let startX = getClientX(e);

    const move = (ev) => {
      ev.preventDefault();
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
      finalizeResize();
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
    window.addEventListener("touchmove", move);
    window.addEventListener("touchend", stop);
  }, [resizeColumn, finalizeResize]);

  const startRowResize = useCallback((e, i) => {
    e.preventDefault();
    let startY = getClientY(e);

    const move = (ev) => {
      ev.preventDefault();
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
      finalizeResize();
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
    window.addEventListener("touchmove", move);
    window.addEventListener("touchend", stop);
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
      isMobile={isMobile}
    >
      {isMobile ? (
        <MobileGridNav
          rows={rows}
          cols={cols}
          activeCell={activeCell}
          setActiveCell={setActiveCell}
          isMobile={isMobile}
          zoomedOut={zoomedOut}
          setZoomedOut={setZoomedOut}
          visiblePanels={visiblePanels}
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
            isMobile={isMobile}
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
        />
      )}

      <FullscreenOverlay
        fullscreenPanelId={fullscreenPanelId}
        setFullscreenPanelId={setFullscreenPanelId}
        panelsById={panelsById}
        cols={cols}
        rows={rows}
      />

      {/* Grid Radial Menu - Undo/Redo/Fields (History moved to Toolbar) — hidden on mobile */}
      {!isMobile && (
        <GridRadialMenu
          onUndo={undo}
          onRedo={redo}
          canUndo={canUndo && !isProcessing}
          canRedo={canRedo && !isProcessing}
          onFields={() => setFieldsBankOpen(true)}
          disabled={isProcessing}
        />
      )}

      {/* Grid Fields Bank Dialog */}
      <GridFieldsBank
        open={fieldsBankOpen}
        onOpenChange={setFieldsBankOpen}
        gridId={gridId}
        fields={state.fields || []}
        panels={state.panels || []}
        containers={state.containers || []}
        instances={state.instances || []}
        onCreateField={createField}
        onUpdateField={updateField}
        onDeleteField={deleteField}
      />

    </DragProvider>
  );
}

export default GridInner;
