// modules/Instance.jsx
// Extracted from client/src/Instance.jsx (InstanceInner).
// Renders an individual instance row: label, field pills, operation widgets.
// Import paths updated for modules/ subfolder location.

import React, { useContext, useEffect, useState, useCallback, useMemo } from "react";
import { GridDataContext } from "../GridDataContext";
import { GridActionsContext } from "../GridActionsContext";

import InstanceForm from "../ui/InstanceForm";
import FieldRenderer from "../ui/FieldRenderer";
import RadialMenu from "../ui/RadialMenu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverAnchor,
} from "@/components/ui/popover";

import { Link2, Unlink, Settings, Copy, Move, Play, Zap, ArrowBigDown, Eye, EyeOff } from "lucide-react";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { useDragContext } from "../helpers/dragSystem";
import { resolveInstanceStyle, styleToCSS } from "../helpers/StyleHelpers";
import { executeOperation } from "../helpers/operationExecutor";
import { setComputedValuesAction } from "../state/actions";

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
  dispatch,
  socket,
}) {
  const { state } = useContext(GridDataContext);
  const { fieldsById, addInstanceToContainer, occurrencesById, instancesById, operationsById, computedValues } = useContext(GridActionsContext);
  const isOriginalActive = !overlay && state?.activeId === id;

  const dragCtx = useDragContext();
  const { isDragging } = dragCtx;

  // Per-occurrence dragMode overrides instance's defaultDragMode
  const entityDragMode = occurrence?.dragMode ?? instance?.defaultDragMode ?? "move";

  const [draft, setDraft] = useState(() => ({ label: label ?? "" }));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [linksPopoverOpen, setLinksPopoverOpen] = useState(false);
  const [showLabel, setShowLabel] = useState(true);

  // Find all sibling occurrences sharing the same linkedGroupId
  const linkedSiblings = useMemo(() => {
    if (!occurrence?.linkedGroupId || !occurrencesById) return [];
    return Object.values(occurrencesById).filter(
      o => o.linkedGroupId === occurrence.linkedGroupId && o.id !== occurrence.id
    );
  }, [occurrence?.linkedGroupId, occurrencesById]);

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
    CommitHelpers.deleteModule({
      dispatch,
      socket,
      moduleId: id,
      emit: true
    });
  }, [id, dispatch, socket]);

  // Toggle drag mode — writes to occurrence if it has its own dragMode, otherwise to instance template
  const toggleEntityDragMode = useCallback(() => {
    const newMode = entityDragMode === "move" ? "copy" : "move";
    if (occurrence?.dragMode != null) {
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: { id: occurrence.id, dragMode: newMode },
        emit: true,
      });
    } else {
      CommitHelpers.updateModule({
        dispatch, socket,
        module: { id, defaultDragMode: newMode },
        emit: true,
      });
    }
  }, [id, occurrence, entityDragMode, dispatch, socket]);

  // Get fields for this instance based on fieldBindings (skip hidden bindings)
  const instanceFields = useMemo(() => {
    if (!instance?.fieldBindings || !fieldsById) return [];

    return (instance.fieldBindings || [])
      .filter(binding => !binding.hidden)
      .map(binding => {
        const field = fieldsById[binding.fieldId];
        if (!field) return null;
        return { field, binding };
      })
      .filter(Boolean)
      .sort((a, b) => (a.binding.order || 0) - (b.binding.order || 0));
  }, [instance?.fieldBindings, fieldsById]);

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
    const updates = executeOperation(op, "manual", { type: "manual", instanceId: id }, { state, fieldsById: fieldsLookup });
    if (updates.length > 0) dispatch(setComputedValuesAction(updates));
  }, [id, state, fieldsById, dispatch]);

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
      containerId: occurrence?.meta?.containerId,
      currentIteration: currentTimeFilter,
      iterationDate: dateVal || new Date().toISOString(),
    };
  }, [occurrence?.gridId, occurrence?.meta?.containerId, state?.grid]);

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
        alignItems: "center",
        gap: 4,
        position: "relative",
        ...resolvedInstanceCSS,
      }}
      onDoubleClick={onDoubleClick}
      {...(!overlay ? dragAttributes : {})}
      {...(!overlay ? dragListeners : {})}
    >
      {/* Right side: [radial + label] anchored left + fields in remaining space */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "row",
          flexWrap: "nowrap",
          alignItems: "center",
          gap: 4,
          minWidth: 0,
          paddingLeft: 2,
          paddingRight: 8,
        }}
      >
        {/* RadialMenu handle + label — grouped in same flex row */}
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
            <PopoverAnchor asChild>
              <div
                ref={dragHandleRef}
                className="module-handle"
                style={{ position: "relative", alignSelf: "center", cursor: "grab", flexShrink: 0, width: 16, height: 16 }}
              >
                <span className="module-dot" />
                <RadialMenu
                  dragMode={entityDragMode}
                  onToggleDragMode={toggleEntityDragMode}
                  onToggleCollapse={toggleDoc}
                  onSettings={() => setSettingsOpen(true)}
                  addLabel="Item"
                  size="sm"
                  items={radialItems}
                  onToggleHeader={!occurrence?.linkedGroupId ? () => setShowLabel(v => !v) : undefined}
                  showHeader={showLabel}
                />
              </div>
            </PopoverAnchor>
            <PopoverContent align="start" side="right" collisionPadding={8} className="w-auto p-0">
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
              }}
            >
            {label}
            {occurrence?.linkedGroupId && (
              <Popover open={linksPopoverOpen} onOpenChange={setLinksPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setLinksPopoverOpen(prev => !prev); }}
                    className="inline-flex items-center ml-1 flex-shrink-0"
                    title={`Linked (${linkedSiblings.length} sibling${linkedSiblings.length !== 1 ? 's' : ''})`}
                  >
                    <Link2 className="w-3 h-3 text-blue-400 opacity-60 hover:opacity-100 transition-opacity" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" side="bottom" className="w-auto min-w-[160px] max-w-[240px] p-2">
                  <div className="text-xs font-medium text-muted-foreground mb-1.5">
                    Linked Occurrences ({linkedSiblings.length})
                  </div>
                  {linkedSiblings.length === 0 ? (
                    <div className="text-xs text-muted-foreground/60 italic">No other linked copies</div>
                  ) : (
                    <ul className="space-y-1">
                      {linkedSiblings.map(sib => {
                        const sibInstance = instancesById?.[sib.targetId];
                        const sibLabel = sibInstance?.label || sib.targetId || "Unknown";
                        const sibContainerId = sib.meta?.containerId;
                        return (
                          <li key={sib.id} className="text-xs text-foreground/80 flex items-center gap-1.5 py-0.5 px-1 rounded hover:bg-muted/50">
                            <Link2 className="w-2.5 h-2.5 text-blue-400 flex-shrink-0" />
                            <span className="truncate">{sibLabel}</span>
                            {sibContainerId && (
                              <span className="text-muted-foreground/50 text-[10px] ml-auto flex-shrink-0">
                                {sibContainerId.slice(0, 6)}...
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </PopoverContent>
              </Popover>
            )}
          </div>
          )}
        </div>{/* end label+radial wrapper */}

        {/* U2: Inline file preview for instances with fileRef */}
        {instance?.fileRef && (() => {
          const src = `/uploads/${instance.fileRef}`;
          const ext = instance.fileRef.split(".").pop().toLowerCase();
          const isImg = ["jpg","jpeg","png","gif","webp","svg","avif"].includes(ext);
          const isVid = ["mp4","webm","mov"].includes(ext);
          const isAudio = ["mp3","wav","ogg","m4a"].includes(ext);
          if (isImg) return (
            <img
              key="preview"
              src={src}
              alt={label || "preview"}
              style={{ height: 36, width: "auto", maxWidth: 60, objectFit: "cover", borderRadius: 3, flexShrink: 0, opacity: 0.85 }}
            />
          );
          if (isVid) return (
            <video
              key="preview"
              src={src}
              style={{ height: 36, width: "auto", maxWidth: 60, borderRadius: 3, flexShrink: 0, opacity: 0.85 }}
              muted playsInline preload="metadata"
            />
          );
          if (isAudio) return (
            <span key="preview" style={{ fontSize: 10, color: "var(--text-muted)", flexShrink: 0 }}>
              🎵
            </span>
          );
          return null;
        })()}

        {showLabel && hasFields && (
          <div
            className="instance-fields"
            style={{
              flex: 1,
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
        {operationWidgets.length > 0 && (
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

export default React.memo(InstanceInner);
