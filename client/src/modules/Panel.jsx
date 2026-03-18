// modules/Panel.jsx
// Extracted from Module.jsx ModulePanel component.
// Renders a panel shell with its containers.
// Handles panel-specific UI: iteration nav, fullscreen, resize, stacking, copy/split/delete.

import React, { useRef, useMemo, useState, useCallback, useEffect, useContext } from "react";
import ResizeHandle from "../ResizeHandle";
import RadialMenu from "../ui/RadialMenu";
import ContainerKindSelector from "../ui/ContainerKindSelector";
import LocalIterationNav from "../ui/LocalIterationNav";
import ContextMenu from "../ui/ContextMenu";

import Artifact from "./Artifact";
import ManifestTree from "./ManifestTree";
import LayoutForm from "../ui/LayoutForm";
import TransactionHistory from "../ui/TransactionHistory";
import { Popover, PopoverTrigger, PopoverContent, PopoverAnchor } from "@/components/ui/popover";
import { Button } from "../components/ui/button";

import { GridActionsContext } from "../GridActionsContext";
import { GridDataContext } from "../GridDataContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { resolveEffectiveFilters, isOccurrenceVisible } from "../state/selectors";
import {
  getPanelContainers,
  getContainerItems,
  copyPanel,
  copylinkPanel,
  splitPanel,
  unsplitPanel,
} from "../helpers/LayoutHelpers";
import {
  useDraggable,
  useDroppable,
  useDragContext,
  DragType,
  DropAccepts,
} from "../helpers/dragSystem";

import {
  Copy,
  Link2,
  Unlink,
  Trash2,
  SplitSquareHorizontal,
  Merge,
} from "lucide-react";

import Container from "./Container.jsx";
import QuickAddMenu from "../ui/QuickAddMenu.jsx";

// ============================================================
// LAYOUT HELPERS
// ============================================================
function getDefaultLayout() {
  return {
    name: "",
    display: "grid",
    flow: "row",
    wrap: "wrap",
    columns: 0,
    rows: 0,
    gapPx: 12,
    alignItems: "start",
    alignContent: "start",
    justify: "start",
    dense: false,
    padding: "none",
    scrollY: "auto",
    widthMode: "auto",
    fixedWidth: 340,
    fixedHeight: 0,
    style: { display: "block" },
    lock: { enabled: false, containersDrag: true, containersDrop: true, instancesDrag: true, instancesDrop: true },
  };
}

function mergeLayout(panelLayout) {
  const base = getDefaultLayout();
  const next = panelLayout && typeof panelLayout === "object" ? panelLayout : {};
  return {
    ...base,
    ...next,
    style: { ...base.style, ...(next.style || {}) },
    lock: { ...base.lock, ...(next.lock || {}) },
  };
}

// Separate component so useState for treeCollapsed doesn't re-run on every panel render
function TreePanelContent({ resolvedView, activeOcc, activeOccView, dispatch, socket }) {
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
      <ManifestTree
        manifestId={resolvedView.manifestId}
        view={resolvedView}
        dispatch={dispatch}
        socket={socket}
        collapsed={treeCollapsed}
        onToggleCollapse={() => setTreeCollapsed(v => !v)}
      />
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative", display: "flex", flexDirection: "column" }}>
        <Artifact
          occurrence={activeOcc}
          viewType={activeOccView?.viewType ?? "markdown"}
          artifactType={activeOccView?.artifactType ?? null}
          dispatch={dispatch}
          socket={socket}
          view={resolvedView}
        />
      </div>
    </div>
  );
}

// ============================================================
// PANEL COMPONENT
// ============================================================
export default function Panel({
  module,
  dispatch,
  socket,
  cols,
  rows,
  addContainerToPanel,
  addInstanceToContainer,
  sizesRef,
  fullscreenPanelId,
  setFullscreenPanelId,
  forceFullscreen = false,
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [kindSelectorOpen, setKindSelectorOpen] = useState(false);
  const [kindSelectorPos, setKindSelectorPos] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [panelHeaderHovered, setPanelHeaderHovered] = useState(false);
  const [showHeader, setShowHeader] = useState(true);
  const panelDragMode = module?.defaultDragMode || "move";

  const { occurrencesById, instancesById, containersById, viewsById, modulesById } = useContext(GridActionsContext);
  const { state } = useContext(GridDataContext);
  const dragCtx = useDragContext();
  const {
    isContainerDrag,
    isInstanceDrag,
    isExternalDrag,
  } = dragCtx;
  // LAYOUT STATE
  const layout = useMemo(() => mergeLayout(module?.layout), [module?.layout]);
  const layoutSaveTimer = useRef(null);
  useEffect(() => () => window.clearTimeout(layoutSaveTimer.current), []);

  // CS6a — Scoped custom CSS injection
  useEffect(() => {
    if (!module?.customCss || !module?.id) return;
    const styleId = `mod-css-${module.id}`;
    let tag = document.getElementById(styleId);
    if (!tag) { tag = document.createElement("style"); tag.id = styleId; document.head.appendChild(tag); }
    tag.textContent = `.mod-${module.id} { ${module.customCss} }`;
    return () => { document.getElementById(styleId)?.remove(); };
  }, [module?.customCss, module?.id]);

  const togglePanelDragModeQuick = useCallback(() => {
    const nextMode = panelDragMode === "move" ? "copy" : "move";
    CommitHelpers.updateModule({ dispatch, socket, module: { ...module, defaultDragMode: nextMode }, emit: true });
  }, [module, panelDragMode, dispatch, socket]);

  const commitPanelLayout = useCallback((nextLayout) => {
    if (!module) return;
    const curr = module.layout || {};
    const merged = mergeLayout({ ...curr, ...nextLayout });
    CommitHelpers.updateModule({ dispatch, socket, module: { ...module, layout: merged }, emit: true });
  }, [module, socket, dispatch]);

  const commitPanelIteration = useCallback((nextIteration) => {
    if (!module) return;
    CommitHelpers.updateModule({ dispatch, socket, module: { ...module, iteration: nextIteration }, emit: true });
  }, [module, socket, dispatch]);

  const commitPanelDragMode = useCallback((nextMode) => {
    if (!module) return;
    CommitHelpers.updateModule({ dispatch, socket, module: { ...module, defaultDragMode: nextMode }, emit: true });
  }, [module, socket, dispatch]);

  const commitPanelStyleUpdate = useCallback((styleUpdates) => {
    if (!module) return;
    CommitHelpers.updateModule({ dispatch, socket, module: { ...module, ...styleUpdates }, emit: true });
  }, [module, socket, dispatch]);

  // Occurrence for this panel
  const panelOccurrence = useMemo(() => {
    return Object.values(occurrencesById).find(occ => occ.targetId === module.id);
  }, [occurrencesById, module.id]);

  const commitOccurrenceUpdate = useCallback((updates) => {
    if (!panelOccurrence?.id) return;
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: panelOccurrence.id, ...updates }, emit: true });
  }, [panelOccurrence, dispatch, socket]);

  // View: check occurrence.viewId first (new system), fall back to module.viewId (legacy)
  const resolvedViewId = panelOccurrence?.viewId || module.viewId;
  const currentView = resolvedViewId ? viewsById[resolvedViewId] : null;
  const currentViewType = currentView?.viewType || "list";

  // Quick-add: create an occurrence of an existing container module in this panel
  const handleQuickAddContainer = useCallback((containerModule) => {
    if (!panelOccurrence || !containerModule?.id) return;
    const occId = crypto.randomUUID();
    const occ = {
      id: occId,
      userId: module.userId,
      gridId: module.gridId,
      targetId: containerModule.id,
      targetType: "module",
      iteration: { mode: "persistent" },
      fields: {},
    };
    CommitHelpers.createOccurrence({ dispatch, socket, occurrence: occ, emit: true });
    // Add to panel's occurrence list
    const updatedOccs = [...(panelOccurrence.occurrences || []), occId];
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: panelOccurrence.id, occurrences: updatedOccs }, emit: true });
  }, [panelOccurrence, module, dispatch, socket]);

  const handleViewTypeChange = useCallback((e) => {
    const newViewType = e.target.value;
    if (newViewType === currentViewType) return;
    if (currentView) {
      CommitHelpers.updateView({ dispatch, socket, view: { ...currentView, viewType: newViewType }, emit: true });
    } else {
      const viewId = crypto.randomUUID();
      CommitHelpers.createView({
        dispatch, socket,
        view: { id: viewId, userId: module.userId, gridId: module.gridId, panelId: module.id, name: "Default View", viewType: newViewType },
        emit: true,
      });
      CommitHelpers.updateModule({ dispatch, socket, module: { ...module, viewId }, emit: true });
    }
  }, [currentView, currentViewType, module, dispatch, socket]);

  const setLayout = useCallback((nextLayout) => {
    if (!module) return;
    const curr = module.layout || {};
    const merged = mergeLayout({ ...curr, ...nextLayout });
    CommitHelpers.updateModule({ dispatch, socket, module: { ...module, layout: merged }, emit: false });
    window.clearTimeout(layoutSaveTimer.current);
    layoutSaveTimer.current = window.setTimeout(() => {
      CommitHelpers.updateModule({ dispatch, socket, module: { ...module, layout: merged }, emit: true });
    }, 150);
  }, [module, socket, dispatch]);

  // SPLIT
  const grid = state?.grid;
  const userId = state?.userId;

  const splitPartnerPanel = useMemo(() => {
    if (!module.splitPartnerId) return null;
    return modulesById[module.splitPartnerId] || null;
  }, [module.splitPartnerId, modulesById]);

  const splitPartnerOccurrenceId = useMemo(() => {
    if (!splitPartnerPanel) return null;
    return Object.values(occurrencesById).find(occ => occ.targetId === splitPartnerPanel.id)?.id || null;
  }, [splitPartnerPanel, occurrencesById]);

  const isSplit = !!splitPartnerPanel;

  const handleCopyPanel = useCallback(() => {
    if (!grid || !userId) return;
    copyPanel({ dispatch, socket, grid, panel: module, userId });
  }, [dispatch, socket, grid, module, userId]);

  const handleCopylinkPanel = useCallback(() => {
    if (!grid || !userId) return;
    copylinkPanel({ dispatch, socket, grid, panel: module, userId });
  }, [dispatch, socket, grid, module, userId]);

  const handleSplitPanel = useCallback(() => {
    if (!grid || !userId) return;
    splitPanel({ dispatch, socket, grid, panel: module, userId });
  }, [dispatch, socket, grid, module, userId]);

  const handleUnsplitPanel = useCallback(() => {
    if (!grid || !splitPartnerPanel) return;
    unsplitPanel({ dispatch, socket, grid, panel: module, splitPartnerPanel, splitPartnerOccurrenceId });
  }, [dispatch, socket, grid, module, splitPartnerPanel, splitPartnerOccurrenceId]);

  const handlePanelContextMenu = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: "Copy panel", icon: Copy, onClick: handleCopyPanel },
        { label: "Link panel", icon: Link2, onClick: handleCopylinkPanel },
        panelOccurrence?.linkedGroupId && {
          label: "Break link",
          icon: Unlink,
          onClick: () => CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { ...panelOccurrence, linkedGroupId: null }, emit: true }),
        },
        isSplit
          ? { label: "Merge back", icon: Merge, onClick: handleUnsplitPanel }
          : { label: "Split panel", icon: SplitSquareHorizontal, onClick: handleSplitPanel },
        { separator: true },
        { label: "Delete panel", icon: Trash2, danger: true, onClick: () => CommitHelpers.deleteModule({ dispatch, socket, moduleId: module.id, emit: true }) },
      ].filter(Boolean),
    });
  }, [handleCopyPanel, handleCopylinkPanel, handleSplitPanel, handleUnsplitPanel, isSplit, panelOccurrence, module.id, dispatch, socket]);

  // DISPLAY STATE
  const display = layout?.style?.display ?? "block";
  const hidden = display === "none";
  const isFullscreen = forceFullscreen || fullscreenPanelId === module.id;
  const [liveSize, setLiveSize] = useState({ w: null, h: null });

  // STACK (nav arrows moved to GridCell overlay)

  // LAYOUT ORIENTATION
  const panelLayoutOrientation = useMemo(() => {
    const l = layout;
    if (l.display === "flex") return l.flow === "row" ? "horizontal" : "vertical";
    if (l.display === "grid") return (l.columns || 0) > 1 ? "horizontal" : "vertical";
    return "vertical";
  }, [layout]);

  // DRAG
  const isChildDrag = isContainerDrag || isInstanceDrag || isExternalDrag;

  const panelWithChildren = useMemo(() => {
    const containers = getPanelContainers(module, occurrencesById, containersById, panelOccurrence);
    const containerObjects = containers.map(container => ({
      ...container,
      instanceObjects: getContainerItems(container, occurrencesById, instancesById),
    }));
    return { ...module, containerObjects };
  }, [module, occurrencesById, containersById, instancesById, panelOccurrence]);

  const panelHandleRef = useRef(null);

  const { ref: dragRef, isDragging } = useDraggable({
    type: DragType.PANEL,
    id: module.id,
    data: panelWithChildren,
    context: { panelId: module.id, cellId: `cell-${module.row}-${module.col}` },
    disabled: hidden || isChildDrag,
    dragHandleRef: panelHandleRef,
  });

  const { ref: headerDropRef, isOver: isHeaderOver } = useDroppable({
    type: "panel-header",
    id: `panel-header:${module.id}`,
    context: { panelId: module.id, insertAt: 0 },
    accepts: DropAccepts.PANEL_CONTENT,
    disabled: hidden || panelLayoutOrientation !== "vertical",
  });

  const { ref: dropRef, isOver } = useDroppable({
    type: "panel-content",
    id: `panel-content:${module.id}`,
    context: { panelId: module.id },
    accepts: DropAccepts.PANEL_CONTENT,
    disabled: hidden,
  });

  // Effective filters for container-level visibility (panel occurrence can override grid filters)
  const panelEffectiveFilters = useMemo(
    () => resolveEffectiveFilters(panelOccurrence, state?.grid?.activeFilterValues || {}),
    [panelOccurrence, state?.grid?.activeFilterValues]
  );

  const containersList = useMemo(() => {
    const allContainers = getPanelContainers(module, occurrencesById, containersById, panelOccurrence);
    // Find each container's occurrence to check visibility
    const panelChildOccIds = panelOccurrence?.occurrences || [];
    return allContainers.filter(container => {
      const containerOccId = panelChildOccIds.find(occId => occurrencesById[occId]?.targetId === container.id);
      const containerOcc = containerOccId ? occurrencesById[containerOccId] : null;
      return isOccurrenceVisible(containerOcc ?? { id: container.id }, panelEffectiveFilters);
    });
  }, [module, occurrencesById, containersById, panelOccurrence, panelEffectiveFilters]);

  const getLayoutStyles = () => {
    const l = layout;
    const styles = {};
    if (l.display === "grid") {
      styles.display = "grid";
      const minWidth = l.minWidthPx > 0 ? `${l.minWidthPx}px` : "280px";
      styles.gridTemplateColumns = l.columns > 0 ? `repeat(${l.columns}, 1fr)` : `repeat(auto-fill, minmax(${minWidth}, 1fr))`;
      if (l.rows > 0) styles.gridTemplateRows = `repeat(${l.rows}, auto)`;
      if (l.dense) styles.gridAutoFlow = "dense";
    } else if (l.display === "flex") {
      styles.display = "flex";
      styles.flexDirection = (l.flow === "column" || l.flow === "col") ? "column" : "row";
      styles.flexWrap = l.wrap === "nowrap" ? "nowrap" : "wrap";
    } else if (l.display === "columns") {
      styles.display = "block";
      styles.columnCount = l.columns > 0 ? l.columns : "auto";
      if (l.minWidthPx > 0) styles.columnWidth = `${l.minWidthPx}px`;
      styles.columnGap = `${l.gapPx || 12}px`;
    } else {
      styles.display = "block";
    }
    if (l.display !== "columns") styles.gap = `${l.gapPx || 12}px`;
    styles.alignItems = l.alignItems || "start";
    styles.alignContent = l.alignContent || "start";
    styles.justifyContent = l.justify || "start";
    if (l.widthMode === "fixed" && l.fixedWidth > 0) styles.width = `${l.fixedWidth}px`;
    if (l.minWidthPx > 0 && l.display !== "grid") styles.minWidth = `${l.minWidthPx}px`;
    if (l.maxWidthPx > 0) styles.maxWidth = `${l.maxWidthPx}px`;
    if (l.heightMode === "fixed" && l.fixedHeight > 0) styles.height = `${l.fixedHeight}px`;
    if (l.minHeightPx > 0) styles.minHeight = `${l.minHeightPx}px`;
    if (l.maxHeightPx > 0) styles.maxHeight = `${l.maxHeightPx}px`;
    return styles;
  };

  if (hidden && !forceFullscreen) return null;

  const cellWidth = liveSize.w !== null ? liveSize.w : (module.width || 1);
  const cellHeight = liveSize.h !== null ? liveSize.h : (module.height || 1);
  const isExtended = cellWidth > 1 || cellHeight > 1;
  const isPanelDrag = dragCtx.isPanelDrag;

  const panelChildOccIds = panelOccurrence?.occurrences || [];
  const containerListJSX = containersList.map((container) => {
    const containerOccId = panelChildOccIds.find(occId => occurrencesById[occId]?.targetId === container.id);
    return (<Container
      key={containerOccId || container.id}
      module={container}
      panel={module}
      panelId={module.id}
      panelLayoutOrientation={panelLayoutOrientation}
      addInstanceToContainer={addInstanceToContainer}
      dispatch={dispatch}
      socket={socket}
      gapPx={layout.gapPx || 12}
    />);
  });

  const contentInner = (
    <>
      <div
        style={{
          position: "absolute",
          inset: "5px",
          borderRadius: "6px",
          background: "var(--surface-overlay)",
          border: "1px solid var(--border-default)",
          boxShadow: "inset 0 2px 4px rgba(0, 0, 0, 0.3)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      <div style={{ ...getLayoutStyles(), position: "relative", minHeight: "100%", zIndex: 1, padding: layout.padding === "none" ? "5px" : "12px" }}>
        {containerListJSX}
        {containersList.length === 0 && (
          <div className="text-xs text-muted-foreground text-center empty-placeholder">
            Drop containers here
          </div>
        )}
      </div>
    </>
  );

  return (
    <div
      ref={(node) => {
        if (typeof dragRef === "function") dragRef(node); else if (dragRef) dragRef.current = node;
      }}
      role="region"
      aria-label={layout.name || module.label || `Panel ${module.id}`}
      data-panel-id={module.id}
      data-testid="panel-shell"
      className={`panel-shell bg-background rounded-lg border border-border shadow-md mod-${module.id}`}
      style={{
        gridRow: isFullscreen ? "auto" : `${module.row + 1} / span ${cellHeight}`,
        gridColumn: isFullscreen ? "auto" : `${module.col + 1} / span ${cellWidth}`,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minHeight: 0,
        minWidth: 0,
        opacity: isDragging ? 0.4 : 1,
        margin: isFullscreen ? 0 : "6px",
        zIndex: isExtended ? 60 : 1,
        pointerEvents: isPanelDrag && !isDragging ? "none" : "auto",
        ...(isFullscreen && {
          position: "fixed",
          top: 16, left: 16, right: 16, bottom: 16,
          zIndex: 1000,
        }),
      }}
    >
      <ContextMenu ctx={ctxMenu} onClose={() => setCtxMenu(null)} />

      {/* COG HANDLE — shown when header hidden, acts as drag handle */}
      {!showHeader && (
        <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
          <PopoverAnchor asChild>
            <div ref={panelHandleRef} className="panel-cog-handle module-handle module-grab-zone">
              <span className="module-dot" />
              <RadialMenu
                dragMode={panelDragMode}
                onToggleDragMode={togglePanelDragModeQuick}
                onSettings={() => setSettingsOpen(true)}
                onAddChild={(e) => {
                  const rect = e?.currentTarget?.getBoundingClientRect?.();
                  if (rect) setKindSelectorPos({ top: rect.bottom + 8, left: rect.left });
                  else setKindSelectorPos(null);
                  setKindSelectorOpen(true);
                }}
                addLabel="Container"
                size="sm"
                onToggleHeader={() => setShowHeader(true)}
                showHeader={false}
                onHistory={() => setHistoryOpen(true)}
              />
            </div>
          </PopoverAnchor>
          <PopoverContent align="start" side="right" collisionPadding={8} className="w-auto p-0">
            <LayoutForm
              value={layout}
              onChange={setLayout}
              onCommit={commitPanelLayout}
              panelId={module.id}
              panel={module}
              onPanelStyleUpdate={commitPanelStyleUpdate}
              iteration={module.iteration}
              onIterationChange={commitPanelIteration}
              defaultDragMode={module.defaultDragMode}
              onDragModeChange={commitPanelDragMode}
              occurrence={panelOccurrence}
              onOccurrenceUpdate={commitOccurrenceUpdate}
              currentViewType={currentViewType}
              onViewTypeChange={handleViewTypeChange}
              onCopyPanel={handleCopyPanel}
              onCopylinkPanel={handleCopylinkPanel}
              onSplitPanel={handleSplitPanel}
              onUnsplitPanel={isSplit ? handleUnsplitPanel : null}
              isSplit={isSplit}
            />
          </PopoverContent>
        </Popover>
      )}

      {/* HEADER */}
      {showHeader && (
      <div
        ref={(node) => {
          if (typeof headerDropRef === "function") headerDropRef(node); else if (headerDropRef) headerDropRef.current = node;
        }}
        className={`panel-header module-header-row no-select border-b border-gray-700 border-solid${panelHeaderHovered ? " header-hovered" : ""}`}
        onContextMenu={handlePanelContextMenu}
        onMouseOver={(e) => { e.stopPropagation(); setPanelHeaderHovered(true); }}
        onMouseOut={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setPanelHeaderHovered(false); }}
      >
        <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
          <PopoverAnchor asChild>
            <div
              ref={panelHandleRef}
              className="module-handle module-grab-zone"
            >
              <span className="module-dot" />
              <RadialMenu
                dragMode={panelDragMode}
                onToggleDragMode={togglePanelDragModeQuick}
                onSettings={() => setSettingsOpen(true)}
                onAddChild={(e) => {
                  const rect = e?.currentTarget?.getBoundingClientRect?.();
                  if (rect) setKindSelectorPos({ top: rect.bottom + 8, left: rect.left });
                  else setKindSelectorPos(null);
                  setKindSelectorOpen(true);
                }}
                addLabel="Container"
                size="sm"
                onToggleHeader={() => setShowHeader(false)}
                showHeader={showHeader}
                onHistory={() => setHistoryOpen(true)}
              />
            </div>
          </PopoverAnchor>
          <PopoverContent align="start" side="right" collisionPadding={8} className="w-auto p-0">
            <LayoutForm
              value={layout}
              onChange={setLayout}
              onCommit={commitPanelLayout}
              panelId={module.id}
              panel={module}
              onPanelStyleUpdate={commitPanelStyleUpdate}
              iteration={module.iteration}
              onIterationChange={commitPanelIteration}
              defaultDragMode={module.defaultDragMode}
              onDragModeChange={commitPanelDragMode}
              occurrence={panelOccurrence}
              onOccurrenceUpdate={commitOccurrenceUpdate}
              currentViewType={currentViewType}
              onViewTypeChange={handleViewTypeChange}
              onCopyPanel={handleCopyPanel}
              onCopylinkPanel={handleCopylinkPanel}
              onSplitPanel={handleSplitPanel}
              onUnsplitPanel={isSplit ? handleUnsplitPanel : null}
              isSplit={isSplit}
            />
          </PopoverContent>
        </Popover>

        {isHeaderOver && panelLayoutOrientation === "vertical" && containersList.length > 0 && (
          <div className="drop-indicator drop-indicator-insert" />
        )}

        <span className="text-sm font-small pl-1 truncate flex-1 flex items-center gap-1">
          {layout.name || module.id}
          {panelOccurrence?.linkedGroupId && (
            <Link2 className="w-3 h-3 text-blue-400 opacity-60 flex-shrink-0" title="Linked" />
          )}
        </span>

        <div onPointerDown={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
          <QuickAddMenu
            targetRole="container"
            onSelect={handleQuickAddContainer}
            onCreateNew={() => addContainerToPanel?.(module.id, "list")}
            createLabel="New container"
          />
        </div>

        <div className="ml-auto mr-2 flex items-center" onPointerDown={(e) => e.stopPropagation()}>
          <LocalIterationNav
            occurrence={panelOccurrence}
            onUpdate={commitOccurrenceUpdate}
            showModeToggle={true}
            compact={true}
          />
        </div>

        {/* Stack nav moved to GridCell overlay */}
      </div>
      )}

      {/* CONTENT */}
      {(() => {
        const resolvedView = resolvedViewId ? viewsById[resolvedViewId] : null;
        const viewType = resolvedView?.viewType;

        // Tree panel — ManifestTree sidebar + active artifact content
        if (resolvedView?.hasTree && resolvedView?.manifestId) {
          const activeOccId = resolvedView?.activeOccurrenceId;
          const activeOcc = activeOccId ? occurrencesById?.[activeOccId] : null;
          const activeOccView = activeOcc?.viewId ? viewsById[activeOcc.viewId] : null;
          return (
            <TreePanelContent
              resolvedView={resolvedView}
              activeOcc={activeOcc}
              activeOccView={activeOccView}
              dispatch={dispatch}
              socket={socket}
            />
          );
        }

        // Artifact panel — find the active occurrence and delegate to Artifact
        if (viewType === "artifact" || viewType === "markdown" || viewType === "image" || viewType === "pdf" || viewType === "audio" || viewType === "video") {
          const activeOccId = resolvedView?.activeOccurrenceId;
          const activeOcc = activeOccId ? occurrencesById?.[activeOccId] : null;
          return (
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }}>
              <Artifact
                occurrence={activeOcc}
                viewType={viewType}
                artifactType={resolvedView?.artifactType ?? null}
                dispatch={dispatch}
                socket={socket}
              />
            </div>
          );
        }

        // Default: container list
        return (
          <div
            ref={dropRef}
            className="panel-content"
            style={{
              flex: 1, minHeight: 0,
              overflowY: layout.scrollY === "auto" ? "auto" : (layout.scrollY === "scroll" ? "scroll" : "hidden"),
              overflowX: layout.scrollX === "auto" ? "auto" : (layout.scrollX === "scroll" ? "scroll" : "hidden"),
              padding: 0,
              outline: (isOver && isContainerDrag) ? "2px solid rgba(50,150,255,0.5)" : "none",
              outlineOffset: -2, position: "relative",
            }}
          >
            {contentInner}
          </div>
        );
      })()}

      {!isFullscreen && (
        <ResizeHandle
          panel={module}
          cols={cols}
          rows={rows}
          onResize={({ width, height }) => setLiveSize({ w: width, h: height })}
          onResizeEnd={({ width, height }) => {
            setLiveSize({ w: null, h: null });
            if (width !== module.width || height !== module.height) {
              CommitHelpers.updateModule({ dispatch, socket, module: { ...module, width, height }, emit: true });
            }
          }}
        />
      )}

      <ContainerKindSelector
        open={kindSelectorOpen}
        onClose={() => setKindSelectorOpen(false)}
        onSelect={(kind) => {
          addContainerToPanel?.(module.id, kind);
          setKindSelectorOpen(false);
        }}
        position={kindSelectorPos}
      />

      <TransactionHistory
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        gridId={state.grid?._id || state.gridId}
        moduleId={module.id}
      />
    </div>
  );
}
