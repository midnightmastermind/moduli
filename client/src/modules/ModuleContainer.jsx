// modules/ModuleContainer.jsx
// Extracted from Module.jsx ModuleContainer component.
// Renders a container header and its instances.
// Handles doc containers, focused instance view, list view, sorting.

import React, { useRef, useMemo, useState, useReducer, useCallback, useEffect, useContext } from "react";
import { createPortal } from "react-dom";
import RadialMenu from "../ui/RadialMenu";
import { toast } from "sonner";
import ContextMenu from "../ui/ContextMenu";
import ContainerForm from "../ui/ContainerForm";
import TransactionHistory from "../ui/TransactionHistory";
import { Popover, PopoverTrigger, PopoverContent, PopoverAnchor } from "@/components/ui/popover";
import { bumpRender } from "../helpers/renderProbe";

import { useGridActionsSelector } from "../GridActionsContext";
import { SelectionContext } from "../state/SelectionContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import {
  getContainerItems,
  getContainerItemsWithOccurrences,
} from "../helpers/LayoutHelpers";
import { runPasteClipboard } from "../helpers/pasteClipboard";
import {
  useDragDrop,
  useDroppable,
  useDragContext,
  DragType,
  DropAccepts,
} from "../helpers/dragSystem";
import { resolveContainerStyle, styleToCSS } from "../helpers/StyleHelpers";
import { hexToRgba, lightenHex } from "../helpers/colorHelpers.js";
import { getEffectiveFilterForOccurrence, isOccurrenceVisible, getLocalFilterConditions } from "../state/selectors";
import HeaderChevron from "../ui/HeaderChevron";
import HeaderDropdown from "../ui/HeaderDropdown";
import FiltersSection from "../ui/FiltersSection";
import AutoMarquee from "../ui/AutoMarquee.jsx";
import RepresentationView from "../ui/RepresentationView";
import { getEffectiveViewMode } from "../helpers/viewMode";
import { buildLayoutCascadeContext, resolveLayoutCascade } from "../helpers/layoutCascade";
import { summarizeSelection } from "../ui/filterSummary";

// Schedule day-cols have a module label like "Schedule - Sunday, May 24th, 2026"
// stamped at CREATE time and never updated again. When the user changes a
// day-col's own filterOverride (HeaderDropdown picker), the title should reflect
// the new range. computeScheduleColLabel returns a recomputed label string, or
// null when the occurrence isn't a schedule day-col / has no date in its
// override (caller falls back to module.label).
const SCHEDULE_LABEL_PREFIX = "Schedule - ";
const ISO_DAY_RX = /^\d{4}-\d{2}-\d{2}/;
function computeScheduleColLabel(occurrence, module) {
  if (!module?.label || !module.label.startsWith(SCHEDULE_LABEL_PREFIX)) return null;
  const override = occurrence?.filterOverride;
  if (!override || typeof override !== "object") return null;
  let shape = null;
  for (const v of Object.values(override)) {
    if (v == null) continue;
    if (typeof v === "string" && ISO_DAY_RX.test(v)) {
      shape = { value: v, unit: "day" };
      break;
    }
    if (typeof v === "object" && v && typeof v.value === "string" && ISO_DAY_RX.test(v.value)) {
      shape = v;
      break;
    }
  }
  if (!shape) return null;
  const summary = summarizeSelection(shape, { maxSegments: 3 });
  return summary ? `${SCHEDULE_LABEL_PREFIX}${summary}` : null;
}
import { jumpToOccurrence } from "../helpers/jumpToOccurrence";
import SortSection from "../ui/SortSection";
import FieldVisibilitySection from "../ui/FieldVisibilitySection";
import ViewModeSection from "../ui/ViewModeSection";
import LayoutCascadeSection from "../ui/LayoutCascadeSection";
import TemplatesSection from "../ui/TemplatesSection";

import {
  ChevronRight,
  ChevronDown,
  Copy,
  Link2,
  Unlink,
  Trash2,
  ArrowLeft,
  X,
  ClipboardPaste,
  Plus,
  FileText,
  Type,
} from "lucide-react";

import { CanvasDrawSection } from "./CanvasContent.jsx";
import { DocEditorShell } from "./DocContent.jsx";
import ContainerPool from "./containers/ContainerPool.jsx";
import ContainerTable from "./containers/ContainerTable.jsx";
import { FilterOverridePopup } from "./containerPopups.jsx";
import ModuleInstance from "./ModuleInstance.jsx";
import ArtifactCard from "./ArtifactCard.jsx";
import TextblockCard from "./TextblockCard.jsx";
import BoundHeader from "./BoundHeader.jsx";
import QuickAddMenu from "../ui/QuickAddMenu.jsx";
import FieldRenderer from "../ui/FieldRenderer.jsx";
import { resolveEditorBinding } from "../state/editorBindings.js";

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
  bumpRender("container");
  // Per-slice selectors — only re-render when an actually-read slice's identity
  // changes (was a single useGridActions() that re-rendered on every actionsValue
  // rebuild — i.e. on every filter change anywhere on the grid).
  const occurrencesById = useGridActionsSelector(s => s.occurrencesById);
  const occurrencesByModuleId = useGridActionsSelector(s => s.occurrencesByModuleId);
  const parentByChildId = useGridActionsSelector(s => s.parentByChildId);
  const instancesById = useGridActionsSelector(s => s.instancesById);
  const leafModulesById = useGridActionsSelector(s => s.leafModulesById);
  const modulesById = useGridActionsSelector(s => s.modulesById);
  const viewsById = useGridActionsSelector(s => s.viewsById);
  const fieldsById = useGridActionsSelector(s => s.fieldsById);
  const ctxState = useGridActionsSelector(s => s.state);
  const dragCtx = useDragContext();
  const { isContainerDrag, isInstanceDrag, isExternalDrag, isPanelDrag } = dragCtx;
  const selection = useContext(SelectionContext);

  const [draft, setDraft] = useState(() => ({ label: module.label ?? "" }));

  // C5: Consolidated UI state — single reducer instead of 13 separate useState
  const [ui, uiDispatch] = useReducer((s, a) => {
    if (typeof a === "function") return { ...s, ...a(s) };
    return { ...s, ...a };
  }, {
    settingsOpen: false, historyOpen: false, ctxMenu: null,
    focusedStack: [], historyExpanded: false,
    // Persistent collapse memory (#U3) — read from localStorage on mount
    // keyed by occurrence id so the body collapse survives reloads.
    isBodyCollapsed: (() => {
      try {
        const occId = (occurrenceOverride?.id || module?._occurrenceId);
        if (!occId) return false;
        return localStorage.getItem(`moduli:collapse:${occId}`) === "1";
      } catch { return false; }
    })(),
    showHeader: true,
    showEmbeddedIterNav: false, filterPopupPos: null,
  });
  const { settingsOpen, historyOpen, ctxMenu, focusedStack, historyExpanded,
    isBodyCollapsed, showHeader,
    showEmbeddedIterNav, filterPopupPos } = ui;
  // Setter wrappers — same API as useState setters, delegates to single reducer
  const setSettingsOpen = useCallback(v => uiDispatch(typeof v === "function" ? s => ({ settingsOpen: v(s.settingsOpen) }) : { settingsOpen: v }), []);
  const setHistoryOpen = useCallback(v => uiDispatch(typeof v === "function" ? s => ({ historyOpen: v(s.historyOpen) }) : { historyOpen: v }), []);
  const setCtxMenu = useCallback(v => uiDispatch({ ctxMenu: v }), []);
  const setFocusedStack = useCallback(v => uiDispatch(typeof v === "function" ? s => ({ focusedStack: v(s.focusedStack) }) : { focusedStack: v }), []);
  const setHistoryExpanded = useCallback(v => uiDispatch(typeof v === "function" ? s => ({ historyExpanded: v(s.historyExpanded) }) : { historyExpanded: v }), []);
  const setIsBodyCollapsed = useCallback(v => uiDispatch(typeof v === "function" ? s => ({ isBodyCollapsed: v(s.isBodyCollapsed) }) : { isBodyCollapsed: v }), []);
  // Persist collapse state to localStorage on every change so it survives
  // reloads (#U3). Keyed by occurrence id — different placements of the
  // same module keep independent collapse state.
  useEffect(() => {
    try {
      const occId = (occurrenceOverride?.id || module?._occurrenceId);
      if (!occId) return;
      const key = `moduli:collapse:${occId}`;
      if (isBodyCollapsed) localStorage.setItem(key, "1");
      else localStorage.removeItem(key);
    } catch {}
  }, [isBodyCollapsed, occurrenceOverride?.id, module?._occurrenceId]);
  const setShowHeader = useCallback(v => uiDispatch({ showHeader: v }), []);
  const setShowEmbeddedIterNav = useCallback(v => uiDispatch({ showEmbeddedIterNav: v }), []);
  const setFilterPopupPos = useCallback(v => uiDispatch({ filterPopupPos: v }), []);
  const [dropdownAnchor, setDropdownAnchor] = useState(null);
  const openDropdown = useCallback((e) => {
    setDropdownAnchor(e.currentTarget.getBoundingClientRect());
  }, []);
  const closeDropdown = useCallback(() => setDropdownAnchor(null), []);
  const [templatesAnchor, setTemplatesAnchor] = useState(null);
  const openTemplates = useCallback((e) => setTemplatesAnchor(e?.currentTarget?.getBoundingClientRect?.() || null), []);
  const closeTemplates = useCallback(() => setTemplatesAnchor(null), []);
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

  // `opts` carries the QuickAddMenu field-picker payload: `{ fieldIds }`.
  // Forwarded to addInstanceToContainer (App.jsx) which pre-binds those
  // fields on the new module. Other call sites that pass no arg still work.
  const onAdd = useCallback((opts) => addInstanceToContainer(module.id, opts), [addInstanceToContainer, module.id]);

  const commitLabel = useCallback(() => {
    const next = (draft?.label ?? "").trim();
    if (!next) return;
    CommitHelpers.updateModule({ dispatch, socket, module: { ...module, label: next }, emit: true });
  }, [draft?.label, module, dispatch, socket]);

  // Inline label editor (standard non-embedded header) — double-click flips
  // the label span into an <input>; Enter / blur commits, Escape cancels.
  // The embedded variant uses contentEditable directly; this is only for the
  // standard variant which renders a plain text span.
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(module.label ?? "");
  useEffect(() => { setLabelDraft(module.label ?? ""); }, [module.label, module.id]);
  const commitInlineLabel = useCallback(() => {
    const next = (labelDraft ?? "").trim();
    if (next && next !== (module.label ?? "")) {
      CommitHelpers.updateModule({ dispatch, socket, module: { ...module, label: next }, emit: true });
    }
    setIsEditingLabel(false);
  }, [labelDraft, module, dispatch, socket]);

  const commitIteration = useCallback((nextIteration) => {
    CommitHelpers.updateModule({ dispatch, socket, module: { ...module, iteration: nextIteration }, emit: true });
  }, [module, dispatch, socket]);

  const commitDragMode = useCallback((nextMode) => {
    CommitHelpers.updateModule({ dispatch, socket, module: { ...module, defaultDragMode: nextMode }, emit: true });
  }, [module, dispatch, socket]);

  const containerOccurrence = useMemo(() => {
    if (occurrenceOverride) return occurrencesById[occurrenceOverride.id] || occurrenceOverride;
    // O(1) lookup via App-level occurrencesByModuleId index. Each
    // container previously scanned every occurrence on every render
    // (`Object.values(...).find`) — see #24 perf notes.
    const matches = occurrencesByModuleId?.[module.id];
    return matches && matches.length > 0 ? matches[0] : undefined;
  }, [occurrenceOverride, occurrencesById, occurrencesByModuleId, module.id]);

  const containerDragMode = containerOccurrence?.dragMode ?? module?.defaultDragMode ?? "move";

  // Dynamic display label for schedule day-cols. When the occurrence's
  // filterOverride carries a multi-day shape (after the user picks a range
  // / multi via the chevron picker), recompute the title to match —
  // otherwise the day-col stays stamped with its CREATE-time single date.
  // For every other container this falls back to module.label byte-identical.
  const displayLabel = useMemo(
    () => computeScheduleColLabel(containerOccurrence, module) ?? module.label,
    [containerOccurrence, module]
  );

  // Editor↔field binding for the container header. When set, the contentEditable
  // / static label is replaced by a BoundHeader that reads/writes the linked
  // occurrence's target field (see client/src/state/editorBindings.js).
  const headerBinding = useMemo(
    () => resolveEditorBinding({ occurrence: containerOccurrence, module, slot: "header" }),
    [containerOccurrence, module]
  );

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
    // O(1) parent lookup via the App-level parentByChildId index.
    // Previously scanned every occurrence looking for one whose
    // `occurrences[]` contained this id. #24 perf.
    const parentId = parentByChildId?.[containerOccurrence.id];
    const parentOcc = parentId ? occurrencesById[parentId] : null;
    CommitHelpers.removeOccurrence({ dispatch, socket, occurrenceId: containerOccurrence.id, occurrence: containerOccurrence, parentOccurrence: parentOcc || null, emit: true });
  }, [containerOccurrence, occurrencesById, parentByChildId, dispatch, socket]);

  // Quick-add: create an occurrence of an existing instance module in this container
  const handleQuickAddInstance = useCallback((instanceModule) => {
    if (!containerOccurrence || !instanceModule?.id) return;
    const occId = crypto.randomUUID();
    const occ = {
      id: occId,
      userId: module.userId,
      gridId: module.gridId,
      moduleId: instanceModule.id,
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
      CommitHelpers.createModule({ dispatch, socket, module: { role: "instance", kind: "board", label: text, userId, gridId, fieldBindings: [], iteration: { mode: "persistent" } }, emit: true });
    }
    toast.success(`${texts.length} instance${texts.length > 1 ? "s" : ""} created — drag from toolbar`);
  }, [ctxState, dispatch, socket]);

  const commitOccurrenceUpdate = useCallback((updates) => {
    if (!containerOccurrence?.id) return;
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: containerOccurrence.id, ...updates }, emit: true });
  }, [containerOccurrence, dispatch, socket]);

  const resolvedContainerCSS = useMemo(
    () => styleToCSS(resolveContainerStyle(module, panel, containerOccurrence, ctxState?.grid)),
    [module, panel, containerOccurrence, ctxState?.grid]
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

  const containerAllowedEdges = ALL_EDGES;

  const containerWithInstances = useMemo(() => {
    const instanceObjects = getContainerItems(module, occurrencesById, leafModulesById);
    return { ...module, instanceObjects };
  }, [module, occurrencesById, leafModulesById]);

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
    context: { panelId, containerId: module.id, occurrenceId: containerOccurrence?.id || null, insertAt: 0 },
    accepts: DropAccepts.CONTAINER_LIST,
    disabled: isContainerDrag,
  });

  const { ref: listDropRef, isOver: isListOver } = useDroppable({
    type: "container-list",
    id: `container-list:${module.id}`,
    context: { panelId, containerId: module.id, occurrenceId: containerOccurrence?.id || null },
    accepts: DropAccepts.CONTAINER_LIST,
    disabled: isContainerDrag,
  });

  // Resolve the layout cascade for this container so render-time decisions
  // (sticky header, future view rules) can read the effective rule set
  // without each consumer walking ancestors themselves. Memoized on the
  // inputs the walker reads — occurrence + maps + grid defaults.
  const layoutCascade = useMemo(() => {
    if (!containerOccurrence?.id) return null;
    const ctx = buildLayoutCascadeContext({
      leafOccurrence: containerOccurrence,
      occurrencesById,
      modulesById,
      grid: ctxState?.grid,
    });
    return resolveLayoutCascade(ctx, "container");
  }, [containerOccurrence, occurrencesById, modulesById, ctxState?.grid]);
  const stickyHeader = layoutCascade?.resolved?.stickyHeaders === true;

  // Occurrence controls order — pass containerOccurrence so ordering reads from occurrence.occurrences.
  // When `module.meta.allowChildContainers` is set, fall back to the full modulesById lookup so
  // role:"container" children are not filtered out (leafModulesById only contains instance/artifact/
  // textblock). The render loop below then branches by child role to mount <Container> vs <ModuleInstance>.
  const allowChildContainers = !!module?.meta?.allowChildContainers;
  const childModuleLookup = allowChildContainers ? modulesById : leafModulesById;
  const allItemsWithOccurrences = useMemo(
    () => getContainerItemsWithOccurrences(module, occurrencesById, childModuleLookup, undefined, containerOccurrence),
    [module, occurrencesById, childModuleLookup, containerOccurrence]
  );

  // Apply active filter: hide occurrences that don't match the effective filter values
  const activeNamedFilter = useMemo(() => {
    const activeId = ctxState?.grid?.activeFilterId;
    if (!activeId) return null;
    return (ctxState?.grid?.namedFilters || []).find(f => f.id === activeId) || null;
  }, [ctxState?.grid?.activeFilterId, ctxState?.grid?.namedFilters]);

  // Always walk the parent chain — `activeNamedFilter.lock` controls whether THIS
  // occurrence may write its own filterOverride (UI-level editability), not whether
  // ancestor overrides cascade. Mirrors the same fix in ModulePage.jsx — without
  // it, the schedule page's local date wouldn't propagate to slot containers below.
  const effectiveFilters = useMemo(
    () => getEffectiveFilterForOccurrence(containerOccurrence, { grid: ctxState?.grid, occurrencesById }),
    [containerOccurrence, ctxState?.grid, occurrencesById]
  );

  // Combine grid's active named-filter conditions with this container's own
  // `filters[]` entries (mirrors the same combination in ModulePage.jsx — the
  // Time Slot select on the schedule page is the driving example).
  const activeFilterConditions = useMemo(() => {
    const gridConds = activeNamedFilter?.conditions || [];
    const localConds = getLocalFilterConditions(containerOccurrence);
    if (!gridConds.length && !localConds.length) return null;
    return [...gridConds, ...localConds];
  }, [activeNamedFilter, containerOccurrence]);

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
  const isTableContainer = containerViewType === "table" || (!containerViewType && module?.kind === "table");

  // Canvas items: look up ALL module roles (instances + containers) from modulesById
  // so both instances and doc/list containers can be dropped onto a canvas.
  const canvasItemsWithOccurrences = useMemo(() => {
    if (!isCanvasContainer) return [];
    const ids = containerOccurrence?.occurrences || module?.occurrences || [];
    return ids.map(occId => {
      const occ = occurrencesById[occId];
      if (!occ) return null;
      const mod = modulesById[occ.moduleId];
      if (!mod) return null;
      return { module: mod, occurrence: occ };
    }).filter(Boolean);
  }, [isCanvasContainer, containerOccurrence, module, occurrencesById, modulesById]);

  // Canvas card renderer — wraps <ModuleInstance>/<Container> in an
  // absolute-positioning shell. The inner module handles its own drag
  // (useDragDrop), so canvas children are the same components used in
  // board/doc — only positioning differs.
  const renderCanvasCard = useCallback(({ module: mod, occurrence: occ, containerId: cid, panelId: pid }) => {
    let renderBody = null;
    if (mod.role === "textblock") {
      renderBody = () => <TextblockCard occurrence={occ} module={mod} />;
    } else if (mod.role === "artifact") {
      renderBody = () => <ArtifactCard module={mod} label={mod.label} occurrence={occ} />;
    }
    return (
      <div
        key={occ.id}
        style={{
          position: "absolute",
          left: occ?.meta?.x ?? 20,
          top: occ?.meta?.y ?? 20,
          minWidth: 160,
          maxWidth: 300,
        }}
      >
        {mod.role === "container" ? (
          <Container
            module={mod}
            occurrenceOverride={occ}
            panelId={pid}
            embedded={mod.kind === "doc"}
            dispatch={dispatch}
            socket={socket}
          />
        ) : (
          <ModuleInstance
            module={mod}
            occurrence={occ}
            containerId={cid}
            containerOccurrence={containerOccurrence}
            panelId={pid}
            dispatch={dispatch}
            socket={socket}
            renderBody={renderBody}
            floatHandle={!!renderBody}
          />
        )}
      </div>
    );
  }, [dispatch, socket, containerOccurrence]);


  // Per-occurrence view-mode handling. Default is Actual (full container
  // render below). Representation mode swaps in a single compact chip so
  // mind-map nodes / value-builder cards can reference a container
  // without expanding all its descendants. Preview mode is the folder-
  // page PreviewNode pattern and doesn't apply at the inline container
  // level — falls through to Actual here.
  const containerViewMode = getEffectiveViewMode(containerOccurrence, "default");
  if (containerViewMode === "representation") {
    return (
      <div
        data-container-id={module.id}
        data-occ-id={containerOccurrence?.id}
        style={{ padding: "4px 6px" }}
      >
        <RepresentationView
          occurrence={containerOccurrence}
          size="md"
          showBreadcrumb={false}
          onJump={() => jumpToOccurrence(containerOccurrence?.id)}
        />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-container-id={module.id}
      data-occ-id={containerOccurrence?.id}
      data-testid="container-shell"
      className={(() => {
        const base = `container-shell bg-background2 rounded-md border border-border shadow-inner mod-${module.id}`;
        const occId = containerOccurrence?.id;
        const sel = occId && selection.isSelected(occId) ? " is-selected" : "";
        const clipMode = selection.clipboard?.mode;
        const staged = occId && clipMode && selection.clipboard.ids.includes(occId) ? ` is-clipboard-staged clipboard-${clipMode}` : "";
        const sticky = stickyHeader ? " is-sticky-header" : "";
        return base + sel + staged + sticky;
      })()}
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
      onClickCapture={(e) => {
        // Shift+click anywhere on the container shell toggles selection.
        // Capture phase so inner contentEditable / inputs don't swallow it.
        if (e.shiftKey && containerOccurrence?.id) {
          e.preventDefault();
          e.stopPropagation();
          selection.toggle(containerOccurrence.id);
        }
      }}
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
                onTemplate={openTemplates}
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
              onOccurrenceStyleChange={(style) => commitOccurrenceUpdate({ ownStyle: style })}
            />
          </PopoverContent>
        </Popover>
      )}

      {/* HEADER */}
      {showHeader && (
      <div
        ref={headerDropRef}
        className={`container-header module-header-row no-select ${embedded ? "embedded-container-header" : ""}`}
        style={embedded
          ? { padding: "0", alignItems: "stretch", flexDirection: "column", ...embeddedHeaderStyle }
          : { height: "20px", gap: 6, padding: "2px 3px" }
        }
        onContextMenu={(e) => {
          if ("ontouchstart" in window) return;
          e.preventDefault();
          e.stopPropagation();
          // Paste-here surfaces when there's a non-empty clipboard. The
          // verb adapts to mode: Move N here / Paste N here / Paste
          // linked N here. Destination is this container.
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
                    destinationOccurrence: containerOccurrence,
                    destinationModule: module,
                    occurrencesById,
                    dispatch, socket,
                    gridId: ctxState?.gridId || ctxState?.grid?._id,
                    userId: ctxState?.userId,
                    panelId,
                  });
                  selection.clearClipboard();
                  selection.clear();
                  // Toast feedback so the user knows the paste landed,
                  // especially for moves where the visual change is in
                  // both the source and destination.
                  if (pasted > 0) {
                    const verb = clip.mode === "move" ? "Moved" : clip.mode === "copylink" ? "Linked" : "Pasted";
                    toast.success(`${verb} ${pasted} item${pasted === 1 ? "" : "s"}`, { duration: 2000 });
                  } else {
                    toast.error("Nothing pasted", { duration: 2500 });
                  }
                },
              },
              clip && { separator: true },
              // CL4 — "Add new item here" entries. Direct creation under
              // THIS container without opening the QuickAddMenu surface.
              // Generic instance, plain textblock, and the new inline
              // textblock variant (LT1).
              {
                label: "Add new item here",
                icon: Plus,
                onClick: () => onAdd?.(),
              },
              {
                label: "Add textblock here",
                icon: FileText,
                onClick: () => {
                  if (!containerOccurrence) return;
                  CommitHelpers.createTextblockInContainer({
                    dispatch, socket,
                    gridId: ctxState?.gridId || ctxState?.grid?._id,
                    userId: ctxState?.userId,
                    containerOccurrence,
                  });
                },
              },
              {
                label: "Add inline textblock here",
                icon: Type,
                onClick: () => {
                  if (!containerOccurrence) return;
                  CommitHelpers.createTextblockInContainer({
                    dispatch, socket,
                    gridId: ctxState?.gridId || ctxState?.grid?._id,
                    userId: ctxState?.userId,
                    containerOccurrence,
                    kind: "inline",
                  });
                },
              },
              { separator: true },
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
                      onTemplate={openTemplates}
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
                  />
                </PopoverContent>
              </Popover>
              <span className="embedded-hash" style={{ fontSize: 20, fontWeight: 700, color: embeddedAccent, fontFamily: "var(--font-mono)" }}>#</span>
              {headerBinding ? (
                <span
                  onPointerDown={(e) => e.stopPropagation()}
                  style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 700, color: embeddedAccent, lineHeight: 1.2, flex: 1, minWidth: 0, overflow: "hidden" }}
                >
                  <AutoMarquee>
                    <BoundHeader
                      hostOccurrence={containerOccurrence}
                      binding={headerBinding}
                      markdownPrefix=""
                      label={displayLabel || "Container"}
                    />
                  </AutoMarquee>
                </span>
              ) : (
                <span
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => {
                    const next = e.currentTarget.textContent.trim();
                    if (next && next !== module.label) {
                      CommitHelpers.updateModule({ dispatch, socket, module: { ...module, label: next }, emit: true });
                    } else {
                      e.currentTarget.textContent = displayLabel || "Container";
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
                    e.stopPropagation();
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  style={{ outline: "none", cursor: "text", fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 700, color: embeddedAccent, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}
                >
                  {displayLabel || "Container"}
                </span>
              )}
              <div onPointerDown={(e) => e.stopPropagation()} style={{ flexShrink: 0, marginLeft: "auto" }}>
              </div>
            </div>
            {/* Row 3: Container-bound fields (below label, prevents mobile crush) */}
            {containerFields.length > 0 && !isBodyCollapsed && (
              <div style={{ padding: "0px 12px 4px 28px", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }} onPointerDown={(e) => e.stopPropagation()}>
                {containerFields.map(({ field, binding }) => (
                  <AutoMarquee key={field.id} className="instance-field-mq">
                    <FieldRenderer
                      field={field}
                      binding={binding}
                      occurrence={containerOccurrence}
                      instance={module}
                      state={ctxState}
                      dispatch={dispatch}
                      socket={socket}
                      compact={true}
                    />
                  </AutoMarquee>
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
                    onHistory={() => setHistoryOpen(true)}
                    onTemplate={openTemplates}
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
              isEditingLabel && !headerBinding ? (
                <input
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  onBlur={commitInlineLabel}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitInlineLabel(); }
                    if (e.key === "Escape") { setLabelDraft(module.label ?? ""); setIsEditingLabel(false); }
                    e.stopPropagation();
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  autoFocus
                  style={{
                    flex: "1 1 auto", minWidth: 0,
                    background: "transparent", border: "none", outline: "none",
                    padding: module.kind === "board" ? "2px 0" : 0,
                    fontSize: module.kind === "board" ? "0.8rem" : "0.75rem",
                    fontWeight: module.kind === "board" ? 500 : 500,
                    color: "var(--text-primary)", fontFamily: "inherit",
                  }}
                />
              ) : (
                <span
                  onDoubleClick={!headerBinding ? (e) => { e.stopPropagation(); setIsEditingLabel(true); } : undefined}
                  title={!headerBinding ? "Double-click to rename" : undefined}
                  style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", padding: module.kind === "board" ? "2px 0" : 0, fontSize: module.kind === "board" ? "0.8rem" : "0.75rem", fontWeight: module.kind === "board" ? 500 : 500, display: "flex", alignItems: "center", gap: 4, cursor: !headerBinding ? "text" : undefined }}
                >
                  <AutoMarquee>
                    {headerBinding ? (
                      <BoundHeader
                        hostOccurrence={containerOccurrence}
                        binding={headerBinding}
                        markdownPrefix=""
                        label={displayLabel || "Container"}
                      />
                    ) : (
                      displayLabel || "Container"
                    )}
                  </AutoMarquee>
                  {containerOccurrence?.linkedGroupId && (
                    <Link2 className="w-3 h-3 text-blue-400 opacity-60 flex-shrink-0 inline" title="Linked" />
                  )}
                </span>
              )
            )}

            <div onPointerDown={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
              <QuickAddMenu
                targetRole="instance"
                onSelect={handleQuickAddInstance}
                onCreateNew={onAdd}
                createLabel="New instance"
                onAddTextblock={() => {
                  CommitHelpers.createTextblockInContainer({
                    dispatch, socket,
                    gridId: ctxState?.gridId || ctxState?.grid?._id,
                    userId: ctxState?.userId,
                    containerOccurrence,
                  });
                }}
                hostOccurrence={containerOccurrence}
              />
            </div>

            <div className="ml-auto mr-1" style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4 }} onPointerDown={(e) => e.stopPropagation()}>
              <HeaderChevron onClick={openDropdown} isOpen={!!dropdownAnchor} occurrence={containerOccurrence} />
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
              instance: { id: instanceId, role: "instance", kind: "board", label: "New card", userId, gridId, fieldBindings: [] },
              initialMeta: { x, y },
              emit: true,
            });
          }}
        />
      ) : isTableContainer ? (
        /* Table Container: static grid from occurrence.meta.table */
        <ContainerTable occurrence={containerOccurrence} dispatch={dispatch} socket={socket} />
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
          const sibs = allOccurrences.filter(o => o.moduleId === sibId);
          if (foTimeStr) {
            const matched = sibs.find(o => String(getOccDate(o)).slice(0, 10) === foTimeStr);
            if (matched) return matched;
          }
          return sibs.sort((a, b) =>
            new Date(getOccDate(b)) - new Date(getOccDate(a))
          )[0] || null;
        };

        const historyOccs = allOccurrences
          .filter(o => o.moduleId === fi.id && o.id !== fo?.id)
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
                      const childOccs = allOccurrences.filter(o => o.moduleId === child.id);
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
                          o.moduleId === sib.id &&
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
            style={{
              // Board containers get +2px top + bottom over the list default —
              // the kanban-style column rows were too squished against the
              // container chrome.
              padding: module.kind === "board" ? "7px 5px 9px 5px" : "3px 5px 5px 5px",
              flex: 1, display: "flex", flexDirection: "column",
            }}
          >
            {itemsWithOccurrences.map(({ instance, occurrence }) => {
              const role = instance?.role;
              // Container-in-container: when the parent has allowChildContainers,
              // a role:"container" child mounts its own <Container> instead of a
              // <ModuleInstance>. occurrenceOverride pins the child to the
              // specific occurrence this parent links (multi-parent-safe).
              if (role === "container" && allowChildContainers) {
                return (
                  <Container
                    key={occurrence.id}
                    module={instance}
                    occurrenceOverride={occurrence}
                    panelId={panelId}
                    pageOccurrenceId={pageOccurrenceId || null}
                    dispatch={dispatch}
                    socket={socket}
                    gapPx={6}
                  />
                );
              }
              let renderBody = null;
              if (role === "artifact") {
                renderBody = () => <ArtifactCard module={instance} label={instance.label} occurrence={occurrence} />;
              } else if (role === "textblock") {
                renderBody = () => <TextblockCard occurrence={occurrence} module={instance} />;
              }
              return (
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
                  renderBody={renderBody}
                />
              );
            })}
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

      <TransactionHistory
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        gridId={ctxState?.grid?._id || ctxState?.gridId}
        moduleId={module.id}
      />

      {dropdownAnchor && (
        <HeaderDropdown anchorRect={dropdownAnchor} onClose={closeDropdown}>
          <FiltersSection occurrence={containerOccurrence} />
          <SortSection occurrence={containerOccurrence} />
          <FieldVisibilitySection occurrence={containerOccurrence} />
          <ViewModeSection occurrence={containerOccurrence} />
          <LayoutCascadeSection occurrence={containerOccurrence} />
        </HeaderDropdown>
      )}
      {templatesAnchor && (
        <HeaderDropdown anchorRect={templatesAnchor} onClose={closeTemplates}>
          <TemplatesSection occurrence={containerOccurrence} />
        </HeaderDropdown>
      )}
    </div>
  );
}

export default React.memo(Container);
