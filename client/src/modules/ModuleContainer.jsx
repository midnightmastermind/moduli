// modules/ModuleContainer.jsx
// Extracted from Module.jsx ModuleContainer component.
// Renders a container header and its instances.
// Handles doc containers, focused instance view, list view, sorting.

import React, { useRef, useMemo, useState, useReducer, useCallback, useEffect, useContext } from "react";
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
import { hexToRgba, lightenHex } from "../helpers/colorHelpers.js";
import { resolveEffectiveFilters, isOccurrenceVisible } from "../state/selectors";

import {
  ChevronRight,
  ChevronDown,
  Copy,
  Link2,
  Unlink,
  Trash2,
  BookMarked,
  ArrowLeft,
  X,
} from "lucide-react";

import Instance from "./Instance.jsx";
import { CanvasCard, CanvasDrawSection } from "./containerHelpers.jsx";
import { DocEditorShell } from "./DocContent.jsx";
import ContainerPool from "./containers/ContainerPool.jsx";
import { FilterOverridePopup, TemplatePickerPopup } from "./containerPopups.jsx";
import ModuleInstance from "./ModuleInstance.jsx";
import QuickAddMenu from "../ui/QuickAddMenu.jsx";
import FieldRenderer from "../ui/FieldRenderer.jsx";

// ============================================================
// HELPERS
// ============================================================

const ALL_EDGES = ["top", "bottom", "left", "right"];

// ─── AttachedFieldTextarea ────────────────────────────────────
// Inline textarea used when a field is attached to the header or body of a container.
// Uncontrolled locally — commits on blur. `grow` enables auto-resize to content.
function AttachedFieldTextarea({ value, placeholder, onCommit, rows = 1, grow = false }) {
  const [local, setLocal] = React.useState(value ?? "");
  const ref = React.useRef(null);

  React.useEffect(() => { setLocal(value ?? ""); }, [value]);

  React.useEffect(() => {
    if (grow && ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  }, [local, grow]);

  return (
    <textarea
      ref={ref}
      value={local}
      placeholder={placeholder}
      rows={rows}
      onChange={e => {
        setLocal(e.target.value);
        if (grow && ref.current) {
          ref.current.style.height = "auto";
          ref.current.style.height = `${ref.current.scrollHeight}px`;
        }
      }}
      onBlur={() => onCommit(local)}
      onKeyDown={e => {
        if (e.key === "Escape") { setLocal(value ?? ""); e.currentTarget.blur(); }
        e.stopPropagation();
      }}
      onPointerDown={e => e.stopPropagation()}
      style={{
        width: "100%", resize: grow ? "none" : "vertical",
        padding: "2px 4px",
        fontSize: 12, fontFamily: "var(--font-mono)", lineHeight: 1.5,
        background: "transparent", border: "none", outline: "none",
        color: "var(--text-primary)", overflowY: grow ? "hidden" : "auto",
      }}
    />
  );
}

// ============================================================
// CONTAINER COMPONENT
// ============================================================
function Container({
  module,
  panel,
  panelId,
  pageOccurrenceId = null,
  panelLayoutOrientation = "vertical",
  addInstanceToContainer,
  dispatch,
  socket,
  gapPx = 12,
  onInstanceFocus,
  embedded = false,
  occurrenceOverride = null,
  embedRadialItems = null,
  embedOnDelete = null,
  embedSourceType = null,
}) {
  const { occurrencesById, instancesById, modulesById, viewsById, fieldsById, state: ctxState } = useContext(GridActionsContext);
  const dragCtx = useDragContext();
  const { isContainerDrag, isInstanceDrag, isExternalDrag, isPanelDrag } = dragCtx;

  const [draft, setDraft] = useState(() => ({ label: module.label ?? "" }));

  // C5: Consolidated UI state — single reducer instead of 13 separate useState
  const [ui, uiDispatch] = useReducer((s, a) => {
    if (typeof a === "function") return { ...s, ...a(s) };
    return { ...s, ...a };
  }, {
    settingsOpen: false, historyOpen: false, ctxMenu: null,
    focusedStack: [], historyExpanded: false, isBodyCollapsed: false,
    showHeader: true,
    showEmbeddedIterNav: false, filterPopupPos: null, templatePopupPos: null,
  });
  const { settingsOpen, historyOpen, ctxMenu, focusedStack, historyExpanded,
    isBodyCollapsed, showHeader,
    showEmbeddedIterNav, filterPopupPos, templatePopupPos } = ui;
  // Setter wrappers — same API as useState setters, delegates to single reducer
  const setSettingsOpen = useCallback(v => uiDispatch(typeof v === "function" ? s => ({ settingsOpen: v(s.settingsOpen) }) : { settingsOpen: v }), []);
  const setHistoryOpen = useCallback(v => uiDispatch(typeof v === "function" ? s => ({ historyOpen: v(s.historyOpen) }) : { historyOpen: v }), []);
  const setCtxMenu = useCallback(v => uiDispatch({ ctxMenu: v }), []);
  const setFocusedStack = useCallback(v => uiDispatch(typeof v === "function" ? s => ({ focusedStack: v(s.focusedStack) }) : { focusedStack: v }), []);
  const setHistoryExpanded = useCallback(v => uiDispatch(typeof v === "function" ? s => ({ historyExpanded: v(s.historyExpanded) }) : { historyExpanded: v }), []);
  const setIsBodyCollapsed = useCallback(v => uiDispatch(typeof v === "function" ? s => ({ isBodyCollapsed: v(s.isBodyCollapsed) }) : { isBodyCollapsed: v }), []);
  const setShowHeader = useCallback(v => uiDispatch({ showHeader: v }), []);
  const setShowEmbeddedIterNav = useCallback(v => uiDispatch({ showEmbeddedIterNav: v }), []);
  const setFilterPopupPos = useCallback(v => uiDispatch({ filterPopupPos: v }), []);
  const setTemplatePopupPos = useCallback(v => uiDispatch({ templatePopupPos: v }), []);
  const containerHandleRef = useRef(null);
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

  const containerDragMode = containerOccurrence?.dragMode ?? module?.defaultDragMode ?? "move";

  // Resolve fields bound to this container (for header display)
  const containerFields = useMemo(() => {
    if (!module?.fieldBindings || !fieldsById) return [];
    return (module.fieldBindings || [])
      .filter(b => !b.hidden)
      .map(b => ({ field: fieldsById[b.fieldId], binding: b }))
      .filter(item => item.field)
      .sort((a, b) => (a.binding.order || 0) - (b.binding.order || 0));
  }, [module?.fieldBindings, fieldsById]);

  // Attached fields — fields whose content IS the header/body of this module.
  // header/body are arrays of fieldIds; all share the same typed value.
  const attachedHeaderFields = useMemo(() => {
    const ids = module?.attachedFields?.header || [];
    return ids.map(id => fieldsById[id]).filter(Boolean);
  }, [module?.attachedFields?.header, fieldsById]);

  const attachedBodyFields = useMemo(() => {
    const ids = module?.attachedFields?.body || [];
    return ids.map(id => fieldsById[id]).filter(Boolean);
  }, [module?.attachedFields?.body, fieldsById]);

  // Read the header/body content from the first attached field's value in the occurrence
  const attachedHeaderValue = useMemo(() => {
    if (!attachedHeaderFields.length || !containerOccurrence) return null;
    const fieldId = attachedHeaderFields[0].id;
    const raw = containerOccurrence.fields?.[fieldId];
    return raw && typeof raw === "object" && "value" in raw ? raw.value : raw ?? null;
  }, [attachedHeaderFields, containerOccurrence]);

  const attachedBodyValue = useMemo(() => {
    if (!attachedBodyFields.length || !containerOccurrence) return null;
    const fieldId = attachedBodyFields[0].id;
    const raw = containerOccurrence.fields?.[fieldId];
    return raw && typeof raw === "object" && "value" in raw ? raw.value : raw ?? null;
  }, [attachedBodyFields, containerOccurrence]);

  // Commit a new value to all attached fields simultaneously
  const commitAttachedFieldValue = useCallback((fieldGroup, newValue) => {
    if (!containerOccurrence?.id || !fieldGroup.length) return;
    const fieldUpdates = {};
    for (const f of fieldGroup) {
      fieldUpdates[f.id] = { value: newValue, flow: "in" };
    }
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: containerOccurrence.id, fields: { ...(containerOccurrence.fields || {}), ...fieldUpdates } },
      emit: true,
    });
  }, [containerOccurrence, dispatch, socket]);

  const removeMe = useCallback(() => {
    if (!containerOccurrence?.id) return;
    const parentOcc = Object.values(occurrencesById).find(occ =>
      Array.isArray(occ.occurrences) && occ.occurrences.includes(containerOccurrence.id)
    );
    CommitHelpers.removeOccurrence({ dispatch, socket, occurrenceId: containerOccurrence.id, occurrence: containerOccurrence, parentOccurrence: parentOcc || null, emit: true });
  }, [containerOccurrence, occurrencesById, dispatch, socket]);

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

  const containerAllowedEdges = ALL_EDGES;

  const containerWithInstances = useMemo(() => {
    const instanceObjects = getContainerItems(module, occurrencesById, instancesById);
    return { ...module, instanceObjects };
  }, [module, occurrencesById, instancesById]);

  const { ref: containerRef, isDragging, isOver: isContainerOver, closestEdge, props: containerProps } = useDragDrop({
    type: DragType.CONTAINER,
    id: module.id,
    data: { ...containerWithInstances, occurrenceId: containerOccurrence?.id || null, defaultDragMode: containerDragMode },
    context: { panelId, containerId: module.id, occurrenceId: containerOccurrence?.id || null, pageOccurrenceId: pageOccurrenceId || null, sourceType: embedSourceType },
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
  const activeNamedFilter = useMemo(() => {
    const activeId = ctxState?.grid?.activeFilterId;
    if (!activeId) return null;
    return (ctxState?.grid?.namedFilters || []).find(f => f.id === activeId) || null;
  }, [ctxState?.grid?.activeFilterId, ctxState?.grid?.namedFilters]);

  const effectiveFilters = useMemo(
    () => resolveEffectiveFilters(
      containerOccurrence,
      ctxState?.grid?.activeFilterValues || {},
      !!activeNamedFilter?.lock
    ),
    [containerOccurrence, ctxState?.grid?.activeFilterValues, activeNamedFilter]
  );

  const activeFilterConditions = useMemo(
    () => activeNamedFilter?.conditions || null,
    [activeNamedFilter]
  );

  const itemsWithOccurrences = useMemo(
    () => allItemsWithOccurrences.filter(item => isOccurrenceVisible(item.occurrence, effectiveFilters, activeFilterConditions)),
    [allItemsWithOccurrences, effectiveFilters, activeFilterConditions]
  );

  const items = useMemo(() => itemsWithOccurrences.map(item => item.instance), [itemsWithOccurrences]);

  const toggleContainerDragModeQuick = useCallback(() => {
    const nextMode = containerDragMode === "move" ? "copy" : "move";
    if (containerOccurrence) {
      CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: containerOccurrence.id, dragMode: nextMode }, emit: true });
    } else {
      CommitHelpers.updateModule({ dispatch, socket, module: { ...module, defaultDragMode: nextMode }, emit: true });
    }
  }, [module, containerOccurrence, containerDragMode, dispatch, socket]);

  // Rendering type comes from view.viewType (occurrence.viewId → View), never from module.kind
  const containerViewType = containerOccurrence?.viewId ? (viewsById?.[containerOccurrence.viewId]?.viewType ?? null) : null;
  const isDocContainer = containerViewType === "doc" || (!containerViewType && module?.kind === "doc");
  const isPoolContainer = containerViewType === "pool" || (!containerViewType && module?.kind === "pool");
  const isCanvasContainer = containerViewType === "canvas" || (!containerViewType && module?.kind === "canvas");

  // Canvas items: look up ALL module roles (instances + containers) from modulesById
  // so both instances and doc/list containers can be dropped onto a canvas.
  const canvasItemsWithOccurrences = useMemo(() => {
    if (!isCanvasContainer) return [];
    const ids = containerOccurrence?.occurrences || module?.occurrences || [];
    return ids.map(occId => {
      const occ = occurrencesById[occId];
      if (!occ) return null;
      const mod = modulesById[occ.targetId];
      if (!mod) return null;
      return { module: mod, occurrence: occ };
    }).filter(Boolean);
  }, [isCanvasContainer, containerOccurrence, module, occurrencesById, modulesById]);

  // Canvas card renderer — called by CanvasDrawSection for each item.
  // Renders <CanvasCard> with <Instance> or <Container embedded> as children.
  const renderCanvasCard = useCallback(({ module: mod, occurrence: occ, style, containerId: cid, panelId: pid }) => (
    <CanvasCard
      key={occ.id}
      module={mod}
      occurrence={occ}
      dispatch={dispatch}
      socket={socket}
      containerId={cid}
      panelId={pid}
      style={style}
    >
      {mod.role === "container"
        ? <Container module={mod} occurrenceOverride={occ} panelId={pid} embedded dispatch={dispatch} socket={socket} />
        : <Instance id={mod.id} label={mod.label} instance={mod} occurrence={occ} dispatch={dispatch} socket={socket} />
      }
    </CanvasCard>
  ), [dispatch, socket]);


  return (
    <div
      ref={containerRef}
      data-container-id={module.id}
      data-occ-id={containerOccurrence?.id}
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
            <div ref={containerHandleRef} className="container-cog-handle module-drag-handle module-grab-zone" data-dnd-handle="true">
              <RadialMenu
                dragMode={containerDragMode}
                onToggleDragMode={toggleContainerDragModeQuick}
                onSettings={() => setSettingsOpen(true)}
                onAddChild={onAdd}
                addLabel="Item"
                size="sm"
                forceDirection="down"
                onToggleCollapse={null}
                isCollapsed={isBodyCollapsed}
                onToggleHeader={() => setShowHeader(true)}
                showHeader={false}
                onHistory={() => setHistoryOpen(true)}
                onDelete={embedOnDelete ?? removeMe}
                extraItems={embedRadialItems}
              />
            </div>
          </PopoverAnchor>
          <PopoverContent align="start" side="right" collisionPadding={8} className="w-auto p-0 settings-sheet">
            <ContainerForm
              value={draft}
              onChange={setDraft}
              onCommitLabel={commitLabel}
              onDeleteContainer={removeMe}
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
          : { height: "20px", gap: 6, paddingLeft: 3 }
        }
        onContextMenu={(e) => {
          if ("ontouchstart" in window) return;
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
              { label: "Remove from grid", icon: Trash2, danger: true, onClick: removeMe },
            ].filter(Boolean),
          });
        }}
      >
        {embedded ? (
          /* Embedded: single-row header — handle + #label + filter */
          <>
            <div style={{ display: "flex", alignItems: "center", padding: "0px 4px 0px 2px", minHeight: 12, gap: 4 }}>
              <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
                <PopoverAnchor asChild>
                  <div ref={containerHandleRef} className="module-drag-handle module-grab-zone" data-dnd-handle="true" style={{ position: "relative", top: 0, left: "auto", transform: "none", flexShrink: 0 }}>
                    <div className="drag-handle-ball" />
                    <div className="drag-handle-stem" />
                    <RadialMenu
                      dragMode={containerDragMode}
                      onToggleDragMode={toggleContainerDragModeQuick}
                      onSettings={() => setSettingsOpen(true)}
                      onAddChild={onAdd}
                      addLabel="Item"
                      size="sm"
                      forceDirection="down"
                      onToggleCollapse={isDocContainer ? () => setIsBodyCollapsed(v => !v) : null}
                      isCollapsed={isBodyCollapsed}
                      onToggleHeader={() => setShowHeader(false)}
                      showHeader={showHeader}
                      onHistory={() => setHistoryOpen(true)}
                      onDelete={embedOnDelete ?? removeMe}
                      extraItems={embedRadialItems}
                    />
                  </div>
                </PopoverAnchor>
                <PopoverContent align="start" side="right" collisionPadding={8} className="w-auto p-0 settings-sheet" style={{ position: "relative" }}>
                  <button type="button" onClick={() => setSettingsOpen(false)} style={{ position: "absolute", top: 6, right: 6, zIndex: 10, background: "none", border: "none", cursor: "pointer", padding: 2, lineHeight: 0, color: "var(--text-muted)" }}><X size={14} /></button>
                  <ContainerForm
                    value={draft}
                    onChange={setDraft}
                    onCommitLabel={commitLabel}
                    onDeleteContainer={removeMe}
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
              <span className="embedded-hash" style={{ fontSize: 20, fontWeight: 700, color: embeddedAccent, fontFamily: "var(--font-mono)" }}>#</span>
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
                style={{ outline: "none", cursor: "text", fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 700, color: embeddedAccent, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}
              >
                {module.label || "Container"}
              </span>
              <div onPointerDown={(e) => e.stopPropagation()} style={{ flexShrink: 0, marginLeft: "auto" }}>
                <LocalIterationNav
                  occurrence={containerOccurrence}
                  onUpdate={commitOccurrenceUpdate}
                  showModeToggle={true}
                  compact={true}
                  collapsible={true}
                />
              </div>
            </div>
            {/* Row 3: Container-bound fields (below label, prevents mobile crush) */}
            {containerFields.length > 0 && !isBodyCollapsed && (
              <div style={{ padding: "0px 12px 4px 28px", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }} onPointerDown={(e) => e.stopPropagation()}>
                {containerFields.map(({ field, binding }) => (
                  <FieldRenderer
                    key={field.id}
                    field={field}
                    binding={binding}
                    occurrence={containerOccurrence}
                    instance={module}
                    state={ctxState}
                    dispatch={dispatch}
                    socket={socket}
                    compact={true}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          /* Standard single-row layout */
          <>
            <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
              <PopoverAnchor asChild>
                <div ref={containerHandleRef} className="module-drag-handle module-grab-zone" data-dnd-handle="true">
                  <div className="drag-handle-ball" />
                  <div className="drag-handle-stem" />
                  <RadialMenu
                    dragMode={containerDragMode}
                    onToggleDragMode={toggleContainerDragModeQuick}
                    onSettings={() => setSettingsOpen(true)}
                    onAddChild={onAdd}
                    addLabel="Item"
                    size="sm"
                    forceDirection="down"
                    onToggleCollapse={isDocContainer ? () => setIsBodyCollapsed(v => !v) : null}
                    isCollapsed={isBodyCollapsed}
                    onToggleHeader={() => setShowHeader(false)}
                    showHeader={showHeader}
                    onFilter={(e) => setFilterPopupPos({ x: e?.clientX ?? 100, y: e?.clientY ?? 100 })}
                    onTemplate={gridTemplates.length > 0 ? (e) => setTemplatePopupPos({ x: e?.clientX ?? 100, y: e?.clientY ?? 100 }) : null}
                    onHistory={() => setHistoryOpen(true)}
                    onDelete={embedOnDelete ?? removeMe}
                    extraItems={embedRadialItems}
                  />
                </div>
              </PopoverAnchor>
              <PopoverContent align="start" side="right" collisionPadding={8} className="w-auto p-0 settings-sheet" style={{ position: "relative" }}>
                <button type="button" onClick={() => setSettingsOpen(false)} style={{ position: "absolute", top: 6, right: 6, zIndex: 10, background: "none", border: "none", cursor: "pointer", padding: 2, lineHeight: 0, color: "var(--text-muted)" }}><X size={14} /></button>
                <ContainerForm
                  value={draft}
                  onChange={setDraft}
                  onCommitLabel={commitLabel}
                  onDeleteContainer={removeMe}
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

            {attachedHeaderFields.length > 0 ? (
              /* Attached header field — inline editable markdown textarea */
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }} onPointerDown={e => e.stopPropagation()}>
                {attachedHeaderFields[0] && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", fontFamily: "var(--font-mono)", lineHeight: 1, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {attachedHeaderFields[0].name}
                  </span>
                )}
                <AttachedFieldTextarea
                  value={attachedHeaderValue ?? ""}
                  placeholder={attachedHeaderFields[0]?.meta?.placeholder || ""}
                  onCommit={v => commitAttachedFieldValue(attachedHeaderFields, v)}
                  rows={1}
                />
              </div>
            ) : (
              <span className="truncate" style={{ fontSize: "0.75rem", fontWeight: 500 }}>
                {module.label || "Container"}
                {containerOccurrence?.linkedGroupId && (
                  <Link2 className="w-3 h-3 text-blue-400 opacity-60 flex-shrink-0 inline ml-1" title="Linked" />
                )}
              </span>
            )}

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

      {/* CONTENT AREA */}
      {!isBodyCollapsed && (isPoolContainer ? (
        <ContainerPool
          itemsWithOccurrences={itemsWithOccurrences}
          dispatch={dispatch}
          socket={socket}
          listDropRef={listDropRef}
          module={module}
          ctxState={ctxState}
        />
      ) : attachedBodyFields.length > 0 ? (
        /* Attached body field — markdown textarea replaces the body editor */
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "4px 8px 8px 8px", gap: 2 }}>
          {attachedBodyFields[0] && (
            <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {attachedBodyFields[0].name}
            </span>
          )}
          <AttachedFieldTextarea
            value={attachedBodyValue ?? ""}
            placeholder={attachedBodyFields[0]?.meta?.placeholder || ""}
            onCommit={v => commitAttachedFieldValue(attachedBodyFields, v)}
            rows={4}
            grow
          />
        </div>
      ) : isDocContainer ? (
        <div ref={listDropRef} className="container-doc" style={{ flex: 1, minHeight: 100, overflow: embedded ? "visible" : "auto", position: "relative" }}>
          <DocEditorShell
            occurrence={containerOccurrence}
            dispatch={dispatch}
            socket={socket}
            onConvertListToInstances={handleConvertListToInstances}
            hideToolbar={embedded}
          />
        </div>
      ) : isCanvasContainer ? (
        /* Canvas Container: free-form spatial layout + draw toolbar */
        <CanvasDrawSection
          containerOccurrence={containerOccurrence}
          itemsWithOccurrences={canvasItemsWithOccurrences}
          renderCard={renderCanvasCard}
          dispatch={dispatch}
          socket={socket}
          module={module}
          listDropRef={listDropRef}
          ctxState={ctxState}
          containerId={module.id}
          panelId={panelId}
          onDoubleClickBackground={(e) => {
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
        />
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
            style={{ padding: "3px 5px 5px 5px", flex: 1, display: "flex", flexDirection: "column" }}
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
                containerOccurrence={containerOccurrence}
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
