// modules/ModulePage.jsx
// Page is a navigable content unit inside a panel.
// Outside shell: drag handle + radial menu + page name (like a doc).
// Inside: routes to content based on page kind (board, canvas, doc, display).

import React, { useRef, useMemo, useState, useCallback, useContext, useEffect } from "react";
import RadialMenu from "../ui/RadialMenu";
import ContextMenu from "../ui/ContextMenu";
import QuickAddMenu from "../ui/QuickAddMenu.jsx";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Trash2, Copy, FileText, Layout, Paintbrush, Monitor, Folder, ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import HeaderChevron from "../ui/HeaderChevron";
import HeaderDropdown from "../ui/HeaderDropdown";
import FiltersSection from "../ui/FiltersSection";
import TemplatesSection from "../ui/TemplatesSection";
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

import { GridActionsContext } from "../GridActionsContext";
import { GridDataContext } from "../GridDataContext";
import { GridLiveContext } from "../GridLiveContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import {
  getPageChildrenModules,
} from "../helpers/LayoutHelpers";
import {
  useDragDrop,
  useDroppable,
  DragType,
  DropAccepts,
} from "../helpers/dragSystem";
import { getEffectiveFilterForOccurrence, isOccurrenceVisible, getLocalFilterConditions } from "../state/selectors";

// Kind icon mapping
const KIND_ICONS = {
  board: Layout,
  canvas: Paintbrush,
  doc: FileText,
  display: Monitor,
  folder: Folder,
};


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
  const { occurrencesById, modulesById, containersById, viewsById, foldersById, childrenByParentId } = useContext(GridActionsContext);
  const { state } = useContext(GridDataContext);
  const { isMobile, fullStateLoaded } = useContext(GridLiveContext);

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

  // Tree view: resolve active occurrence from page view
  const treeActiveOccId = isTreeView ? pageView?.activeOccurrenceId : null;
  const treeActiveOcc = treeActiveOccId ? occurrencesById[treeActiveOccId] : null;
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
    const activeId = state?.grid?.activeFilterId;
    if (!activeId) return null;
    return (state?.grid?.namedFilters || []).find(f => f.id === activeId) || null;
  }, [state?.grid?.activeFilterId, state?.grid?.namedFilters]);

  // Always walk the parent chain — `pageActiveNamedFilter.lock` controls whether
  // THIS occurrence may write its own `filterOverride` (UI-level editability),
  // not whether ancestor overrides cascade. Short-circuiting to grid filters
  // here was breaking the cascade — e.g. navigating the Schedule page's local
  // date wouldn't propagate to the slot containers below.
  const pageEffectiveFilters = useMemo(
    () => getEffectiveFilterForOccurrence(occurrence, { grid: state?.grid, occurrencesById }),
    [occurrence, state?.grid, occurrencesById]
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
  const folderChildOccs = useMemo(() => {
    if (kind !== "folder") return [];
    const folderId = occurrence?.parentId;
    if (!folderId) return [];

    // Direct children: occurrences whose parentId matches this folder
    const directChildren = (childrenByParentId[folderId] || [])
      .filter(occ => {
        if (occ.id === occurrence.id) return false;
        if (occ.meta?.isTemplate) return false;
        return true;
      });

    // Sub-folder pages: find child folders, then find their folder-page occurrences
    const childFolders = Object.values(foldersById || {})
      .filter(f => f.parentId === folderId);
    const seenIds = new Set(directChildren.map(c => c.id));
    const subFolderPageOccs = [];
    for (const sf of childFolders) {
      const sfChildren = childrenByParentId[sf.id] || [];
      const folderPageOcc = sfChildren.find(occ => {
        const mod = modulesById[occ.moduleId];
        return mod?.kind === "folder" && mod?.role === "page";
      });
      if (folderPageOcc && !seenIds.has(folderPageOcc.id)) {
        subFolderPageOccs.push(folderPageOcc);
      }
    }

    return [...directChildren, ...subFolderPageOccs]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }, [kind, occurrence?.parentId, occurrence?.id, childrenByParentId, modulesById, foldersById]);

  const containersList = useMemo(() => {
    if (!occurrence) return [];
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
        pairs.push({ container, occurrence: matchedOcc });
      } else if (!hasAnyOcc && isOccurrenceVisible({ id: container.id }, pageEffectiveFilters, pageActiveFilterConditions)) {
        pairs.push({ container, occurrence: null });
      }
    }
    return pairs;
  }, [occurrence, occurrencesById, modulesById, pageEffectiveFilters, pageActiveFilterConditions]);

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
    if ("ontouchstart" in window) return;
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: showHeader ? "Hide header" : "Show header", onClick: () => setShowHeader(v => !v) },
        { label: "Rename", onClick: startEdit },
        { separator: true },
        { label: "Remove page", icon: Trash2, danger: true, onClick: handleDelete },
      ],
    });
  }, [showHeader, startEdit, handleDelete]);

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
  } else if (kind === "display") {
    content = <PageDisplay occurrence={occurrence} pageView={pageView} dispatch={dispatch} socket={socket} />;
  } else if (kind === "folder") {
    content = (
      <PageFolder
        childOccs={folderChildOccs}
        siblingOccs={folderChildOccs}
        dropRef={dropRef}
        isOver={isOver}
        isMobile={isMobile}
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
        isMobile={isMobile}
        fullStateLoaded={fullStateLoaded}
      />
    );
  }

  return (
    <div
      ref={dragRef}
      className={`page-shell`}
      data-page-occ-id={occurrence?.id}
      onContextMenu={handleContextMenu}
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        opacity: isDragging ? 0.4 : 1,
        overflow: "hidden",
        position: "relative",
        border: "1px solid var(--border-default)",
        borderRadius: 6,
        background: "var(--surface-card)",
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
        {/* Handle — leftmost with breathing room */}
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
        {(
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 0", marginLeft: "auto" }}>
            {(
              <div onPointerDown={(e) => e.stopPropagation()} style={{ flexShrink: 0}}>
                <QuickAddMenu
                  targetRole="container"
                  onSelect={handleQuickAddContainer}
                  onCreateNew={() => {
                    if (!occurrence?.id || !state?.userId || !state?.grid?._id) return;
                    const id = crypto.randomUUID();
                    const mod = { id, role: "container", kind: "list", label: `List ${containersList.length + 1}` };
                    CommitHelpers.createModule({ dispatch, socket, module: mod, emit: true });
                    const occId = crypto.randomUUID();
                    const occ = { id: occId, userId: state.userId, gridId: state.grid._id, moduleId: id, fields: {} };
                    CommitHelpers.createOccurrence({ dispatch, socket, occurrence: occ, emit: true });
                    const updatedOccs = [...(occurrence.occurrences || []), occId];
                    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: occurrence.id, occurrences: updatedOccs }, emit: true });
                  }}
                  createLabel="New container"
                  hostOccurrence={occurrence}
                />
              </div>
            )}
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
                style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-mono)", letterSpacing: "0.03em", cursor: "text", userSelect: "none" }}
                onDoubleClick={startEdit}
              >
                {pageModule.label || "Untitled"}
              </span>
            )}

            {/* Filter dropdown trigger */}
            <div onPointerDown={(e) => e.stopPropagation()} style={{ display: "flex", flexShrink: 0, gap: 4, alignItems: "center", marginLeft: 4 }}>
              <HeaderChevron onClick={openDropdown} isOpen={!!dropdownAnchor} occurrence={occurrence} />
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
