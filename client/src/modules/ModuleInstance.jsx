// modules/ModuleInstance.jsx
// Instance wrapper within a Container — handles drag/drop, context menu, and doc toggle.
// Also contains the inner Instance row (label, field pills, operation widgets).
// Merged from ModuleInstance.jsx + Instance.jsx.

import React, { useContext, useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useGridActionsSelector, useGridActionsSelectorShallow } from "../GridActionsContext";

// Stable empty array for selector fallbacks — a fresh [] per selector run
// would defeat the Object.is stability the selector layer depends on.
const EMPTY_ARR = [];
import { SelectionContext } from "../state/SelectionContext";
import ContextMenu from "../ui/ContextMenu";
import { useLongPress } from "../hooks/useLongPress";
import InstanceForm from "../ui/InstanceForm";
import FieldRenderer from "../ui/FieldRenderer";
import { bumpRender, useRenderAttribution } from "../helpers/renderProbe";
import RadialMenu from "../ui/RadialMenu";
import RepresentationView from "../ui/RepresentationView";
import { getEffectiveViewMode } from "../helpers/viewMode";
import { jumpToOccurrence } from "../helpers/jumpToOccurrence";
import { resolveLabelTokens, materializeLabelTokens, commitLabelTokens } from "../helpers/labelTokens";
import {
  Popover,
  PopoverContent,
  PopoverAnchor,
} from "@/components/ui/popover";
import { Link2, Unlink, Settings, Copy, Move, Play, Zap, Eye, EyeOff, X, Trash2, Focus, ClipboardCopy, MoveRight, Shuffle, Box, Type, FileDown } from "lucide-react";
import { convertLeafRole, CONVERTIBLE_LEAF_ROLES } from "../helpers/convertOccurrence";
import { canConvertLinkToPage, resolveExternalLink, convertLinkToPage } from "../helpers/linkToPage";
import { toast } from "sonner";
import * as CommitHelpers from "../helpers/CommitHelpers";
import {
  useDragDrop,
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
import { consumeLabelEdit } from "../helpers/pendingLabelEdit.js";
import { primaryMediaOf } from "../helpers/occurrenceMedia";
import { useComputedValue } from "../state/computedValuesStore";

// Operation display widget — its own component so the per-key
// computedValues subscription lives HERE, not on the whole instance
// (which used to re-render every instance on every op-drain batch).
function OpDisplayPill({ binding, op }) {
  const val = useComputedValue(op.targetFieldId);
  return (
    <span
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
  // Split into per-slice selectors so this component only re-renders when
  // one of its actually-read slices changes identity. Was a single
  // useGridActions() that re-rendered on EVERY actionsValue rebuild — i.e.
  // on every filter change / drop / field edit anywhere on the grid.
  //
  // The occurrence-derived maps (occurrencesById / linkedGroupIndex) and the
  // raw `state` are rebuilt on EVERY occurrence write — instances only
  // subscribe to their OWN slices (linked group, ancestor chain, grid,
  // activeId) and read the maps at compute/callback time via the stable
  // non-subscribing getters. Module-derived maps stay whole-map (stable).
  const fieldsById = useGridActionsSelector(s => s.fieldsById);
  const addInstanceToContainer = useGridActionsSelector(s => s.addInstanceToContainer);
  const modulesById = useGridActionsSelector(s => s.modulesById);
  const instancesById = useGridActionsSelector(s => s.instancesById);
  const operationsById = useGridActionsSelector(s => s.operationsById);
  const ctxGrid = useGridActionsSelector(s => s.state.grid);
  // Select the BOOLEAN, not the raw activeId — the raw value changes for every
  // instance when a drag sets/clears it, re-rendering all of them; the boolean
  // changes only for the affected instance.
  const isOriginalActiveSel = useGridActionsSelector(s => s.state.activeId === id);
  // Fallback closures cover custom providers (tests/previews) that omit the
  // getters; the app's getters are identity-stable.
  const getOcc = useGridActionsSelector(s => s.getOcc || ((oid) => (oid ? s.occurrencesById?.[oid] || null : null)));
  const getOccMap = useGridActionsSelector(s => s.getOccMap || (() => s.occurrencesById || {}));
  const getState = useGridActionsSelector(s => s.getState || (() => s.state || {}));
  // Own linked-group members — element-wise stable, so only a change to one
  // of THIS instance's linked siblings re-renders it.
  const linkedGroup = useGridActionsSelectorShallow(s =>
    occurrence?.linkedGroupId ? (s.linkedGroupIndex?.[occurrence.linkedGroupId] || EMPTY_ARR) : EMPTY_ARR
  );
  // Ancestor occurrence refs root-ward — the reactive dep for the
  // field-visibility cascade walk (and any future ancestor-derived memo).
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
  const isOriginalActive = !overlay && isOriginalActiveSel;
  // Lite state for FieldRenderer's `state?.grid` reads. Ops read the FULL
  // fresh state via getState() in Field.jsx — never this object.
  const ctxStateLite = useMemo(() => ({ grid: ctxGrid }), [ctxGrid]);

  // DIAG (window.__RENDER_ATTR): which input changed → this render.
  useRenderAttribution("instance", {
    p_id: id, p_label: label, p_instance: instance, p_occurrence: occurrence,
    p_panel: panel, p_container: container, p_containerOccurrence: containerOccurrence,
    p_dragAttributes: dragAttributes, p_dragListeners: dragListeners,
    p_dragHandleRef: dragHandleRef, p_onDoubleClick: onDoubleClick,
    p_toggleDoc: toggleDoc, p_renderBody: renderBody,
    s_fieldsById: fieldsById, s_addInstanceToContainer: addInstanceToContainer,
    s_modulesById: modulesById, s_instancesById: instancesById,
    s_operationsById: operationsById, s_ctxGrid: ctxGrid, s_isActive: isOriginalActiveSel,
    s_getOcc: getOcc, s_getOccMap: getOccMap, s_getState: getState,
    s_linkedGroup: linkedGroup, s_ancestorChain: ancestorChain,
    // eslint-disable-next-line react-hooks/rules-of-hooks
    s_selection: useContext(SelectionContext),
    // eslint-disable-next-line react-hooks/rules-of-hooks
    s_cellEmbedCtx: useContext(CellEmbedContext),
    p_overlay: overlay, p_dispatch: dispatch, p_socket: socket,
    p_embedRadialItems: embedRadialItems, p_embedOnDelete: embedOnDelete,
    p_floatHandle: floatHandle, p_embedHideLabel: embedHideLabel,
  }, label);

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
    return linkedGroup.filter(o => o.id !== occurrence.id);
  }, [occurrence?.linkedGroupId, occurrence?.id, linkedGroup]);

  useEffect(() => {
    setDraft({ label: label ?? "" });
  }, [label, id]);

  // Open the inline label editor with field tokens MATERIALIZED — "[Water]" /
  // "{Water}" become "[Water:16]" / "{Water:16oz}" so the value is editable
  // in place (typing "14" over it writes the FIELD on commit; the label
  // re-stores without the value). helpers/labelTokens.js owns the grammar.
  const startLabelEdit = useCallback(() => {
    setLabelDraft(materializeLabelTokens(label ?? "", occurrence, fieldsById));
    setIsEditingLabel(true);
  }, [label, occurrence, fieldsById]);

  // Just-created via quick-add / insert-gap → open the label editor focused so
  // the user can type the name immediately (see helpers/pendingLabelEdit).
  useEffect(() => {
    if (consumeLabelEdit(id)) startLabelEdit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
    // Token write-back: "{Water:14}" → write 14 to the Water field, store the
    // label as "{Water}". Non-token labels pass through untouched.
    const { label: cleaned, writes } = commitLabelTokens(next, occurrence || {}, fieldsById || {});
    if (cleaned && cleaned !== (label ?? "")) {
      CommitHelpers.updateModule({ dispatch, socket, module: { id, label: cleaned }, emit: true });
    }
    if (writes.length && occurrence?.id) {
      // Mirror FieldRenderer.handleCommit: full updated occurrence + a
      // triggerField per write so trackers/ops fire like any field edit.
      let fields = { ...(occurrence.fields || {}) };
      for (const w of writes) {
        const prev = fields[w.fieldId];
        const flow = (prev && typeof prev === "object" && prev.flow) || "in";
        fields = { ...fields, [w.fieldId]: { value: w.value, flow } };
        CommitHelpers.updateOccurrence({
          dispatch, socket,
          occurrence: { ...occurrence, fields },
          emit: true,
          triggerField: { fieldId: w.fieldId, value: w.value, instanceId: occurrence.moduleId },
        });
      }
    }
    setIsEditingLabel(false);
  }, [labelDraft, label, id, occurrence, fieldsById, dispatch, socket]);

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
    // ancestorChain is the reactive dep for the ancestor walk inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return getEffectiveFieldVisibilityForOccurrence(occurrence, { occurrencesById: getOccMap() });
  }, [columnFieldVisibility, occurrence, ancestorChain, getOccMap]);

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
  // Opt-in compact media (2026-07-25, per user): a SMALL thumbnail inline with
  // the label instead of the full-width block below. Board option occurrences
  // set it — a poster-sized block per option made the boards unreadable.
  const mediaInline = !!(occurrence?.meta?.mediaInline ?? instance?.meta?.mediaInline);
  // The media value is an artifact OCCURRENCE ID now, resolved through the one
  // resolver every thumbnail site reads (2026-08-06). It handles the local vs
  // absolute fileRef split that used to be re-derived here.
  const primaryMedia = primaryMediaOf(occurrence, {
    occurrencesById: getOccMap(), modulesById, fieldsById,
  });
  const mediaSrc = primaryMedia?.src || null;
  const mediaKind = primaryMedia?.kind || null;

  const mediaDropRef = useRef(null);

  // Resolve a dropped artifact's file path. Supports ManifestTree's
  // { type:"artifact", occurrenceId } payload and the CC/pool
  // { type:"module", role:"artifact", id, data } payload.
  const resolveArtifactFileRef = useCallback((sourceData) => {
    const d = sourceData || {};
    let mod = null;
    if (d.type === "artifact" && d.occurrenceId) {
      const occ = getOcc(d.occurrenceId);
      mod = occ ? (modulesById?.[occ.moduleId]) : null;
    } else if (d.type === "module" && d.role === "artifact") {
      mod = d.data || modulesById?.[d.id];
    }
    return mod?.fileRef || null;
  }, [getOcc, modulesById]);

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

  // Pick a renderer. The artifact module already carries a `kind` (mimeToKind
  // decided it at upload), so this reads that instead of re-sniffing an
  // extension off a URL — one fewer place that has to know what a .m4v is.
  const mediaTag = useMemo(() => {
    if (!mediaSrc) return null;
    if (mediaKind === "video") return "video";
    if (mediaKind === "audio") return "audio";
    return "img"; // image / pdf-thumb / best-effort default
  }, [mediaSrc, mediaKind]);

  // A row carrying an inline thumbnail anchors its handle + label to the TOP of
  // that picture instead of centring on it (user 2026-07-31: "keep the text on
  // the top though, right now it's centered with the image"). This has to be
  // decided HERE rather than in a stylesheet: the group's alignItems is an
  // INLINE style below, and an inline style beats any rule regardless of
  // specificity — the fourth time that trap has bitten this codebase.
  const hasInlineThumb = showMedia && mediaInline && !!mediaSrc && mediaTag === "img";

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
    const occLookup = getOccMap();
    const transaction = { type: "ButtonOp", operationId: op.id, instanceId: id, occurrenceId: occurrence?.id };
    const updates = runMatchingOperations(
      Object.values(operationsLookup),
      "ButtonOp",
      transaction,
      { state: getState(), fieldsById: fieldsLookup, operationsById: operationsLookup, occurrencesById: occLookup }
    );
    if (updates.length > 0) {
      const displayUpdates = updates.filter(u => !u._effect);
      if (displayUpdates.length > 0) dispatch(setComputedValuesAction(displayUpdates));
    }
  }, [id, occurrence?.id, getState, fieldsById, operationsById, getOccMap, dispatch]);

  // Context for derived field calculations (includes filter unit for target
  // scaling — switching the D/W/M/Y toggle should re-scale every progress
  // target on screen).
  const fieldContext = useMemo(() => {
    const grid = ctxGrid;
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
  }, [occurrence?.gridId, occurrence?.parentId, ctxGrid]);

  // Resolved cascading style for this instance — passes state?.grid
  // as the 4th arg so grid.meta.defaultStyle (the Grid-level cascade
  // root) flows through panel/container defaults into the instance.
  // Per-occurrence overrides still win (handled inside the helper).
  const resolvedInstanceCSS = useMemo(
    () => styleToCSS(resolveInstanceStyle(instance, container, panel, ctxGrid)),
    [instance, container, panel, ctxGrid]
  );

  // Build radial menu items - include Break Link when occurrence is linked
  // Convert-role button(s) for the RADIAL menu (touch-accessible; right-click is
  // desktop-only now). textblock ↔ instance, each with the target's own icon.
  const convertLeafItems = useMemo(() => {
    if (!CONVERTIBLE_LEAF_ROLES.includes(instance?.role)) return [];
    const ICONS = { instance: Box, textblock: Type };
    return CONVERTIBLE_LEAF_ROLES.filter(r => r !== instance.role).map(r => ({
      icon: ICONS[r] || Shuffle,
      label: `Convert to ${r === "instance" ? "Instance" : "Textblock"}`,
      onClick: () => convertLeafRole({ dispatch, socket, occurrence, module: instance, targetRole: r }),
      color: "bg-teal-700 hover:bg-teal-600",
    }));
  }, [instance, occurrence, dispatch, socket]);

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
          : { display: "flex", flexDirection: "row", alignItems: hasInlineThumb ? "flex-start" : "center", gap: 4, minWidth: 0 }
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
                  extraItems={[...(embedRadialItems || []), ...convertLeafItems]}
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
          {effectiveShowLabel && (hasLabel || !renderBody) && (
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
                onFocus={(e) => e.target.select()}
                autoFocus
                style={{
                  flex: "0 1 auto", minWidth: 0,
                  background: "transparent", border: "none", outline: "none",
                  fontSize: 12, color: "var(--text-primary)",
                  paddingTop: 0, paddingLeft: 2,
                  fontFamily: "inherit",
                }}
              />
            ) : (
              <>
              {showMedia && mediaInline && mediaSrc && mediaTag === "img" && (
                <img
                  className="instance-media-inline"
                  src={mediaSrc}
                  alt={label || "media"}
                  title={mediaBinding?.field?.name || "Media"}
                />
              )}
              <div
                className="instance-label"
                onDoubleClick={(e) => { e.stopPropagation(); startLabelEdit(); }}
                style={{
                  flex: "0 1 auto",
                  minWidth: 0,
                  overflow: "hidden",
                  fontSize: 12,
                  color: "var(--text-primary)",
                  paddingTop: 0,
                  paddingLeft: 2,
                  cursor: "text",
                }}
                title="Double-click to rename"
              >
                {/* Auto-marquee: scrolls the label only when it's wider than the
                    space it has; otherwise renders static. Empty labels render a
                    faint, double-clickable "Untitled" placeholder so a blank
                    occurrence can be named — but NOT for textblock / artifact
                    bodies (renderBody), whose content IS the body and which have
                    no meaningful label.
                    Display goes through resolveLabelTokens: "[Field Name]" in
                    the label renders the occurrence's live field value; the
                    RAW label (with tokens) is what inline editing shows. */}
                {hasLabel
                  ? <AutoMarquee>{resolveLabelTokens(label, occurrence, fieldsById)}</AutoMarquee>
                  : (renderBody ? null : <span style={{ opacity: 0.4, fontStyle: "italic" }}>Untitled</span>)}
              </div>
              </>
            )
          )}
        </div>{/* end label+radial wrapper */}

        {/* Custom body — used by ArtifactCard / TextblockCard. Replaces fields layout when provided.
            The .instance-row sets user-select:none (so dragging an instance doesn't smear-select
            its label); that cascades into a textblock's editor and blocked click-drag text
            selection. Re-enable selection for the body subtree. */}
        {renderBody && (
          <div
            className="instance-body"
            style={{ flex: 1, minWidth: 0, position: "relative", userSelect: "text", WebkitUserSelect: "text" }}
          >
            {renderBody()}
          </div>
        )}

        {/* Fields row. Body-rendered occurrences (textblock/artifact cards) get
            it too, as a full-width strip UNDER the body — a textblock carrying
            a tags-style field must surface it or the binding is invisible
            (feed field-check use case, 2026-07-12). Unbound cards render
            nothing extra (hasFields false), so default textblocks/wraps are
            byte-identical. */}
        {hasFields && (renderBody || embedHideLabel || showLabel) && (
          <div
            className={"instance-fields" + (renderBody ? " instance-fields--under-body" : "")}
            style={{
              flex: renderBody ? "1 1 100%" : "1 1 160px",
              minWidth: 0,
              display: "flex",
              flexWrap: "wrap",
              gap: 4,
              justifyContent: renderBody ? "flex-start" : "flex-end",
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
                  state={ctxStateLite}
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
            only (showMedia gate). Doubles as an artifact drop target.
            `meta.mediaInline` opts into a SMALL thumbnail rendered inline with
            the label instead (board options — a poster-sized block per option
            made the boards unreadable). */}
        {showMedia && !mediaInline && (() => {
          // Resolved once, above, through helpers/occurrenceMedia — the
          // local-vs-absolute fileRef split lives in resolveFileRef now rather
          // than being re-derived at every render site.
          const src = mediaSrc;
          return (
            <div
              ref={mediaDropRef}
              className={"instance-media" + (mediaDragOver ? " instance-media-dragover" : "") + (src ? "" : " instance-media-empty")}
              style={{ flex: "1 1 100%", minWidth: 0 }}
              title={src ? (mediaBinding?.field?.name || "Media") : "Drop an artifact here"}
            >
              {src && mediaTag === "img" && (
                <img className="instance-media-el" src={src} alt={mediaBinding?.field?.name || label || "media"} />
              )}
              {src && mediaTag === "video" && (
                <video className="instance-media-el" src={src} controls playsInline preload="metadata" />
              )}
              {src && mediaTag === "audio" && (
                <audio className="instance-media-el" src={src} controls style={{ width: "100%" }} />
              )}
              {!src && (
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
                return <OpDisplayPill key={binding.operationId} binding={binding} op={op} />;
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
  // Instances are the hot path — no reactive drag-state subscription (see
  // ModuleContainer). Drag-type gating rides on the hook's `accepts` list.
  const selection = useContext(SelectionContext);
  // The bulk-delete handler looks up each selected occurrence (+ its parent)
  // at CALLBACK time via the non-subscribing getters — subscribing to the
  // per-write-rebuilt maps here re-rendered every instance on every write.
  const getOccMap = useGridActionsSelector(s => s.getOccMap || (() => s.occurrencesById || {}));
  const getParentId = useGridActionsSelector(s => s.getParentId || ((oid) => (oid ? s.parentByChildId?.[oid] || null : null)));
  // Linked-badge count for THIS instance's group — a number, so Object.is
  // keeps it stable across unrelated writes.
  const linkedGroupCount = useGridActionsSelector(s =>
    occurrence?.linkedGroupId ? (s.linkedGroupIndex?.[occurrence.linkedGroupId]?.length || 0) : 0
  );
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
          const occMap = getOccMap();
          for (const id of ids) {
            const target = occMap[id];
            // O(1) parent lookup via App-level parentByChildId index (read
            // at callback time). Was an O(N) scan over every occurrence per
            // selected id (so bulk-delete of N items was O(N×total)).
            const parentId = getParentId(id);
            let parentOcc = parentId ? occMap[parentId] : null;
            if (!parentOcc && target?.parentId) parentOcc = occMap[target.parentId] || null;
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
      // Convert this leaf between a typed textblock and a data instance
      // (see helpers/convertOccurrence.js). Textblock ↔ instance only.
      ...(CONVERTIBLE_LEAF_ROLES.includes(module?.role)
        ? CONVERTIBLE_LEAF_ROLES.filter(r => r !== module.role).map(r => ({
            label: `Convert to ${r === "instance" ? "Instance" : "Textblock"}`,
            icon: Shuffle,
            onClick: () => convertLeafRole({ dispatch, socket, occurrence, module, targetRole: r }),
          }))
        : []),
      // "Convert to page" — fetch what an EXTERNAL link points at and build
      // the whole tree from it (user, 2026-08-07). Offered only on a link that
      // points outward: an in-app link already goes somewhere in the grid, so
      // converting it would duplicate a page that exists.
      canConvertLinkToPage(occurrence, module) && {
        label: "Convert to page",
        icon: FileDown,
        onClick: async () => {
          const url = resolveExternalLink(occurrence, module);
          const gridId = occurrence?.gridId;
          if (!url || !gridId) return;
          // A fetch + full import is seconds, not milliseconds — say so, and
          // resolve the SAME toast so the user is never left guessing.
          const toastId = toast.loading(`Importing ${url}…`);
          const res = await convertLinkToPage({ socket, gridId, url });
          if (res?.ok) {
            toast.success("Page imported", { id: toastId });
            // Land the user on what they just made.
            if (res.rootOccurrenceId) jumpToOccurrence(res.rootOccurrenceId);
          } else {
            // The server's reason is specific ("not a web page", "timed out",
            // "redirected") — pass it through rather than a generic failure.
            toast.error(`Couldn't import: ${res?.error || "unknown error"}`, { id: toastId });
          }
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
  }, [module, occurrence, containerId, containerOccurrence, onInstanceFocus, dispatch, socket, selection, getOccMap, getParentId]);

  // Touch: long-press opens the same menu (right-click has no touch equivalent).
  const instanceLongPress = useLongPress(({ x, y }) =>
    handleContextMenu({ clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} }));

  const handleRef = useRef(null);

  const { ref, isDragging, isOver, closestEdge, props } = useDragDrop({
    type: DragType.INSTANCE,
    id: module.id,
    data: { ...module, occurrence },
    context: { containerId, containerOccurrenceId: containerOccurrence?.id || null, panelId, instanceId: module.id, occurrenceId: occurrence?.id, sourceType: embedSourceType },
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
      {...instanceLongPress}
    >
      <ContextMenu ctx={ctxMenu} onClose={() => setCtxMenu(null)} />

      {isOver && closestEdge === "top" && <div className="drop-indicator drop-indicator-inst-top" />}
      {isOver && closestEdge === "bottom" && <div className="drop-indicator drop-indicator-inst-bottom" />}
      {isOver && closestEdge === "left" && <div className="drop-indicator drop-indicator-inst-left" />}
      {isOver && closestEdge === "right" && <div className="drop-indicator drop-indicator-inst-right" />}

      {occurrence?.linkedGroupId && (() => {
        const count = Math.max(0, linkedGroupCount - 1);
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

export default React.memo(ModuleInstance);
