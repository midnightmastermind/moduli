// modules/ModulePage.jsx
// Page is a navigable content unit inside a panel.
// Outside shell: drag handle + radial menu + page name (like a doc).
// Inside: routes to content based on page kind (board, canvas, doc, display).

import React, { useRef, useMemo, useState, useCallback, useContext } from "react";
import RadialMenu from "../ui/RadialMenu";
import ContextMenu from "../ui/ContextMenu";
import QuickAddMenu from "../ui/QuickAddMenu.jsx";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { X, Trash2, Copy, FileText, Layout, Paintbrush, Monitor } from "lucide-react";

import Container from "./Container.jsx";
import Artifact from "./Artifact.jsx";
import { DocEditorShell } from "./DocContent.jsx";

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
};

function Page({
  occurrence,
  panelId,
  panelOccurrence,
  dispatch,
  socket,
  addInstanceToContainer,
}) {
  const { occurrencesById, modulesById, containersById, viewsById } = useContext(GridActionsContext);
  const { state } = useContext(GridDataContext);
  const { isMobile } = useContext(GridLiveContext);

  const pageModule = occurrence?.targetId ? modulesById[occurrence.targetId] : null;
  const pageView = occurrence?.viewId ? viewsById[occurrence.viewId] : null;
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

  // Delete page
  const handleDelete = useCallback(() => {
    if (!occurrence?.id || !panelOccurrence?.id) return;
    CommitHelpers.deletePage({ dispatch, socket, pageOccurrenceId: occurrence.id, panelOccurrenceId: panelOccurrence.id, emit: true });
  }, [occurrence, panelOccurrence, dispatch, socket]);

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
          padding: isMobile ? "6px 28px 80px 28px" : "0px 5px 80px 5px",
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

      {/* Page header row — handle centered, name below for non-doc */}
      <div
        style={{
          position: "relative",
          flexShrink: 0,
          width: "100%",
          display: "flex",
          alignItems: "start",
          flexDirection: "row",
          justifyContent: "end"
        }}
      >
        {/* Handle — centered horizontally */}
        <div style={{
          position: "absolute",
          top: "3px",
          left: "calc(50% - 8.88px)",
          display: "flex",
          justifyContent: "end"
        }}>
          <div
            ref={handleRef}
            className="module-drag-handle module-grab-zone"
            draggable={false}
            style={{ position: "relative", top: 0, left: "auto", transform: "none", flexShrink: 0 }}
          >
            <div className="drag-handle-ball" />
            <div className="drag-handle-stem" />
            <RadialMenu
              onSettings={() => setSettingsOpen(true)}
              size="sm"
              forceDirection="down"
            />
          </div>
        </div>
        {(
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 10px 2px 12px" }}>
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
