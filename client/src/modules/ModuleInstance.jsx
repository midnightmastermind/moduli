// modules/ModuleInstance.jsx
// Instance wrapper within a Container — handles drag/drop, context menu, and doc toggle.
// Also contains the inner Instance row (label, field pills, operation widgets).
// Merged from ModuleInstance.jsx + Instance.jsx.

import React, { useContext, useEffect, useState, useCallback, useRef, useMemo } from "react";
import { GridDataContext } from "../GridDataContext";
import { GridActionsContext } from "../GridActionsContext";
import { GridLiveContext } from "../GridLiveContext";
import ContextMenu from "../ui/ContextMenu";
import InstanceForm from "../ui/InstanceForm";
import FieldRenderer from "../ui/FieldRenderer";
import RadialMenu from "../ui/RadialMenu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverAnchor,
} from "@/components/ui/popover";
import { Link2, Unlink, Settings, Copy, Move, Play, Zap, ArrowBigDown, Eye, EyeOff, ChevronRight, ChevronDown, X, Trash2, Focus } from "lucide-react";
import * as CommitHelpers from "../helpers/CommitHelpers";
import {
  useDragDrop,
  useDragContext,
  DragType,
  DropAccepts,
} from "../helpers/dragSystem";
import { resolveInstanceStyle, styleToCSS } from "../helpers/StyleHelpers";
import { runMatchingOperations } from "../helpers/operationExecutor";
import { setComputedValuesAction } from "../state/actions";
import { DocContent } from "./DocContent.jsx";
import { hexToRgba } from "../helpers/colorHelpers.js";
import { CellEmbedContext } from "../docs/CellEmbedContext.js";

// ============================================================
// INSTANCE INNER ROW — label, field pills, operation widgets
// ============================================================
function InstanceInner({
  id,
  label,
  instance,
  occurrence,
  panel,
  container,
  overlay = false,
  dragAttributes,
  dragListeners,
  dragHandleRef = null,
  onDoubleClick,
  toggleDoc,
  containerOccurrence,
  dispatch,
  socket,
  embedRadialItems = null,
  embedOnDelete = null,
  renderBody = null,
  // Canvas-friendly handle layout: handle floats absolutely in the
  // top-left of the card instead of consuming a flex slot inline.
  floatHandle = false,
}) {
  const { state } = useContext(GridDataContext);
  const { fieldsById, addInstanceToContainer, occurrencesById, linkedGroupIndex, instancesById, operationsById } = useContext(GridActionsContext);
  const { computedValues } = useContext(GridLiveContext);
  const isOriginalActive = !overlay && state?.activeId === id;

  const dragCtx = useDragContext();
  const { isDragging } = dragCtx;

  // Per-occurrence dragMode overrides instance's defaultDragMode
  const entityDragMode = occurrence?.dragMode ?? instance?.defaultDragMode ?? "move";

  const [draft, setDraft] = useState(() => ({ label: label ?? "" }));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [linksPopoverOpen, setLinksPopoverOpen] = useState(false);
  const [showLabel, setShowLabel] = useState(true);

  // C3: O(1) linked sibling lookup via pre-indexed map
  const linkedSiblings = useMemo(() => {
    if (!occurrence?.linkedGroupId) return [];
    const group = linkedGroupIndex?.[occurrence.linkedGroupId] || [];
    return group.filter(o => o.id !== occurrence.id);
  }, [occurrence?.linkedGroupId, linkedGroupIndex]);

  useEffect(() => {
    setDraft({ label: label ?? "" });
  }, [label, id]);

  const commitLabel = useCallback(() => {
    const next = (draft?.label ?? "").trim();
    CommitHelpers.updateModule({
      dispatch,
      socket,
      module: { id, label: next },
      emit: true
    });
  }, [draft?.label, id, dispatch, socket]);

  const deleteMe = useCallback(() => {
    if (!occurrence?.id) return;
    CommitHelpers.removeOccurrence({
      dispatch,
      socket,
      occurrenceId: occurrence.id,
      occurrence,
      parentOccurrence: containerOccurrence || null,
      emit: true,
    });
  }, [occurrence, containerOccurrence, dispatch, socket]);

  // Toggle drag mode — writes to occurrence if it has its own dragMode, otherwise to instance template
  const toggleEntityDragMode = useCallback(() => {
    if (!occurrence?.id) return;
    const newMode = entityDragMode === "move" ? "copy" : "move";
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: occurrence.id, dragMode: newMode },
      emit: true,
    });
  }, [occurrence?.id, entityDragMode, dispatch, socket]);

  // Pick up the enclosing table cell's column-level field filter (if any).
  // When the embed is rendered outside a table cell the context provides
  // null — instanceFields then renders every visible binding as before.
  const cellEmbedCtx = useContext(CellEmbedContext);
  const cellFieldFilter = cellEmbedCtx?.fieldFilter || null;

  // Get fields for this instance based on fieldBindings (skip hidden bindings).
  // Additional cell-column filter: column.fieldFilter = { mode: "show"|"hide",
  // fieldIds } — when "show", keep only listed fields; when "hide", drop them.
  const instanceFields = useMemo(() => {
    if (!instance?.fieldBindings || !fieldsById) return [];

    const filterIds = Array.isArray(cellFieldFilter?.fieldIds) ? cellFieldFilter.fieldIds : null;
    const filterMode = cellFieldFilter?.mode || null;
    const passesCellFilter = (fieldId) => {
      if (!filterIds || !filterMode) return true;
      const inList = filterIds.includes(fieldId);
      if (filterMode === "show") return inList;
      if (filterMode === "hide") return !inList;
      return true;
    };

    return (instance.fieldBindings || [])
      .filter(binding => !binding.hidden && passesCellFilter(binding.fieldId))
      .map(binding => {
        const field = fieldsById[binding.fieldId];
        if (!field) return null;
        return { field, binding };
      })
      .filter(Boolean)
      .sort((a, b) => (a.binding.order || 0) - (b.binding.order || 0));
  }, [instance?.fieldBindings, fieldsById, cellFieldFilter]);

  // Operation widget bindings
  const operationWidgets = useMemo(() => {
    if (!instance?.operationBindings?.length || !operationsById) return [];
    return instance.operationBindings
      .map(b => ({ binding: b, op: operationsById[b.operationId] }))
      .filter(w => w.op);
  }, [instance?.operationBindings, operationsById]);

  const handleRunOperation = useCallback((op) => {
    if (!op) return;
    const fieldsLookup = fieldsById || {};
    const operationsLookup = operationsById || {};
    const occLookup = occurrencesById || {};
    const transaction = { type: "ButtonOp", operationId: op.id, instanceId: id, occurrenceId: occurrence?.id };
    const updates = runMatchingOperations(
      Object.values(operationsLookup),
      "ButtonOp",
      transaction,
      { state, fieldsById: fieldsLookup, operationsById: operationsLookup, occurrencesById: occLookup }
    );
    if (updates.length > 0) {
      const displayUpdates = updates.filter(u => !u._effect);
      if (displayUpdates.length > 0) dispatch(setComputedValuesAction(displayUpdates));
    }
  }, [id, occurrence?.id, state, fieldsById, operationsById, occurrencesById, dispatch]);

  // Context for derived field calculations (includes filter timeScale for target scaling)
  const fieldContext = useMemo(() => {
    const grid = state?.grid;
    const namedFilters = grid?.namedFilters || [];
    const activeFilter = namedFilters.find(f => f.id === grid?.activeFilterId);
    const currentTimeFilter = activeFilter?.timeScale || "daily";
    const activeFilterValues = grid?.activeFilterValues || {};
    // Find the date value from the active filter values (first date-type value found)
    const dateVal = Object.values(activeFilterValues).find(v => v && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v));
    return {
      gridId: occurrence?.gridId,
      containerId: occurrence?.parentId,
      currentIteration: currentTimeFilter,
      iterationDate: dateVal || new Date().toISOString(),
    };
  }, [occurrence?.gridId, occurrence?.parentId, state?.grid]);

  // Resolved cascading style for this instance
  const resolvedInstanceCSS = useMemo(
    () => styleToCSS(resolveInstanceStyle(instance, container, panel)),
    [instance, container, panel]
  );

  // Build radial menu items - include Break Link when occurrence is linked
  const radialItems = useMemo(() => {
    const toggleLabelItem = {
      icon: showLabel ? EyeOff : Eye,
      label: showLabel ? "Hide Label" : "Show Label",
      onClick: () => setShowLabel(v => !v),
      color: "bg-slate-700 hover:bg-slate-600",
    };
    if (!occurrence?.linkedGroupId) return null; // null = use default items (onToggleHeader handles toggle)
    return [
      {
        icon: Settings,
        label: "Settings",
        onClick: () => setSettingsOpen(true),
        color: "bg-slate-600 hover:bg-slate-500",
      },
      {
        icon: entityDragMode === "move" ? Copy : Move,
        label: entityDragMode === "move" ? "Set to Copy" : "Set to Move",
        onClick: toggleEntityDragMode,
        color: entityDragMode === "move" ? "bg-blue-600 hover:bg-blue-500" : "bg-slate-600 hover:bg-slate-500",
      },
      {
        icon: Unlink,
        label: "Break Link",
        onClick: () => socket?.emit("break_link", { occurrenceId: occurrence.id }),
        color: "bg-orange-600 hover:bg-orange-500",
      },
      toggleLabelItem,
    ];
  }, [occurrence?.linkedGroupId, occurrence?.id, entityDragMode, toggleEntityDragMode, socket, showLabel]);

  const hasLabel = !!label;
  const hasFields = instanceFields.length > 0;

  return (
    <div
      role="listitem"
      aria-label={label || "Untitled instance"}
      className={"font-mono instance-row" + (isOriginalActive ? " hidden" : "")}
      style={{
        touchAction: "manipulation",
        WebkitUserSelect: "none",
        userSelect: "none",
        display: "flex",
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 4,
        position: "relative",
        ...resolvedInstanceCSS,
      }}
      onDoubleClick={onDoubleClick}
      {...(!overlay ? dragAttributes : {})}
      {...(!overlay ? dragListeners : {})}
    >
      {/* Content: [radial + label] inline with fields; fields wrap to a new row below the label when the row is too narrow.
          When `floatHandle` is on (canvas-style cards), the handle wrapper instead lives as an absolute overlay at the top-left
          of the card and the renderBody fills the full row. */}
      <div
        className="instance-content"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "row",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: 2,
          rowGap: 4,
          minWidth: 0,
          paddingLeft: floatHandle ? 22 : 2,
          paddingRight: 8,
        }}
      >
        {/* RadialMenu handle + label — grouped in same flex row, OR absolute top-left when floatHandle */}
        <div style={floatHandle
          ? { position: "absolute", top: 4, left: 2, zIndex: 10, display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }
          : { display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }
        }>
          <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
            <PopoverAnchor asChild>
              <div
                ref={dragHandleRef}
                className="module-drag-handle"
                data-dnd-handle="true"
              >
                <RadialMenu
                  dragMode={entityDragMode}
                  onToggleDragMode={toggleEntityDragMode}
                  onSettings={() => setSettingsOpen(true)}
                  addLabel="Item"
                  size="sm"
                  forceDirection="down"
                  items={radialItems}
                  onToggleHeader={!occurrence?.linkedGroupId ? () => setShowLabel(v => !v) : undefined}
                  showHeader={showLabel}
                  onToggleDoc={toggleDoc || undefined}
                  onDelete={embedOnDelete ?? (() => {
                    if (!occurrence?.id) return;
                    CommitHelpers.removeOccurrence({ dispatch, socket, occurrenceId: occurrence.id, occurrence, parentOccurrence: containerOccurrence || null, emit: true });
                  })}
                  extraItems={embedRadialItems}
                />
              </div>
            </PopoverAnchor>
            <PopoverContent align="start" side="right" collisionPadding={8} className="w-auto p-0 settings-sheet" style={{ position: "relative" }}>
              <button type="button" onClick={() => setSettingsOpen(false)} style={{ position: "absolute", top: 6, right: 6, zIndex: 10, background: "none", border: "none", cursor: "pointer", padding: 2, lineHeight: 0, color: "var(--text-muted)" }}><X size={14} /></button>
              <InstanceForm
                value={draft}
                onChange={setDraft}
                onCommitLabel={commitLabel}
                onDeleteInstance={deleteMe}
                instanceId={id}
                instance={instance}
                occurrence={occurrence}
                dispatch={dispatch}
                socket={socket}
              />
            </PopoverContent>
          </Popover>
          {showLabel && hasLabel && (
            <div
              style={{
                flexShrink: 0,
                fontSize: 12,
                color: "var(--text-primary)",
                overflowWrap: "anywhere",
                paddingTop: 2,
                paddingLeft: 2,
              }}
            >
            {label}
            {/* Inline link icon next to label removed — the linked-copy badge
                at the end of the row (`.linked-copy-badge`) is the single
                authoritative indicator that an occurrence is copy-linked. */}
          </div>
          )}
        </div>{/* end label+radial wrapper */}

        {/* Custom body — used by ArtifactCard / TextblockCard. Replaces fields layout when provided. */}
        {renderBody && (
          <div className="instance-body" style={{ flex: 1, minWidth: 0, position: "relative" }}>
            {renderBody()}
          </div>
        )}

        {!renderBody && showLabel && hasFields && (
          <div
            className="instance-fields"
            style={{
              flex: "1 1 160px",
              minWidth: 0,
              display: "flex",
              flexWrap: "wrap",
              gap: 4,
              justifyContent: "flex-end",
              alignItems: "center",
            }}
          >
            {instanceFields.map(({ field, binding }) => (
              <FieldRenderer
                key={field.id}
                field={field}
                binding={binding}
                occurrence={occurrence}
                instance={instance}
                context={fieldContext}
                state={state}
                dispatch={dispatch}
                socket={socket}
                compact={true}
                disabled={!!instance?.meta?.disabled}
              />
            ))}
          </div>
        )}

        {/* Operation widgets */}
        {!renderBody && operationWidgets.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", marginLeft: hasFields ? 0 : "auto" }}>
            {operationWidgets.map(({ binding, op }) => {
              if (binding.widgetType === "display") {
                const val = computedValues?.[op.targetFieldId];
                return (
                  <span
                    key={binding.operationId}
                    title={binding.displayName || op.name}
                    style={{
                      fontSize: 11, fontFamily: "monospace", padding: "2px 8px",
                      borderRadius: 999, background: "var(--accent-green-bg)",
                      border: "1px solid var(--accent-green-border)", color: "var(--accent-green-text)",
                    }}
                  >
                    <Zap style={{ width: 9, height: 9, display: "inline", marginRight: 3 }} />
                    {val !== undefined && val !== null ? String(val) : "—"}
                  </span>
                );
              }
              // Default: trigger button
              return (
                <button
                  key={binding.operationId}
                  onClick={(e) => { e.stopPropagation(); handleRunOperation(op); }}
                  title={`Run: ${binding.displayName || op.name}`}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "2px 8px", borderRadius: 999, fontSize: 11,
                    fontFamily: "monospace", cursor: "pointer",
                    background: "var(--accent-blue-bg)", border: "1px solid var(--accent-blue-border)",
                    color: "var(--accent-blue-text)",
                  }}
                >
                  <Play style={{ width: 9, height: 9 }} />
                  {binding.displayName || op.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// MODULE INSTANCE WRAPPER (was SortableInstance.jsx — used within Container only)
// ============================================================
function ModuleInstance({
  module,
  occurrence,
  containerId,
  panelId,
  panel,
  container,
  containerOccurrence,
  dispatch,
  socket,
  allowedEdges = ["top", "bottom"],
  onInstanceFocus,
  embedRadialItems = null,
  embedOnDelete = null,
  embedSourceType = null,
  renderBody = null,
  floatHandle = false,
}) {
  const dragCtx = useDragContext();
  const { isContainerDrag } = dragCtx;
  const [ctxMenu, setCtxMenu] = useState(null);
  const [showDoc, setShowDoc] = useState(false);

  const handleContextMenu = useCallback((e) => {
    if ("ontouchstart" in window) return;
    e.preventDefault();
    e.stopPropagation();
    const items = [
      onInstanceFocus && { label: "Focus", icon: Focus, onClick: () => onInstanceFocus(module, occurrence) },
      onInstanceFocus && { separator: true },
      {
        label: "Copy instance",
        icon: Copy,
        onClick: () => {
          const newInstance = { ...module, id: crypto.randomUUID(), label: `${module.label} (Copy)` };
          CommitHelpers.createInstanceInContainer({ dispatch, socket, containerId, instance: newInstance, emit: true });
        },
      },
      {
        label: "Remove from container", icon: Trash2, danger: true,
        onClick: () => {
          if (!occurrence?.id) return;
          CommitHelpers.removeOccurrence({ dispatch, socket, occurrenceId: occurrence.id, occurrence, parentOccurrence: containerOccurrence || null, emit: true });
        },
      },
    ].filter(Boolean);
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, [module, occurrence, containerId, containerOccurrence, onInstanceFocus, dispatch, socket]);

  const handleRef = useRef(null);

  const { ref, isDragging, isOver, closestEdge, props } = useDragDrop({
    type: DragType.INSTANCE,
    id: module.id,
    data: { ...module, occurrence },
    context: { containerId, containerOccurrenceId: containerOccurrence?.id || null, panelId, instanceId: module.id, occurrenceId: occurrence?.id, sourceType: embedSourceType },
    disabled: isContainerDrag,
    nativeEnabled: true,
    accepts: DropAccepts.INSTANCE,
    allowedEdges,
    dragHandleRef: handleRef,
  });

  const toggleDoc = () => setShowDoc(v => !v);

  return (
    <div
      ref={ref}
      data-instance-id={module.id}
      data-occurrence-id={occurrence?.id}
      data-testid="instance-wrap"
      className="instance-wrap"
      style={{
        touchAction: "manipulation",
        opacity: isDragging ? 0.4 : 1,
        background: "transparent", borderRadius: 4,
        transition: "opacity 0.1s", marginBottom: 2, position: "relative",
      }}
      {...props}
      onContextMenu={handleContextMenu}
    >
      <ContextMenu ctx={ctxMenu} onClose={() => setCtxMenu(null)} />

      {isOver && closestEdge === "top" && <div className="drop-indicator drop-indicator-inst-top" />}
      {isOver && closestEdge === "bottom" && <div className="drop-indicator drop-indicator-inst-bottom" />}
      {isOver && closestEdge === "left" && <div className="drop-indicator drop-indicator-inst-left" />}
      {isOver && closestEdge === "right" && <div className="drop-indicator drop-indicator-inst-right" />}

      {occurrence?.linkedGroupId && (
        <Link2 title="Linked copy" className="linked-copy-badge" />
      )}

      <InstanceInner
        id={module.id}
        label={module.label}
        instance={module}
        occurrence={occurrence}
        panel={panel}
        container={container}
        containerOccurrence={containerOccurrence}
        dispatch={dispatch}
        socket={socket}
        dragHandleRef={handleRef}
        toggleDoc={toggleDoc}
        onDoubleClick={onInstanceFocus ? () => onInstanceFocus(module, occurrence) : undefined}
        embedRadialItems={embedRadialItems}
        embedOnDelete={embedOnDelete}
        renderBody={renderBody}
        floatHandle={floatHandle}
      />
      {occurrence && showDoc && (() => {
        const bg = container?.ownStyle?.bg || null;
        return (
          <div style={{
            borderLeft: `2px solid ${hexToRgba(bg, 0.45) ?? "rgba(255,255,255,0.08)"}`,
            background: hexToRgba(bg, 0.06) ?? "transparent",
            marginLeft: 4,
          }}>
            <DocContent occurrence={occurrence} dispatch={dispatch} socket={socket} hideToolbar={true} />
          </div>
        );
      })()}
    </div>
  );
}

// Named export so Instance.jsx (stub) can re-export the inner row directly.
// Memoized version used by ModuleContainer's canvas card rendering.
export const MemoInstanceInner = React.memo(InstanceInner);

export default React.memo(ModuleInstance);
