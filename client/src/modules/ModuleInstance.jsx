// modules/ModuleInstance.jsx
// Instance wrapper within a Container — handles drag/drop, context menu, and doc toggle.
// Also contains the inner Instance row (label, field pills, operation widgets).
// Merged from ModuleInstance.jsx + Instance.jsx.

import React, { useContext, useEffect, useState, useCallback, useRef, useMemo } from "react";
import { GridDataContext } from "../GridDataContext";
import { useGridActionsSelector } from "../GridActionsContext";
import { GridLiveContext } from "../GridLiveContext";
import { SelectionContext } from "../state/SelectionContext";
import ContextMenu from "../ui/ContextMenu";
import InstanceForm from "../ui/InstanceForm";
import FieldRenderer from "../ui/FieldRenderer";
import { bumpRender } from "../helpers/renderProbe";
import RadialMenu from "../ui/RadialMenu";
import RepresentationView from "../ui/RepresentationView";
import { getEffectiveViewMode } from "../helpers/viewMode";
import { jumpToOccurrence } from "../helpers/jumpToOccurrence";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverAnchor,
} from "@/components/ui/popover";
import { Link2, Unlink, Settings, Copy, Move, Play, Zap, ArrowBigDown, Eye, EyeOff, ChevronRight, ChevronDown, X, Trash2, Focus, ClipboardCopy, ClipboardPaste, MoveRight } from "lucide-react";
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
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import AutoMarquee from "../ui/AutoMarquee.jsx";
import { getEffectiveFieldVisibilityForOccurrence, fieldPassesVisibility } from "../state/selectors";

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
  // Force-hide the instance label regardless of the user's per-instance
  // toggle. Set by the moduleEmbed wrapper when rendering inside a table
  // cell whose column declares `hideLabel: true` (Date/Time projection
  // columns where every row's task name would be repetitive next to the
  // Task column anyway).
  embedHideLabel = false,
}) {
  bumpRender("instance");
  const { state } = useContext(GridDataContext);
  // Split into per-slice selectors so this component only re-renders when
  // one of its actually-read slices changes identity. Was a single
  // useGridActions() that re-rendered on EVERY actionsValue rebuild — i.e.
  // on every filter change / drop / field edit anywhere on the grid.
  const fieldsById = useGridActionsSelector(s => s.fieldsById);
  const addInstanceToContainer = useGridActionsSelector(s => s.addInstanceToContainer);
  const occurrencesById = useGridActionsSelector(s => s.occurrencesById);
  const modulesById = useGridActionsSelector(s => s.modulesById);
  const linkedGroupIndex = useGridActionsSelector(s => s.linkedGroupIndex);
  const instancesById = useGridActionsSelector(s => s.instancesById);
  const operationsById = useGridActionsSelector(s => s.operationsById);
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
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(label ?? "");
  // Effective label visibility: respect the per-instance user toggle UNLESS the
  // embed host forced it off (embedHideLabel from CellEmbedContext). Used
  // throughout the render below in place of the raw `showLabel`.
  const effectiveShowLabel = !embedHideLabel && showLabel;

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

  // Inline label editor — committed independently of the settings-popover draft.
  // Double-click on the label flips into an <input>; Enter / blur commits to
  // the module, Escape cancels. Keeps in sync with the live `label` prop so
  // external renames (settings popover, server echo) propagate.
  useEffect(() => { setLabelDraft(label ?? ""); }, [label, id]);
  const commitInlineLabel = useCallback(() => {
    const next = (labelDraft ?? "").trim();
    if (next && next !== (label ?? "")) {
      CommitHelpers.updateModule({ dispatch, socket, module: { id, label: next }, emit: true });
    }
    setIsEditingLabel(false);
  }, [labelDraft, label, id, dispatch, socket]);

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

  // Resolve effective field-visibility for this instance. Two layers:
  //   1. Occurrence cascade — the nearest fieldVisibility set on this
  //      occurrence or any ancestor (page/container), resolved via the
  //      shared ancestor walk. Governs doc / board / canvas / table-page.
  //   2. Table-cell column override — when this embed renders inside a
  //      table cell, the enclosing column can override per-column. The
  //      column override WINS over the occurrence cascade when set; when
  //      the column leaves it null the occurrence cascade applies.
  const cellEmbedCtx = useContext(CellEmbedContext);
  const columnFieldVisibility = cellEmbedCtx?.fieldVisibility || null;

  const effectiveFieldVisibility = useMemo(() => {
    if (columnFieldVisibility) return columnFieldVisibility;
    return getEffectiveFieldVisibilityForOccurrence(occurrence, { occurrencesById });
  }, [columnFieldVisibility, occurrence, occurrencesById]);

  // Get fields for this instance based on fieldBindings (skip hidden bindings),
  // then apply the cascade-resolved field-visibility (show/hide whitelist).
  // ADDITIONALLY: when the visibility is "show" mode, synthesize bindings for
  // any fieldIds in the show-list that aren't in the module's bindings — this
  // is how the Schedule Table's Date/Time projection columns render the date
  // and timeslot fields that schedule task modules DON'T formally bind (those
  // are stamped as VALUES on each occurrence via Build Day's defaultFields,
  // not declared as bindings on the source module). Without this, "show" mode
  // referring to an unbound fieldId rendered nothing.
  const instanceFields = useMemo(() => {
    if (!fieldsById) return [];
    const bindings = Array.isArray(instance?.fieldBindings) ? instance.fieldBindings : [];
    // Show-mode fieldIds: any binding whose fieldId is in this set must
    // render even when `binding.hidden === true`. The hide flag is for the
    // "normal render with default visibility" path — when a column / page
    // explicitly opts a field IN via "show" mode, that wins over the hide
    // flag (otherwise Schedule Table's Date column shows nothing: the
    // schedule task module binds dateFieldId with `hidden: true` so the
    // date doesn't show inline in the Schedule panel, but the table cell
    // is explicitly asking for it).
    const showSet = effectiveFieldVisibility?.mode === "show"
      && Array.isArray(effectiveFieldVisibility.fieldIds)
      ? new Set(effectiveFieldVisibility.fieldIds)
      : null;

    const fromBindings = bindings
      .filter(binding => {
        // Media-role bindings render in the dedicated media section under the
        // label + fields (see `mediaBinding` below) — never as an inline pill.
        if (binding.role === "media") return false;
        const isExplicitShow = showSet?.has(binding.fieldId);
        if (binding.hidden && !isExplicitShow) return false;
        return fieldPassesVisibility(binding.fieldId, effectiveFieldVisibility);
      })
      .map(binding => {
        const field = fieldsById[binding.fieldId];
        if (!field) return null;
        // Force-show: clone the binding without the hidden flag so any
        // downstream UI that checks binding.hidden also sees it as visible.
        const b = (binding.hidden && showSet?.has(binding.fieldId))
          ? { ...binding, hidden: false }
          : binding;
        return { field, binding: b };
      })
      .filter(Boolean);

    // Synthesize bindings for "show"-mode fieldIds that aren't bound at all
    // (e.g. schedule task modules don't formally bind date/timeslot — those
    // values are stamped by Build Day's defaultFields).
    const extras = [];
    if (showSet) {
      const alreadyBound = new Set(bindings.map(b => b.fieldId));
      for (const fid of showSet) {
        if (alreadyBound.has(fid)) continue;
        const field = fieldsById[fid];
        if (!field) continue;
        extras.push({ field, binding: { fieldId: fid, role: "input" } });
      }
    }

    return [...fromBindings, ...extras]
      .sort((a, b) => (a.binding.order || 0) - (b.binding.order || 0));
  }, [instance?.fieldBindings, fieldsById, effectiveFieldVisibility]);

  // ── Media section ──────────────────────────────────────────────────────────
  // A field binding with role:"media" surfaces below the label + fields as an
  // image/video/audio block (NOT an inline pill — see instanceFields filter).
  // The value is a file path served from /uploads/<fileRef> (the same path
  // ArtifactCard uses). Board/list instances only — doc-looking embeds
  // (renderBody = Artifact/Textblock cards) and table cells (__inCell) are
  // intentionally excluded: a poster under a textblock makes no sense.
  const mediaBinding = useMemo(() => {
    const bindings = Array.isArray(instance?.fieldBindings) ? instance.fieldBindings : [];
    const b = bindings.find(x => x.role === "media");
    if (!b) return null;
    const field = fieldsById?.[b.fieldId];
    if (!field) return null;
    return { binding: b, field };
  }, [instance?.fieldBindings, fieldsById]);

  const mediaValue = mediaBinding
    ? (occurrence?.fields?.[mediaBinding.binding.fieldId]?.value ?? null)
    : null;

  // board/list by default — never under a textblock/artifact card. Table cells
  // can opt back in via the column's showMedia toggle (CellEmbedContext.showMedia).
  const showMedia = !renderBody && !!mediaBinding && (
    !cellEmbedCtx?.__inCell || !!cellEmbedCtx?.showMedia
  );

  const mediaDropRef = useRef(null);

  // Resolve a dropped artifact's file path. Supports ManifestTree's
  // { type:"artifact", occurrenceId } payload and the CC/pool
  // { type:"module", role:"artifact", id, data } payload.
  const resolveArtifactFileRef = useCallback((sourceData) => {
    const d = sourceData || {};
    let mod = null;
    if (d.type === "artifact" && d.occurrenceId) {
      const occ = occurrencesById?.[d.occurrenceId];
      mod = occ ? (modulesById?.[occ.moduleId || occ.targetId]) : null;
    } else if (d.type === "module" && d.role === "artifact") {
      mod = d.data || modulesById?.[d.id];
    }
    return mod?.fileRef || null;
  }, [occurrencesById, modulesById]);

  const [mediaDragOver, setMediaDragOver] = useState(false);

  useEffect(() => {
    const el = mediaDropRef.current;
    if (!el || !showMedia || !mediaBinding || !occurrence?.id) return;
    return dropTargetForElements({
      element: el,
      canDrop: ({ source }) => {
        const d = source.data || {};
        return d.type === "artifact" || (d.type === "module" && d.role === "artifact");
      },
      onDragEnter: () => setMediaDragOver(true),
      onDragLeave: () => setMediaDragOver(false),
      onDrop: ({ source }) => {
        setMediaDragOver(false);
        const fileRef = resolveArtifactFileRef(source.data);
        if (!fileRef) return;
        const fid = mediaBinding.binding.fieldId;
        CommitHelpers.updateOccurrence({
          dispatch, socket, emit: true,
          occurrence: {
            id: occurrence.id,
            fields: {
              ...(occurrence.fields || {}),
              [fid]: { value: fileRef, flow: "in", timestamp: new Date().toISOString() },
            },
          },
        });
      },
    });
  }, [showMedia, mediaBinding, occurrence?.id, occurrence?.fields, resolveArtifactFileRef, dispatch, socket]);

  // Pick a renderer from the file extension (same kinds ArtifactCard uses).
  const mediaTag = useMemo(() => {
    if (!mediaValue || typeof mediaValue !== "string") return null;
    // Strip query string + fragment before sniffing extension so URLs like
    // https://image.tmdb.org/.../poster.jpg?token=abc still classify right.
    const cleaned = mediaValue.split(/[?#]/)[0];
    const ext = cleaned.split(".").pop()?.toLowerCase() || "";
    if (["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"].includes(ext)) return "img";
    if (["mp4", "webm", "mov", "m4v"].includes(ext)) return "video";
    if (["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) return "audio";
    return "img"; // best-effort default
  }, [mediaValue]);

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

  // Context for derived field calculations (includes filter unit for target
  // scaling — switching the D/W/M/Y toggle should re-scale every progress
  // target on screen).
  const fieldContext = useMemo(() => {
    const grid = state?.grid;
    const namedFilters = grid?.namedFilters || [];
    const activeFilter = namedFilters.find(f => f.id === grid?.activeFilterId);
    const activeFilterValues = grid?.activeFilterValues || {};
    // Unit precedence: per-value unit (the D/W/M/Y toggle writes here) →
    // filter.timeUnit → filter.timeScale (legacy) → daily. Map unit → period
    // name the scaler expects (day → daily, week → weekly, etc.).
    const UNIT_TO_PERIOD = { day: "daily", week: "weekly", month: "monthly", year: "yearly" };
    let unit = null;
    let span = 1;
    if (activeFilter) {
      const rawVal = activeFilterValues[activeFilter.id];
      if (rawVal && typeof rawVal === "object") {
        if (rawVal.unit) unit = rawVal.unit;
        const s = Number(rawVal.span);
        if (Number.isFinite(s) && s > 1) span = Math.floor(s);
      }
    }
    const currentTimeFilter = UNIT_TO_PERIOD[unit] || activeFilter?.timeScale || UNIT_TO_PERIOD[activeFilter?.timeUnit] || "daily";
    // Find the date value from the active filter values (first date-type value found)
    const dateVal = Object.values(activeFilterValues).find(v => {
      if (typeof v === "string") return /^\d{4}-\d{2}-\d{2}/.test(v);
      if (v && typeof v === "object" && typeof v.value === "string") return /^\d{4}-\d{2}-\d{2}/.test(v.value);
      return false;
    });
    const dateStr = typeof dateVal === "string" ? dateVal : (dateVal?.value || null);
    return {
      gridId: occurrence?.gridId,
      containerId: occurrence?.parentId,
      currentIteration: currentTimeFilter,
      currentSpan: span,
      iterationDate: dateStr || new Date().toISOString(),
      activeFilterUnit: unit || "day",
    };
  }, [occurrence?.gridId, occurrence?.parentId, state?.grid]);

  // Resolved cascading style for this instance — passes state?.grid
  // as the 4th arg so grid.meta.defaultStyle (the Grid-level cascade
  // root) flows through panel/container defaults into the instance.
  // Per-occurrence overrides still win (handled inside the helper).
  const resolvedInstanceCSS = useMemo(
    () => styleToCSS(resolveInstanceStyle(instance, container, panel, state?.grid)),
    [instance, container, panel, state?.grid]
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

  // Per-occurrence view-mode handling. Most instances render as Actual
  // (the full row below). Representation mode replaces the row with a
  // compact RepresentationView chip — used by mind-map nodes, value-
  // builder cards, and anywhere an instance is referenced without its
  // content. Preview mode is currently not distinct from Actual at the
  // instance level (instances are already compact rows); the
  // PreviewNode iframe pattern is for page-level previews. If/when a
  // preview-style "miniature instance card" is wanted, branch here.
  const instanceViewMode = getEffectiveViewMode(occurrence, "default");
  if (instanceViewMode === "representation") {
    return (
      <div
        role="listitem"
        aria-label={label || "Untitled instance"}
        data-occ-id={occurrence?.id}
        className="font-mono instance-row instance-row-representation"
        style={{ padding: "2px 4px" }}
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
          // minWidth:0 + default shrink lets the label child clip (and its
          // AutoMarquee detect overflow) whenever space is tight. No flex-grow
          // so wide layouts are visually unchanged (group sizes to content,
          // fields take the remainder exactly as before).
          : { display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0 }
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
          {effectiveShowLabel && hasLabel && (
            isEditingLabel ? (
              <input
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                onBlur={commitInlineLabel}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); commitInlineLabel(); }
                  if (e.key === "Escape") { setLabelDraft(label ?? ""); setIsEditingLabel(false); }
                  e.stopPropagation();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                autoFocus
                style={{
                  flex: "0 1 auto", minWidth: 0,
                  background: "transparent", border: "none", outline: "none",
                  fontSize: 12, color: "var(--text-primary)",
                  paddingTop: 2, paddingLeft: 2,
                  fontFamily: "inherit",
                }}
              />
            ) : (
              <div
                onDoubleClick={(e) => { e.stopPropagation(); setIsEditingLabel(true); }}
                style={{
                  flex: "0 1 auto",
                  minWidth: 0,
                  overflow: "hidden",
                  fontSize: 12,
                  color: "var(--text-primary)",
                  paddingTop: 2,
                  paddingLeft: 2,
                  cursor: "text",
                }}
                title="Double-click to rename"
              >
                {/* Auto-marquee: scrolls the label only when it's wider than the
                    space it has; otherwise renders static. */}
                <AutoMarquee>{label}</AutoMarquee>
              </div>
            )
          )}
        </div>{/* end label+radial wrapper */}

        {/* Custom body — used by ArtifactCard / TextblockCard. Replaces fields layout when provided. */}
        {renderBody && (
          <div className="instance-body" style={{ flex: 1, minWidth: 0, position: "relative" }}>
            {renderBody()}
          </div>
        )}

        {!renderBody && hasFields && (embedHideLabel || showLabel) && (
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
              // Each pill is its own AutoMarquee box: the fields row still
              // wraps normally (each box is a flex item), but a single pill
              // that is itself wider than the available width auto-scrolls
              // instead of overflowing the container.
              <AutoMarquee key={field.id} className="instance-field-mq">
                <FieldRenderer
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
              </AutoMarquee>
            ))}
          </div>
        )}

        {/* Media section — full-width row below label + fields. Board/list
            only (showMedia gate). Doubles as an artifact drop target. */}
        {showMedia && (() => {
          // mediaValue can be either a local upload (fileRef → /uploads/<…>)
          // or an absolute URL (http(s):// or data:) — e.g. seeded library
          // poster URLs from openlibrary / wikimedia. Detect-and-use-as-is
          // when absolute; prefix /uploads/ otherwise.
          const isAbsolute =
            typeof mediaValue === "string" &&
            /^(https?:\/\/|data:)/.test(mediaValue);
          const src = isAbsolute ? mediaValue : `/uploads/${mediaValue}`;
          return (
            <div
              ref={mediaDropRef}
              className={"instance-media" + (mediaDragOver ? " instance-media-dragover" : "") + (mediaValue ? "" : " instance-media-empty")}
              style={{ flex: "1 1 100%", minWidth: 0 }}
              title={mediaValue ? (mediaBinding?.field?.name || "Media") : "Drop an artifact here"}
            >
              {mediaValue && mediaTag === "img" && (
                <img className="instance-media-el" src={src} alt={mediaBinding?.field?.name || label || "media"} />
              )}
              {mediaValue && mediaTag === "video" && (
                <video className="instance-media-el" src={src} controls playsInline preload="metadata" />
              )}
              {mediaValue && mediaTag === "audio" && (
                <audio className="instance-media-el" src={src} controls style={{ width: "100%" }} />
              )}
              {!mediaValue && (
                <span className="instance-media-placeholder">Drop media here</span>
              )}
            </div>
          );
        })()}

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
  embedHideLabel = false,
  renderBody = null,
  floatHandle = false,
}) {
  const dragCtx = useDragContext();
  const { isContainerDrag } = dragCtx;
  const selection = useContext(SelectionContext);
  // Pull occurrencesById so the bulk-delete handler can look up each
  // selected occurrence (+ its parent) and pass them to removeOccurrence
  // so MeasureOps fire and the parent's occurrences[] cleans up. Single-
  // item delete below already does this for the right-clicked target.
  const occurrencesById = useGridActionsSelector(s => s.occurrencesById);
  const parentByChildId = useGridActionsSelector(s => s.parentByChildId);
  const linkedGroupIndex = useGridActionsSelector(s => s.linkedGroupIndex);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [showDoc, setShowDoc] = useState(false);

  const occId = occurrence?.id;
  const isSelected = occId ? selection.isSelected(occId) : false;
  // Clipboard-staged class — applied when this occurrence is currently in
  // the clipboard (post Copy / Move / Copy-link from the right-click menu).
  // Distinct dashed-marching-ants treatment per mode so the user can tell
  // at a glance what kind of paste is queued.
  const clipMode = selection.clipboard?.mode;
  const isClipboardStaged = !!(occId && clipMode && selection.clipboard.ids.includes(occId));

  const handleWrapperClick = useCallback((e) => {
    if (e.shiftKey && occId) {
      e.preventDefault();
      e.stopPropagation();
      selection.toggle(occId);
    }
  }, [occId, selection]);

  const handleContextMenu = useCallback((e) => {
    if ("ontouchstart" in window) return;
    e.preventDefault();
    e.stopPropagation();
    // Bulk-action items appear on top when >1 occurrence is selected — keeps
    // the muscle memory of right-click → operate on selection without
    // forcing the user to right-click each item individually. Copy/Move/
    // Copy-link stage the selection into the SelectionContext clipboard;
    // Paste-here on a container or page replays them in the target.
    const bulkItems = selection.count > 1 ? [
      {
        label: `Copy ${selection.count} selected`,
        icon: ClipboardCopy,
        onClick: () => selection.setClipboard("copy", [...selection.selectedIds]),
      },
      {
        label: `Move ${selection.count} selected`,
        icon: MoveRight,
        onClick: () => selection.setClipboard("move", [...selection.selectedIds]),
      },
      {
        label: `Copy-link ${selection.count} selected`,
        icon: Link2,
        onClick: () => selection.setClipboard("copylink", [...selection.selectedIds]),
      },
      { separator: true },
      {
        label: `Delete ${selection.count} selected`,
        icon: Trash2, danger: true,
        onClick: () => {
          // Destructive action with no group-level undo — match the
          // ModulePage.handleDelete pattern and require explicit
          // confirmation. Window.confirm is intentionally simple here
          // (no shadcn AlertDialog wrapper) so the menu close + dialog
          // ordering doesn't fight with the ContextMenu portal.
          const n = selection.count;
          const ok = window.confirm(
            `Delete ${n} selected item${n === 1 ? "" : "s"}? This cannot be undone.`
          );
          if (!ok) return;
          const ids = [...selection.selectedIds];
          selection.clear();
          // Resolve each occurrence + its parent so removeOccurrence
          // fires MeasureOps for the deleted fields and cleans the
          // parent's occurrences[] list. Parent lookup mirrors the
          // pasteClipboard / dragHitTesting convention: reverse-scan
          // occurrences[] arrays, fall back to parentId.
          for (const id of ids) {
            const target = occurrencesById?.[id];
            let parentOcc = null;
            if (occurrencesById) {
              // O(1) parent lookup via App-level parentByChildId index.
              // Was an O(N) scan over every occurrence per selected id
              // (so bulk-delete of N items was O(N×total)).
              const parentId = parentByChildId?.[id];
              parentOcc = parentId ? occurrencesById[parentId] : null;
              if (!parentOcc && target?.parentId) parentOcc = occurrencesById[target.parentId] || null;
            }
            CommitHelpers.removeOccurrence({
              dispatch, socket, occurrenceId: id,
              occurrence: target || undefined,
              parentOccurrence: parentOcc || undefined,
              emit: true,
            });
          }
        },
      },
      { label: "Clear selection", icon: X, onClick: () => selection.clear() },
      { separator: true },
    ] : [];
    const items = [
      ...bulkItems,
      onInstanceFocus && { label: "Focus", icon: Focus, onClick: () => onInstanceFocus(module, occurrence) },
      onInstanceFocus && { separator: true },
      {
        // "Duplicate" not "Copy" — this mints a NEW MODULE (independent
        // template) with a "(Copy)" label and adds it to the container.
        // Bulk "Copy N selected" above is different: it shares the
        // existing module across the new occurrences. Both are useful;
        // the label disambiguates them so users don't pick the wrong one.
        label: "Duplicate (new instance)",
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
  }, [module, occurrence, containerId, containerOccurrence, onInstanceFocus, dispatch, socket, selection, occurrencesById]);

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
      className={`instance-wrap${isSelected ? " is-selected" : ""}${isClipboardStaged ? ` is-clipboard-staged clipboard-${clipMode}` : ""}`}
      style={{
        touchAction: "manipulation",
        opacity: isDragging ? 0.4 : 1,
        background: "transparent", borderRadius: 4,
        transition: "opacity 0.1s", marginBottom: 2, position: "relative",
      }}
      {...props}
      onClick={handleWrapperClick}
      onContextMenu={handleContextMenu}
    >
      <ContextMenu ctx={ctxMenu} onClose={() => setCtxMenu(null)} />

      {isOver && closestEdge === "top" && <div className="drop-indicator drop-indicator-inst-top" />}
      {isOver && closestEdge === "bottom" && <div className="drop-indicator drop-indicator-inst-bottom" />}
      {isOver && closestEdge === "left" && <div className="drop-indicator drop-indicator-inst-left" />}
      {isOver && closestEdge === "right" && <div className="drop-indicator drop-indicator-inst-right" />}

      {occurrence?.linkedGroupId && (() => {
        const siblings = linkedGroupIndex?.[occurrence.linkedGroupId] || [];
        const count = Math.max(0, siblings.length - 1);
        const title = count > 0 ? `Linked to ${count} other ${count === 1 ? "copy" : "copies"}` : "Linked copy";
        return <Link2 title={title} className="linked-copy-badge" />;
      })()}

      <InstanceInner
        id={module.id}
        label={occurrence?.label ?? module.label}
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
        embedHideLabel={embedHideLabel}
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
