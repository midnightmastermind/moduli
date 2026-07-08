// modules/ModulePage.jsx
// Page is a navigable content unit inside a panel.
// Outside shell: drag handle + radial menu + page name (like a doc).
// Inside: routes to content based on page kind (board, canvas, doc, display).

import React, { useRef, useMemo, useState, useCallback, useContext, useEffect } from "react";
import { toast } from "../state/notificationStore";
import RadialMenu from "../ui/RadialMenu";
import ContextMenu from "../ui/ContextMenu";
import { useLongPress } from "../hooks/useLongPress";
import QuickAddMenu from "../ui/QuickAddMenu.jsx";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Trash2, Copy, FileText, ArrowLeft, ChevronLeft, ChevronRight, ClipboardPaste } from "lucide-react";
import HeaderChevron from "../ui/HeaderChevron";
import { bumpRender } from "../helpers/renderProbe";
import HeaderDropdown from "../ui/HeaderDropdown";
import FiltersSection from "../ui/FiltersSection";
import FeedSection from "../ui/FeedSection";
import SortSection from "../ui/SortSection";
import FieldVisibilitySection from "../ui/FieldVisibilitySection";
import ViewModeSection from "../ui/ViewModeSection";
import LayoutCascadeSection from "../ui/LayoutCascadeSection";
import TemplatesSection from "../ui/TemplatesSection";
import StyleEditor from "../ui/StyleEditor";
import { buildStyleCascadeContext, resolveStyleCascade, styleToCSS } from "../helpers/StyleHelpers";
import NodePill from "./NodePill.jsx";
import PreviewNode from "./PreviewNode.jsx";

import ArtifactContent from "./ArtifactContent.jsx";
import { Spinner } from "../components/ui/spinner";
import { DocEditorShell } from "./DocContent.jsx";
import useDrilldown, { getCardAnimStyle } from "../hooks/useDrilldown.js";
import PageBoard from "./pages/PageBoard.jsx";
import PageDoc from "./pages/PageDoc.jsx";
import PageCanvas from "./pages/PageCanvas.jsx";
import PageDisplay from "./pages/PageDisplay.jsx";
import PageFolder from "./pages/PageFolder.jsx";
import ContainerTable from "./containers/ContainerTable.jsx";
import AutoMarquee from "../ui/AutoMarquee.jsx";
import RepresentationView from "../ui/RepresentationView";
import { getEffectiveViewMode } from "../helpers/viewMode";
import { resolveEffectiveViewModeFromCascade, classifyOccurrenceContext } from "../helpers/layoutCascade";
import { jumpToOccurrence } from "../helpers/jumpToOccurrence";

import { useGridActionsSelector, useGridActionsSelectorShallow } from "../GridActionsContext";

// Stable empty array for selector fallbacks — a fresh [] per selector run
// would defeat the Object.is stability the selector layer depends on.
const EMPTY_ARR = [];
import { GridLiveContext } from "../GridLiveContext";
import { SelectionContext } from "../state/SelectionContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import {
  getPageChildrenModules,
  applyLocalSort,
} from "../helpers/LayoutHelpers";
import { runPasteClipboard } from "../helpers/pasteClipboard";
import {
  useDragDrop,
  useDroppable,
  DragType,
  DropAccepts,
} from "../helpers/dragSystem";
import { getEffectiveFilterForOccurrence, isOccurrenceVisible, getLocalFilterConditions } from "../state/selectors";

// Kind icon mapping — now delegates to the shared helpers/moduleIcons.js
// helper. Kept as a thin re-export to avoid churn on the consumer that
// does `KIND_ICONS[kind] || FileText` below.
import { KIND_ICONS as SHARED_KIND_ICONS } from "../helpers/moduleIcons";
const KIND_ICONS = SHARED_KIND_ICONS;


function Page({
  occurrence,
  panelId,
  panelOccurrence,
  panelView,
  dispatch,
  socket,
  addInstanceToContainer,
  drilldownTarget,
  onDrilldownComplete,
}) {
  bumpRender("page");
  // Occurrence-derived maps (occurrencesById / childrenByParentId) rebuild on
  // every write — pages subscribe only to their OWN slices (direct children,
  // ancestor chain, folder children, grid) and read the maps at compute /
  // callback time via the non-subscribing getters. Module-derived maps stay
  // whole-map (stable across occurrence writes).
  const modulesById = useGridActionsSelector(s => s.modulesById);
  const containersById = useGridActionsSelector(s => s.containersById);
  const viewsById = useGridActionsSelector(s => s.viewsById);
  const foldersById = useGridActionsSelector(s => s.foldersById);
  const ctxGrid = useGridActionsSelector(s => s.state.grid);
  const ctxUserId = useGridActionsSelector(s => s.state.userId);
  const ctxGridId = useGridActionsSelector(s => s.state.gridId) || ctxGrid?._id;
  const getOccMap = useGridActionsSelector(s => s.getOccMap || (() => s.occurrencesById || {}));
  const { isMobileLayout, fullStateLoaded } = useContext(GridLiveContext);
  const selection = useContext(SelectionContext);

  // Direct child occurrence refs — the reactive dep for child-derived memos.
  const childOccsKey = useGridActionsSelectorShallow(s =>
    (occurrence?.occurrences || []).map(id => s.occurrencesById?.[id] || null)
  );
  // Ancestor occurrence refs root-ward (panel → …) — reactive dep for the
  // filter/style cascade walks.
  const ancestorChain = useGridActionsSelectorShallow(s => {
    const out = [];
    let cursor = occurrence?.id;
    let guard = 0;
    while (cursor && guard++ < 64) {
      const pid = s.parentByChildId?.[cursor];
      const parent = pid ? s.occurrencesById?.[pid] : null;
      if (!parent) break;
      out.push(parent);
      cursor = pid;
    }
    return out;
  });

  const pageModule = occurrence?.moduleId ? modulesById[occurrence.moduleId] : null;
  const pageView = occurrence?.viewId ? viewsById[occurrence.viewId] : null;
  const scrollAnchor = pageView?.scrollAnchor || panelView?.scrollAnchor;
  const kind = pageModule?.kind || "board";

  // Tree view detection — page with hasTree + manifestId renders ArtifactContent content only
  // (the ManifestTree sidebar is handled by the parent panel, not duplicated here)
  const isTreeView = !!(pageView?.hasTree && pageView?.manifestId);

  const [ctxMenu, setCtxMenu] = useState(null);
  const [showHeader, setShowHeader] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editLabel, setEditLabel] = useState("");
  const [dropdownAnchor, setDropdownAnchor] = useState(null);
  const openDropdown = useCallback((e) => setDropdownAnchor(e.currentTarget.getBoundingClientRect()), []);
  const closeDropdown = useCallback(() => setDropdownAnchor(null), []);
  const [templatesAnchor, setTemplatesAnchor] = useState(null);
  const openTemplates = useCallback((e) => setTemplatesAnchor(e?.currentTarget?.getBoundingClientRect?.() || null), []);
  const closeTemplates = useCallback(() => setTemplatesAnchor(null), []);

  // Page cascade — walks from THIS page occurrence up through panel
  // → grid (pages don't have container/instance ancestors). The
  // StyleEditor's "Inherited cascade" view shows what each ancestor
  // contributes before the user overrides at the page level.
  const pageCascade = useMemo(() => {
    if (!occurrence) return null;
    const ctx = buildStyleCascadeContext({
      leafOccurrence: occurrence,
      occurrencesById: getOccMap(),
      modulesById,
      grid: ctxGrid,
    });
    return resolveStyleCascade(ctx, "page");
    // ancestorChain is the reactive dep for the ancestor walk inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occurrence, ancestorChain, modulesById, ctxGrid, getOccMap]);

  // Tree view: resolve active occurrence from page view
  const treeActiveOccId = isTreeView ? pageView?.activeOccurrenceId : null;
  const treeActiveOcc = useGridActionsSelector(s => (treeActiveOccId ? s.occurrencesById?.[treeActiveOccId] || null : null));
  const treeActiveOccView = treeActiveOcc?.viewId ? viewsById[treeActiveOcc.viewId] : null;
  const handleRef = useRef(null);

  // Drag handle for the page (no accepts → not a drop target itself; drops
  // pass through to the page-content useDroppable below).
  const { ref: dragRef, isDragging } = useDragDrop({
    type: DragType.PAGE,
    id: pageModule?.id,
    data: { module: pageModule, occurrence },
    context: { panelId, pageId: pageModule?.id, pageOccurrenceId: occurrence?.id || null },
    disabled: !pageModule,
    dragHandleRef: handleRef,
  });

  // Drop zone for content inside the page
  const { ref: dropRef, isOver } = useDroppable({
    type: "page-content",
    id: `page-content:${occurrence?.id}`,
    context: { panelId, pageId: pageModule?.id, pageOccurrenceId: occurrence?.id },
    accepts: DropAccepts.PAGE_CONTENT,
    disabled: !pageModule,
  });

  // Container list for board pages
  const pageActiveNamedFilter = useMemo(() => {
    const activeId = ctxGrid?.activeFilterId;
    if (!activeId) return null;
    return (ctxGrid?.namedFilters || []).find(f => f.id === activeId) || null;
  }, [ctxGrid?.activeFilterId, ctxGrid?.namedFilters]);

  // Always walk the parent chain — `pageActiveNamedFilter.lock` controls whether
  // THIS occurrence may write its own `filterOverride` (UI-level editability),
  // not whether ancestor overrides cascade. Short-circuiting to grid filters
  // here was breaking the cascade — e.g. navigating the Schedule page's local
  // date wouldn't propagate to the slot containers below.
  const pageEffectiveFilters = useMemo(
    // ancestorChain is the reactive dep for the ancestor filter walk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    () => getEffectiveFilterForOccurrence(occurrence, { grid: ctxGrid, occurrencesById: getOccMap() }),
    [occurrence, ctxGrid, ancestorChain, getOccMap]
  );

  // Combine grid's active named-filter conditions with the page's own
  // `filters[]` entries. The Time Slot select on the schedule page is defined
  // as a local filter on `occurrence.filters[]` with `condition: null` — its
  // synthesized IS condition is what makes filterOverride[timeslotFieldId]
  // actually drive child visibility.
  const pageActiveFilterConditions = useMemo(() => {
    const gridConds = pageActiveNamedFilter?.conditions || [];
    const localConds = getLocalFilterConditions(occurrence);
    if (!gridConds.length && !localConds.length) return null;
    return [...gridConds, ...localConds];
  }, [pageActiveNamedFilter, occurrence]);

  // Child occurrences for folder pages.
  // Includes: (1) page/doc occurrences with parentId = this folder
  //           (2) folder-page occurrences for each sub-folder of this folder
  // Excludes self, templates.
  // Shallow context selector (not a useMemo over childrenByParentId — that map
  // rebuilds on every occurrence write): the result is an array of occurrence
  // REFS, so element-wise comparison keeps folder pages from re-rendering on
  // unrelated writes while still reacting when a folder child changes.
  const folderChildOccs = useGridActionsSelectorShallow(s => {
    if (kind !== "folder") return EMPTY_ARR;
    const folderId = occurrence?.parentId;
    if (!folderId) return EMPTY_ARR;

    // Direct children: occurrences whose parentId matches this folder
    const directChildren = (s.childrenByParentId?.[folderId] || [])
      .filter(occ => {
        if (occ.id === occurrence.id) return false;
        if (occ.meta?.isTemplate) return false;
        return true;
      });

    // Sub-folder pages: find child folders, then find their folder-page occurrences
    const childFolders = Object.values(s.foldersById || {})
      .filter(f => f.parentId === folderId);
    const seenIds = new Set(directChildren.map(c => c.id));
    const subFolderPageOccs = [];
    for (const sf of childFolders) {
      const sfChildren = s.childrenByParentId?.[sf.id] || [];
      const folderPageOcc = sfChildren.find(occ => {
        const mod = s.modulesById?.[occ.moduleId];
        return mod?.kind === "folder" && mod?.role === "page";
      });
      if (folderPageOcc && !seenIds.has(folderPageOcc.id)) {
        subFolderPageOccs.push(folderPageOcc);
      }
    }

    return [...directChildren, ...subFolderPageOccs]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  });

  const containersList = useMemo(() => {
    if (!occurrence) return [];
    // childOccsKey is the reactive dep (direct child refs); the full map is a
    // fresh read at compute time via the non-subscribing getter.
    const occurrencesById = getOccMap();
    // Pages can host any module role (containers, artifacts, textblocks, nested pages).
    // Pass full modulesById so non-container child modules also resolve.
    const childModules = getPageChildrenModules(occurrence, occurrencesById, modulesById);
    const childOccIds = occurrence.occurrences || [];
    const pairs = [];
    for (const container of childModules) {
      // Pick the per-day occurrence that matches the page's effective filter. A page
      // can host multiple occurrences of the same slot module (one per date), and we
      // want the one belonging to the active date — not the first one find() returns.
      let matchedOcc = null;
      let hasAnyOcc = false;
      for (const occId of childOccIds) {
        const occ = occurrencesById[occId];
        if (!occ || occ.moduleId !== container.id) continue;
        hasAnyOcc = true;
        if (isOccurrenceVisible(occ, pageEffectiveFilters, pageActiveFilterConditions)) {
          matchedOcc = occ;
          break;
        }
      }
      if (matchedOcc) {
        pairs.push({ container, occurrence: matchedOcc, instance: container });
      } else if (!hasAnyOcc && isOccurrenceVisible({ id: container.id }, pageEffectiveFilters, pageActiveFilterConditions)) {
        pairs.push({ container, occurrence: null, instance: container });
      }
    }
    // Apply the page occurrence's local sort to its direct children (when set).
    // `applyLocalSort` reads `instance.label` (we set instance=container above)
    // for the "label" key, or occurrence.fields[fid].value otherwise.
    const sorted = applyLocalSort(pairs, occurrence?.meta?.localSort, modulesById);
    // Strip the temporary `instance` field so we don't leak it into the
    // existing PageBoard call sites that expect `{ container, occurrence }`.
    return sorted.map(({ container, occurrence }) => ({ container, occurrence }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occurrence, childOccsKey, modulesById, pageEffectiveFilters, pageActiveFilterConditions, getOccMap]);

  // Label editing
  const startEdit = useCallback(() => {
    setEditLabel(pageModule?.label || "");
    setIsEditing(true);
  }, [pageModule?.label]);

  const commitLabel = useCallback(() => {
    setIsEditing(false);
    if (!pageModule || editLabel === pageModule.label) return;
    CommitHelpers.updateModule({ dispatch, socket, module: { ...pageModule, label: editLabel }, emit: true });
  }, [pageModule, editLabel, dispatch, socket]);

  // Delete page (with confirmation)
  const handleDelete = useCallback(() => {
    if (!occurrence?.id || !panelOccurrence?.id) return;
    const label = pageModule?.label || "this page";
    if (!window.confirm(`Delete "${label}"? This will remove the page and all its contents.`)) return;
    CommitHelpers.deletePage({ dispatch, socket, pageOccurrenceId: occurrence.id, panelOccurrenceId: panelOccurrence.id, emit: true });
  }, [occurrence, panelOccurrence, pageModule?.label, dispatch, socket]);

  // Context menu
  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    // Paste-here surfaces when the multi-select clipboard is non-empty.
    // Destination is this page occurrence; pasted children land in
    // occurrence.occurrences[] (same shape as a container).
    const clip = selection.clipboard;
    const pasteLabel = clip
      ? clip.mode === "move"
        ? `Move ${clip.ids.length} here`
        : clip.mode === "copylink"
          ? `Paste linked ${clip.ids.length} here`
          : `Paste ${clip.ids.length} here`
      : null;
    setCtxMenu({
      x: e.clientX, y: e.clientY,
      items: [
        clip && {
          label: pasteLabel,
          icon: ClipboardPaste,
          onClick: () => {
            const { pasted } = runPasteClipboard({
              mode: clip.mode,
              ids: clip.ids,
              destinationOccurrence: occurrence,
              destinationModule: pageModule,
              occurrencesById: getOccMap(),
              dispatch, socket,
              gridId: pageModule?.gridId || ctxGridId,
              userId: pageModule?.userId || ctxUserId,
              panelId,
            });
            selection.clearClipboard();
            selection.clear();
            if (pasted > 0) {
              const verb = clip.mode === "move" ? "Moved" : clip.mode === "copylink" ? "Linked" : "Pasted";
              toast.success(`${verb} ${pasted} item${pasted === 1 ? "" : "s"}`, { duration: 2000 });
            } else {
              toast.error("Nothing pasted", { duration: 2500 });
            }
          },
        },
        clip && { separator: true },
        { label: showHeader ? "Hide header" : "Show header", onClick: () => setShowHeader(v => !v) },
        { label: "Rename", onClick: startEdit },
        { separator: true },
        { label: "Remove page", icon: Trash2, danger: true, onClick: handleDelete },
      ].filter(Boolean),
    });
  }, [showHeader, startEdit, handleDelete, selection, occurrence, pageModule, getOccMap, dispatch, socket, ctxGridId, ctxUserId, panelId]);

  // Touch: long-press opens the same page menu.
  const pageLongPress = useLongPress(({ x, y }) =>
    handleContextMenu({ clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} }));

  // Quick-add container inside this page
  const handleQuickAddContainer = useCallback((containerModule) => {
    if (!occurrence?.id || !containerModule?.id) return;
    const occId = crypto.randomUUID();
    const occ = {
      id: occId,
      userId: pageModule?.userId,
      gridId: pageModule?.gridId,
      moduleId: containerModule.id,
      fields: {},
    };
    CommitHelpers.createOccurrence({ dispatch, socket, occurrence: occ, emit: true });
    const updatedOccs = [...(occurrence.occurrences || []), occId];
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: occurrence.id, occurrences: updatedOccs }, emit: true });
  }, [occurrence, pageModule, dispatch, socket]);

  if (!pageModule || !occurrence) return null;

  const KindIcon = KIND_ICONS[kind] || FileText;

  // Route content by page kind (tree view takes priority)
  let content = null;
  if (isTreeView) {
    // Tree view — render only the active document content.
    // ManifestTree sidebar is handled by the parent panel, not duplicated here.
    content = treeActiveOcc ? (
      <ArtifactContent
        occurrence={treeActiveOcc}
        viewType={treeActiveOccView?.viewType ?? "markdown"}
        artifactType={treeActiveOccView?.artifactType ?? null}
        dispatch={dispatch}
        socket={socket}
        view={pageView}
      />
    ) : (
      <div className="text-xs text-muted-foreground text-center empty-placeholder" style={{ paddingTop: 40 }}>
        Select a document
      </div>
    );
  } else if (kind === "canvas") {
    content = (
      <PageCanvas
        pageModule={pageModule}
        occurrence={occurrence}
        panelId={panelId}
        dispatch={dispatch}
        socket={socket}
      />
    );
  } else if (kind === "doc") {
    content = <PageDoc occurrence={occurrence} dispatch={dispatch} socket={socket} scrollAnchor={scrollAnchor} />;
  } else if (kind === "table") {
    // Table as a page — same layout-only grid as the table container,
    // just hosted directly by the page (mirrors canvas/doc delegation).
    content = <ContainerTable occurrence={occurrence} dispatch={dispatch} socket={socket} />;
  } else if (kind === "display") {
    content = <PageDisplay occurrence={occurrence} pageView={pageView} dispatch={dispatch} socket={socket} />;
  } else if (kind === "folder") {
    content = (
      <PageFolder
        childOccs={folderChildOccs}
        siblingOccs={folderChildOccs}
        dropRef={dropRef}
        isOver={isOver}
        isMobileLayout={isMobileLayout}
        modulesById={modulesById}
        panelView={panelView}
        folderPageOccId={occurrence?.id}
        dispatch={dispatch}
        socket={socket}
        autoNavigateTo={drilldownTarget}
        onAutoNavigateComplete={onDrilldownComplete}
      />
    );
  } else {
    // Board (default) — sortable container list
    content = (
      <PageBoard
        occurrence={occurrence}
        containersList={containersList}
        panelId={panelId}
        addInstanceToContainer={addInstanceToContainer}
        dispatch={dispatch}
        socket={socket}
        dropRef={dropRef}
        isOver={isOver}
        isMobileLayout={isMobileLayout}
        fullStateLoaded={fullStateLoaded}
      />
    );
  }

  // Per-occurrence view-mode handling. Pages default to Actual (the full
  // page-shell render below). Representation mode swaps in a compact
  // chip — useful for surfacing a page reference in a mind-map / value-
  // builder context without rendering its full content. Preview mode is
  // the folder-page PreviewNode pattern (separate component) and doesn't
  // apply at the page-render entry point — falls through to Actual.
  //
  // Task #45 page-within-page: the layout cascade hardcodes a forced
  // `representation` mode for any page nested inside another page or a
  // container, and forced `actual` for a top-level page (panel content).
  // The cascade-aware resolver wins over `meta.viewMode` when the cascade
  // sets navAllowChange=false.
  const pageViewMode = resolveEffectiveViewModeFromCascade({
    occurrence,
    occurrencesById: getOccMap(),
    modulesById,
    grid: ctxGrid,
  }) || getEffectiveViewMode(occurrence, "default");
  if (pageViewMode === "representation") {
    return (
      <div
        data-page-occ-id={occurrence?.id}
        style={{ padding: "6px 8px" }}
      >
        <RepresentationView
          occurrence={occurrence}
          size="md"
          showBreadcrumb={false}
          onJump={() => jumpToOccurrence(occurrence?.id)}
        />
      </div>
    );
  }

  // Task #45 — page-within-page primitive. When this page is nested INSIDE
  // another page AND the user has switched it to "actual" mode, render
  // with container-style chrome (slim header, no outer page border) so
  // it visually inlines as a container while still being a real page
  // module under the hood. The cascade rule
  // (resolveDefaultLayout.context === "nestedInPage") gates whether the
  // switch is even available.
  //
  // Q2 (2026-05-24) actual-converted view: when viewMode is
  // "actual-converted" — selectable for pages nested in containers OR
  // other pages — render the same nested page-shell as #45's actual mode
  // (slim border, transparent bg). Only difference vs `actual` is the
  // name in the switcher; both render identically and let the page
  // inline as a container.
  const pageContextKind = classifyOccurrenceContext({
    occurrence,
    occurrencesById: getOccMap(),
    modulesById,
  });
  // D4 (2026-05-24): top-level pages also accept `actual-converted` so
  // users can collapse the page into a container-styled render in place.
  const isNestedAsContainer =
    (pageContextKind === "nestedInPage" && pageViewMode === "actual") ||
    (pageContextKind === "nestedInPage" && pageViewMode === "actual-converted") ||
    (pageContextKind === "nestedInContainer" && pageViewMode === "actual-converted") ||
    (pageContextKind === "topLevel" && pageViewMode === "actual-converted");

  return (
    <div
      ref={dragRef}
      className={isNestedAsContainer ? "page-shell page-shell--nested" : "page-shell"}
      data-page-occ-id={occurrence?.id}
      onContextMenu={handleContextMenu}
      {...pageLongPress}
      style={{
        display: "flex",
        flexDirection: "column",
        flex: isNestedAsContainer ? "0 0 auto" : 1,
        minHeight: 0,
        opacity: isDragging ? 0.4 : 1,
        overflow: "hidden",
        position: "relative",
        // Nested-as-container: drop the outer border + card background
        // so the page inlines visually inside its parent. The header
        // row below still renders so users can switch the view back to
        // representation. Per #45.
        ...(isNestedAsContainer
          ? { border: "1px solid var(--border-subtle)", borderRadius: 4, background: "transparent" }
          : { border: "1px solid var(--border-default)", borderRadius: 6, background: "var(--surface-card)" }),
        // Cascade-resolved page style — Grid default → Panel pushdown
        // → this page's own ownStyle (last write wins). Spread AFTER
        // the static defaults so any key the user set in the Page
        // Settings popover (background, border color, fonts, padding,
        // opacity) overrides the matching default. Per-key opt-in:
        // styleToCSS returns only keys the cascade explicitly set;
        // nothing else is touched.
        ...(pageCascade?.resolved ? styleToCSS(pageCascade.resolved) : {}),
      }}
    >
      <ContextMenu ctx={ctxMenu} onClose={() => setCtxMenu(null)} />

      {/* Page header row — handle LEFT, then spacer, then actions RIGHT */}
      <div
        style={{
          flexShrink: 0,
          width: "100%",
          display: "flex",
          alignItems: "center",
          flexDirection: "row",
          justifyContent: "space-between",
          padding: "0px 6px 0px 0px",
          borderBottom: "1px solid var(--border-default)",
        }}
      >
        {/* Handle — leftmost with breathing room. Wrapped in a
            Popover so RadialMenu's settings cog opens a Page Settings
            panel (kind-aware StyleEditor + cascade view) anchored at
            the handle. Previously `settingsOpen` toggled but had no
            consumer — clicking the cog did nothing. */}
        <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
          <PopoverAnchor asChild>
            <div
              ref={handleRef}
              className="module-drag-handle module-grab-zone"
              data-dnd-handle="true"
              draggable={false}
              style={{ position: "relative", top: 0, left: 4, transform: "none", flexShrink: 0, marginLeft: 0 }}
            >
              <RadialMenu
                onSettings={() => setSettingsOpen(true)}
                onTemplate={openTemplates}
                size="sm"
                forceDirection="down"
              />
            </div>
          </PopoverAnchor>
          <PopoverContent
            side="bottom"
            align="start"
            collisionPadding={8}
            className="p-0 w-72"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="px-3 pt-3 pb-2 border-b border-border flex items-center justify-between">
              <span className="text-[11px] font-semibold text-foreground/80">Page settings</span>
              <span className="text-[10px] text-muted-foreground font-mono">{kind}</span>
            </div>
            <div className="px-3 py-2 max-h-[60vh] overflow-y-auto">
              <StyleEditor
                kind="page"
                cascade={pageCascade}
                styleMode={pageModule?.styleMode || "inherit"}
                ownStyle={pageModule?.ownStyle}
                onStyleModeChange={(mode) => {
                  if (!pageModule) return;
                  CommitHelpers.updateModule({
                    dispatch, socket,
                    module: { id: pageModule.id, styleMode: mode },
                    emit: true,
                  });
                }}
                onOwnStyleChange={(style) => {
                  if (!pageModule) return;
                  CommitHelpers.updateModule({
                    dispatch, socket,
                    module: { id: pageModule.id, ownStyle: style },
                    emit: true,
                  });
                }}
                label="Page Style"
                inheritLabel="Panel / Grid"
              />
            </div>
          </PopoverContent>
        </Popover>
        {(
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 0", marginLeft: "auto" }}>
            {/* Filter (HeaderChevron) now leads; the add (QuickAddMenu) moved to the end. */}
            <div onPointerDown={(e) => e.stopPropagation()} style={{ display: "flex", flexShrink: 0, gap: 4, alignItems: "center" }}>
              <HeaderChevron onClick={openDropdown} isOpen={!!dropdownAnchor} occurrence={occurrence} />
            </div>
            <KindIcon size={10} style={{ opacity: 0.35, flexShrink: 0 }} />
            {isEditing ? (
              <input
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                onBlur={commitLabel}
                onKeyDown={(e) => { if (e.key === "Enter") commitLabel(); if (e.key === "Escape") setIsEditing(false); }}
                autoFocus
                style={{
                  flex: 1, minWidth: 0,
                  background: "transparent", border: "none", outline: "none",
                  color: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)",
                  letterSpacing: "0.03em",
                }}
              />
            ) : (
              <span
                style={{ flex: 1, minWidth: 0, overflow: "hidden", fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-mono)", letterSpacing: "0.03em", cursor: "text", userSelect: "none" }}
                onDoubleClick={startEdit}
              >
                <AutoMarquee>{pageModule.label || "Untitled"}</AutoMarquee>
              </span>
            )}

            {/* Add (QuickAddMenu) moved here, after the label. */}
            <div onPointerDown={(e) => e.stopPropagation()} style={{ display: "flex", flexShrink: 0, gap: 4, alignItems: "center", marginLeft: 4 }}>
              <QuickAddMenu
                targetRole="container"
                onSelect={handleQuickAddContainer}
                onCreateNew={({ kind } = {}) => {
                  if (!occurrence?.id || !ctxUserId || !ctxGridId) return;
                  const id = crypto.randomUUID();
                  const mod = { id, role: "container", kind: kind || "board", label: `List ${containersList.length + 1}` };
                  CommitHelpers.createModule({ dispatch, socket, module: mod, emit: true });
                  const occId = crypto.randomUUID();
                  const occ = { id: occId, userId: ctxUserId, gridId: ctxGridId, moduleId: id, fields: {} };
                  CommitHelpers.createOccurrence({ dispatch, socket, occurrence: occ, emit: true });
                  const updatedOccs = [...(occurrence.occurrences || []), occId];
                  CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: occurrence.id, occurrences: updatedOccs }, emit: true });
                }}
                createLabel="New container"
                hostOccurrence={occurrence}
              />
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, overflow: isTreeView ? "hidden" : "auto", WebkitOverflowScrolling: isTreeView ? undefined : "touch", position: "relative", display: "flex", flexDirection: "column", }}>
        {content}
      </div>

      {dropdownAnchor && (
        <HeaderDropdown anchorRect={dropdownAnchor} onClose={closeDropdown}>
          <FiltersSection occurrence={occurrence} />
          <FeedSection occurrence={occurrence} />
          <SortSection occurrence={occurrence} />
          <FieldVisibilitySection occurrence={occurrence} />
          <ViewModeSection occurrence={occurrence} />
          <LayoutCascadeSection occurrence={occurrence} />
        </HeaderDropdown>
      )}
      {templatesAnchor && (
        <HeaderDropdown anchorRect={templatesAnchor} onClose={closeTemplates}>
          <TemplatesSection occurrence={occurrence} />
        </HeaderDropdown>
      )}
    </div>
  );
}

export default React.memo(Page);
