// modules/ModulePanel.jsx
// Extracted from Module.jsx ModulePanel component.
// Renders a panel shell with its containers.
// Handles panel-specific UI: iteration nav, fullscreen, resize, stacking, copy/split/delete.

import React, { useRef, useMemo, useState, useCallback, useEffect, useContext } from "react";
import ResizeHandle from "../ResizeHandle";
import RadialMenu from "../ui/RadialMenu";
import ContainerKindSelector from "../ui/ContainerKindSelector";
import ContextMenu from "../ui/ContextMenu";
import { buildStyleCascadeContext, resolveStyleCascade, styleToCSS } from "../helpers/StyleHelpers";

import Artifact from "./ArtifactContent";
import ManifestTree from "./ManifestTree";
import LayoutForm from "../ui/LayoutForm";
import TransactionHistory from "../ui/TransactionHistory";
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover";

import { GridActionsContext } from "../GridActionsContext";
import { GridDataContext } from "../GridDataContext";
import { GridLiveContext } from "../GridLiveContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import {
  getPanelContainers,
  getContainerItems,
  copyPanel,
  copylinkPanel,
  splitPanel,
  unsplitPanel,
  applyLocalSort,
} from "../helpers/LayoutHelpers";
import {
  useDragDrop,
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
  X,
  ChevronRight,
  Folder,
  FileText,
  Layers,
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
} from "lucide-react";

import Container from "./ModuleContainer.jsx";
import Page from "./ModulePage.jsx";
import { CanvasDrawSection } from "./CanvasContent.jsx";
import QuickAddMenu from "../ui/QuickAddMenu.jsx";
import HeaderDropdown from "../ui/HeaderDropdown";
import FiltersSection from "../ui/FiltersSection";
import AutoMarquee from "../ui/AutoMarquee.jsx";
import SortSection from "../ui/SortSection";
import FieldVisibilitySection from "../ui/FieldVisibilitySection";
import TemplatesSection from "../ui/TemplatesSection";

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
  const { isMobile } = useContext(GridLiveContext);
  // Reset scroll highlight when active doc changes (user clicked a different doc)
  const activeOccId = activeOcc?.id;
  useEffect(() => { setScrollHighlightId(null); }, [activeOccId]);

  // On mount: reset to default landing page if configured
  useEffect(() => {
    if (!resolvedView?.defaultOccurrenceId || !resolvedView?.id) return;
    if (resolvedView.activeOccurrenceId === resolvedView.defaultOccurrenceId) return;
    CommitHelpers.updateView({ dispatch, socket, view: { ...resolvedView, activeOccurrenceId: resolvedView.defaultOccurrenceId, scrollAnchor: null } });
  }, []); // mount only

  const tree = (
    <ManifestTree
      manifestId={resolvedView.manifestId}
      view={resolvedView}
      dispatch={dispatch}
      socket={socket}
      collapsed={isMobile ? false : treeCollapsed}
      onToggleCollapse={() => setTreeCollapsed(v => !v)}
      scrollHighlightId={scrollHighlightId}
    />
  );

  const content = (
    <div style={{ flex: 1, minHeight: 0, width: "100%", overflow: "auto", WebkitOverflowScrolling: "touch", display: "flex", flexDirection: "column" }}>
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
  );

  if (isMobile) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {!treeCollapsed && (
          <div style={{ maxHeight: "25vh", overflowY: "auto", WebkitOverflowScrolling: "touch", borderBottom: "1px solid var(--border-default)", flexShrink: 0 }}>
            {tree}
          </div>
        )}
        <button
          onClick={() => setTreeCollapsed(v => !v)}
          style={{
            flexShrink: 0, height: 20, width: "100%",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
            background: "var(--surface-card)", border: "none", borderBottom: "1px solid var(--border-default)",
            color: "var(--text-muted)", fontSize: 10, cursor: "pointer",
          }}
        >
          <ChevronRight size={10} style={{ transform: treeCollapsed ? "rotate(90deg)" : "rotate(-90deg)", transition: "transform 0.15s" }} />
          {treeCollapsed ? "Files" : "Hide"}
        </button>
        {content}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, zIndex: 100, pointerEvents: "auto" }}>
        {tree}
      </div>
      {content}
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

  const canvasContainerId = activeOcc ? modulesById?.[activeOcc.moduleId]?.id : null;
  const { ref: listDropRef } = useDroppable({
    type: "container-list",
    id: `container-list:${canvasContainerId || "canvas"}`,
    context: { panelId, containerId: canvasContainerId },
    accepts: DropAccepts.CONTAINER_LIST,
    disabled: !canvasContainerId,
  });

  const canvasModule = activeOcc ? modulesById?.[activeOcc.moduleId] : null;
  const canvasItems = useMemo(() => {
    if (!activeOcc || !occurrencesById) return [];
    return (activeOcc.occurrences || []).map(occId => {
      const occ = occurrencesById[occId];
      const inst = occ ? modulesById?.[occ.moduleId] : null;
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
  const [showHeader, setShowHeader] = useState(true);
  const [rootTreeOpen, setRootTreeOpen] = useState(false);
  const [localTreeOpen, setLocalTreeOpen] = useState(false);
  // Autohide reveal state — ephemeral. The persisted `autohide` flag itself
  // lives on panelOccurrence.meta.autohide and is read further down (after
  // panelOccurrence is resolved).
  const [headerRevealed, setHeaderRevealed] = useState(false);
  const [pendingDrilldown, setPendingDrilldown] = useState(null);
  const [dropdownAnchor, setDropdownAnchor] = useState(null);
  const openDropdown = useCallback((e) => setDropdownAnchor(e.currentTarget.getBoundingClientRect()), []);
  const closeDropdown = useCallback(() => setDropdownAnchor(null), []);
  const [templatesAnchor, setTemplatesAnchor] = useState(null);
  const openTemplates = useCallback((e) => setTemplatesAnchor(e?.currentTarget?.getBoundingClientRect?.() || null), []);
  const closeTemplates = useCallback(() => setTemplatesAnchor(null), []);
  // Navigation breadcrumb history — array of occIds in visit order
  const prevActiveOccRef = useRef(null);
  const panelDragMode = module?.defaultDragMode || "move";

  const { occurrencesById, instancesById, leafModulesById, containersById, viewsById, modulesById, manifestsById, foldersById } = useContext(GridActionsContext);
  const { state } = useContext(GridDataContext);
  const { isMobile } = useContext(GridLiveContext);
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
    return Object.values(occurrencesById).find(occ => occ.moduleId === module.id);
  }, [occurrencesById, module.id]);

  // Panel cascade — Grid → Panel chain. Reads pass-down style from
  // grid.meta.defaultStyle, then panel.ownStyle if module.styleMode === "own".
  // Spread onto the panel-shell inline style so the user's choices in
  // LayoutForm's "Panel Style" editor actually take effect at render time.
  const panelCascade = useMemo(
    () => resolveStyleCascade({ grid: state?.grid, panel: module, panelOcc: panelOccurrence }, "panel"),
    [state?.grid, module, panelOccurrence]
  );
  const panelCascadeCss = useMemo(
    () => (panelCascade?.resolved ? styleToCSS(panelCascade.resolved) : null),
    [panelCascade]
  );

  const commitOccurrenceUpdate = useCallback((updates) => {
    if (!panelOccurrence?.id) return;
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: panelOccurrence.id, ...updates }, emit: true });
  }, [panelOccurrence, dispatch, socket]);

  // Autohide setting — persisted on panelOccurrence.meta.autohide so it can
  // be seeded by createLiveData. Collapses pageHeader + breadcrumbBar; the
  // hover strip at the top of the panel reveals them.
  const autohide = !!panelOccurrence?.meta?.autohide;
  const toggleAutohide = useCallback(() => {
    if (!panelOccurrence?.id) return;
    const nextMeta = { ...(panelOccurrence.meta || {}), autohide: !autohide };
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: panelOccurrence.id, meta: nextMeta },
      emit: true,
    });
  }, [panelOccurrence, autohide, dispatch, socket]);

  // View: check occurrence.viewId first (new system), fall back to module.viewId (legacy)
  const resolvedViewId = panelOccurrence?.viewId || module.viewId;
  const currentView = resolvedViewId ? viewsById[resolvedViewId] : null;
  const currentViewType = currentView?.viewType || "board";

  // Global folder ID for the user manifest (page library)
  const globalFolderId = useMemo(() => {
    const manifestId = state?.grid?.manifestId;
    if (!manifestId) return null;
    const manifest = manifestsById[manifestId];
    if (!manifest?.rootFolderId) return null;
    return manifest?.rootFolderId || null;
  }, [state?.grid?.manifestId, manifestsById, foldersById]);

  // Quick-add: create an occurrence of an existing page module in this panel
  const handleQuickAddPage = useCallback((pageModule) => {
    if (!panelOccurrence || !pageModule?.id) return;
    const occId = crypto.randomUUID();
    const occ = {
      id: occId,
      userId: module.userId,
      gridId: module.gridId,
      moduleId: pageModule.id,
      parentId: globalFolderId,
      iteration: { mode: "persistent" },
      fields: {},
    };
    CommitHelpers.createOccurrence({ dispatch, socket, occurrence: occ, emit: true });
    const updatedOccs = [...(panelOccurrence.occurrences || []), occId];
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: panelOccurrence.id, occurrences: updatedOccs }, emit: true });
  }, [panelOccurrence, module, globalFolderId, dispatch, socket]);

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
    return Object.values(occurrencesById).find(occ => occ.moduleId === splitPartnerPanel.id)?.id || null;
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


  // DRAG
  const isChildDrag = isContainerDrag || isInstanceDrag || isExternalDrag;

  const panelWithChildren = useMemo(() => {
    const containers = getPanelContainers(module, occurrencesById, containersById, panelOccurrence);
    const containerObjects = containers.map(container => ({
      ...container,
      instanceObjects: getContainerItems(container, occurrencesById, leafModulesById),
    }));
    return { ...module, containerObjects };
  }, [module, occurrencesById, containersById, leafModulesById, panelOccurrence]);

  const panelHandleRef = useRef(null);

  const { ref: dragRef, isDragging } = useDragDrop({
    type: DragType.PANEL,
    id: module.id,
    data: panelWithChildren,
    context: { panelId: module.id, cellId: `cell-${module.row}-${module.col}` },
    disabled: hidden || isChildDrag,
    dragHandleRef: panelHandleRef,
  });

  // Drop zone for incoming page drags — pages are children of panels
  // (panel.occurrences[] holds page occurrence ids), so a panel-level drop
  // target lets the user move a page tab from one panel into another.
  const { ref: pageDropRef } = useDroppable({
    type: "panel-pages",
    id: `panel-pages:${module.id}`,
    context: { panelId: module.id, panelOccurrenceId: panelOccurrence?.id || null },
    accepts: [DragType.PAGE],
    disabled: hidden,
  });


  // Build page list from panel children (all children are pages).
  // Honors the panel occurrence's local sort (meta.localSort) — when set,
  // pages are auto-sorted by label or by a field value; otherwise drop
  // order (the existing occurrences[] array) is preserved.
  const pagesList = useMemo(() => {
    const panelChildOccIds = panelOccurrence?.occurrences || [];
    const pages = [];
    for (const occId of panelChildOccIds) {
      const occ = occurrencesById[occId];
      if (!occ) continue;
      const mod = modulesById[occ.moduleId];
      if (!mod) continue;
      if (mod.role === "page") {
        pages.push({ page: mod, occurrence: occ, instance: mod });
      }
    }
    const sorted = applyLocalSort(pages, panelOccurrence?.meta?.localSort, modulesById);
    return sorted.map(({ page, occurrence }) => ({ page, occurrence }));
  }, [panelOccurrence, occurrencesById, modulesById]);

  // Auto-create panel View if it doesn't have one yet
  useEffect(() => {
    if (pagesList.length === 0 || resolvedViewId) return;
    if (!panelOccurrence?.id || !module?.userId || !module?.gridId) return;
    const viewId = crypto.randomUUID();
    CommitHelpers.createView({ dispatch, socket, view: { id: viewId, userId: module.userId, gridId: module.gridId, viewType: "board", activeOccurrenceId: null } });
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: panelOccurrence.id, viewId }, emit: true });
  }, [pagesList.length, resolvedViewId, panelOccurrence?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select first page if view has no active page yet
  useEffect(() => {
    if (pagesList.length === 0 || !currentView?.id || currentView.activeOccurrenceId) return;
    CommitHelpers.updateView({ dispatch, socket, view: { ...currentView, activeOccurrenceId: pagesList[0].occurrence.id }, emit: true });
  }, [pagesList, currentView?.id, currentView?.activeOccurrenceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track active occurrence for ref (used by other effects)
  useEffect(() => {
    const newId = currentView?.activeOccurrenceId;
    if (!newId) return;
    prevActiveOccRef.current = newId;
  }, [currentView?.activeOccurrenceId]);

  const openPage = useCallback((occId, options = {}) => {
    if (!occId || !panelOccurrence?.id) return;
    const { drilldownTarget } = options;
    if (drilldownTarget) {
      setPendingDrilldown(drilldownTarget);
      // Pre-pin the drilldown target so it's in pagesList when handleNavigate switches to it
      if (!(panelOccurrence.occurrences || []).includes(drilldownTarget)) {
        CommitHelpers.pinPageToPanel({ dispatch, socket, pageOccurrenceId: drilldownTarget, panelOccurrenceId: panelOccurrence.id });
      }
    }
    if (!(panelOccurrence.occurrences || []).includes(occId)) {
      CommitHelpers.pinPageToPanel({ dispatch, socket, pageOccurrenceId: occId, panelOccurrenceId: panelOccurrence.id });
    }
    if (currentView?.id) {
      CommitHelpers.updateView({ dispatch, socket, view: { ...currentView, activeOccurrenceId: occId }, emit: true });
    }
  }, [panelOccurrence, currentView, dispatch, socket]);

  // Sidebar-aware page open: anything that opens a page from the Local/Root
  // tree should also collapse the sidebar (user requested: selecting closes it).
  const openPageAndCloseTrees = useCallback((occId, options) => {
    openPage(occId, options);
    setLocalTreeOpen(false);
    setRootTreeOpen(false);
  }, [openPage]);

  // Breadcrumb click — opens a folder as a page. Crumb.id is a folder.id
  // (from `pageBreadcrumbs`'s parentId-walk through `foldersById`). Mirrors
  // ManifestTree's openFolderAsPage: find an existing folder-page occurrence
  // under this folder, otherwise mint module + occurrence and navigate to it.
  const openFolderCrumb = useCallback((folderId) => {
    if (!folderId) return;
    const existingFolderPage = Object.values(occurrencesById || {}).find(occ => {
      if (occ.parentId !== folderId) return false;
      const mod = modulesById?.[occ.moduleId];
      return mod?.kind === "folder" && mod?.role === "page";
    });
    if (existingFolderPage) {
      openPage(existingFolderPage.id);
      return;
    }
    const userId = state?.userId;
    const gridId = state?.grid?._id || state?.gridId;
    const folder = foldersById?.[folderId];
    if (!dispatch || !socket || !userId || !gridId || !folder) return;
    const modId = crypto.randomUUID();
    const occId = crypto.randomUUID();
    CommitHelpers.createModule({ dispatch, socket, module: { id: modId, userId, gridId, role: "page", kind: "folder", label: folder.name }, emit: true });
    CommitHelpers.createOccurrence({ dispatch, socket, occurrence: { id: occId, userId, gridId, moduleId: modId, targetId: modId, targetType: "module", parentId: folderId, sortOrder: -1, iteration: { mode: "persistent" }, fields: {}, meta: {} }, emit: true });
    openPage(occId);
  }, [openPage, occurrencesById, modulesById, foldersById, dispatch, socket, state]);

  const closePage = useCallback((occId) => {
    if (!occId || !panelOccurrence?.id) return;
    CommitHelpers.unpinPageFromPanel({ dispatch, socket, pageOccurrenceId: occId, panelOccurrenceId: panelOccurrence.id });
    if (currentView?.id && currentView.activeOccurrenceId === occId) {
      const remaining = (panelOccurrence.occurrences || []).filter(id => id !== occId);
      CommitHelpers.updateView({ dispatch, socket, view: { ...currentView, activeOccurrenceId: remaining[0] ?? null } });
    }
  }, [panelOccurrence, currentView, dispatch, socket]);

  if (hidden && !forceFullscreen) return null;

  const cellWidth = liveSize.w !== null ? liveSize.w : (module.width || 1);
  const cellHeight = liveSize.h !== null ? liveSize.h : (module.height || 1);
  const isExtended = cellWidth > 1 || cellHeight > 1;
  const isPanelDrag = dragCtx.isPanelDrag;

  const panelChildOccIds = panelOccurrence?.occurrences || [];

  // Active page entry — check pagesList first, then fall back to direct lookup
  // (folder drilldown navigates to child pages not in panelOccurrence.occurrences)
  const activePageEntry = (() => {
    const activeId = currentView?.activeOccurrenceId;
    const fromList = activeId ? pagesList.find(p => p.occurrence.id === activeId) : null;
    if (fromList) return fromList;
    if (activeId) {
      const occ = occurrencesById[activeId];
      const mod = occ ? modulesById[occ.moduleId] : null;
      if (occ && mod && mod.role === "page") return { occurrence: occ, page: mod };
    }
    return pagesList[0] || null;
  })();

  // B3: Compute folder-path breadcrumbs for the active page (walks up parentId → foldersById)
  const pageBreadcrumbs = useMemo(() => {
    if (!activePageEntry) return [];
    const crumbs = [];
    // Walk up through folders (skip root — it has no parentId)
    let folderId = activePageEntry.occurrence?.parentId;
    let safety = 0;
    while (folderId && safety < 8) {
      const folder = foldersById?.[folderId];
      if (!folder || !folder.parentId) break; // root folder has no parentId
      crumbs.unshift({ id: folder.id, label: folder.name, isFolder: true });
      folderId = folder.parentId;
      safety++;
    }
    // Page itself at end
    crumbs.push({ id: activePageEntry.occurrence.id, label: activePageEntry.page?.label || "Page", isPage: true });
    return crumbs;
  }, [activePageEntry, foldersById]);

  return (
    <div
      ref={(node) => {
        if (typeof dragRef === "function") dragRef(node); else if (dragRef) dragRef.current = node;
        if (typeof pageDropRef === "function") pageDropRef(node); else if (pageDropRef) pageDropRef.current = node;
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
        margin: isFullscreen ? 0 : (isMobile ? "0px 2px 2px 2px" : "3px 6px 6px 6px"),
        zIndex: isForeground ? 70 : (isExtended ? 60 : 1),
        pointerEvents: isPanelDrag && !isDragging ? "none" : "auto",
        ...(isFullscreen && {
          position: "fixed",
          top: 16, left: 16, right: 16, bottom: 16,
          zIndex: 1000,
        }),
        // Cascade-resolved panel style (Grid → Panel ownStyle). Spread
        // LAST so any key the user explicitly set in LayoutForm's
        // "Panel Style" editor wins over the static defaults above
        // (background, border color, fonts, padding, opacity). Only
        // keys with non-null values are emitted by styleToCSS, so the
        // baseline shell chrome stays intact for keys left at default.
        ...(panelCascadeCss || {}),
      }}
    >
      <ContextMenu ctx={ctxMenu} onClose={() => setCtxMenu(null)} />

      {/* CONTENT */}
      {(() => {
        const resolvedView = resolvedViewId ? viewsById[resolvedViewId] : null;
        const viewType = resolvedView?.viewType;

        // Page panel — dual sidebar (root tree left, panel-local right)
        if (pagesList.length > 0) {
          const activePageView = activePageEntry?.occurrence?.viewId ? viewsById[activePageEntry.occurrence.viewId] : null;

          // Root tree sidebar (left) — user manifest, global page library
          const rootTree = (
            <ManifestTree
              manifestId={state?.grid?.manifestId}
              view={resolvedView}
              dispatch={dispatch}
              socket={socket}
              collapsed={false}
              onToggleCollapse={() => setRootTreeOpen(false)}
              onOpenPage={openPageAndCloseTrees}
              activePageView={activePageView}
            />
          );

          // Local tree sidebar (right) — page panel mode, shows pages + anchors
          const localTree = (
            <ManifestTree
              manifestId={state?.grid?.manifestId}
              view={resolvedView}
              dispatch={dispatch}
              socket={socket}
              collapsed={false}
              onToggleCollapse={() => setLocalTreeOpen(false)}
              panelOccurrence={panelOccurrence}
              onOpenPage={openPageAndCloseTrees}
              onClosePage={closePage}
            />
          );

          // Page panel header — drag handle on LEFT, then page name, then QuickAdd + filters
          const activePageLabel = activePageEntry?.page?.label || "Untitled";
          const pageHeader = (
            <div className="page-header" style={{
              display: "flex", alignItems: "center",
              flexShrink: 0, padding: "2px 6px 2px 10px", gap: 6,
            }}>
              {/* Panel drag handle — leftmost */}
              <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
                <PopoverAnchor asChild>
                  <div
                    ref={panelHandleRef}
                    className="module-drag-handle module-grab-zone"
                    data-dnd-handle="true"
                    style={{ position: "relative", top: 0, left: -6, transform: "none", flexShrink: 0 }}
                  >
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
                      onTemplate={openTemplates}
                      onDelete={handleRemovePanel}
                      extraItems={[{
                        icon: autohide ? Eye : EyeOff,
                        label: autohide ? "Disable autohide" : "Autohide header",
                        onClick: () => { toggleAutohide(); setHeaderRevealed(false); },
                      }]}
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

              {/* Active page name — flex-grows to fill space between handle and actions */}
              <span style={{
                flex: 1, minWidth: 0,
                fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)",
                letterSpacing: "0.03em", overflow: "hidden",
                userSelect: "none",
              }}>
                <AutoMarquee>{activePageLabel}</AutoMarquee>
              </span>

              {/* QuickAdd + header dropdown + grid cell switcher.
                  HeaderChevron intentionally suppressed on panels — panel-level
                  filter UI is hidden so users configure filters on pages /
                  containers / instances only. The underlying filterOverride
                  cascade still flows through panels unchanged (a panel with
                  filterOverride:null is invisible to descendants' walk via
                  getEffectiveFilterForOccurrence), and a panel's deactivated
                  filters[].active:false entries are skipped by
                  getLocalFilterConditions and don't cascade — descendants can
                  still inherit grid + higher-ancestor filters past a panel
                  with all its local filters off ("skip generations"). */}
              <div onPointerDown={(e) => e.stopPropagation()} style={{ display: "flex", flexShrink: 0, gap: 5, alignItems: "center" }}>
                <QuickAddMenu
                  targetRole="page"
                  onSelect={handleQuickAddPage}
                  onCreateNew={() => {
                    if (!panelOccurrence?.id || !module?.userId || !module?.gridId) return;
                    const modId = crypto.randomUUID();
                    const occId = crypto.randomUUID();
                    CommitHelpers.createPage({
                      dispatch, socket,
                      module: { id: modId, userId: module.userId, gridId: module.gridId, role: "page", kind: "board", label: `Page ${(panelOccurrence.occurrences || []).length + 1}` },
                      occurrence: { id: occId, userId: module.userId, gridId: module.gridId, moduleId: modId, parentId: globalFolderId, iteration: { mode: "persistent" }, fields: {} },
                      panelOccurrenceId: panelOccurrence.id,
                      ...(!resolvedViewId && {
                        panelViewData: { id: crypto.randomUUID(), userId: module.userId, gridId: module.gridId, viewType: "board", activeOccurrenceId: occId },
                      }),
                      emit: true,
                    });
                  }}
                  createLabel="New page"
                  hostOccurrence={panelOccurrence}
                />
                {(() => {
                  const stack = dragCtx.getStackForPanel?.(module) || [];
                  if (stack.length <= 1) return null;
                  return (
                    <button
                      className="panel-stack-btn-inline"
                      onClick={(e) => { e.stopPropagation(); dragCtx.cyclePanelStack?.({ panelId: module.id, dir: 1 }); }}
                      title="Cycle panels in this cell"
                    >
                      <Layers size={9} />
                      <span style={{ fontSize: 9, fontWeight: 600 }}>{stack.length}</span>
                    </button>
                  );
                })()}
                {/* Fullscreen toggle — toggles the Grid-level
                    fullscreenPanelId to/from this panel's id. The
                    isFullscreen render path (line ~505 + ~704-716) was
                    always plumbed; only the chrome was missing. */}
                {setFullscreenPanelId && (
                  <button
                    className="panel-stack-btn-inline"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFullscreenPanelId(isFullscreen ? null : module.id);
                    }}
                    title={isFullscreen ? "Exit fullscreen" : "Fullscreen this panel"}
                    aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen this panel"}
                  >
                    {isFullscreen ? <Minimize2 size={10} /> : <Maximize2 size={10} />}
                  </button>
                )}
              </div>
            </div>
          );

          // sidebarToggleBar removed — Root/Local buttons moved into pageHeader row.

          const pageContent = (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              {activePageEntry ? (
                <Page
                  key={activePageEntry.occurrence.id}
                  occurrence={activePageEntry.occurrence}
                  panelId={module.id}
                  panelOccurrence={panelOccurrence}
                  panelView={resolvedView}
                  addInstanceToContainer={addInstanceToContainer}
                  dispatch={dispatch}
                  socket={socket}
                  drilldownTarget={pendingDrilldown}
                  onDrilldownComplete={() => setPendingDrilldown(null)}
                />
              ) : (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)", fontSize: 12, height: "100%" }}>
                  Select or create a page
                </div>
              )}
            </div>
          );

          // Nav bar — Root toggle (left) | breadcrumb trail (middle, when applicable) | Local toggle (right).
          // Always visible for page panels.
          const activeFolderKind = activePageEntry?.page?.kind === "folder";
          const breadcrumbBar = (
            <div style={{
              display: "flex", alignItems: "center",
              flexShrink: 0, padding: "2px 4px",
              borderBottom: "1px solid var(--border-default)",
              background: "var(--surface-base)",
              gap: 2,
            }}>
              {/* Local tree toggle — left */}
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => { setLocalTreeOpen(v => !v); setRootTreeOpen(false); }}
                onDragEnter={(e) => { e.preventDefault(); setLocalTreeOpen(true); setRootTreeOpen(false); }}
                onDragOver={(e) => e.preventDefault()}
                style={{
                  display: "flex", alignItems: "center", gap: 3, flexShrink: 0,
                  padding: "2px 7px", border: "none", borderRadius: 4, cursor: "pointer",
                  background: localTreeOpen ? "rgba(6,182,212,0.12)" : "transparent",
                  color: localTreeOpen ? "#06b6d4" : "var(--text-muted)",
                  fontSize: 10, fontFamily: "var(--font-mono)",
                }}
              >
                <FileText size={10} style={{ opacity: 0.7 }} />
                Local
              </button>

              {/* Breadcrumb trail — middle, folder-path derived */}
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 3, overflow: "hidden", minWidth: 0 }}>
                {!activeFolderKind && pageBreadcrumbs.length > 1 && pageBreadcrumbs.map((crumb, i) => {
                  const isLast = i === pageBreadcrumbs.length - 1;
                  const clickable = !isLast && crumb.isFolder;
                  return (
                    <React.Fragment key={crumb.id}>
                      {i > 0 && <span style={{ color: "var(--text-faint)", fontSize: 9, flexShrink: 0 }}>›</span>}
                      <span
                        onClick={clickable ? (e) => { e.stopPropagation(); openFolderCrumb(crumb.id); } : undefined}
                        onPointerDown={clickable ? (e) => e.stopPropagation() : undefined}
                        style={{
                          fontSize: 10, fontFamily: "var(--font-mono)",
                          color: isLast ? "var(--text-primary)" : "var(--text-muted)",
                          cursor: clickable ? "pointer" : "default",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 80,
                          flexShrink: crumb.isPage ? 0 : 1,
                        }}
                        title={clickable ? `Open ${crumb.label}` : crumb.label}
                      >
                        {crumb.label}
                      </span>
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Root tree toggle — right */}
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => { setRootTreeOpen(v => !v); setLocalTreeOpen(false); }}
                onDragEnter={(e) => { e.preventDefault(); setRootTreeOpen(true); setLocalTreeOpen(false); }}
                onDragOver={(e) => e.preventDefault()}
                style={{
                  display: "flex", alignItems: "center", gap: 3, flexShrink: 0,
                  padding: "2px 7px", border: "none", borderRadius: 4, cursor: "pointer",
                  background: rootTreeOpen ? "rgba(100,180,255,0.12)" : "transparent",
                  color: rootTreeOpen ? "rgba(100,180,255,1)" : "var(--text-muted)",
                  fontSize: 10, fontFamily: "var(--font-mono)",
                }}
              >
                <Folder size={10} style={{ opacity: 0.7 }} />
                Root
              </button>
            </div>
          );

          // Autohide: header + breadcrumb collapse and a thin top hover strip
          // reveals them. When revealed they stay in normal flow and push the
          // page content down (not overlaid). When NOT autohiding, render inline.
          const headersVisible = !autohide || headerRevealed;
          const headerCluster = (
            <div
              onMouseEnter={() => autohide && setHeaderRevealed(true)}
              onMouseLeave={() => autohide && setHeaderRevealed(false)}
              style={{ flexShrink: 0 }}
            >
              {pageHeader}
              {breadcrumbBar}
            </div>
          );

          return (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
              {/* Top hover strip — only present when autohide is on. Reveals the
                  header cluster on hover. Tall enough to be hittable. */}
              {autohide && !headerRevealed && (
                <div
                  onMouseEnter={() => setHeaderRevealed(true)}
                  style={{ position: "absolute", top: 0, left: 0, right: 0, height: 8, zIndex: 40, cursor: "pointer" }}
                />
              )}
              {headersVisible && headerCluster}
              {/* On desktop: sidebars push content (flex row). On mobile: sidebars overlay (absolute). */}
              <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", position: "relative" }}>
                {/* Local tree sidebar — LEFT, pushes content on desktop, overlays on mobile */}
                {localTreeOpen && (
                  isMobile ? (
                    <div style={{
                      position: "absolute", top: 0, left: 0, bottom: 0, zIndex: 100,
                      width: "100%", maxHeight: "50%",
                      display: "flex", flexDirection: "column",
                      background: "var(--surface-card)",
                      borderBottom: "1px solid var(--border-default)",
                      pointerEvents: "auto",
                    }}>
                      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "4px 2px" }}>
                        {localTree}
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      flexShrink: 0, width: 222,
                      display: "flex", flexDirection: "column",
                      background: "var(--surface-card)",
                      borderRight: "1px solid var(--border-default)",
                      overflow: "hidden",
                    }}>
                      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "4px 2px" }}>
                        {localTree}
                      </div>
                    </div>
                  )
                )}
                {/* Page content — flex-grows between sidebars */}
                <div style={{ flex: 1, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                  {pageContent}
                </div>
                {/* Root tree sidebar — RIGHT, pushes content on desktop, overlays on mobile */}
                {rootTreeOpen && (
                  isMobile ? (
                    <div style={{
                      position: "absolute", top: 0, right: 0, bottom: 0, zIndex: 100,
                      width: "100%", maxHeight: "50%",
                      display: "flex", flexDirection: "column",
                      background: "var(--surface-card)",
                      borderBottom: "1px solid var(--border-default)",
                      pointerEvents: "auto",
                    }}>
                      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "4px 2px" }}>
                        {rootTree}
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      flexShrink: 0, width: 222,
                      display: "flex", flexDirection: "column",
                      background: "var(--surface-card)",
                      borderLeft: "1px solid var(--border-default)",
                      overflow: "hidden",
                    }}>
                      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "4px 2px" }}>
                        {rootTree}
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          );
        }

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

        // Display panel — find the active occurrence and delegate to Artifact
        if (viewType === "display" || viewType === "markdown" || viewType === "image" || viewType === "pdf" || viewType === "audio" || viewType === "video") {
          const activeOccId = resolvedView?.activeOccurrenceId;
          const activeOcc = activeOccId ? occurrencesById?.[activeOccId] : null;
          const activeOccView = activeOcc?.viewId ? viewsById?.[activeOcc.viewId] : null;
          const effectiveViewType = activeOccView?.viewType ?? viewType;
          const effectiveArtifactType = activeOccView?.artifactType ?? resolvedView?.artifactType ?? null;
          return (
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }}>
              <Artifact
                occurrence={activeOcc}
                viewType={effectiveViewType}
                artifactType={effectiveArtifactType}
                dispatch={dispatch}
                socket={socket}
              />
            </div>
          );
        }

        // Fallback — empty panel
        return (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)", fontSize: 12 }}>
            No content
          </div>
        );
      })()}

      {/* Resize handle — inline in bottom bar, not overlayed */}
      {!isFullscreen && (
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, position: "absolute", bottom: 0, right: 0}}>
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

      {dropdownAnchor && (
        <HeaderDropdown anchorRect={dropdownAnchor} onClose={closeDropdown}>
          <FiltersSection occurrence={panelOccurrence} />
          <SortSection occurrence={panelOccurrence} />
          <FieldVisibilitySection occurrence={panelOccurrence} />
        </HeaderDropdown>
      )}
      {templatesAnchor && (
        <HeaderDropdown anchorRect={templatesAnchor} onClose={closeTemplates}>
          <TemplatesSection occurrence={panelOccurrence} />
        </HeaderDropdown>
      )}
    </div>
  );
}

export default React.memo(Panel);
