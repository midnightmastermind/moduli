// modules/ModulePage.jsx
// Page is a navigable content unit inside a panel.
// Outside shell: drag handle + radial menu + page name (like a doc).
// Inside: routes to content based on page kind (board, canvas, doc, display).

import React, { useRef, useMemo, useState, useCallback, useContext, useEffect } from "react";
import RadialMenu from "../ui/RadialMenu";
import ContextMenu from "../ui/ContextMenu";
import QuickAddMenu from "../ui/QuickAddMenu.jsx";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { X, Trash2, Copy, FileText, Layout, Paintbrush, Monitor, Folder, ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import NodePill from "./NodePill.jsx";
import PreviewNode from "./PreviewNode.jsx";

import Container from "./Container.jsx";
import Artifact from "./Artifact.jsx";
import { DocEditorShell } from "./DocContent.jsx";
import useDrilldown, { getCardAnimStyle } from "../hooks/useDrilldown.js";

import { GridActionsContext } from "../GridActionsContext";
import { GridDataContext } from "../GridDataContext";
import { GridLiveContext } from "../GridLiveContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import {
  getPageContainers,
} from "../helpers/LayoutHelpers";
import {
  useDraggable,
  useDroppable,
  DragType,
  DropAccepts,
} from "../helpers/dragSystem";
import { resolveEffectiveFilters, isOccurrenceVisible } from "../state/selectors";

// Kind icon mapping
const KIND_ICONS = {
  board: Layout,
  canvas: Paintbrush,
  doc: FileText,
  display: Monitor,
  folder: Folder,
};

// Folder content with PreviewNode grid + drilldown animation.
// Header mimics Windows 7 date picker: clicking scope label drills out,
// prev/next arrows navigate peer pages at the same depth.
function FolderContent({ childOccs, siblingOccs, dropRef, isOver, isMobile, modulesById, panelView, folderPageOccId, dispatch, socket, autoNavigateTo, onAutoNavigateComplete }) {
  const folderRef = useRef(null);
  const { occurrencesById } = useContext(GridActionsContext);

  const handleNavigate = useCallback((occId) => {
    if (panelView?.id) {
      CommitHelpers.updateView({ dispatch, socket, view: { ...panelView, activeOccurrenceId: occId }, emit: true });
    }
  }, [panelView, dispatch, socket]);

  const { animState, drilldownStack, startDrillDown, startDrillOut, navigatePeer, resetStack, canDrillOut } = useDrilldown({
    onNavigate: handleNavigate,
    containerRef: folderRef,
  });

  // Wrap startDrillDown to prime the folder into the stack when entering from a clean state.
  const handleDrillDown = useCallback((occId, cardEl) => {
    if (drilldownStack.length === 0 && folderPageOccId) {
      resetStack([folderPageOccId]);
    }
    startDrillDown(occId, cardEl);
  }, [drilldownStack.length, folderPageOccId, resetStack, startDrillDown]);

  // Auto-drilldown when navigating from tree (folder-first flow)
  useEffect(() => {
    if (!autoNavigateTo) return;
    resetStack(folderPageOccId ? [folderPageOccId] : []);
    const timer = setTimeout(() => {
      const cardEl = folderRef.current?.querySelector(`[data-occurrence-id="${autoNavigateTo}"]`);
      startDrillDown(autoNavigateTo, cardEl || null);
      onAutoNavigateComplete?.();
    }, 10);
    return () => clearTimeout(timer);
  }, [autoNavigateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Peer navigation — move to previous or next sibling at the current drill depth
  // siblingOccs is the sorted list of ALL pages in this folder (same level as the current drilled-in page)
  const currentDrilledId = canDrillOut ? drilldownStack[drilldownStack.length - 1] : null;
  const currentSiblingIndex = useMemo(() => {
    if (!currentDrilledId || !siblingOccs?.length) return -1;
    return siblingOccs.findIndex(o => o.id === currentDrilledId);
  }, [currentDrilledId, siblingOccs]);

  const handlePeerNav = useCallback((delta) => {
    if (!siblingOccs?.length || currentSiblingIndex < 0) return;
    const nextIndex = currentSiblingIndex + delta;
    if (nextIndex < 0 || nextIndex >= siblingOccs.length) return;
    navigatePeer(siblingOccs[nextIndex].id);
  }, [siblingOccs, currentSiblingIndex, navigatePeer]);

  // Keyboard: Escape = drill out, Left/Right = peer nav
  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || document.activeElement?.isContentEditable) return;
      if (e.key === "Escape" && canDrillOut) { e.preventDefault(); startDrillOut(); }
      if (e.key === "ArrowLeft" && canDrillOut) { e.preventDefault(); handlePeerNav(-1); }
      if (e.key === "ArrowRight" && canDrillOut) { e.preventDefault(); handlePeerNav(1); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }); // eslint-disable-line react-hooks/exhaustive-deps — intentionally re-registers to capture latest closures

  // Build scope header labels from drilldownStack (Windows 7: "FolderName › PageName")
  const scopeLabels = useMemo(() => {
    return drilldownStack.map(occId => {
      const occ = occurrencesById[occId];
      const mod = occ ? modulesById[occ.targetId] : null;
      return { occId, label: mod?.label || "…" };
    });
  }, [drilldownStack, occurrencesById, modulesById]);

  // Windows 7-style scope header — shown when drilled in (stack length >= 2)
  // Clicking parent portion drills out; prev/next arrows navigate siblings.
  const scopeHeader = canDrillOut ? (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      flexShrink: 0, padding: "4px 8px 4px 18px",
      borderBottom: "1px solid var(--border-default)",
      background: "var(--surface-base)",
    }}>
      {/* Left: clickable parent scope → drills out */}
      <div style={{ display: "flex", alignItems: "center", gap: 3, minWidth: 0, flex: 1, overflow: "hidden" }}>
        {scopeLabels.map((crumb, i) => {
          const isLast = i === scopeLabels.length - 1;
          return (
            <React.Fragment key={crumb.occId}>
              {i > 0 && <span style={{ color: "var(--text-faint)", fontSize: 9, flexShrink: 0 }}>›</span>}
              <span
                style={{
                  fontSize: 10, fontFamily: "var(--font-mono)",
                  color: isLast ? "var(--text-primary)" : "var(--accent-blue, #38bdf8)",
                  cursor: isLast ? "default" : "pointer",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  textDecoration: isLast ? "none" : "underline",
                  textDecorationColor: "rgba(56,189,248,0.4)",
                }}
                onClick={() => {
                  if (isLast) return;
                  // Drill out to this crumb level — pop stack down to i+1 entries
                  const stepsOut = scopeLabels.length - 1 - i;
                  for (let s = 0; s < stepsOut; s++) startDrillOut();
                }}
                title={isLast ? undefined : `Back to ${crumb.label}`}
              >
                {crumb.label}
              </span>
            </React.Fragment>
          );
        })}
      </div>

      {/* Right: prev/next peer navigation arrows */}
      {siblingOccs?.length > 1 && currentSiblingIndex >= 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0, marginLeft: 8 }}>
          <button
            onClick={() => handlePeerNav(-1)}
            disabled={currentSiblingIndex <= 0}
            style={{
              background: "none", border: "none", cursor: currentSiblingIndex <= 0 ? "default" : "pointer",
              color: currentSiblingIndex <= 0 ? "var(--text-faint)" : "var(--text-muted)",
              padding: "1px 2px", display: "flex", alignItems: "center",
            }}
            title="Previous page"
          >
            <ChevronLeft size={12} />
          </button>
          <span style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "var(--font-mono)", userSelect: "none" }}>
            {currentSiblingIndex + 1}/{siblingOccs.length}
          </span>
          <button
            onClick={() => handlePeerNav(1)}
            disabled={currentSiblingIndex >= siblingOccs.length - 1}
            style={{
              background: "none", border: "none", cursor: currentSiblingIndex >= siblingOccs.length - 1 ? "default" : "pointer",
              color: currentSiblingIndex >= siblingOccs.length - 1 ? "var(--text-faint)" : "var(--text-muted)",
              padding: "1px 2px", display: "flex", alignItems: "center",
            }}
            title="Next page"
          >
            <ChevronRight size={12} />
          </button>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div
      ref={(node) => {
        folderRef.current = node;
        if (dropRef) dropRef.current = node;
      }}
      style={{
        flex: 1, minHeight: 0,
        display: "flex", flexDirection: "column",
        overflow: "hidden",
        outline: isOver ? "2px solid rgba(50,150,255,0.5)" : "none",
        outlineOffset: -2,
        position: "relative",
      }}
    >
      {scopeHeader}
      <div style={{
        flex: 1, minHeight: 0,
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        overscrollBehavior: "contain",
        padding: isMobile ? "8px 8px 80px 8px" : "0px 0px 80px 0px",
      }}>
        <div className="preview-node-grid">
          {childOccs.map((occ, i) => {
            const mod = modulesById[occ.targetId];
            return (
              <PreviewNode
                key={occ.id}
                occurrence={occ}
                module={mod}
                onDrillDown={handleDrillDown}
                isAnimating={!!animState}
                loadPreview={autoNavigateTo ? occ.id === autoNavigateTo : true}
                loadIndex={i}
                style={getCardAnimStyle(occ.id, animState)}
              />
            );
          })}
          {childOccs.length === 0 && (
            <div className="text-xs text-muted-foreground text-center empty-placeholder" style={{ gridColumn: "1 / -1" }}>
              Drop items here
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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
  const { isMobile } = useContext(GridLiveContext);

  const pageModule = occurrence?.targetId ? modulesById[occurrence.targetId] : null;
  const pageView = occurrence?.viewId ? viewsById[occurrence.viewId] : null;
  const scrollAnchor = pageView?.scrollAnchor || panelView?.scrollAnchor;
  const kind = pageModule?.kind || "board";

  // Tree view detection — page with hasTree + manifestId renders Artifact content only
  // (the ManifestTree sidebar is handled by the parent panel, not duplicated here)
  const isTreeView = !!(pageView?.hasTree && pageView?.manifestId);

  const [ctxMenu, setCtxMenu] = useState(null);
  const [showHeader, setShowHeader] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editLabel, setEditLabel] = useState("");

  // Tree view: resolve active occurrence from page view
  const treeActiveOccId = isTreeView ? pageView?.activeOccurrenceId : null;
  const treeActiveOcc = treeActiveOccId ? occurrencesById[treeActiveOccId] : null;
  const treeActiveOccView = treeActiveOcc?.viewId ? viewsById[treeActiveOcc.viewId] : null;
  const handleRef = useRef(null);

  // Drag handle for the page
  const { ref: dragRef, isDragging } = useDraggable({
    type: DragType.PAGE,
    id: pageModule?.id,
    data: { module: pageModule, occurrence },
    context: { panelId, pageId: pageModule?.id },
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
  const pageEffectiveFilters = useMemo(
    () => resolveEffectiveFilters(occurrence, state?.grid?.activeFilterValues || {}),
    [occurrence, state?.grid?.activeFilterValues]
  );

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
        const mod = modulesById[occ.targetId];
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
    const allContainers = getPageContainers(occurrence, occurrencesById, containersById);
    const childOccIds = occurrence.occurrences || [];
    return allContainers.filter(container => {
      const containerOccId = childOccIds.find(occId => occurrencesById[occId]?.targetId === container.id);
      const containerOcc = containerOccId ? occurrencesById[containerOccId] : null;
      return isOccurrenceVisible(containerOcc ?? { id: container.id }, pageEffectiveFilters);
    });
  }, [occurrence, occurrencesById, containersById, pageEffectiveFilters]);

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
      targetId: containerModule.id,
      targetType: "module",
      fields: {},
    };
    CommitHelpers.createOccurrence({ dispatch, socket, occurrence: occ, emit: true });
    const updatedOccs = [...(occurrence.occurrences || []), occId];
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: occurrence.id, occurrences: updatedOccs }, emit: true });
  }, [occurrence, pageModule, dispatch, socket]);

  if (!pageModule || !occurrence) return null;

  const KindIcon = KIND_ICONS[kind] || FileText;

  // Render content based on kind (tree view takes priority)
  let content = null;
  if (isTreeView) {
    // Tree view — render only the active document content.
    // The ManifestTree sidebar is rendered by the parent panel (ModulePanel.jsx),
    // not duplicated here. Doc clicks in the sidebar update pageView.activeOccurrenceId.
    content = treeActiveOcc ? (
      <Artifact
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
    // Canvas page — the page occurrence IS the canvas container
    content = (
      <Container
        module={pageModule}
        occurrenceOverride={occurrence}
        panelId={panelId}
        addInstanceToContainer={addInstanceToContainer}
        dispatch={dispatch}
        socket={socket}
      />
    );
  } else if (kind === "doc") {
    // Doc page — TipTap editor directly
    content = (
      <DocEditorShell
        occurrence={occurrence}
        dispatch={dispatch}
        socket={socket}
        scrollAnchor={scrollAnchor}
      />
    );
  } else if (kind === "display") {
    // Display page — artifact viewer
    content = (
      <Artifact
        occurrence={occurrence}
        viewType={pageView?.viewType ?? "display"}
        artifactType={pageView?.artifactType ?? null}
        dispatch={dispatch}
        socket={socket}
        view={pageView}
      />
    );
  } else if (kind === "folder") {
    // Folder page — Explorer-style grid of PreviewNode cards with drilldown.
    // folderChildOccs computed above (hooks can't be in else branches).
    content = (
      <FolderContent
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
    const childOccIds = occurrence.occurrences || [];
    content = (
      <div
        ref={dropRef}
        style={{
          flex: 1, minHeight: 0,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          overscrollBehavior: "contain",
          padding: isMobile ? "6px 6px 80px 6px" : "0px 5px 80px 5px",
          position: "relative",
          outline: isOver ? "2px solid rgba(50,150,255,0.5)" : "none",
          outlineOffset: -2,
        }}
      >
        <div style={{ position: "relative", minHeight: "100%", zIndex: 1 }}>
          {containersList.map((container) => {
            const containerOccId = childOccIds.find(occId => occurrencesById[occId]?.targetId === container.id);
            const containerOcc = containerOccId ? occurrencesById[containerOccId] : null;
            return (
              <Container
                key={containerOccId || container.id}
                module={container}
                occurrenceOverride={containerOcc}
                panelId={panelId}
                panelLayoutOrientation="vertical"
                addInstanceToContainer={addInstanceToContainer}
                dispatch={dispatch}
                socket={socket}
                gapPx={12}
              />
            );
          })}
          {containersList.length === 0 && (
            <div className="text-xs text-muted-foreground text-center empty-placeholder">
              Drop containers here
            </div>
          )}
        </div>
      </div>
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
          draggable={false}
          style={{ position: "relative", top: 0, left: 4, transform: "none", flexShrink: 0, marginLeft: 0 }}
        >
          <div className="drag-handle-ball" />
          <div className="drag-handle-stem" />
          <RadialMenu
            onSettings={() => setSettingsOpen(true)}
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
                    const occ = { id: occId, userId: state.userId, gridId: state.grid._id, targetId: id, targetType: "module", fields: {} };
                    CommitHelpers.createOccurrence({ dispatch, socket, occurrence: occ, emit: true });
                    const updatedOccs = [...(occurrence.occurrences || []), occId];
                    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: occurrence.id, occurrences: updatedOccs }, emit: true });
                  }}
                  createLabel="New container"
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
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, overflow: isTreeView ? "hidden" : "auto", WebkitOverflowScrolling: isTreeView ? undefined : "touch", position: "relative", display: "flex", flexDirection: "column", }}>
        {content}
      </div>
    </div>
  );
}

export default React.memo(Page);
