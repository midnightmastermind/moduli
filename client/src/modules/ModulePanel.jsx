// modules/ModulePanel.jsx
// Extracted from Module.jsx ModulePanel component.
// Renders a panel shell with its containers.
// Handles panel-specific UI: iteration nav, fullscreen, resize, stacking, copy/split/delete.

import React, { useRef, useMemo, useState, useCallback, useEffect, useLayoutEffect, useContext } from "react";
import ResizeHandle from "../ResizeHandle";
import RadialMenu from "../ui/RadialMenu";
import ContainerKindSelector from "../ui/ContainerKindSelector";
import ContextMenu from "../ui/ContextMenu";
import { useLongPress } from "../hooks/useLongPress";
import { resolveStyleCascade, styleToCSS } from "../helpers/StyleHelpers";
import { bumpRender } from "../helpers/renderProbe";
import { markLoadOnce, markLoad } from "../helpers/loadDiag";
import { useStagedContent } from "../hooks/useStagedContent";
import { useActiveCell } from "../state/activeCellStore";
import { Spinner } from "@/components/ui/spinner";

import Artifact from "./ArtifactContent";
import ManifestTree from "./ManifestTree";
import LayoutForm from "../ui/LayoutForm";
import TransactionHistory from "../ui/TransactionHistory";
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover";

import { useGridActionsSelector } from "../GridActionsContext";
import { GridDataContext } from "../GridDataContext";
import { GridLiveContext } from "../GridLiveContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { flashPanelAlreadyOpen } from "../helpers/alreadyOpenFlash";
import { setCurrentLocation } from "../helpers/currentLocation";
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
  useDragStateContext,
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
  Layers,
  Maximize2,
  Minimize2,
  Plus,
  PlusSquare,
} from "lucide-react";
import QuickAddMenu from "../ui/QuickAddMenu.jsx";

import Page from "./ModulePage.jsx";
import { CanvasDrawSection } from "./CanvasContent.jsx";
import HeaderDropdown from "../ui/HeaderDropdown";
import FiltersSection from "../ui/FiltersSection";
import MenuTabs from "../ui/MenuTabs";
import AutoMarquee from "../ui/AutoMarquee.jsx";
import OccurrenceSearch from "../ui/OccurrenceSearch.jsx";
import { openOccurrenceInPanel } from "../helpers/openOccurrenceInPanel";
import { toast } from "../state/notificationStore";
import SortSection from "../ui/SortSection";
import FieldVisibilitySection from "../ui/FieldVisibilitySection";
import LayoutCascadeSection from "../ui/LayoutCascadeSection";
import TemplatesSection from "../ui/TemplatesSection";
import { openPanelOnRootFolderPage } from "../helpers/importsFolder";
import { useMinWidth } from "../hooks/useMinWidth";
import { ROOT_TREE_W, ROOT_TREE_PUSH_MIN_W } from "../helpers/rootTreeLayout";

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
  const { isMobileLayout } = useContext(GridLiveContext);
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
      collapsed={isMobileLayout ? false : treeCollapsed}
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

  if (isMobileLayout) {
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
            color: "var(--text-muted)", fontSize: 12, cursor: "pointer",
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
  const occurrencesById = useGridActionsSelector(s => s.occurrencesById);
  const modulesById = useGridActionsSelector(s => s.modulesById);
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
      instance: { id: instanceId, role: "instance", kind: "board", label: "New card", userId, gridId, fieldBindings: [] },
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
  mosaic = false,
}) {
  bumpRender("panel");
  // Load-path split (helpers/loadDiag.js): first commit of THIS panel — its
  // chrome and its content mount together today, which is exactly what the
  // staged-loading plan proposes to separate. Keyed by module id so a panel
  // counts once no matter how many times it re-renders during the op drain.
  useLayoutEffect(() => { markLoadOnce(`panel:${module?.id}`, "panel:commit", { id: module?.id }); });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [kindSelectorOpen, setKindSelectorOpen] = useState(false);
  const [kindSelectorPos, setKindSelectorPos] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [showHeader, setShowHeader] = useState(true);
  const [rootTreeOpen, setRootTreeOpen] = useState(false);
  const [pendingDrilldown, setPendingDrilldown] = useState(null);
  // Stable ref — an inline closure here defeated <Page>'s React.memo on EVERY
  // panel render, cascading a full page/container/instance re-render per write.
  const handleDrilldownComplete = useCallback(() => setPendingDrilldown(null), []);
  const [dropdownAnchor, setDropdownAnchor] = useState(null);
  const openDropdown = useCallback((e) => setDropdownAnchor(e.currentTarget.getBoundingClientRect()), []);
  const closeDropdown = useCallback(() => setDropdownAnchor(null), []);
  const [templatesAnchor, setTemplatesAnchor] = useState(null);
  const openTemplates = useCallback((e) => setTemplatesAnchor(e?.currentTarget?.getBoundingClientRect?.() || null), []);
  const closeTemplates = useCallback(() => setTemplatesAnchor(null), []);
  // Navigation breadcrumb history — array of occIds in visit order
  const prevActiveOccRef = useRef(null);
  const panelDragMode = module?.defaultDragMode || "move";

  const occurrencesById = useGridActionsSelector(s => s.occurrencesById);
  const instancesById = useGridActionsSelector(s => s.instancesById);
  const leafModulesById = useGridActionsSelector(s => s.leafModulesById);
  const containersById = useGridActionsSelector(s => s.containersById);
  const viewsById = useGridActionsSelector(s => s.viewsById);
  const addNewPanel = useGridActionsSelector(s => s.addNewPanel);
  const modulesById = useGridActionsSelector(s => s.modulesById);
  const manifestsById = useGridActionsSelector(s => s.manifestsById);
  const foldersById = useGridActionsSelector(s => s.foldersById);
  const { state } = useContext(GridDataContext);
  const { isMobileLayout, isTouch } = useContext(GridLiveContext);
  const rootTreeCanPush = useMinWidth(ROOT_TREE_PUSH_MIN_W);

  // ── Staged content (docs/superpowers/plans/2026-08-06-staged-loading.md) ──
  // The panel's CHROME renders immediately; its CONTENT waits for a frame so the
  // shape can paint first. Order is nearest-first: on mobile that means the cell
  // you are actually looking at (MobileGridNav already knows which one), on
  // desktop it is reading order, which is the closest thing to "nearest the
  // viewport" a grid layout gives us.
  const stagingCell = useActiveCell();
  const stagePriority = isMobileLayout
    ? Math.abs((module?.row ?? 0) - (stagingCell?.row ?? 0)) * 100
      + Math.abs((module?.col ?? 0) - (stagingCell?.col ?? 0))
    : (module?.row ?? 0) * 100 + (module?.col ?? 0);
  const contentReady = useStagedContent(`panel:${module?.id}`, stagePriority);
  useEffect(() => { if (contentReady) markLoad("panel:content-ready", { id: module?.id }); }, [contentReady, module?.id]);
  // Stable handler context (stack helpers) + the small reactive drag-state
  // context. Panels are few (~dozens), so a reactive subscription here is the
  // sanctioned pattern (see dragSystem.js DragStateContext).
  const dragCtx = useDragContext();
  const {
    isContainerDrag,
    isInstanceDrag,
    isExternalDrag,
    isPanelDrag,
  } = useDragStateContext();
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

  // View: check occurrence.viewId first (new system), fall back to module.viewId (legacy)
  const resolvedViewId = panelOccurrence?.viewId || module.viewId;
  const currentView = resolvedViewId ? viewsById[resolvedViewId] : null;
  const currentViewType = currentView?.viewType || "board";

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

  // "Add page…" from the panel right-click menu (2026-07-12): the header lost
  // its + QuickAddMenu in the 2026-07-03 redesign (page creation lives in the
  // trees), so a ZERO-SIZE QuickAddMenu is mounted next to the ContextMenu and
  // opened imperatively via this trigger. Picking an existing page pins it to
  // this panel + activates it; the create tiles mint a fresh page here.
  const [panelQuickAddTrigger, setPanelQuickAddTrigger] = useState(0);
  const handlePanelPickPage = useCallback((pageModule) => {
    if (!pageModule?.id || !panelOccurrence?.id) return;
    const pageOcc = Object.values(occurrencesById).find(o => o.moduleId === pageModule.id);
    if (!pageOcc) return;
    CommitHelpers.pinPageToPanel({ dispatch, socket, pageOccurrenceId: pageOcc.id, panelOccurrenceId: panelOccurrence.id });
    if (currentView) {
      CommitHelpers.updateView({ dispatch, socket, view: { ...currentView, activeOccurrenceId: pageOcc.id }, emit: true });
    }
  }, [panelOccurrence?.id, occurrencesById, currentView, dispatch, socket]);
  // Returns the new page's occurrence id (or null) — needed by the
  // create-from-template flow below so it doesn't need a second creation path.
  const handlePanelCreatePage = useCallback(({ kind } = {}) => {
    if (!panelOccurrence?.id || !state?.userId || !state?.grid?._id) return null;
    const manifest = manifestsById?.[state?.grid?.manifestId] || null;
    return CommitHelpers.createPagePinnedToPanel({
      dispatch, socket, gridId: state.grid._id, userId: state.userId,
      kind: kind || "board", panelOccurrenceId: panelOccurrence.id,
      panelView: currentView, rootFolderId: manifest?.rootFolderId ?? null,
      activate: true,
    });
  }, [panelOccurrence?.id, state, manifestsById, currentView, dispatch, socket]);

  // QuickAddMenu template row (targetRole="page") — mirrors ManifestTree's
  // handleCreatePageFromTemplate byte-for-byte (same commit path, same
  // mode:"merge" reasoning): mint a fresh empty page via the same
  // handlePanelCreatePage a plain kind-tile uses, then merge the template's
  // contents into it. The ordering between the mint and the merge is made
  // correct SERVER-SIDE (create_page registers the new occurrence as pending;
  // apply_template awaits it — see server/utils/pendingOccCreates.js), so
  // this client-side call has nothing extra to do and nothing to duplicate
  // against ManifestTree's copy of the same two-step flow.
  const handlePanelCreatePageFromTemplate = useCallback(({ templateOccId, kind }) => {
    const newOccId = handlePanelCreatePage({ kind });
    if (!newOccId || !templateOccId) return;
    CommitHelpers.commitApplyTemplate(socket, { templateOccurrenceId: templateOccId, targetOccurrenceId: newOccId, mode: "merge" });
  }, [handlePanelCreatePage, socket]);

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
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({
      x: e.clientX, y: e.clientY,
      items: [
        {
          label: "Add page…",
          icon: Plus,
          onClick: () => setPanelQuickAddTrigger((n) => n + 1),
        },
        // The toolbar's + button is gone (2026-07-26). Empty grid cells are the
        // primary way to add a panel, but a MOSAIC grid has none — every pane is
        // filled — so panel creation lives here too.
        addNewPanel && {
          label: "Add panel",
          icon: PlusSquare,
          onClick: () => addNewPanel("board"),
        },
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
  }, [handleCopyPanel, handleCopylinkPanel, handleSplitPanel, handleUnsplitPanel, handleRemovePanel, isSplit, panelOccurrence, module.id, dispatch, socket, showHeader, addNewPanel]);

  // Touch: long-press opens the same panel menu.
  const panelLongPress = useLongPress(({ x, y }) =>
    handlePanelContextMenu({ clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} }));

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
    // Record "current location" for the assistant ("here" / "this folder").
    // A folder-page resolves to its underlying folder (id + name) so an import
    // lands in the folder; any other page resolves to the page occurrence.
    try {
      const occ = occurrencesById?.[occId];
      const mod = occ && modulesById?.[occ.moduleId];
      if (mod?.kind === "folder" && mod?.role === "page" && occ?.parentId) {
        const folder = foldersById?.[occ.parentId];
        setCurrentLocation({ id: occ.parentId, label: folder?.name || mod.label || "folder", type: "folder" });
      } else if (occ) {
        setCurrentLocation({ id: occId, label: mod?.label || "page", type: "page" });
      }
    } catch { /* location is best-effort — never block navigation */ }
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
    // Already-open notification: if this page is the active occurrence of
    // ANOTHER panel's view in the current grid, flash that page's HEADER over
    // there so the user notices. We still open the page in the requested
    // panel — this is a notice, not a block.
    if (occId && viewsById && (modulesById || occurrencesById)) {
      const otherPanelIds = new Set();
      for (const [vid, v] of Object.entries(viewsById)) {
        if (!v || v.activeOccurrenceId !== occId) continue;
        if (vid === currentView?.id) continue; // skip THIS panel's view
        // Resolve which panel uses this view — check panel occurrences first
        // (canonical), fall back to module.viewId (legacy panels).
        for (const occ of Object.values(occurrencesById || {})) {
          if (occ?.viewId === vid) {
            const mid = occ.moduleId;
            if (mid) otherPanelIds.add(mid);
          }
        }
        for (const mod of Object.values(modulesById || {})) {
          if (mod?.viewId === vid && mod?.role === "panel") otherPanelIds.add(mod.id);
        }
      }
      for (const pid of otherPanelIds) {
        const el = document.querySelector(`[data-panel-id="${CSS.escape(String(pid))}"]`);
        // The PAGE HEADER, not the whole shell (user, 2026-08-22: flash "the
        // page in the spot thats opened"). `flashPanelAlreadyOpen` falls back
        // to the shell when a panel has no page mounted.
        if (el) flashPanelAlreadyOpen(el);
      }
    }
    if (currentView?.id) {
      CommitHelpers.updateView({ dispatch, socket, view: { ...currentView, activeOccurrenceId: occId }, emit: true });
    }
  }, [panelOccurrence, currentView, dispatch, socket, viewsById, modulesById, occurrencesById, foldersById]);

  // Sidebar-aware page open: opening a page from the tree also collapses the
  // sidebar (user requested: selecting closes it).
  const openPageAndCloseTrees = useCallback((occId, options) => {
    openPage(occId, options);
    setRootTreeOpen(false);
  }, [openPage]);

  const closePage = useCallback((occId) => {
    if (!occId || !panelOccurrence?.id) return;
    CommitHelpers.unpinPageFromPanel({ dispatch, socket, pageOccurrenceId: occId, panelOccurrenceId: panelOccurrence.id });
    const remaining = (panelOccurrence.occurrences || []).filter(id => id !== occId);

    // CLOSING THE LAST PAGE lands on the root manifest folder, not on "No
    // content" (user, 2026-08-21: "an empty panel just goes to the root manifest
    // folder in folder view in the panel"). That default already existed for a
    // panel being CREATED — both the Toolbar + button and the empty-cell tap
    // call this helper — and stopped at the panel's first moment, so a panel
    // that became empty later fell through to the dead shell instead.
    //
    // It also matters one level up: the merged sidebar OMITS its "Pinned"
    // section when a panel has nothing pinned, on the stated grounds that such a
    // panel "already shows the root manifest folder as its CONTENT". That was
    // true only for new panels, so an emptied one showed neither.
    //
    // The panel's CURRENT view is handed over so it is re-pointed rather than
    // replaced — otherwise every emptied panel strands a View.
    if (!remaining.length) {
      openPanelOnRootFolderPage({
        panelOccId: panelOccurrence.id, grid, gridId: grid?._id,
        manifestsById, occurrencesById, modulesById, dispatch, socket, userId,
        existingView: currentView || null,
      });
      return;
    }
    if (currentView?.id && currentView.activeOccurrenceId === occId) {
      CommitHelpers.updateView({ dispatch, socket, view: { ...currentView, activeOccurrenceId: remaining[0] ?? null } });
    }
  }, [panelOccurrence, currentView, dispatch, socket, grid, manifestsById, occurrencesById, modulesById, userId]);

  // Panel-header search: the result may live on any page of the grid, so open
  // that page HERE (pin + activate) before scrolling to it.
  const handleSearchPick = useCallback((occId) => {
    const res = openOccurrenceInPanel({
      occId, panelOccurrence, occurrencesById, modulesById, viewsById, dispatch, socket,
      // Reported asynchronously when the page had to be opened first: the
      // helper polls for the target inside THIS panel and gives up eventually.
      onMissing: () => toast("Found it, but it's hidden by the current filter"),
    });
    if (!res.ok) toast("That item isn't on a page yet");
    else if (res.found === false) toast("Found it, but it's hidden by the current filter");
  }, [panelOccurrence, occurrencesById, modulesById, viewsById, dispatch, socket]);

  if (hidden && !forceFullscreen) return null;

  const cellWidth = liveSize.w !== null ? liveSize.w : (module.width || 1);
  const cellHeight = liveSize.h !== null ? liveSize.h : (module.height || 1);
  const isExtended = cellWidth > 1 || cellHeight > 1;

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
      {...panelLongPress}
      style={{
        // Mosaic panes are positioned by GridMosaic's absolute wrapper, so the
        // panel just fills it (no CSS-grid placement, no grid margin).
        ...(mosaic && !isFullscreen
          ? { width: "100%", height: "100%" }
          : {
              gridRow: isFullscreen ? "auto" : `${module.row + 1} / span ${cellHeight}`,
              gridColumn: isFullscreen ? "auto" : `${module.col + 1} / span ${cellWidth}`,
            }),
        position: "relative",
        display: "flex",
        flexDirection: "column",
        overflow: "visible",
        minHeight: 0,
        minWidth: 0,
        opacity: isDragging ? 0.4 : 1,
        margin: (mosaic && !isFullscreen) ? 0 : (isFullscreen ? 0 : (isMobileLayout ? "0px 2px 2px 2px" : "3px 6px 6px 6px")),
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

      {/* Hidden imperative page-adder — opened only by the "Add page…"
          context-menu row (the header intentionally carries no + button).
          The zero-size wrapper anchors the popup at the panel's top-left.
          Mounted LAZILY on the first trigger (a permanent mount cost every
          panel its subscriptions for a menu most panels never open) — and
          kept mounted afterwards so the open-on-mount trigger pattern holds
          for repeat opens. */}
      {panelQuickAddTrigger > 0 && (
        <span style={{ position: "absolute", top: 28, left: 10, width: 0, height: 0, overflow: "hidden" }}>
          <QuickAddMenu
            targetRole="page"
            onSelect={handlePanelPickPage}
            onCreateNew={handlePanelCreatePage}
            onCreatePageFromTemplate={handlePanelCreatePageFromTemplate}
            createLabel="New page"
            hostOccurrence={panelOccurrence}
            openTrigger={panelQuickAddTrigger}
          />
        </span>
      )}

      {/* CONTENT — staged per panel (helpers/stagedMount.js). The panel's own
          chrome (header, page name, tree toggles) renders immediately; only the
          BODY waits its turn, and while it waits it holds ONE circular loader —
          the same `Spinner` used everywhere else, smaller. Nothing is shown for
          the first 150ms, so a panel that lands quickly never flashes it. */}
      {(() => {
        const resolvedView = resolvedViewId ? viewsById[resolvedViewId] : null;
        const viewType = resolvedView?.viewType;
        // The loader is rendered in the SAME commit as the panel chrome, so it
        // is on screen the moment the shape is. `.staged-hold-spinner` keeps it
        // invisible for the first 150ms in CSS — a delay that survives a blocked
        // main thread, which a JS timer does not.
        const stagedHold = (
          <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Spinner size="sm" className="staged-hold-spinner" />
          </div>
        );

        // Page panel — dual sidebar (root tree left, panel-local right)
        if (pagesList.length > 0) {
          const activePageView = activePageEntry?.occurrence?.viewId ? viewsById[activePageEntry.occurrence.viewId] : null;

          // THE sidebar — one tree on the RIGHT holding the panel's pinned
          // pages above the full manifest. It was two mutually exclusive trees
          // on opposite sides until 2026-08-21; `panelOccurrence` is what makes
          // ManifestTree render the pinned section, so the merge is simply this
          // instance carrying every prop the two used to split between them.
          const rootTree = (
            <ManifestTree
              manifestId={state?.grid?.manifestId}
              view={resolvedView}
              dispatch={dispatch}
              socket={socket}
              collapsed={false}
              onToggleCollapse={() => setRootTreeOpen(false)}
              panelOccurrence={panelOccurrence}
              onOpenPage={openPageAndCloseTrees}
              onClosePage={closePage}
              activePageView={activePageView}
            />
          );

          // Page panel header — always visible. Drag handle on LEFT, then the
          // Local tree toggle, page name, then Root tree toggle + stack/fullscreen.
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
                      size="sm"
                      forceDirection="down"
                      onToggleHeader={() => setShowHeader(false)}
                      showHeader={showHeader}
                      onHistory={() => setHistoryOpen(true)}
                      onTemplate={openTemplates}
                      onDelete={handleRemovePanel}
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
                fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)",
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
                {/* Search every occurrence on the grid; picking one opens its
                    page in THIS panel and scrolls to it. */}
                <OccurrenceSearch onPick={handleSearchPick} title="Search all occurrences" />
                {/* THE sidebar toggle. Was one of TWO buttons that switched
                    between a local tree and the root tree; with one merged tree
                    there is nothing to switch, so it is a plain show/hide (the
                    user's pick over keeping them as jump links). Drag-enter still
                    opens it, which is what lets a drag drop into the tree. */}
                <button
                  onClick={() => setRootTreeOpen(v => !v)}
                  onDragEnter={(e) => { e.preventDefault(); setRootTreeOpen(true); }}
                  onDragOver={(e) => e.preventDefault()}
                  title="Files"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    padding: "3px 5px", border: "none", borderRadius: 4, cursor: "pointer",
                    background: rootTreeOpen ? "rgba(100,180,255,0.12)" : "transparent",
                    color: rootTreeOpen ? "rgba(100,180,255,1)" : "var(--text-muted)",
                  }}
                >
                  <Folder size={11} style={{ opacity: 0.8 }} />
                </button>
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
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{stack.length}</span>
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
                  onClosePage={closePage}
                  onDrilldownComplete={handleDrilldownComplete}
                />
              ) : (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)", fontSize: 12, height: "100%" }}>
                  Select or create a page
                </div>
              )}
            </div>
          );

          return (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
              {/* Panel header — always visible (per user; the old autohide
                  hover-hide + Local/Root nav bar are gone — the tree toggles
                  live in the header itself now). */}
              {pageHeader}
              {/* On desktop: sidebars push content (flex row). On mobile: sidebars overlay (absolute). */}
              <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", position: "relative" }}>
                {/* The sidebar is on the RIGHT only (user, 2026-08-21: "put this on
                    the right side"). The left rail it replaced held the panel-local
                    tree, which is now the Pinned section of the one on the right. */}
                {/* Page content — flex-grows between sidebars */}
                <div style={{ flex: 1, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                  {contentReady ? pageContent : stagedHold}
                </div>
                {/* Root tree sidebar — RIGHT. Pushes the page wherever there is
                    room for it (desktop AND tablet, portrait included); overlays only
                    on a genuinely narrow viewport. See ROOT_TREE_PUSH_MIN_W. */}
                {rootTreeOpen && (
                  !rootTreeCanPush ? (
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
                      flexShrink: 0, width: ROOT_TREE_W,
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
          if (!contentReady) return stagedHold;
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
          if (!contentReady) return stagedHold;
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

      {/* Resize handle — inline in bottom bar, not overlayed. Hidden in mosaic
          mode: panes are resized via GridMosaic's splitter bars, not cell spans. */}
      {!isFullscreen && !mosaic && (
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, position: "absolute", bottom: 0, right: 0}}>
          <ResizeHandle
            panel={module}
            cols={cols}
            rows={rows}
            large={isTouch}
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
          <MenuTabs
            tabs={[
              { id: "filter", label: "Filter", content: <FiltersSection occurrence={panelOccurrence} /> },
              { id: "sort",   label: "Sort",   content: <SortSection occurrence={panelOccurrence} /> },
              { id: "fields", label: "Fields", content: <FieldVisibilitySection occurrence={panelOccurrence} /> },
              { id: "layout", label: "Layout", content: <LayoutCascadeSection occurrence={panelOccurrence} /> },
            ]}
          />
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
