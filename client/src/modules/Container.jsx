// modules/Container.jsx
// Extracted from Module.jsx ModuleContainer component.
// Renders a container header and its instances.
// Handles doc containers, focused instance view, list view, sorting.

import React, { useRef, useMemo, useState, useCallback, useEffect, useContext } from "react";
import { createPortal } from "react-dom";
import RadialMenu from "../ui/RadialMenu";
import LocalIterationNav from "../ui/LocalIterationNav";
import { toast } from "sonner";
import ContextMenu from "../ui/ContextMenu";
import ContainerForm from "../ui/ContainerForm";
import TransactionHistory from "../ui/TransactionHistory";
import { Popover, PopoverTrigger, PopoverContent, PopoverAnchor } from "@/components/ui/popover";

import { GridActionsContext } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import {
  getContainerItems,
  getContainerItemsWithOccurrences,
} from "../helpers/LayoutHelpers";
import {
  useDragDrop,
  useDroppable,
  useDragContext,
  DragType,
  DropAccepts,
} from "../helpers/dragSystem";
import { resolveContainerStyle, styleToCSS } from "../helpers/StyleHelpers";
import { hexToRgba } from "../helpers/colorHelpers.js";
import { resolveEffectiveFilters, isOccurrenceVisible } from "../state/selectors";

import {
  ChevronRight,
  Copy,
  Link2,
  Unlink,
  Trash2,
  BookMarked,
  ArrowLeft,
  Search,
  Plus,
  X,
} from "lucide-react";

import Instance from "./Instance.jsx";
import { DocEditorShell, PoolPill, CanvasCard } from "./containerHelpers.jsx";
import { FilterOverridePopup, TemplatePickerPopup } from "./containerPopups.jsx";
import ModuleInstance from "./ModuleInstance.jsx";
import QuickAddMenu from "../ui/QuickAddMenu.jsx";

// ============================================================
// HELPERS
// ============================================================

// Blend hex color toward white by amount (0=original, 1=white)
function lightenHex(hex, amount) {
  if (!hex || !hex.startsWith("#") || hex.length < 7) return "#ffffff";
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `rgb(${lr},${lg},${lb})`;
}

// ============================================================
// CONTAINER COMPONENT
// ============================================================
function Container({
  module,
  panel,
  panelId,
  panelLayoutOrientation = "vertical",
  addInstanceToContainer,
  dispatch,
  socket,
  gapPx = 12,
  onInstanceFocus,
  embedded = false,
  occurrenceOverride = null,
}) {
  const { occurrencesById, instancesById, viewsById, state: ctxState } = useContext(GridActionsContext);
  const dragCtx = useDragContext();
  const { isContainerDrag, isInstanceDrag, isExternalDrag, isPanelDrag } = dragCtx;

  const [draft, setDraft] = useState(() => ({ label: module.label ?? "" }));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [focusedStack, setFocusedStack] = useState([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [isBodyCollapsed, setIsBodyCollapsed] = useState(false);
  const [showHeader, setShowHeader] = useState(true);
  const [poolSearch, setPoolSearch] = useState("");
  const [poolAddLabel, setPoolAddLabel] = useState("");
  const [isPoolAdding, setIsPoolAdding] = useState(false);
  const [showEmbeddedIterNav, setShowEmbeddedIterNav] = useState(false);
  const [filterPopupPos, setFilterPopupPos] = useState(null);
  const [templatePopupPos, setTemplatePopupPos] = useState(null);
  const containerHandleRef = useRef(null);
  const containerDragMode = module?.defaultDragMode || "move";
  const focusedItem = focusedStack[focusedStack.length - 1] || null;

  const handleInstanceFocusLocal = useCallback((instance, occurrence) => {
    setFocusedStack([{ instance, occurrence }]);
    setHistoryExpanded(false);
  }, []);

  useEffect(() => {
    setDraft({ label: module.label ?? "" });
  }, [module.id, module.label]);

  // CS6a — Scoped custom CSS injection
  useEffect(() => {
    if (!module?.customCss || !module?.id) return;
    const styleId = `mod-css-${module.id}`;
    let tag = document.getElementById(styleId);
    if (!tag) { tag = document.createElement("style"); tag.id = styleId; document.head.appendChild(tag); }
    tag.textContent = `.mod-${module.id} { ${module.customCss} }`;
    return () => { document.getElementById(styleId)?.remove(); };
  }, [module?.customCss, module?.id]);

  const onAdd = useCallback(() => addInstanceToContainer(module.id), [addInstanceToContainer, module.id]);

  const commitLabel = useCallback(() => {
    const next = (draft?.label ?? "").trim();
    if (!next) return;
    CommitHelpers.updateModule({ dispatch, socket, module: { ...module, label: next }, emit: true });
  }, [draft?.label, module, dispatch, socket]);

  const deleteMe = useCallback(() => {
    CommitHelpers.deleteModule({ dispatch, socket, moduleId: module.id, emit: true });
  }, [module.id, dispatch, socket]);

  const commitIteration = useCallback((nextIteration) => {
    CommitHelpers.updateModule({ dispatch, socket, module: { ...module, iteration: nextIteration }, emit: true });
  }, [module, dispatch, socket]);

  const commitDragMode = useCallback((nextMode) => {
    CommitHelpers.updateModule({ dispatch, socket, module: { ...module, defaultDragMode: nextMode }, emit: true });
  }, [module, dispatch, socket]);

  const containerOccurrence = useMemo(() => {
    if (occurrenceOverride) return occurrencesById[occurrenceOverride.id] || occurrenceOverride;
    return Object.values(occurrencesById).find(occ => occ.targetId === module.id);
  }, [occurrenceOverride, occurrencesById, module.id]);

  // Quick-add: create an occurrence of an existing instance module in this container
  const handleQuickAddInstance = useCallback((instanceModule) => {
    if (!containerOccurrence || !instanceModule?.id) return;
    const occId = crypto.randomUUID();
    const occ = {
      id: occId,
      userId: module.userId,
      gridId: module.gridId,
      targetId: instanceModule.id,
      targetType: "module",
      iteration: { mode: "persistent" },
      fields: {},
    };
    CommitHelpers.createOccurrence({ dispatch, socket, occurrence: occ, emit: true });
    const updatedOccs = [...(containerOccurrence.occurrences || []), occId];
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: containerOccurrence.id, occurrences: updatedOccs }, emit: true });
  }, [containerOccurrence, module, dispatch, socket]);

  const handleConvertListToInstances = useCallback(async (texts) => {
    if (!texts?.length) return;
    const { grid } = ctxState || {};
    const userId = ctxState?.userId;
    const gridId = grid?._id;
    if (!userId || !gridId) return;
    for (const text of texts) {
      CommitHelpers.createModule({ dispatch, socket, module: { role: "instance", kind: "list", label: text, userId, gridId, fieldBindings: [], iteration: { mode: "persistent" } }, emit: true });
    }
    toast.success(`${texts.length} instance${texts.length > 1 ? "s" : ""} created — drag from toolbar`);
  }, [ctxState, dispatch, socket]);

  const commitOccurrenceUpdate = useCallback((updates) => {
    if (!containerOccurrence?.id) return;
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: containerOccurrence.id, ...updates }, emit: true });
  }, [containerOccurrence, dispatch, socket]);

  const resolvedContainerCSS = useMemo(
    () => styleToCSS(resolveContainerStyle(module, panel)),
    [module, panel]
  );

  // Embedded doc card styles — used when this container is rendered inside Artifact.jsx (not a panel child)
  const rawColor = embedded ? (module?.ownStyle?.bg || null) : null;
  // Text: lighten the raw color 70% toward white for bright readable labels
  const embeddedAccent = rawColor ? lightenHex(rawColor, 0.7) : "#b0f8da";
  const embeddedCardStyle = embedded ? {
    background: hexToRgba(rawColor, 0.18) ?? "rgba(14,61,50,0.35)",
    border: `1px solid ${hexToRgba(rawColor, 0.5) ?? "rgba(14,61,50,0.65)"}`,
    borderRadius: 6,
  } : {};
  const embeddedHeaderStyle = embedded ? {
    background: hexToRgba(rawColor, 0.42) ?? "rgba(14,61,50,0.6)",
    borderBottom: `1px solid ${hexToRgba(rawColor, 0.55) ?? "rgba(14,61,50,0.7)"}`,
  } : {};

  const commitContainerStyleUpdate = useCallback((updates) => {
    CommitHelpers.updateModule({ dispatch, socket, module: { ...module, ...updates }, emit: true });
  }, [module, dispatch, socket]);

  const ctxGrid = ctxState?.grid;
  const gridTemplates = useMemo(() => ctxGrid?.templates || [], [ctxGrid?.templates]);

  const handleSaveAsTemplate = useCallback(() => {
    const gridId = ctxGrid?._id;
    if (!gridId) return;
    // Occurrence owns all ordering — no module.occurrences fallback
    const orderedIds = containerOccurrence?.occurrences || [];
    const items = orderedIds.map(occId => {
      const occ = occurrencesById[occId];
      if (!occ) return null;
      return { instanceId: occ.targetId, fieldDefaults: occ.fields || {}, ...(occ.linkedGroupId ? { linkedGroupId: occ.linkedGroupId } : {}) };
    }).filter(Boolean);
    const templateName = window.prompt("Template name:", module.label || "Template");
    if (!templateName) return;
    CommitHelpers.saveTemplate({ socket, gridId, template: { id: crypto.randomUUID(), name: templateName, items, createdAt: new Date() } });
  }, [module, occurrencesById, ctxGrid, socket]);

  const handleFillFromTemplate = useCallback((templateId) => {
    const gridId = ctxGrid?._id;
    if (!gridId) return;
    CommitHelpers.fillFromTemplate({ socket, gridId, templateId, containerId: module.id });
  }, [ctxGrid, module.id, socket]);

  const containerAllowedEdges = useMemo(() => ["top", "bottom", "left", "right"], []);

  const containerWithInstances = useMemo(() => {
    const instanceObjects = getContainerItems(module, occurrencesById, instancesById);
    return { ...module, instanceObjects };
  }, [module, occurrencesById, instancesById]);

  const { ref: containerRef, isDragging, isOver: isContainerOver, closestEdge, props: containerProps } = useDragDrop({
    type: DragType.CONTAINER,
    id: module.id,
    data: containerWithInstances,
    context: { panelId, containerId: module.id },
    disabled: isInstanceDrag || isExternalDrag,
    accepts: [DragType.CONTAINER],
    allowedEdges: containerAllowedEdges,
    dragHandleRef: containerHandleRef,
  });

  const { ref: headerDropRef, isOver: isHeaderOver } = useDroppable({
    type: "container-header",
    id: `container-header:${module.id}`,
    context: { panelId, containerId: module.id, insertAt: 0 },
    accepts: DropAccepts.CONTAINER_LIST,
    disabled: isContainerDrag,
  });

  const { ref: listDropRef, isOver: isListOver } = useDroppable({
    type: "container-list",
    id: `container-list:${module.id}`,
    context: { panelId, containerId: module.id },
    accepts: DropAccepts.CONTAINER_LIST,
    disabled: isContainerDrag,
  });

  // Occurrence controls order — pass containerOccurrence so ordering reads from occurrence.occurrences
  const allItemsWithOccurrences = useMemo(
    () => getContainerItemsWithOccurrences(module, occurrencesById, instancesById, undefined, containerOccurrence),
    [module, occurrencesById, instancesById, containerOccurrence]
  );

  // Apply active filter: hide occurrences that don't match the effective filter values
  const effectiveFilters = useMemo(
    () => resolveEffectiveFilters(containerOccurrence, ctxState?.grid?.activeFilterValues || {}),
    [containerOccurrence, ctxState?.grid?.activeFilterValues]
  );

  const itemsWithOccurrences = useMemo(
    () => allItemsWithOccurrences.filter(item => isOccurrenceVisible(item.occurrence, effectiveFilters)),
    [allItemsWithOccurrences, effectiveFilters]
  );

  const items = useMemo(() => itemsWithOccurrences.map(item => item.instance), [itemsWithOccurrences]);

  const toggleContainerDragModeQuick = useCallback(() => {
    const nextMode = containerDragMode === "move" ? "copy" : "move";
    CommitHelpers.updateModule({ dispatch, socket, module: { ...module, defaultDragMode: nextMode }, emit: true });
  }, [module, containerDragMode, dispatch, socket]);

  // Rendering type comes from view.viewType (occurrence.viewId → View), never from module.kind
  const containerViewType = containerOccurrence?.viewId ? (viewsById?.[containerOccurrence.viewId]?.viewType ?? null) : null;
  const isDocContainer = containerViewType === "doc" || (!containerViewType && module?.kind === "doc");
  const isPoolContainer = containerViewType === "pool" || (!containerViewType && module?.kind === "pool");
  const isCanvasContainer = containerViewType === "canvas" || (!containerViewType && module?.kind === "canvas");

  const handlePoolAdd = useCallback(() => {
    const label = poolAddLabel.trim();
    if (!label) return;
    const { grid } = ctxState || {};
    const userId = ctxState?.userId;
    const gridId = grid?._id;
    if (!userId || !gridId) return;
    const instanceId = crypto.randomUUID();
    CommitHelpers.createInstanceInContainer({
      dispatch, socket,
      containerId: module.id,
      instance: { id: instanceId, role: "instance", kind: "list", label, userId, gridId, fieldBindings: [] },
      emit: true,
    });
    setPoolAddLabel("");
    setIsPoolAdding(false);
  }, [poolAddLabel, ctxState, dispatch, socket, module.id]);

  return (
    <div
      ref={containerRef}
      data-container-id={module.id}
      data-testid="container-shell"
      className={`container-shell bg-background2 rounded-md border border-border shadow-inner mod-${module.id}`}
      style={{
        display: "flex", flexDirection: "column", minHeight: 0, overflow: "visible",
        borderRadius: 10,
        pointerEvents: (isDragging || isPanelDrag) ? "none" : "auto",
        position: "relative", zIndex: isDragging ? 0 : 1,
        opacity: isDragging ? 0.4 : 1,
        transition: "opacity 0.15s",
        ...(embedded ? embeddedCardStyle : resolvedContainerCSS),
      }}
      {...containerProps}
    >
      {/* Drop Indicators */}
      {isContainerOver && closestEdge === "top" && <div className="drop-indicator drop-indicator-top" />}
      {isContainerOver && closestEdge === "bottom" && <div className="drop-indicator drop-indicator-bottom" />}
      {isContainerOver && closestEdge === "left" && <div className="drop-indicator drop-indicator-left" />}
      {isContainerOver && closestEdge === "right" && <div className="drop-indicator drop-indicator-right" />}

      <ContextMenu ctx={ctxMenu} onClose={() => setCtxMenu(null)} />

      {/* COG HANDLE — shown when header hidden, acts as drag handle */}
      {!showHeader && (
        <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
          <PopoverAnchor asChild>
            <div ref={containerHandleRef} className="container-cog-handle module-handle module-grab-zone">
              <span className="module-dot" />
              <RadialMenu
                dragMode={containerDragMode}
                onToggleDragMode={toggleContainerDragModeQuick}
                onSettings={() => setSettingsOpen(true)}
                onAddChild={onAdd}
                addLabel="Item"
                size="sm"
                onToggleCollapse={isDocContainer ? () => setIsBodyCollapsed(v => !v) : null}
                isCollapsed={isBodyCollapsed}
                onToggleHeader={() => setShowHeader(true)}
                showHeader={false}
                onHistory={() => setHistoryOpen(true)}
              />
            </div>
          </PopoverAnchor>
          <PopoverContent align="start" side="right" collisionPadding={8} className="w-auto p-0">
            <ContainerForm
              value={draft}
              onChange={setDraft}
              onCommitLabel={commitLabel}
              onDeleteContainer={deleteMe}
              containerId={module.id}
              container={module}
              onContainerUpdate={commitContainerStyleUpdate}
              iteration={module.iteration}
              onIterationChange={commitIteration}
              defaultDragMode={module.defaultDragMode}
              onDragModeChange={commitDragMode}
              occurrence={containerOccurrence}
              onOccurrenceUpdate={commitOccurrenceUpdate}
              onSaveAsTemplate={handleSaveAsTemplate}
              onFillFromTemplate={handleFillFromTemplate}
              templates={gridTemplates}
            />
          </PopoverContent>
        </Popover>
      )}

      {/* HEADER */}
      {showHeader && (
      <div
        ref={headerDropRef}
        className={`container-header module-header-row no-select ${embedded ? "embedded-container-header" : "border-b border-gray-700 border-solid"}`}
        style={embedded
          ? { padding: "0", alignItems: "stretch", flexDirection: "column", ...embeddedHeaderStyle }
          : { height: "20px" }
        }
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setCtxMenu({
            x: e.clientX, y: e.clientY,
            items: [
              {
                label: "Copy container", icon: Copy, onClick: () => {
                  const newM = { ...module, id: crypto.randomUUID(), label: `${module.label} (Copy)` };
                  CommitHelpers.createModule({ dispatch, socket, module: newM, emit: true });
                }
              },
              containerOccurrence?.linkedGroupId && {
                label: "Break link",
                icon: Unlink,
                onClick: () => CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { ...containerOccurrence, linkedGroupId: null }, emit: true }),
              },
              { label: "Save as Template", icon: BookMarked, onClick: handleSaveAsTemplate },
              { separator: true },
              { label: "Delete container", icon: Trash2, danger: true, onClick: deleteMe },
            ].filter(Boolean),
          });
        }}
      >
        {embedded ? (
          /* Embedded: two-row layout — icon row + label row */
          <>
            {/* Row 1: radial handle (left) + link icon (right) */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0px 4px 0px 2px", minHeight: 16 }}>
              <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
                <PopoverAnchor asChild>
                  <div ref={containerHandleRef} className="module-handle module-grab-zone" style={{ minWidth: 14, maxWidth: 18 }}>
                    <span className="module-dot" />
                    <RadialMenu
                      dragMode={containerDragMode}
                      onToggleDragMode={toggleContainerDragModeQuick}
                      onSettings={() => setSettingsOpen(true)}
                      onAddChild={onAdd}
                      addLabel="Item"
                      size="sm"
                      onToggleCollapse={isDocContainer ? () => setIsBodyCollapsed(v => !v) : null}
                      isCollapsed={isBodyCollapsed}
                      onToggleHeader={() => setShowHeader(false)}
                      showHeader={showHeader}
                      onHistory={() => setHistoryOpen(true)}
                    />
                  </div>
                </PopoverAnchor>
                <PopoverContent align="start" side="right" collisionPadding={8} className="w-auto p-0">
                  <ContainerForm
                    value={draft}
                    onChange={setDraft}
                    onCommitLabel={commitLabel}
                    onDeleteContainer={deleteMe}
                    containerId={module.id}
                    container={module}
                    onContainerUpdate={commitContainerStyleUpdate}
                    iteration={module.iteration}
                    onIterationChange={commitIteration}
                    defaultDragMode={module.defaultDragMode}
                    onDragModeChange={commitDragMode}
                    occurrence={containerOccurrence}
                    onOccurrenceUpdate={commitOccurrenceUpdate}
                    onSaveAsTemplate={handleSaveAsTemplate}
                    onFillFromTemplate={handleFillFromTemplate}
                    templates={gridTemplates}
                  />
                </PopoverContent>
              </Popover>
              <div onPointerDown={(e) => e.stopPropagation()}>
                <LocalIterationNav
                  occurrence={containerOccurrence}
                  onUpdate={commitOccurrenceUpdate}
                  showModeToggle={true}
                  compact={true}
                  collapsible={true}
                />
              </div>
            </div>
            {/* Row 2: label */}
            <div style={{ padding: "0px 8px 3px 12px", display: "flex", alignItems: "baseline", gap: 4 }}>
              <span className="embedded-hash" style={{ fontSize: 12, color: embeddedAccent, flexShrink: 0, fontFamily: "var(--font-mono)" }}>#</span>
              <span
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) => {
                  const next = e.currentTarget.textContent.trim();
                  if (next && next !== module.label) {
                    CommitHelpers.updateModule({ dispatch, socket, module: { ...module, label: next }, emit: true });
                  } else {
                    e.currentTarget.textContent = module.label || "Container";
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
                  e.stopPropagation();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                style={{ outline: "none", cursor: "text", fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 600, color: embeddedAccent, lineHeight: 1.3, wordBreak: "break-word", flex: 1 }}
              >
                {module.label || "Container"}
              </span>
            </div>
          </>
        ) : (
          /* Standard single-row layout */
          <>
            <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
              <PopoverAnchor asChild>
                <div ref={containerHandleRef} className="module-handle module-grab-zone">
                  <span className="module-dot" />
                  <RadialMenu
                    dragMode={containerDragMode}
                    onToggleDragMode={toggleContainerDragModeQuick}
                    onSettings={() => setSettingsOpen(true)}
                    onAddChild={onAdd}
                    addLabel="Item"
                    size="sm"
                    onToggleCollapse={isDocContainer ? () => setIsBodyCollapsed(v => !v) : null}
                    isCollapsed={isBodyCollapsed}
                    onToggleHeader={() => setShowHeader(false)}
                    showHeader={showHeader}
                    onFilter={(e) => setFilterPopupPos({ x: e?.clientX ?? 100, y: e?.clientY ?? 100 })}
                    onTemplate={gridTemplates.length > 0 ? (e) => setTemplatePopupPos({ x: e?.clientX ?? 100, y: e?.clientY ?? 100 }) : null}
                    onHistory={() => setHistoryOpen(true)}
                  />
                </div>
              </PopoverAnchor>
              <PopoverContent align="start" side="right" collisionPadding={8} className="w-auto p-0">
                <ContainerForm
                  value={draft}
                  onChange={setDraft}
                  onCommitLabel={commitLabel}
                  onDeleteContainer={deleteMe}
                  containerId={module.id}
                  container={module}
                  onContainerUpdate={commitContainerStyleUpdate}
                  iteration={module.iteration}
                  onIterationChange={commitIteration}
                  defaultDragMode={module.defaultDragMode}
                  onDragModeChange={commitDragMode}
                  occurrence={containerOccurrence}
                  onOccurrenceUpdate={commitOccurrenceUpdate}
                  onSaveAsTemplate={handleSaveAsTemplate}
                  onFillFromTemplate={handleFillFromTemplate}
                  templates={gridTemplates}
                />
              </PopoverContent>
            </Popover>

            <span className="truncate pl-1" style={{ fontSize: "0.75rem", fontWeight: 500 }}>
              {module.label || "Container"}
              {containerOccurrence?.linkedGroupId && (
                <Link2 className="w-3 h-3 text-blue-400 opacity-60 flex-shrink-0 inline ml-1" title="Linked" />
              )}
            </span>

            <div onPointerDown={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
              <QuickAddMenu
                targetRole="instance"
                onSelect={handleQuickAddInstance}
                onCreateNew={onAdd}
                createLabel="New instance"
              />
            </div>

            <div className="ml-auto mr-1" style={{ flexShrink: 0 }} onPointerDown={(e) => e.stopPropagation()}>
              <LocalIterationNav
                occurrence={containerOccurrence}
                onUpdate={commitOccurrenceUpdate}
                showModeToggle={true}
                compact={true}
              />
            </div>
          </>
        )}

        {isHeaderOver && (isInstanceDrag || isExternalDrag) && items.length > 0 && (
          <div className="drop-indicator drop-indicator-insert" style={{ left: 4, right: 4 }} />
        )}
      </div>
      )}

      {/* Collapse lip — sits between header and body */}
      {showHeader && (
        <div
          className="collapse-lip"
          onClick={() => setIsBodyCollapsed(v => !v)}
          title={isBodyCollapsed ? "Expand" : "Collapse"}
        />
      )}

      {/* CONTENT AREA */}
      {!isBodyCollapsed && (isPoolContainer ? (
        /* Pool Container: draggable pills grid */
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          {/* Pool toolbar: search + add */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 6px", borderBottom: "1px solid var(--border-subtle)" }}>
            <div style={{ display: "flex", alignItems: "center", flex: 1, gap: 4, background: "var(--input-bg)", borderRadius: 6, padding: "2px 6px", border: "1px solid var(--input-border)" }}>
              <Search size={10} style={{ opacity: 0.4, flexShrink: 0 }} />
              <input
                value={poolSearch}
                onChange={e => setPoolSearch(e.target.value)}
                placeholder="search…"
                style={{ background: "none", border: "none", outline: "none", fontSize: 10, color: "var(--text-primary)", fontFamily: "var(--font-mono)", flex: 1, minWidth: 0 }}
                onPointerDown={e => e.stopPropagation()}
              />
              {poolSearch && (
                <button onClick={() => setPoolSearch("")} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--text-muted)" }}>
                  <X size={9} />
                </button>
              )}
            </div>
            {isPoolAdding ? (
              <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <input
                  autoFocus
                  value={poolAddLabel}
                  onChange={e => setPoolAddLabel(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") handlePoolAdd();
                    if (e.key === "Escape") { setIsPoolAdding(false); setPoolAddLabel(""); }
                    e.stopPropagation();
                  }}
                  placeholder="new item…"
                  style={{ fontSize: 10, fontFamily: "var(--font-mono)", background: "var(--input-bg)", border: "1px solid rgba(99,102,241,0.4)", borderRadius: 5, padding: "2px 6px", color: "var(--text-primary)", outline: "none", width: 100 }}
                  onPointerDown={e => e.stopPropagation()}
                />
                <button onClick={handlePoolAdd} style={{ background: "rgba(99,102,241,0.3)", border: "1px solid rgba(99,102,241,0.5)", borderRadius: 4, cursor: "pointer", padding: "2px 5px", color: "rgba(180,190,255,0.9)", fontSize: 10 }}>Add</button>
                <button onClick={() => { setIsPoolAdding(false); setPoolAddLabel(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}><X size={10} /></button>
              </div>
            ) : (
              <button
                onClick={() => setIsPoolAdding(true)}
                onPointerDown={e => e.stopPropagation()}
                style={{ display: "flex", alignItems: "center", gap: 3, background: "rgba(99,102,241,0.18)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 5, padding: "3px 7px", cursor: "pointer", color: "rgba(180,190,255,0.85)", fontSize: 10, fontFamily: "var(--font-mono)", flexShrink: 0 }}
              >
                <Plus size={9} /> Add
              </button>
            )}
          </div>
          {/* Pool pills body */}
          <div ref={listDropRef} style={{ flex: 1, overflow: "auto", padding: "6px 6px", display: "flex", flexWrap: "wrap", alignContent: "flex-start", gap: 5 }}>
            {itemsWithOccurrences
              .filter(({ instance }) => !poolSearch || (instance.label || "").toLowerCase().includes(poolSearch.toLowerCase()))
              .map(({ instance, occurrence: occ }) => (
                <PoolPill
                  key={occ.id}
                  instanceModule={instance}
                  occurrence={occ}
                  onDelete={() => occ?.id && CommitHelpers.deleteOccurrence({ dispatch, socket, occurrenceId: occ.id })}
                />
              ))}
            {itemsWithOccurrences.length === 0 && (
              <div style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "var(--font-mono)", padding: "8px 4px", width: "100%" }}>
                Empty pool — add items or drag here
              </div>
            )}
          </div>
        </div>
      ) : isDocContainer ? (
        <div ref={listDropRef} className="container-doc" style={{ flex: 1, minHeight: 100, overflow: "auto", position: "relative" }}>
          <DocEditorShell
            occurrence={containerOccurrence}
            dispatch={dispatch}
            socket={socket}
            onConvertListToInstances={handleConvertListToInstances}
            hideToolbar={embedded}
          />
        </div>
      ) : isCanvasContainer ? (
        /* Canvas Container: free-form spatial layout */
        <div
          ref={listDropRef}
          style={{ flex: 1, position: "relative", overflow: "hidden", background: "var(--surface-overlay)", minHeight: 200,
            backgroundImage: "radial-gradient(circle, var(--border-subtle) 1px, transparent 1px)",
            backgroundSize: "24px 24px" }}
          onDoubleClick={(e) => {
            if (e.target !== e.currentTarget) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = Math.round(e.clientX - rect.left);
            const y = Math.round(e.clientY - rect.top);
            const { grid } = ctxState || {};
            const userId = ctxState?.userId;
            const gridId = grid?._id;
            if (!userId || !gridId) return;
            const instanceId = crypto.randomUUID();
            CommitHelpers.createInstanceInContainer({
              dispatch, socket,
              containerId: module.id,
              instance: { id: instanceId, role: "instance", kind: "list", label: "New card", userId, gridId, fieldBindings: [] },
              initialMeta: { x, y },
              emit: true,
            });
          }}
        >
          {itemsWithOccurrences.map(({ instance, occurrence: occ }) => (
            <CanvasCard
              key={occ.id}
              instance={instance}
              occurrence={occ}
              dispatch={dispatch}
              socket={socket}
              container={module}
              panel={panel}
            />
          ))}
          {itemsWithOccurrences.length === 0 && (
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-mono)", pointerEvents: "none" }}>
              Double-click to add cards
            </div>
          )}
        </div>
      ) : focusedItem ? (() => {
        const { instance: fi, occurrence: fo } = focusedItem;

        const extractDocText = (node, maxLen = 200) => {
          if (!node) return "";
          if (node.type === "text") return node.text || "";
          if (node.content) return node.content.map(n => extractDocText(n)).join(" ").slice(0, maxLen);
          return "";
        };

        const siblingInstances = (fi?.siblingLinks || []).map(id => instancesById[id]).filter(Boolean);
        const allOccurrences = Object.values(occurrencesById);
        const getOccDate = (occ) => occ?.meta?.date || occ?.updatedAt || occ?.createdAt || "";
        const foTimeStr = String(getOccDate(fo)).slice(0, 10);

        const getSiblingOcc = (sibId) => {
          const sibs = allOccurrences.filter(o => o.targetId === sibId);
          if (foTimeStr) {
            const matched = sibs.find(o => String(getOccDate(o)).slice(0, 10) === foTimeStr);
            if (matched) return matched;
          }
          return sibs.sort((a, b) =>
            new Date(getOccDate(b)) - new Date(getOccDate(a))
          )[0] || null;
        };

        const historyOccs = allOccurrences
          .filter(o => o.targetId === fi.id && o.id !== fo?.id)
          .sort((a, b) => new Date(getOccDate(b)) - new Date(getOccDate(a)));

        const formatHistoryDate = (occ) => {
          const t = getOccDate(occ);
          if (!t) return "No date";
          return new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
        };

        return (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
            {/* Breadcrumb */}
            <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border/30 flex-wrap bg-muted/20 shrink-0">
              <button
                className="p-0.5 rounded hover:bg-muted text-muted-foreground"
                onClick={() => { setFocusedStack([]); setHistoryExpanded(false); }}
                title="Back to list"
              >
                <ArrowLeft className="w-3 h-3" />
              </button>
              {focusedStack.map((item, idx) => (
                <React.Fragment key={item.occurrence?.id || item.instance.id}>
                  <ChevronRight className="w-2.5 h-2.5 text-muted-foreground/30 shrink-0" />
                  <button
                    className={`text-[10px] px-1 py-0.5 rounded ${idx === focusedStack.length - 1 ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}
                    onClick={() => { setFocusedStack(s => s.slice(0, idx + 1)); setHistoryExpanded(false); }}
                  >
                    {item.instance.label || "…"}
                  </button>
                </React.Fragment>
              ))}
            </div>

            {/* Scrollable body */}
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
              {/* PRIMARY DOC */}
              <div className="shrink-0" style={{ minHeight: 120 }}>
                <div className="px-2 pt-2 pb-0.5 flex items-center gap-1">
                  <span className="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-wide">{fi.label || "Note"}</span>
                </div>
                <DocEditorShell occurrence={fo} dispatch={dispatch} socket={socket} />
              </div>

              {/* LINKED SIBLINGS */}
              {siblingInstances.map(sib => {
                const sibOcc = getSiblingOcc(sib.id);
                return (
                  <div key={sib.id} className="border-t border-border/30 shrink-0" style={{ minHeight: 100 }}>
                    <div className="px-2 pt-1.5 pb-0.5 flex items-center gap-1">
                      <span className="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-wide">{sib.label || "Linked"}</span>
                      <button
                        className="ml-auto text-[9px] text-muted-foreground/40 hover:text-muted-foreground px-1"
                        onClick={() => { if (sibOcc) handleInstanceFocusLocal(sib, sibOcc); }}
                        title="Drill into linked item"
                      >↗</button>
                    </div>
                    {sibOcc ? (
                      <DocEditorShell occurrence={sibOcc} dispatch={dispatch} socket={socket} />
                    ) : (
                      <div className="px-2 pb-2 text-[10px] text-muted-foreground/40 italic">No entry for this period</div>
                    )}
                  </div>
                );
              })}

              {/* CHILD INSTANCES (recursive drill-down) */}
              {(fi.childInstanceIds || []).length > 0 && (() => {
                const childInstances = (fi.childInstanceIds || []).map(cid => instancesById[cid]).filter(Boolean);
                if (childInstances.length === 0) return null;
                return (
                  <div className="border-t border-border/30 shrink-0">
                    <div className="px-2 pt-1.5 pb-0.5 flex items-center gap-1">
                      <span className="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-wide">Sub-items ({childInstances.length})</span>
                    </div>
                    {childInstances.map(child => {
                      const childOccs = allOccurrences.filter(o => o.targetId === child.id);
                      let childOcc = foTimeStr
                        ? childOccs.find(o => String(getOccDate(o)).slice(0, 10) === foTimeStr)
                        : null;
                      if (!childOcc) {
                        childOcc = childOccs.sort((a, b) =>
                          new Date(getOccDate(b)) - new Date(getOccDate(a))
                        )[0] || null;
                      }
                      return (
                        <div key={child.id} className="border-t border-border/20 flex items-center gap-1 px-2 py-1.5 hover:bg-muted/10">
                          <span className="text-[10px] text-foreground/70 flex-1 truncate">{child.label || "Untitled"}</span>
                          <button
                            className="text-[9px] text-muted-foreground/40 hover:text-muted-foreground px-1 flex-shrink-0"
                            onClick={() => { if (childOcc) setFocusedStack(s => [...s, { instance: child, occurrence: childOcc }]); }}
                            title={childOcc ? "Drill into sub-item" : "No occurrence found"}
                            disabled={!childOcc}
                          >↗</button>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* HISTORY */}
              <div className="border-t border-border/40 shrink-0">
                <button
                  className="w-full flex items-center gap-1 px-2 py-1.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors"
                  onClick={() => setHistoryExpanded(h => !h)}
                >
                  <ChevronRight className={`w-3 h-3 transition-transform ${historyExpanded ? "rotate-90" : ""}`} />
                  <span>History</span>
                  {historyOccs.length > 0 && <span className="ml-auto text-muted-foreground/50">{historyOccs.length} entries</span>}
                </button>
                {historyExpanded && (
                  <div className="divide-y divide-border/20">
                    {historyOccs.length === 0 ? (
                      <div className="px-3 py-2 text-[10px] text-muted-foreground/50 italic">No history yet</div>
                    ) : historyOccs.map(hOcc => {
                      const dateLabel = formatHistoryDate(hOcc);
                      const selfPreview = extractDocText(hOcc.textmap, 120).trim();
                      const hTimeStr = String(getOccDate(hOcc)).slice(0, 10);
                      const siblingPreviews = siblingInstances.map(sib => {
                        const sibHOcc = allOccurrences.find(o =>
                          o.targetId === sib.id &&
                          String(getOccDate(o)).slice(0, 10) === hTimeStr
                        );
                        return { sib, text: extractDocText(sibHOcc?.textmap, 120).trim() };
                      }).filter(s => s.text);
                      return (
                        <div key={hOcc.id} className="px-3 py-2 hover:bg-muted/20">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-[10px] font-medium text-foreground/70">{dateLabel}</span>
                          </div>
                          {selfPreview
                            ? <p className="text-[10px] text-muted-foreground leading-relaxed mb-0.5">{selfPreview}</p>
                            : <p className="text-[10px] text-muted-foreground/30 italic">No content</p>
                          }
                          {siblingPreviews.map(({ sib, text }) => (
                            <div key={sib.id} className="mt-0.5 pl-2 border-l border-border/30">
                              <span className="text-[9px] text-muted-foreground/50">{sib.label}: </span>
                              <span className="text-[10px] text-muted-foreground/70">{text}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })() : (
        /* List Container */
        <div
          ref={listDropRef}
          className="container-list"
          style={{
            flex: items.length === 0 ? 1 : "0 0 auto",
            minHeight: items.length === 0 ? 40 : "fit-content",
            overflow: "auto", padding: 0,
            display: "flex", flexDirection: "column", position: "relative",
          }}
        >
          <div
            role="list"
            aria-label={`${module.label || "Container"} items`}
            style={{ padding: "5px", flex: 1, display: "flex", flexDirection: "column" }}
          >
            {itemsWithOccurrences.map(({ instance, occurrence }) => (
              <ModuleInstance
                key={occurrence.id}
                module={instance}
                occurrence={occurrence}
                containerId={module.id}
                panelId={panelId}
                panel={panel}
                container={module}
                dispatch={dispatch}
                socket={socket}
                allowedEdges={containerAllowedEdges}
                onInstanceFocus={null}
              />
            ))}
            {items.length === 0 && (
              <div className="text-xs text-muted-foreground p-2 text-center empty-placeholder-inline">
                Drop items here
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Gap hitbox */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: gapPx, marginBottom: -gapPx, pointerEvents: "auto", zIndex: 2 }} />

      {/* Filter override quick-popup */}
      {filterPopupPos && createPortal(
        <FilterOverridePopup
          pos={filterPopupPos}
          occurrence={containerOccurrence}
          activeFilterValues={ctxState?.grid?.activeFilterValues || {}}
          onClose={() => setFilterPopupPos(null)}
          onSet={(override) => {
            commitOccurrenceUpdate({ filterOverride: override });
            setFilterPopupPos(null);
          }}
        />,
        document.body
      )}

      {/* Template quick-picker popup */}
      {templatePopupPos && createPortal(
        <TemplatePickerPopup
          pos={templatePopupPos}
          templates={gridTemplates}
          onClose={() => setTemplatePopupPos(null)}
          onSelect={(templateId) => {
            handleFillFromTemplate(templateId);
            setTemplatePopupPos(null);
          }}
        />,
        document.body
      )}

      <TransactionHistory
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        gridId={ctxState?.grid?._id || ctxState?.gridId}
        moduleId={module.id}
      />
    </div>
  );
}

export default React.memo(Container);
