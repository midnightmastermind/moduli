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
  Layers,
  X,
} from "lucide-react";

import Container from "./Container.jsx";
import Page from "./Page.jsx";
import { CanvasDrawSection } from "./containerHelpers.jsx";
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
  const [treeCollapsed, setTreeCollapsed] = useState(true);
  const [scrollHighlightId, setScrollHighlightId] = useState(null);
  // Reset scroll highlight when active doc changes (user clicked a different doc)
  const activeOccId = activeOcc?.id;
  useEffect(() => { setScrollHighlightId(null); }, [activeOccId]);

  // On mount: reset to default landing page if configured
  useEffect(() => {
    if (!resolvedView?.defaultOccurrenceId || !resolvedView?.id) return;
    if (resolvedView.activeOccurrenceId === resolvedView.defaultOccurrenceId) return;
    CommitHelpers.updateView({ dispatch, socket, view: { ...resolvedView, activeOccurrenceId: resolvedView.defaultOccurrenceId, scrollAnchor: null } });
  }, []); // mount only

  return (
    <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
      {/* Sidebar overlays doc content — absolute so it doesn't push */}
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 100,
        pointerEvents: "auto",
      }}>
        <ManifestTree
          manifestId={resolvedView.manifestId}
          view={resolvedView}
          dispatch={dispatch}
          socket={socket}
          collapsed={treeCollapsed}
          onToggleCollapse={() => setTreeCollapsed(v => !v)}
          scrollHighlightId={scrollHighlightId}
        />
      </div>
      {/* Content fills full width */}
      <div style={{ width: "100%", height: "100%", overflow: "auto", display: "flex", flexDirection: "column" }}>
        <Artifact
          occurrence={activeOcc}
          viewType={activeOccView?.viewType ?? "markdown"}
          artifactType={activeOccView?.artifactType ?? null}
          dispatch={dispatch}
          socket={socket}
          view={resolvedView}
          onScrollHighlight={setScrollHighlightId}
        />
      </div>
    </div>
  );
}

// ============================================================
// CANVAS TREE PANEL — ManifestTree sidebar + CanvasDrawSection per page
// ============================================================
function CanvasTreePanelContent({ resolvedView, activeOcc, dispatch, socket, panelId }) {
  const { occurrencesById, modulesById } = useContext(GridActionsContext);
  const { state: ctxState } = useContext(GridDataContext);
  const [treeCollapsed, setTreeCollapsed] = useState(true);

  const canvasContainerId = activeOcc ? modulesById?.[activeOcc.targetId]?.id : null;
  const { ref: listDropRef } = useDroppable({
    type: "container-list",
    id: `container-list:${canvasContainerId || "canvas"}`,
    context: { panelId, containerId: canvasContainerId },
    accepts: DropAccepts.CONTAINER_LIST,
    disabled: !canvasContainerId,
  });

  const canvasModule = activeOcc ? modulesById?.[activeOcc.targetId] : null;
  const canvasItems = useMemo(() => {
    if (!activeOcc || !occurrencesById) return [];
    return (activeOcc.occurrences || []).map(occId => {
      const occ = occurrencesById[occId];
      const inst = occ ? modulesById?.[occ.targetId] : null;
      return occ && inst ? { instance: inst, occurrence: occ } : null;
    }).filter(Boolean);
  }, [activeOcc, occurrencesById, modulesById]);

  const handleDoubleClickBackground = useCallback((e) => {
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);
    const grid = ctxState?.grid;
    const userId = ctxState?.userId;
    const gridId = grid?._id;
    if (!userId || !gridId || !canvasModule) return;
    const instanceId = crypto.randomUUID();
    CommitHelpers.createInstanceInContainer({
      dispatch, socket,
      containerId: canvasModule.id,
      instance: { id: instanceId, role: "instance", kind: "list", label: "New card", userId, gridId, fieldBindings: [] },
      initialMeta: { x, y },
      emit: true,
    });
  }, [ctxState, canvasModule, dispatch, socket]);

  return (
    <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, zIndex: 100, pointerEvents: "auto" }}>
        <ManifestTree
          manifestId={resolvedView.manifestId}
          view={resolvedView}
          dispatch={dispatch}
          socket={socket}
          collapsed={treeCollapsed}
          onToggleCollapse={() => setTreeCollapsed(v => !v)}
        />
      </div>
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
        {activeOcc && canvasModule ? (
          <CanvasDrawSection
            containerOccurrence={activeOcc}
            itemsWithOccurrences={canvasItems}
            dispatch={dispatch}
            socket={socket}
            module={canvasModule}
            listDropRef={listDropRef}
            ctxState={ctxState}
            containerId={canvasModule.id}
            panelId={panelId}
            onDoubleClickBackground={handleDoubleClickBackground}
          />
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)", fontSize: 12 }}>
            Select a canvas page from the sidebar
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// PANEL COMPONENT
// ============================================================
function Panel({
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
  isForeground = false,
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [kindSelectorOpen, setKindSelectorOpen] = useState(false);
  const [kindSelectorPos, setKindSelectorPos] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [panelHeaderHovered, setPanelHeaderHovered] = useState(false);
  const [showHeader, setShowHeader] = useState(true);
  const panelDragMode = module?.defaultDragMode || "move";

  const { occurrencesById, instancesById, containersById, viewsById, modulesById, manifestsById, foldersById } = useContext(GridActionsContext);
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

  // Global folder ID for the user manifest (page library)
  const globalFolderId = useMemo(() => {
    const manifestId = state?.grid?.manifestId;
    if (!manifestId) return null;
    const manifest = manifestsById[manifestId];
    if (!manifest?.rootFolderId) return null;
    return Object.values(foldersById).find(f => f.parentId === manifest.rootFolderId && f.folderType === "global")?.id || null;
  }, [state?.grid?.manifestId, manifestsById, foldersById]);

  // Quick-add: create an occurrence of an existing page module in this panel
  const handleQuickAddPage = useCallback((pageModule) => {
    if (!panelOccurrence || !pageModule?.id) return;
    const occId = crypto.randomUUID();
    const occ = {
      id: occId,
      userId: module.userId,
      gridId: module.gridId,
      targetId: pageModule.id,
      targetType: "module",
      parentId: globalFolderId,
      iteration: { mode: "persistent" },
      fields: {},
    };
    CommitHelpers.createOccurrence({ dispatch, socket, occurrence: occ, emit: true });
    const updatedOccs = [...(panelOccurrence.occurrences || []), occId];
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: panelOccurrence.id, occurrences: updatedOccs }, emit: true });
  }, [panelOccurrence, module, globalFolderId, dispatch, socket]);

  // Quick-add: create an occurrence of an existing container module in this panel (legacy)
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

  const handleRemovePanel = useCallback(() => {
    if (!panelOccurrence?.id) return;
    CommitHelpers.removeOccurrence({ dispatch, socket, occurrenceId: panelOccurrence.id, grid: state?.grid, emit: true });
  }, [panelOccurrence, dispatch, socket, state?.grid]);

  const handlePanelContextMenu = useCallback((e) => {
    if ("ontouchstart" in window) return;
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: showHeader ? "Hide header" : "Show header", onClick: () => setShowHeader(v => !v) },
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
        { label: "Remove from grid", icon: Trash2, danger: true, onClick: handleRemovePanel },
      ].filter(Boolean),
    });
  }, [handleCopyPanel, handleCopylinkPanel, handleSplitPanel, handleUnsplitPanel, handleRemovePanel, isSplit, panelOccurrence, module.id, dispatch, socket, showHeader]);

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

  // Detect whether this panel has page children or container children (legacy)
  const { hasPages, pagesList, containersList } = useMemo(() => {
    const panelChildOccIds = panelOccurrence?.occurrences || [];
    const pages = [];
    const containers = [];
    let foundPage = false;

    for (const occId of panelChildOccIds) {
      const occ = occurrencesById[occId];
      if (!occ) continue;
      const mod = modulesById[occ.targetId];
      if (!mod) continue;
      if (mod.role === "page") {
        foundPage = true;
        pages.push({ page: mod, occurrence: occ });
      } else {
        // Legacy: direct container children
        if (!containersById[mod.id]) continue;
        const containerOcc = occ;
        if (!isOccurrenceVisible(containerOcc, panelEffectiveFilters)) continue;
        containers.push(mod);
      }
    }

    return { hasPages: foundPage, pagesList: pages, containersList: containers };
  }, [panelOccurrence, occurrencesById, modulesById, containersById, panelEffectiveFilters]);

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

  // Pages JSX (new hierarchy)
  const pagesListJSX = hasPages ? pagesList.map(({ page, occurrence: pageOcc }) => (
    <Page
      key={pageOcc.id}
      occurrence={pageOcc}
      panelId={module.id}
      panelOccurrence={panelOccurrence}
      addInstanceToContainer={addInstanceToContainer}
      dispatch={dispatch}
      socket={socket}
    />
  )) : null;

  // Containers JSX (legacy hierarchy)
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
      onContextMenu={handlePanelContextMenu}
      style={{
        gridRow: isFullscreen ? "auto" : `${module.row + 1} / span ${cellHeight}`,
        gridColumn: isFullscreen ? "auto" : `${module.col + 1} / span ${cellWidth}`,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        overflow: "visible",
        minHeight: 0,
        minWidth: 0,
        opacity: isDragging ? 0.4 : 1,
        margin: isFullscreen ? 0 : "19px 6px 6px 6px",
        zIndex: isForeground ? 70 : (isExtended ? 60 : 1),
        pointerEvents: isPanelDrag && !isDragging ? "none" : "auto",
        ...(isFullscreen && {
          position: "fixed",
          top: 16, left: 16, right: 16, bottom: 16,
          zIndex: 1000,
        }),
      }}
    >
      <ContextMenu ctx={ctxMenu} onClose={() => setCtxMenu(null)} />

      {/* Cog handle removed — header is always the access point for panel settings.
          If header is hidden, user can re-show it via context menu (right-click). */}

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
              className="module-drag-handle module-grab-zone"
              draggable={false}
            >
              <div className="drag-handle-ball" />
              <div className="drag-handle-stem" />
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
                forceDirection="down"
                onToggleHeader={() => setShowHeader(false)}
                showHeader={showHeader}
                onHistory={() => setHistoryOpen(true)}
              />
            </div>
          </PopoverAnchor>
          <PopoverContent align="start" side="right" collisionPadding={8} className="w-auto p-0 settings-sheet" style={{ position: "relative" }}>
            <button type="button" onClick={() => setSettingsOpen(false)} style={{ position: "absolute", top: 6, right: 6, zIndex: 10, background: "none", border: "none", cursor: "pointer", padding: 2, lineHeight: 0, color: "var(--text-muted)" }}><X size={14} /></button>
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
              onDeletePanel={handleRemovePanel}
            />
          </PopoverContent>
        </Popover>

        {isHeaderOver && panelLayoutOrientation === "vertical" && containersList.length > 0 && (
          <div className="drop-indicator drop-indicator-insert" />
        )}

        {/* Stack cycler — left of label */}
        {(() => {
          const stack = dragCtx.getStackForPanel?.(module) || [];
          if (stack.length <= 1) return null;
          return (
            <button
              className="panel-stack-btn-inline"
              onClick={(e) => { e.stopPropagation(); dragCtx.cyclePanelStack?.({ panelId: module.id, dir: 1 }); }}
              onPointerDown={(e) => e.stopPropagation()}
              title="Cycle panels"
              style={{ borderRadius: "4px", padding: "2px 6px", flexShrink: 0 }}
            >
              <Layers size={10} />
              <span style={{ fontSize: 9, fontWeight: 600, lineHeight: 1 }}>{stack.length}</span>
            </button>
          );
        })()}

        <span className="text-sm font-small pl-1 truncate flex-1 flex items-center gap-1" style={{ minWidth: 0 }}>
          {(hasPages && pagesList[0]?.page?.label) || layout.name || module.id}
          {panelOccurrence?.linkedGroupId && (
            <Link2 className="w-3 h-3 text-blue-400 opacity-60 flex-shrink-0" title="Linked" />
          )}
        </span>

        <div onPointerDown={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
          {hasPages ? (
            <QuickAddMenu
              targetRole="page"
              onSelect={handleQuickAddPage}
              onCreateNew={() => {
                if (!panelOccurrence?.id || !module?.userId || !module?.gridId) return;
                const modId = crypto.randomUUID();
                const occId = crypto.randomUUID();
                CommitHelpers.createPage({
                  dispatch, socket,
                  module: { id: modId, role: "page", kind: "board", label: `Page ${(panelOccurrence.occurrences || []).length + 1}` },
                  occurrence: { id: occId, gridId: module.gridId, parentId: globalFolderId },
                  panelOccurrenceId: panelOccurrence.id,
                  emit: true,
                });
              }}
              createLabel="New page"
            />
          ) : (
            <QuickAddMenu
              targetRole="container"
              onSelect={handleQuickAddContainer}
              onCreateNew={() => addContainerToPanel?.(module.id, module.kind === "canvas" ? "canvas" : "list")}
              createLabel="New container"
            />
          )}
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

      {/* Stack cycler removed from here — now in header row */}

      {/* CONTENT */}
      {(() => {
        const resolvedView = resolvedViewId ? viewsById[resolvedViewId] : null;
        const viewType = resolvedView?.viewType;

        // Canvas tree panel — ManifestTree sidebar + CanvasDrawSection per page
        if (resolvedView?.hasTree && resolvedView?.viewType === "canvas") {
          const activeOccId = resolvedView?.activeOccurrenceId;
          let activeOcc = activeOccId ? occurrencesById?.[activeOccId] : null;
          if (!activeOcc && resolvedView.manifestId) {
            const manifest = manifestsById?.[resolvedView.manifestId];
            const rootFolder = manifest?.rootFolderId ? foldersById?.[manifest.rootFolderId] : null;
            if (rootFolder) {
              const firstPage = Object.values(occurrencesById || {}).find(o => o.parentId === rootFolder.id);
              if (firstPage) {
                activeOcc = firstPage;
                CommitHelpers.updateView({ dispatch, socket, view: { ...resolvedView, activeOccurrenceId: firstPage.id } });
              }
            }
          }
          return <CanvasTreePanelContent resolvedView={resolvedView} activeOcc={activeOcc} dispatch={dispatch} socket={socket} panelId={module.id} />;
        }

        // Tree panel — ManifestTree sidebar + active artifact content
        if (resolvedView?.hasTree && resolvedView?.manifestId) {
          const activeOccId = resolvedView?.activeOccurrenceId;
          let activeOcc = activeOccId ? occurrencesById?.[activeOccId] : null;

          // Fallback: if no active doc, auto-select first doc in manifest
          if (!activeOcc && resolvedView.manifestId) {
            const manifest = manifestsById?.[resolvedView.manifestId];
            const rootFolder = manifest?.rootFolderId ? foldersById?.[manifest.rootFolderId] : null;
            if (rootFolder) {
              const firstDoc = Object.values(occurrencesById || {}).find(o => o.parentId === rootFolder.id);
              if (firstDoc) {
                activeOcc = firstDoc;
                CommitHelpers.updateView({ dispatch, socket, view: { ...resolvedView, activeOccurrenceId: firstDoc.id } });
              }
            }
          }

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

        // Default: pages (new) or container list (legacy)
        if (hasPages) {
          return (
            <div
              ref={dropRef}
              className="panel-content"
              style={{
                flex: 1, minHeight: 0,
                overflowY: "auto",
                padding: "5px",
                position: "relative",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              {pagesListJSX}
              {pagesList.length === 0 && (
                <div className="text-xs text-muted-foreground text-center empty-placeholder">
                  Drop pages here
                </div>
              )}
            </div>
          );
        }

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

      {/* Resize handle — inline in bottom bar, not overlayed */}
      {!isFullscreen && (
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
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
        </div>
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

export default React.memo(Panel);
