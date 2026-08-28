// modules/ModuleContainer.jsx
// Extracted from Module.jsx ModuleContainer component.
// Renders a container header and its instances.
// Handles doc containers, focused instance view, list view, sorting.

import React, { useRef, useMemo, useState, useReducer, useCallback, useEffect, useLayoutEffect, useContext } from "react";
import { createPortal } from "react-dom";
import RadialMenu from "../ui/RadialMenu";
import { toast } from "../state/notificationStore";
import ContextMenu from "../ui/ContextMenu";
import { useLongPress } from "../hooks/useLongPress";
import ContainerForm from "../ui/ContainerForm";
import TransactionHistory from "../ui/TransactionHistory";
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover";
import { bumpRender, useRenderAttribution } from "../helpers/renderProbe";
import { markLoadOnce } from "../helpers/loadDiag";

import { useGridActionsSelector, useGridActionsSelectorShallow } from "../GridActionsContext";
import { SelectionContext } from "../state/SelectionContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { convertContainerKind, CONVERTIBLE_CONTAINER_KINDS } from "../helpers/convertOccurrence";
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
import { resolveContainerStyle, styleToCSS, SURFACE_ALPHA } from "../helpers/StyleHelpers";
import { hexToRgba, lightenHex } from "../helpers/colorHelpers.js";
import { getEffectiveFilterForOccurrence, isOccurrenceVisible, getLocalFilterConditions } from "../state/selectors";
import HeaderChevron from "../ui/HeaderChevron";
import HeaderDropdown from "../ui/HeaderDropdown";
import FiltersSection from "../ui/FiltersSection";
import FeedSection from "../ui/FeedSection";
import MenuTabs from "../ui/MenuTabs";
import AutoMarquee from "../ui/AutoMarquee.jsx";
import RepresentationView from "../ui/RepresentationView";
import { getEffectiveViewMode } from "../helpers/viewMode";
import { buildLayoutCascadeContext, resolveLayoutCascade } from "../helpers/layoutCascade";
import { resolveContainerChildLayout } from "../helpers/containerChildLayout";

// Embedded-container header font size by section-hierarchy level (meta.headingLevel).
// 1 = article title (H1) … 6. Smaller + cascading; containers without a level
// use the default 15.
// `#` has to READ as the top of the hierarchy. At 18 it was only 2px above an
// `##` section and the user rightly called it out ("it should show a # heading
// but it doesnt look bigger than the nested container labels"). The gap between
// 1 and 2 is now the widest in the scale.
// The steps have to be VISIBLE — 15 vs 14 read as the same size, so a `###`
// section inside a `##` one looked identical to it (user 2026-08-01). Each
// level now drops at least 2px, and the weight drops with it.
// Level 4 is 13, not 12: the bound-header <select> resolves one step under its
// declared size (measured 11 against a declared 12), which tied it with 11px
// body text. 13 clears body either way and still sits clearly under ### (14).
const HEADING_SIZES = { 1: 18, 2: 16, 3: 14, 4: 13, 5: 12, 6: 12 };

// A container header that declares NO heading level — "Movies", "Trackers",
// "Today's Stats". One step smaller (user, 2026-08-25: "make the headers a size
// smaller"): board 0.95rem -> 14px, everything else 0.9rem -> 13px. Measured on
// prod at 15.2px before, which sat between heading levels 2 and 3; 14 IS level
// 3, so the standard header now lands on the scale instead of beside it.
//
// READ BY THE RENAME BOX TOO, and that is not tidiness — the box that replaces
// the header on double-click was 0.8rem/0.75rem against a 0.95rem/0.9rem
// header, so the text visibly shrank the moment you started renaming. Same
// mistake the instance label had; a constant is the only thing that keeps the
// two honest. Headings are untouched: that scale was set deliberately and the
// user named the plain headers.
const CONTAINER_HEADER_PX = { board: 14, other: 13 };
const HEADING_WEIGHTS = { 1: 700, 2: 650, 3: 550, 4: 500, 5: 500, 6: 500 };

// Container-header label overflow behavior, configurable per-occurrence via
// `occurrence.meta.labelOverflow` (falls back to module.meta, then "marquee").
//   marquee → AutoMarquee (scrolls when it overflows, inert when it fits)
//   wrap    → wraps onto multiple lines
//   none    → single line, clipped with an ellipsis
function LabelShell({ mode, style, children, ...rest }) {
  if (mode === "wrap") {
    return <span {...rest} style={{ ...style, whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word", overflow: "hidden" }}>{children}</span>;
  }
  if (mode === "none") {
    return <span {...rest} style={{ ...style, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{children}</span>;
  }
  return <span {...rest} style={{ ...style, overflow: "hidden" }}><AutoMarquee>{children}</AutoMarquee></span>;
}
import { jumpToOccurrence } from "../helpers/jumpToOccurrence";
import SortSection from "../ui/SortSection";
import FieldVisibilitySection from "../ui/FieldVisibilitySection";
import ViewModeSection from "../ui/ViewModeSection";
import LayoutCascadeSection from "../ui/LayoutCascadeSection";
import TemplatesSection from "../ui/TemplatesSection";

import {
  ChevronRight,
  Copy,
  Link2,
  Unlink,
  Trash2,
  ArrowLeft,
  X,
  ClipboardPaste,
  Plus,
  FileText,
  Type, Rss, Shuffle, LayoutGrid, PenTool, Table, BarChart3 } from "lucide-react";

import { CanvasDrawSection } from "./CanvasContent.jsx";
import { DocEditorShell } from "./DocContent.jsx";
import ContainerPool from "./containers/ContainerPool.jsx";
import ContainerTable from "./containers/ContainerTable.jsx";
import ContainerGraph from "./containers/ContainerGraph.jsx";
import { FilterOverridePopup } from "./containerPopups.jsx";
import ModuleInstance from "./ModuleInstance.jsx";
import InsertGap from "../ui/InsertGap.jsx";
import ArtifactCard from "./ArtifactCard.jsx";
import ModuleTextblock from "./ModuleTextblock.jsx";
import BoundHeader from "./BoundHeader.jsx";
import HeadingLevelPicker, { parseHeadingPrefix } from "../ui/HeadingLevelPicker.jsx";
import QuickAddMenu, { KIND_TILE, tileKindsForRole } from "../ui/QuickAddMenu.jsx";
import { getModuleTypeBadge } from "../helpers/moduleIcons";

// The kinds the container context menu can mint DIRECTLY. Artifact and image
// are excluded: they need the file dialog / image picker that lives in
// QuickAddMenu, and duplicating that here would be a second implementation.
const CONTEXT_ADD_KINDS = tileKindsForRole("instance").filter(
  (k) => k !== "artifact" && k !== "image",
);
import OccurrenceFields from "../ui/OccurrenceFields.jsx";
import { resolveEditorBinding } from "../state/editorBindings.js";
import { useRenderWindow } from "../helpers/renderWindow";

// Minimum children before a list opts into the browser off-screen skip.
// Below this the skip costs more than it saves (see .container-list--long).
export const LONG_LIST_MIN = 25;

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
  // WHICH occurrence rendered this one. Not derivable from the data: a SHARED
  // occurrence (the emotions wheel is multi-parented into every day column)
  // has several parents, and `buildParentMap` keys child → ONE parent on a
  // last-writer-wins scan, so every data-side ancestor walk picks an arbitrary
  // one. Only the render tree knows which column the user is actually looking
  // at, so it has to be passed down. Null for a top-level container, which is
  // the honest answer — nothing rendered it.
  renderParentOccurrenceId = null,
}) {
  bumpRender("container");
  // RENDER-phase mark (body, not effect): with the commit mark below it, the
  // pair says whether a gap is React rendering the tree or something else
  // blocking between commits.
  markLoadOnce("container:render", "container:render:first");
  // Load-path split (helpers/loadDiag.js): the CONTENT tree, which is what the
  // staged-loading plan proposes to defer behind the panel chrome.
  useLayoutEffect(() => { markLoadOnce(`container:${module?.id}`, "container:commit"); });
  // Per-slice selectors — only re-render when an actually-read slice's identity
  // changes (was a single useGridActions() that re-rendered on every actionsValue
  // rebuild — i.e. on every filter change anywhere on the grid).
  //
  // IMPORTANT: the occurrence-derived maps (occurrencesById / occurrencesByModuleId /
  // parentByChildId) and `state` are REBUILT ON EVERY OCCURRENCE WRITE — subscribing
  // to them re-rendered every container on every write (the multi-second drop pause).
  // Containers now subscribe only to their OWN slices (own occurrence, direct child
  // refs, ancestor chain, grid) and read the full maps at compute/callback time via
  // the stable non-subscribing getters. Module-derived maps (instancesById /
  // leafModulesById / modulesById / viewsById / fieldsById) stay as whole-map
  // subscriptions — they don't change identity on occurrence writes.
  const instancesById = useGridActionsSelector(s => s.instancesById);
  const leafModulesById = useGridActionsSelector(s => s.leafModulesById);
  const modulesById = useGridActionsSelector(s => s.modulesById);
  const viewsById = useGridActionsSelector(s => s.viewsById);
  const fieldsById = useGridActionsSelector(s => s.fieldsById);
  const ctxGrid = useGridActionsSelector(s => s.state.grid);
  const ctxUserId = useGridActionsSelector(s => s.state.userId);
  const ctxGridId = useGridActionsSelector(s => s.state.gridId) || ctxGrid?._id;
  // Fallback closures cover custom providers (tests/previews) that omit the
  // getters; the app's getters are identity-stable.
  const getOccMap = useGridActionsSelector(s => s.getOccMap || (() => s.occurrencesById || {}));
  const getParentId = useGridActionsSelector(s => s.getParentId || ((oid) => (oid ? s.parentByChildId?.[oid] || null : null)));
  // Lite state for children that only read grid/gridId/userId off a
  // state-shaped prop (FieldRenderer's gridFilters, ContainerPool). Ops in
  // Field.jsx read the FULL fresh state via getState() — never this object.
  const ctxStateLite = useMemo(
    () => ({ grid: ctxGrid, gridId: ctxGridId, userId: ctxUserId }),
    [ctxGrid, ctxGridId, ctxUserId]
  );
  // Handlers/getters only — identity-stable, never re-renders this component.
  // Containers are the hot path (hundreds of mounts): NO reactive drag-state
  // subscription here. Drag-type gating rides on the hooks' `accepts` lists +
  // the body[data-drag-kind] CSS stamped by DragProvider; one-off render-time
  // reads use dragCtx.getActiveType() (safe wherever a local isOver state has
  // already forced a re-render).
  const dragCtx = useDragContext();
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
  const [quickAddTrigger, setQuickAddTrigger] = useState(0);
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

  // Per-id reactive read of THIS container's occurrence — re-renders only when
  // the own-occurrence ref changes, not on every map rebuild.
  const containerOccurrence = useGridActionsSelector(s => {
    if (occurrenceOverride) return s.occurrencesById?.[occurrenceOverride.id] || occurrenceOverride;
    // O(1) lookup via App-level occurrencesByModuleId index. Each
    // container previously scanned every occurrence on every render
    // (`Object.values(...).find`) — see #24 perf notes.
    const matches = s.occurrencesByModuleId?.[module.id];
    return matches && matches.length > 0 ? matches[0] : undefined;
  });

  // Reactive trigger for child-derived memos: the array of DIRECT child
  // occurrence refs. Element-wise stable (useGridActionsSelectorShallow), so
  // this container re-renders only when its own child list or one of its own
  // children changes — not on every occurrence write anywhere on the grid.
  const childOccsKey = useGridActionsSelectorShallow(s => {
    const ids = containerOccurrence?.occurrences || module?.occurrences || [];
    return ids.map(id => s.occurrencesById?.[id] || null);
  });

  // Reactive trigger for ancestor-derived memos (filter cascade, layout
  // cascade): the chain of ancestor occurrence refs root-ward from this
  // container. A page filter-nav writes the page occurrence → the ref in this
  // chain changes → descendants recompute. Everything else leaves it stable.
  const ancestorChain = useGridActionsSelectorShallow(s => {
    const out = [];
    let cursor = containerOccurrence?.id;
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

  // DIAG (window.__RENDER_ATTR): which input changed → this render.
  useRenderAttribution("container", {
    p_module: module, p_panel: panel, p_panelId: panelId,
    p_pageOccurrenceId: pageOccurrenceId, p_addInstanceToContainer: addInstanceToContainer,
    p_dispatch: dispatch, p_socket: socket, p_onInstanceFocus: onInstanceFocus,
    p_occurrenceOverride: occurrenceOverride,
    s_instancesById: instancesById, s_leafModulesById: leafModulesById,
    s_modulesById: modulesById, s_viewsById: viewsById, s_fieldsById: fieldsById,
    s_ctxGrid: ctxGrid, s_ctxUserId: ctxUserId,
    s_getOccMap: getOccMap, s_getParentId: getParentId,
    s_containerOccurrence: containerOccurrence, s_childOccsKey: childOccsKey,
    s_ancestorChain: ancestorChain,
    s_selection: selection, s_dragCtx: dragCtx,
    p_gapPx: gapPx, p_embedded: embedded, p_orientation: panelLayoutOrientation,
    p_embedRadialItems: embedRadialItems, p_embedOnDelete: embedOnDelete,
    p_embedSourceType: embedSourceType,
  }, module?.label);

  const containerDragMode = containerOccurrence?.dragMode ?? module?.defaultDragMode ?? "move";

  // A per-placement `occurrence.label` (written by an operation) wins over the
  // shared template label. That is the ONLY label rule — the renderer knows
  // nothing about what any particular container is.
  const displayLabel = useMemo(
    () => containerOccurrence?.label ?? module.label,
    [containerOccurrence?.label, module.label],
  );

  // Section-hierarchy header sizing (imported docs stamp meta.headingLevel
  // 1=article … 6). Falls back to the default 20/700 for every other container.
  const headingLevel = Number(module?.meta?.headingLevel) || 1;
  // The ONE place the level is written. `meta` is spread rather than replaced:
  // it also carries allowChildContainers, labelOverflow, headerLink and more, and
  // `updateModule` sends the whole module — writing `meta` whole is how those get
  // dropped (the `createPageInContainer` clobber, 2026-08-08).
  const commitHeadingLevel = useCallback((n) => {
    const meta = { ...(module?.meta || {}) };
    if (n == null) delete meta.headingLevel; else meta.headingLevel = n;
    CommitHelpers.updateModule({ dispatch, socket, module: { ...module, meta }, emit: true });
  }, [module, dispatch, socket]);
  const headerFontSize = HEADING_SIZES[module?.meta?.headingLevel] || 20;
  const headerFontWeight = HEADING_WEIGHTS[module?.meta?.headingLevel] || 700;
  // Per-occurrence header label overflow: marquee (default) | wrap | none.
  const labelOverflow = containerOccurrence?.meta?.labelOverflow ?? module?.meta?.labelOverflow ?? "marquee";
  // A BOUND header is a control, not prose: marqueeing it scrolls the picker
  // and its field-name badge out of the row (measured on the day page — a 745px
  // marquee track inside a 466px window, badge parked at x=1150). Default those
  // headers to "none" so the control shrinks to the row and truncates in place.
  // An explicit per-occurrence/module labelOverflow still wins.
  const boundLabelOverflow = containerOccurrence?.meta?.labelOverflow ?? module?.meta?.labelOverflow ?? "none";

  // Editor↔field binding for the container header. When set, the contentEditable
  // / static label is replaced by a BoundHeader that reads/writes the linked
  // occurrence's target field (see client/src/state/editorBindings.js).
  const headerBinding = useMemo(
    () => resolveEditorBinding({ occurrence: containerOccurrence, module, slot: "header" }),
    [containerOccurrence, module]
  );

  // The container's OWN fields. Resolution (bindings + the grid's universal
  // fields + both cascades) lives in <OccurrenceFields>, so the two header
  // layouts cannot drift — which is exactly what happened before: the strip was
  // rendered ONLY in the heading branch, so a plain container's visible bindings
  // were computed and then thrown away.
  const ownFieldsProps = useMemo(() => ({
    occurrence: containerOccurrence,
    module,
    grid: ctxGrid,
    fieldsById,
    occurrencesById: getOccMap(),
    position: "under",
    state: ctxStateLite,
    dispatch,
    socket,
  }), [containerOccurrence, module, ctxGrid, fieldsById, getOccMap, ctxStateLite, dispatch, socket]);

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
    // O(1) parent lookup via the App-level parentByChildId index, read at
    // callback time through the non-subscribing getters. #24 perf.
    const parentId = getParentId(containerOccurrence.id);
    const parentOcc = parentId ? getOccMap()[parentId] : null;
    CommitHelpers.removeOccurrence({ dispatch, socket, occurrenceId: containerOccurrence.id, occurrence: containerOccurrence, parentOccurrence: parentOcc || null, emit: true });
  }, [containerOccurrence, getOccMap, getParentId, dispatch, socket]);

  // Quick-add: create an occurrence of an existing instance module in this container
  const handleQuickAddInstance = useCallback((instanceModule) => {
    if (!containerOccurrence || !instanceModule?.id) return;
    const occId = crypto.randomUUID();
    const occ = {
      id: occId,
      userId: module.userId,
      gridId: module.gridId,
      moduleId: instanceModule.id,
      // Parent link BEFORE the trigger fires — the Stamp op resolves the
      // destination's effective-filter date via the new occ's ancestor chain.
      parentId: containerOccurrence.id,
      iteration: { mode: "persistent" },
      fields: {},
    };
    // panelId + containerLabel give the OccurrenceCreateOp the same context a
    // DRAG into this container carries — without them the "Schedule: Stamp
    // Date & Time Slot" op (panel-scoped trigger, timeslot from
    // $trigger.containerLabel) never matched a + menu add, so the item had no
    // Date and failed every tracker's date gate forever (2026-07-13 repro).
    CommitHelpers.createOccurrence({
      dispatch, socket, occurrence: occ, emit: true,
      panelId, containerLabel: module?.label || "",
    });
    const updatedOccs = [...(containerOccurrence.occurrences || []), occId];
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: containerOccurrence.id, occurrences: updatedOccs }, emit: true });
  }, [containerOccurrence, module, panelId, dispatch, socket]);

  // Header "+" create router: a plain Item keeps the existing focus-the-new-item
  // path (onAdd); Textblock / Board / Doc / Table / Canvas / Artifact route through
  // createChildInContainer (appends; nested containers also flip allowChildContainers).
  const handleQuickCreate = useCallback((payload = {}) => {
    const { kind, fieldIds = [], fieldBindings = null, initialFields = null, file, url, folderId = null } = payload;
    if (!kind || kind === "instance") { onAdd?.(payload); return; }
    CommitHelpers.createChildInContainer({
      dispatch, socket,
      gridId: ctxGridId,
      userId: ctxUserId,
      containerOccurrence,
      containerModule: module,
      kind, fieldIds, fieldBindings, initialFields, file, url, folderId, index: null,
      panelId, containerLabel: module?.label || "",
    });
  }, [onAdd, dispatch, socket, ctxGridId, ctxUserId, containerOccurrence, module, panelId]);

  const handleConvertListToInstances = useCallback(async (texts) => {
    if (!texts?.length) return;
    const userId = ctxUserId;
    const gridId = ctxGridId;
    if (!userId || !gridId) return;
    for (const text of texts) {
      CommitHelpers.createModule({ dispatch, socket, module: { role: "instance", kind: "board", label: text, userId, gridId, fieldBindings: [], iteration: { mode: "persistent" } }, emit: true });
    }
    toast.success(`${texts.length} instance${texts.length > 1 ? "s" : ""} created — drag from toolbar`);
  }, [ctxGridId, ctxUserId, dispatch, socket]);

  const commitOccurrenceUpdate = useCallback((updates) => {
    if (!containerOccurrence?.id) return;
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: containerOccurrence.id, ...updates }, emit: true });
  }, [containerOccurrence, dispatch, socket]);

  const resolvedContainerCSS = useMemo(
    () => styleToCSS(resolveContainerStyle(module, panel, containerOccurrence, ctxGrid)),
    [module, panel, containerOccurrence, ctxGrid]
  );

  // Embedded doc card styles — used when this container is rendered inside Artifact.jsx (not a panel child)
  const rawColor = embedded ? (module?.ownStyle?.bg || null) : null;
  // Text: lighten the raw color 70% toward white for bright readable labels
  const embeddedAccent = rawColor ? lightenHex(rawColor, 0.7) : "#b0f8da";
  // A SECTION WITH NO COLOUR OF ITS OWN PAINTS NO BACKGROUND.
  //
  // This is a THIRD inline colour path — separate from `styleToCSS` and from the
  // stylesheet tokens — and it carried its own hardcoded alphas plus a hardcoded
  // teal fallback. Measured on the live grid, 56 of the 87 painting surfaces were
  // that FALLBACK literal (`rgba(14,61,50,0.35)`): an imported doc nests sections
  // five deep, none of them carry `ownStyle.bg`, so all five painted the same
  // invented teal on top of each other. Alpha compounds, so the wallpaper behind
  // the deepest stack came through at 9.5% and read as a solid slab.
  //
  // Inventing a colour for a section that has none is the actual defect; the
  // stacking is just what made it visible. A coloured section still tints (the
  // nine dimension colours are a real signal), capped at SURFACE_ALPHA so this
  // path cannot drift from the other two. THE BORDER STAYS in both cases — it is
  // what gives a section its edge, and a border is not a surface you look
  // through.
  // THE COLOURLESS CASE TAKES THE PAIR'S CONTAINER TINT, NOT AN INVENTED TEAL.
  // The teal literal that used to sit here moved to `--doc-textblock-tint` (the
  // user's swap: the green that was on textblocks belongs on their container, and
  // the container's teal belongs on the textblocks). Reading the token instead of
  // a literal means the swap lives in ONE place — see the doc-pair block in
  // index.css. It is a 0.04 tint, so five nested sections still transmit ~82%,
  // which is why re-introducing a default here does not undo the transparency
  // work: the old default was 0.35 and compounded to 9.5%.
  const embeddedCardStyle = embedded ? {
    background: hexToRgba(rawColor, SURFACE_ALPHA) ?? "var(--doc-container-tint)",
    border: `1px solid ${hexToRgba(rawColor, 0.5) ?? "var(--doc-container-ring)"}`,
    borderRadius: 6,
  } : {};
  const embeddedHeaderStyle = embedded ? {
    // The header used to read stronger than its card (0.42 vs 0.18). It shares the
    // one alpha now — the ask names headers explicitly ("the backgrounds of them
    // and headers"), and two knobs here is how they drift apart.
    background: hexToRgba(rawColor, SURFACE_ALPHA) ?? "var(--doc-container-tint-hover)",
    borderBottom: `1px solid ${hexToRgba(rawColor, 0.55) ?? "var(--doc-container-ring)"}`,
  } : {};

  const commitContainerStyleUpdate = useCallback((updates) => {
    CommitHelpers.updateModule({ dispatch, socket, module: { ...module, ...updates }, emit: true });
  }, [module, dispatch, socket]);

  const containerAllowedEdges = ALL_EDGES;

  const containerWithInstances = useMemo(() => {
    // childOccsKey is the reactive dep (own children changed); the full map
    // is read fresh at compute time via the non-subscribing getter.
    const instanceObjects = getContainerItems(module, getOccMap(), leafModulesById);
    return { ...module, instanceObjects };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module, childOccsKey, leafModulesById, getOccMap]);

  const { ref: containerRef, isDragging, isOver: isContainerOver, closestEdge, props: containerProps } = useDragDrop({
    type: DragType.CONTAINER,
    id: module.id,
    data: { ...containerWithInstances, occurrenceId: containerOccurrence?.id || null, defaultDragMode: containerDragMode },
    context: { panelId, containerId: module.id, occurrenceId: containerOccurrence?.id || null, pageOccurrenceId: pageOccurrenceId || null, sourceType: embedSourceType },
    accepts: [DragType.CONTAINER],
    allowedEdges: containerAllowedEdges,
    dragHandleRef: containerHandleRef,
  });

  const { ref: headerDropRef, isOver: isHeaderOver } = useDroppable({
    type: "container-header",
    id: `container-header:${module.id}`,
    context: { panelId, containerId: module.id, occurrenceId: containerOccurrence?.id || null, insertAt: 0 },
    accepts: DropAccepts.CONTAINER_LIST,
  });

  const { ref: listDropRef, isOver: isListOver } = useDroppable({
    type: "container-list",
    id: `container-list:${module.id}`,
    context: { panelId, containerId: module.id, occurrenceId: containerOccurrence?.id || null },
    accepts: DropAccepts.CONTAINER_LIST,
  });

  // Resolve the layout cascade for this container so render-time decisions
  // (sticky header, future view rules) can read the effective rule set
  // without each consumer walking ancestors themselves. Memoized on the
  // inputs the walker reads — occurrence + maps + grid defaults.
  const layoutCascade = useMemo(() => {
    if (!containerOccurrence?.id) return null;
    const ctx = buildLayoutCascadeContext({
      leafOccurrence: containerOccurrence,
      occurrencesById: getOccMap(),
      modulesById,
      grid: ctxGrid,
    });
    return resolveLayoutCascade(ctx, "container");
    // ancestorChain is the reactive dep for the ancestor walk inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerOccurrence, ancestorChain, modulesById, ctxGrid, getOccMap]);
  const stickyHeader = layoutCascade?.resolved?.stickyHeaders === true;

  // Children laid out as a WRAPPING GRID of squares rather than a stack of
  // full-width rows (user 2026-08-10: *"i want the instances inside the board
  // containers, wrapped and squared"*). Read from the layout cascade rather than
  // a new per-container flag, so the Trackers PAGE can set it once and every
  // container under it follows — and so the existing Layout menu already edits
  // it. `childMinWidth` doubles as the square's side.
  // HOW THIS CONTAINER ARRANGES ITS OWN CHILDREN — stack (the default), `wrap`
  // (a wrapping grid of tiles) or `flex-row` (a NON-wrapping row that scrolls
  // horizontally: kanban columns). All three read the same layout-cascade keys
  // the Layout menu already edits, so a page can state it once and every
  // container under it follows. The decision lives in a pure helper because
  // mounting this component needs the whole grid store, and the per-mode
  // defaults it picks are exactly where a bug would hide.
  const childLayout = resolveContainerChildLayout(layoutCascade?.resolved);

  // HOW EACH CHILD COMPOSES ITSELF — title above its fields, or beside them.
  // A CONTAINER decides this for its DIRECT children (a CSS custom property
  // reaches exactly one level, which is the scope we want — it is not a
  // cascade). `ModuleInstance` reads these through `var()` on its own inline
  // style, so no `!important` is involved and a container that sets nothing
  // renders exactly as before.
  //
  // NO IMPLICIT "column" UNDER WRAP ANY MORE. That default predates the row
  // restructure: back then the label sat IN LINE with the fields, so a square
  // tile genuinely had no room for it beside the handle. The row is now
  // `[handle][label over fields]`, and forcing `column` on top of that stacked
  // the whole text column BENEATH the drag handle — user, 2026-08-24: *"the
  // trackers tiles have the label and fields underneath the drag handle which
  // shouldnt be the case"* (tracker tiles are wrap tiles, so every one of them
  // hit this).
  //
  // It is still fully settable — `childContentDirection` is in the layout
  // cascade and the Layout menu edits it — so nothing is lost; only the
  // GUESS is gone.
  const childContentDir = layoutCascade?.resolved?.childContentDirection || null;

  // Occurrence controls order — pass containerOccurrence so ordering reads from occurrence.occurrences.
  // When `module.meta.allowChildContainers` is set, fall back to the full modulesById lookup so
  // role:"container" children are not filtered out (leafModulesById only contains instance/artifact/
  // textblock). The render loop below then branches by child role to mount <Container> vs <ModuleInstance>.
  const allowChildContainers = !!module?.meta?.allowChildContainers;
  const childModuleLookup = allowChildContainers ? modulesById : leafModulesById;
  const allItemsWithOccurrences = useMemo(
    // childOccsKey is the reactive dep (direct child refs); the map is a
    // fresh read at compute time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    () => getContainerItemsWithOccurrences(module, getOccMap(), childModuleLookup, undefined, containerOccurrence),
    [module, childOccsKey, childModuleLookup, containerOccurrence, getOccMap]
  );

  // Apply active filter: hide occurrences that don't match the effective filter values
  const activeNamedFilter = useMemo(() => {
    const activeId = ctxGrid?.activeFilterId;
    if (!activeId) return null;
    return (ctxGrid?.namedFilters || []).find(f => f.id === activeId) || null;
  }, [ctxGrid?.activeFilterId, ctxGrid?.namedFilters]);

  // Always walk the parent chain — `activeNamedFilter.lock` controls whether THIS
  // occurrence may write its own filterOverride (UI-level editability), not whether
  // ancestor overrides cascade. Mirrors the same fix in ModulePage.jsx — without
  // it, the schedule page's local date wouldn't propagate to slot containers below.
  const effectiveFilters = useMemo(
    // ancestorChain is the reactive dep for the ancestor filter walk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    () => getEffectiveFilterForOccurrence(containerOccurrence, { grid: ctxGrid, occurrencesById: getOccMap() }),
    [containerOccurrence, ctxGrid, ancestorChain, getOccMap]
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

  // A BOUNDED WINDOW FOR VERY LONG LISTS. Measured on the 993-row Movies board:
  // rendering every row costs 74,592 nodes, 7,377 ResizeObservers and 645 MB of
  // heap in ONE 6.5s task — which kills a tablet outright and starves every
  // other panel until it finishes. `content-visibility` cannot help here: it
  // skips layout and paint, not node creation. Short containers are untouched
  // (the hook returns the full count below its threshold), so this changes
  // nothing for the ~1,300 containers on this grid holding a handful of rows.
  const renderWindow = useRenderWindow(itemsWithOccurrences.length, { resetKey: childOccsKey });

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
  const isGraphContainer = containerViewType === "graph" || (!containerViewType && module?.kind === "graph");

  // Block-wrap host generalization (project_block_wrap_redesign): a kind:"doc"
  // container can host a wrapGroup just like a textblock. When it does, the wrap CSS
  // clips `.container-shell` to the L via the `--wrap-host-clip` var WrapGroupNode
  // measures from the floated neighbor — no per-container measure needed here.

  // Canvas items: look up ALL module roles (instances + containers) from modulesById
  // so both instances and doc/list containers can be dropped onto a canvas.
  const canvasItemsWithOccurrences = useMemo(() => {
    if (!isCanvasContainer) return [];
    // childOccsKey already holds the direct child occurrence refs in order.
    return childOccsKey.map(occ => {
      if (!occ) return null;
      const mod = modulesById[occ.moduleId];
      if (!mod) return null;
      return { module: mod, occurrence: occ };
    }).filter(Boolean);
  }, [isCanvasContainer, childOccsKey, modulesById]);

  // Canvas card renderer — wraps <ModuleInstance>/<Container> in an
  // absolute-positioning shell. The inner module handles its own drag
  // (useDragDrop), so canvas children are the same components used in
  // board/doc — only positioning differs.
  const renderCanvasCard = useCallback(({ module: mod, occurrence: occ, containerId: cid, panelId: pid }) => {
    let renderBody = null;
    if (mod.role === "artifact") {
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
            // A nested DOC has always drawn as a card. A nested BOARD has not —
            // and there are 539 of them on the live grid, every schedule time
            // slot among them, so flipping this on for all nested containers
            // would box the entire Schedule. So it is DATA: a container opts in
            // with `meta.cardChrome`, exactly the way `0124` let a timeslot opt
            // OUT of the rainbow band without the renderer learning what a
            // timeslot is. `noDomainKnowledge` stays satisfied.
            embedded={mod.kind === "doc" || mod.meta?.cardChrome === true}
            addInstanceToContainer={addInstanceToContainer}
            dispatch={dispatch}
            socket={socket}
          />
        ) : mod.role === "textblock" ? (
          <ModuleTextblock
            context="card"
            module={mod}
            occurrence={occ}
            containerId={cid}
            containerOccurrence={containerOccurrence}
            panelId={pid}
            dispatch={dispatch}
            socket={socket}
            floatHandle
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
  }, [dispatch, socket, containerOccurrence, addInstanceToContainer]);


  // Per-occurrence view-mode handling. Default is Actual (full container
  // render below). Representation mode swaps in a single compact chip so
  // mind-map nodes / value-builder cards can reference a container
  // without expanding all its descendants. Preview mode is the folder-
  // page PreviewNode pattern and doesn't apply at the inline container
  // level — falls through to Actual here.
  const containerViewMode = getEffectiveViewMode(containerOccurrence, "default");
  // ── THE RETURN MOVED BELOW THE HOOKS (2026-08-23) ────────────────────────
  // This was an early `return`, and TWO hooks sit below it — so a container
  // rendered N hooks as a representation chip and N+2 as itself. That is only
  // safe if a mounted container can never change mode, and it CAN: the
  // view-mode switcher in the header dropdown writes `meta.viewMode` on the
  // occurrence and `getEffectiveViewMode` reads exactly that. React refuses a
  // changing hook count, so toggling a container to or from Representation
  // crashed it — the same class that crashed BoundHeader (2026-08-11) and the
  // operations editor (same day as this).
  //
  // The JSX is captured here and returned after the last hook. Nothing in
  // between is a hook or a side effect — the span is `const`s and function
  // definitions (checked with the linter, which reports hooks only at the two
  // sites below) — so representation mode now builds a few closures it does not
  // use. That is the price of correct hook order, and it is cheap.
  const representationView = containerViewMode !== "representation" ? null : (

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


  // Build the container context menu at a given screen point. Called by the
  // mouse handler (right-click) AND the touch long-press hook.
  const openContainerMenu = ({ x, y }) => {
    // Paste-here surfaces when there's a non-empty clipboard. The verb adapts
    // to mode: Move N here / Paste N here / Paste linked N here.
    const clip = selection.clipboard;
    const pasteLabel = clip
      ? clip.mode === "move"
        ? `Move ${clip.ids.length} here`
        : clip.mode === "copylink"
          ? `Paste linked ${clip.ids.length} here`
          : `Paste ${clip.ids.length} here`
      : null;
    setCtxMenu({
      x, y,
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
              occurrencesById: getOccMap(),
              dispatch, socket,
              gridId: ctxGridId,
              userId: ctxUserId,
              panelId,
            });
            selection.clearClipboard();
            selection.clear();
            if (pasted > 0) {
              const verb = clip.mode === "move" ? "Moved" : clip.mode === "copylink" ? "Linked" : "Pasted";
              toast.success(`${verb} ${pasted} item${pasted === 1 ? "" : "s"}`, { duration: 2000 });
            } else {
              toast.error("Nothing pasted", { duration: 2500 });
            }
          },
        },
        clip && { separator: true },
        // The occurrence TYPES, same palette (and same labels/icons) the header
        // "+" shows — this menu used to carry four vague "add" rows and none of
        // the actual kinds. Artifact and Image are not here because they need
        // the file dialog / image picker the QuickAddMenu owns; the row below
        // opens it for them rather than duplicating that machinery.
        ...CONTEXT_ADD_KINDS.map((kind) => {
          const meta = KIND_TILE[kind] || { label: kind };
          const tileRole = kind === "instance" ? "instance" : kind === "textblock" ? "textblock" : "container";
          const { Icon } = getModuleTypeBadge({
            role: tileRole,
            kind: ["instance", "textblock"].includes(kind) ? undefined : kind,
          });
          return {
            label: meta.label,
            icon: Icon,
            onClick: () => handleQuickCreate({ kind }),
          };
        }),
        {
          label: "Artifact or image…",
          icon: Plus,
          onClick: () => setQuickAddTrigger((n) => n + 1),
        },
        {
          label: "Add inline textblock here",
          icon: Type,
          onClick: () => {
            if (!containerOccurrence) return;
            CommitHelpers.createTextblockInContainer({
              dispatch, socket,
              gridId: ctxGridId,
              userId: ctxUserId,
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
        // Convert this container to another kind (doc ↔ board ↔ list ↔ table),
        // keeping its children. See helpers/convertOccurrence.js.
        (module?.kind && CONVERTIBLE_CONTAINER_KINDS.includes(module.kind)) && { separator: true },
        ...((module?.kind && CONVERTIBLE_CONTAINER_KINDS.includes(module.kind))
          ? CONVERTIBLE_CONTAINER_KINDS.filter(k => k !== module.kind).map(k => ({
              label: `Convert to ${k[0].toUpperCase()}${k.slice(1)}`,
              icon: Shuffle,
              onClick: () => convertContainerKind({ dispatch, socket, occurrence: containerOccurrence, module, targetKind: k }),
            }))
          : []),
        { separator: true },
        { label: "Remove from grid", icon: Trash2, danger: true, onClick: removeMe },
      ].filter(Boolean),
    });
  };
  const containerLongPress = useLongPress(openContainerMenu);
  // Convert-kind buttons for the RADIAL menu (touch-accessible; the right-click
  // menu is desktop-only now). One button per OTHER container kind, each with
  // the target kind's own icon so they're distinguishable (user 2026-07-17).
  const convertRadialItems = useMemo(() => {
    if (!module?.kind || !CONVERTIBLE_CONTAINER_KINDS.includes(module.kind)) return [];
    const ICONS = { doc: FileText, board: LayoutGrid, canvas: PenTool, table: Table, graph: BarChart3 };
    return CONVERTIBLE_CONTAINER_KINDS.filter(k => k !== module.kind).map(k => ({
      icon: ICONS[k] || Shuffle,
      label: `Convert to ${k[0].toUpperCase()}${k.slice(1)}`,
      onClick: () => convertContainerKind({ dispatch, socket, occurrence: containerOccurrence, module, targetKind: k }),
      color: "bg-teal-700 hover:bg-teal-600",
    }));
  }, [module, containerOccurrence, dispatch, socket]);

  // Deferred from above, now that every hook has run.
  if (representationView) return representationView;

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
        // Panel-drag pass-through is CSS: body[data-drag-kind="panel"] .container-shell
        pointerEvents: isDragging ? "none" : "auto",
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
                size="sm"
                forceDirection="down"
                onToggleCollapse={null}
                isCollapsed={isBodyCollapsed}
                onToggleHeader={() => setShowHeader(true)}
                showHeader={false}
                onHistory={() => setHistoryOpen(true)}
                onTemplate={openTemplates}
                onDelete={embedOnDelete ?? removeMe}
                extraItems={[...(embedRadialItems || []), ...convertRadialItems]}
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
        className={`container-header module-header-row no-select ${embedded ? "embedded-container-header" : ""} ${module?.meta?.headerBand === false ? "container-header--no-band" : ""}`}
        // The heading level, addressable from CSS. The size and weight are
        // computed here and applied INLINE (headerFontSize / headerFontWeight),
        // so a stylesheet could not previously tell a `#` from a `####` — which
        // matters the moment a skin swaps in a font with different metrics: the
        // Stardew skin's pixel face runs much wider per character and clipped
        // the top level at a size that fits every other font.
        data-heading-level={module?.meta?.headingLevel ?? undefined}
        style={embedded
          ? { padding: "0", alignItems: "stretch", flexDirection: "column", ...embeddedHeaderStyle }
          : module.kind === "board"
            ? { gap: 6, padding: "4px 3px 2px 3px", minHeight: "20px" } // +2px above the items
            // A heading container (meta.headingLevel) sizes to its TEXT and takes
            // real padding on all four sides. The fixed 20px height below is
            // shorter than an 18px heading line, so the label overflowed its own
            // header — measured 35px tall starting 9px ABOVE the header row,
            // which is what made the day columns read as unpadded and
            // misaligned (2026-07-31).
            : module?.meta?.headingLevel
              ? { gap: 6, padding: "6px 10px", minHeight: 0, alignItems: "center" }
              : { height: "20px", gap: 6, padding: "2px 3px" }
        }
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openContainerMenu({ x: e.clientX, y: e.clientY }); }}
        {...containerLongPress}
      >
        {embedded ? (
          /* Embedded: single-row header — handle + #label + filter */
          <>
            {/* 3px top — 6 read as too much air above a nested section header
                (user 2026-07-31); the label keeps its own 2px below. */}
            <div style={{ display: "flex", alignItems: "center", padding: "3px 4px 0px 2px", minHeight: 12, gap: 4 }}>
              <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
                <PopoverAnchor asChild>
                  <div ref={containerHandleRef} className="module-drag-handle module-grab-zone" data-dnd-handle="true" style={{ position: "relative", top: 0, left: "auto", transform: "none", flexShrink: 0 }}>
                    <div className="drag-handle-ball" />
                    <div className="drag-handle-stem" />
                    <RadialMenu
                      dragMode={containerDragMode}
                      onToggleDragMode={toggleContainerDragModeQuick}
                      onSettings={() => setSettingsOpen(true)}
                      size="sm"
                      forceDirection="down"
                      onToggleCollapse={isDocContainer ? () => setIsBodyCollapsed(v => !v) : null}
                      isCollapsed={isBodyCollapsed}
                      onToggleHeader={() => setShowHeader(false)}
                      showHeader={showHeader}
                      onHistory={() => setHistoryOpen(true)}
                      onTemplate={openTemplates}
                      onDelete={embedOnDelete ?? removeMe}
                      extraItems={[...(embedRadialItems || []), ...convertRadialItems]}
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
              {/* One hash per heading LEVEL, the way the markdown it mirrors
                  reads: a level-2 section shows "##" (user 2026-07-31: "make the
                  day page container headings ## not #. except the top one saying
                  the date"). Driven by the level in module.meta, so the renderer
                  still knows nothing about which containers those are. */}
              <HeadingLevelPicker
                level={module?.meta?.headingLevel}
                onPick={commitHeadingLevel}
                fontSize={headerFontSize}
                fontWeight={headerFontWeight}
                color={embeddedAccent}
              />
              {headerBinding ? (
                <LabelShell
                  mode={boundLabelOverflow}
                  onPointerDown={(e) => e.stopPropagation()}
                  style={{ fontFamily: "var(--font-mono)", fontSize: headerFontSize, fontWeight: headerFontWeight, color: embeddedAccent, lineHeight: 1.2, flex: 1, minWidth: 0 }}
                >
                  <BoundHeader
                    hostOccurrence={containerOccurrence}
                    binding={headerBinding}
                    markdownPrefix=""
                    label={displayLabel || "Container"}
                  />
                </LabelShell>
              ) : (
                <LabelShell
                  mode={labelOverflow}
                  style={{ fontFamily: "var(--font-mono)", fontSize: headerFontSize, fontWeight: headerFontWeight, color: embeddedAccent, lineHeight: 1.2, flex: 1, minWidth: 0 }}
                >
                  <span
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => {
                      const typed = e.currentTarget.textContent.trim();
                      // MARKDOWN TYPING STILL WORKS, and it lands as ONE write
                      // rather than a rename followed by a level change — two
                      // writes would race each other on the same module and the
                      // second would carry a pre-rename copy.
                      const parsed = parseHeadingPrefix(typed);
                      const next = parsed ? parsed.label : typed;
                      if (!next) { e.currentTarget.textContent = displayLabel || "Container"; return; }
                      const meta = { ...(module?.meta || {}) };
                      if (parsed) meta.headingLevel = parsed.level;
                      const changed = next !== module.label || (parsed && meta.headingLevel !== module?.meta?.headingLevel);
                      if (changed) {
                        CommitHelpers.updateModule({ dispatch, socket, module: { ...module, label: next, meta }, emit: true });
                      }
                      // The hashes never stay in the text — they became the level.
                      if (parsed) e.currentTarget.textContent = next;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
                      e.stopPropagation();
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{ outline: "none", cursor: "text", whiteSpace: "inherit", wordBreak: "inherit" }}
                  >
                    {displayLabel || "Container"}
                  </span>
                </LabelShell>
              )}
              <div onPointerDown={(e) => e.stopPropagation()} style={{ flexShrink: 0, marginLeft: "auto" }}>
              </div>
            </div>
            {/* Row 3: the container's OWN fields, below the label (prevents the
                mobile crush that putting them beside it caused). */}
            {!isBodyCollapsed && <OccurrenceFields {...ownFieldsProps} />}
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
                    extraItems={[...(embedRadialItems || []), ...convertRadialItems]}
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
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", fontFamily: "var(--font-mono)", lineHeight: 1, textTransform: "uppercase", letterSpacing: "0.05em" }}>
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
                    // MATCHES the rendered header exactly — see CONTAINER_HEADER_PX.
                    fontSize: module.kind === "board" ? CONTAINER_HEADER_PX.board : CONTAINER_HEADER_PX.other,
                    fontWeight: module.kind === "board" ? 500 : 500,
                    color: "var(--text-primary)", fontFamily: "inherit",
                  }}
                />
              ) : (
                <span
                  className="container-header-label"
                  onDoubleClick={!headerBinding ? (e) => { e.stopPropagation(); setIsEditingLabel(true); } : undefined}
                  title={!headerBinding ? "Double-click to rename" : undefined}
                  style={{
                    flex: "1 1 auto", minWidth: 0, overflow: "hidden",
                    // 2px of air above the label (user 2026-07-31) — it sat
                    // hard against the container's top edge.
                    paddingTop: 2,
                    paddingBottom: module.kind === "board" ? 2 : 0,
                    // A container that declares a heading level sizes by it,
                    // exactly as the embedded header does. Without this a day
                    // COLUMN (level 1, standard header) rendered SMALLER than
                    // the `##` sections nested inside it.
                    fontSize: module?.meta?.headingLevel
                      ? headerFontSize
                      : (module.kind === "board" ? CONTAINER_HEADER_PX.board : CONTAINER_HEADER_PX.other),
                    fontWeight: module?.meta?.headingLevel ? headerFontWeight : 500,
                    display: "flex", alignItems: "center", gap: 4, position: "relative",
                    // The -1px nudge is for the small fixed-height headers; a
                    // heading sits in a padded row and must not ride up out of it.
                    top: module?.meta?.headingLevel ? 0 : -1,
                    lineHeight: module?.meta?.headingLevel ? 1.15 : undefined,
                    cursor: !headerBinding ? "text" : undefined,
                  }}
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

            {/* Filter (HeaderChevron) BEFORE the add (QuickAddMenu), both right-aligned. */}
            <div className="ml-auto mr-1" style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4 }} onPointerDown={(e) => e.stopPropagation()}>
              {containerOccurrence?.feed?.enabled && (
                <Rss size={10} style={{ color: "rgba(96,165,250,0.85)", flexShrink: 0 }} title="Feed on — pulls matching occurrences" />
              )}
              {/* FIELDS SIT LEFT OF THE FILTER (user 2026-08-11: "fields should
                  go to the left of filters anyway"). Inside the right-aligned
                  cluster rather than after it, so the whole group stays
                  right-aligned and the order reads fields → filter → add. */}
              {!isBodyCollapsed && <OccurrenceFields {...ownFieldsProps} />}
              <HeaderChevron onClick={openDropdown} isOpen={!!dropdownAnchor} occurrence={containerOccurrence} />
              <QuickAddMenu
                targetRole="instance"
                onSelect={handleQuickAddInstance}
                onCreateNew={handleQuickCreate}
                createLabel="New instance"
                hostOccurrence={containerOccurrence}
                openTrigger={quickAddTrigger}
              />
            </div>
          </>
        )}

        {isHeaderOver && items.length > 0 &&
          [DragType.INSTANCE, DragType.EXTERNAL, DragType.FILE, DragType.TEXT, DragType.URL].includes(dragCtx.getActiveType()) && (
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
          ctxState={ctxStateLite}
        />
      ) : attachedBodyFields.length > 0 ? (
        /* Attached body field — markdown textarea replaces the body editor */
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "4px 8px 8px 8px", gap: 2 }}>
          {attachedBodyFields[0] && (
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
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
        <div ref={listDropRef} className="container-doc" style={{ flex: 1, minHeight: embedded ? 0 : 100, overflow: embedded ? "visible" : "auto", position: "relative" }}>
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
          ctxState={ctxStateLite}
          containerId={module.id}
          panelId={panelId}
          onDoubleClickBackground={(e) => {
            if (e.target !== e.currentTarget) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = Math.round(e.clientX - rect.left);
            const y = Math.round(e.clientY - rect.top);
            const userId = ctxUserId;
            const gridId = ctxGridId;
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
        const allOccurrences = Object.values(getOccMap());
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
                    className={`text-[12px] px-1 py-0.5 rounded ${idx === focusedStack.length - 1 ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}
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
                  <span className="text-[12px] font-mono text-muted-foreground/60 uppercase tracking-wide">{fi.label || "Note"}</span>
                </div>
                <DocEditorShell occurrence={fo} dispatch={dispatch} socket={socket} />
              </div>

              {/* LINKED SIBLINGS */}
              {siblingInstances.map(sib => {
                const sibOcc = getSiblingOcc(sib.id);
                return (
                  <div key={sib.id} className="border-t border-border/30 shrink-0" style={{ minHeight: 100 }}>
                    <div className="px-2 pt-1.5 pb-0.5 flex items-center gap-1">
                      <span className="text-[12px] font-mono text-muted-foreground/60 uppercase tracking-wide">{sib.label || "Linked"}</span>
                      <button
                        className="ml-auto text-[12px] text-muted-foreground/40 hover:text-muted-foreground px-1"
                        onClick={() => { if (sibOcc) handleInstanceFocusLocal(sib, sibOcc); }}
                        title="Drill into linked item"
                      >↗</button>
                    </div>
                    {sibOcc ? (
                      <DocEditorShell occurrence={sibOcc} dispatch={dispatch} socket={socket} />
                    ) : (
                      <div className="px-2 pb-2 text-[12px] text-muted-foreground/40 italic">No entry for this period</div>
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
                      <span className="text-[12px] font-mono text-muted-foreground/60 uppercase tracking-wide">Sub-items ({childInstances.length})</span>
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
                          <span className="text-[12px] text-foreground/70 flex-1 truncate">{child.label || "Untitled"}</span>
                          <button
                            className="text-[12px] text-muted-foreground/40 hover:text-muted-foreground px-1 flex-shrink-0"
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
                  className="w-full flex items-center gap-1 px-2 py-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors"
                  onClick={() => setHistoryExpanded(h => !h)}
                >
                  <ChevronRight className={`w-3 h-3 transition-transform ${historyExpanded ? "rotate-90" : ""}`} />
                  <span>History</span>
                  {historyOccs.length > 0 && <span className="ml-auto text-muted-foreground/50">{historyOccs.length} entries</span>}
                </button>
                {historyExpanded && (
                  <div className="divide-y divide-border/20">
                    {historyOccs.length === 0 ? (
                      <div className="px-3 py-2 text-[12px] text-muted-foreground/50 italic">No history yet</div>
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
                            <span className="text-[12px] font-medium text-foreground/70">{dateLabel}</span>
                          </div>
                          {selfPreview
                            ? <p className="text-[12px] text-muted-foreground leading-relaxed mb-0.5">{selfPreview}</p>
                            : <p className="text-[12px] text-muted-foreground/30 italic">No content</p>
                          }
                          {siblingPreviews.map(({ sib, text }) => (
                            <div key={sib.id} className="mt-0.5 pl-2 border-l border-border/30">
                              <span className="text-[12px] text-muted-foreground/50">{sib.label}: </span>
                              <span className="text-[12px] text-muted-foreground/70">{text}</span>
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
      })() : (() => {
        /* List Container. Built as a local so the GRAPH surface can reuse it
           verbatim as its source board — the graph's rows ARE these children,
           so the board is this list, not a second implementation of it. */
        const childList = (
        <div
          ref={listDropRef}
          /* `--long` gates the off-screen skip (index.css, "#24 perf"). That
             skip is applied per ROW, so on a page whose containers hold two or
             three 36-60px rows it can never earn back the layout+paint each
             flip costs — measured on a Samsung A15 (2026-08-04): 97 tracked
             rows, 11 un-skipped mid-scroll, 63ms median frames and a burst
             that moved 0.7px in 3.1s, with ZERO long tasks (so none of it was
             our JS). Long boards are the case it was written for and keep it.
             Structural, so it cannot drift as pages change shape. */
          className={`container-list${items.length >= LONG_LIST_MIN ? " container-list--long" : ""}`}
          style={{
            flex: items.length === 0 ? 1 : "0 0 auto",
            minHeight: items.length === 0 ? 40 : "fit-content",
            // overflow visible — containers expand and the PAGE scrolls. An
            // inline "auto" here silently beat the .container-list stylesheet
            // fix and kept the few-px micro-scrollbar that ate touch scrolling.
            overflow: "visible", padding: 0,
            display: "flex", flexDirection: "column", position: "relative",
          }}
        >
          <div
            role="list"
            aria-label={`${module.label || "Container"} items`}
            className={"container-items"
              + (childLayout.className ? ` ${childLayout.className}` : "")
              // The TILE shape: picture on top, then title, then fields.
              // A class as well as the CSS vars because the rest of the
              // shape is selector work — the media block has to move ABOVE
              // the text column (it is authored after it, for the row
              // layout) and the drag handle has to stop consuming a row.
              + (childContentDir === "column" ? " container-items--content-column" : "")}
            style={{
              // Board containers get +2px top + bottom over the list default —
              // the kanban-style column rows were too squished against the
              // container chrome.
              padding: module.kind === "board" ? "7px 5px 9px 5px" : "3px 5px 5px 5px",
              flex: 1, display: "flex", flexDirection: "column",
              // Wrap mode ("i want to see them as squares instead of rectangles
              // stacked") is driven by the SAME layout cascade the board page
              // uses for its columns — `mode` + `childMinWidth` — so a page can
              // set it once and every container under it follows, and the
              // existing Layout menu already edits it. The two numbers ride as
              // CSS vars because the rest of the shape (aspect ratio, hiding the
              // between-item insert gaps) is CSS.
              // Per-mode CSS vars (null for stack, so an unconfigured
              // container is byte-identical to before).
              ...(childLayout.vars || null),
              ...(childContentDir === "column"
                ? {
                    "--instance-content-direction": "column",
                    "--instance-content-wrap": "nowrap",
                    "--instance-content-justify": "flex-start",
                  }
                : null),
            }}
          >
            {itemsWithOccurrences.slice(0, renderWindow.count).map(({ instance, occurrence }, idx) => {
              const role = instance?.role;
              // Container-in-container: when the parent has allowChildContainers,
              // a role:"container" child mounts its own <Container> instead of a
              // <ModuleInstance>. occurrenceOverride pins the child to the
              // specific occurrence this parent links (multi-parent-safe).
              let node;
              if (role === "container" && allowChildContainers) {
                node = (
                  <Container
                    module={instance}
                    occurrenceOverride={occurrence}
                    panelId={panelId}
                    // OPT-IN CARD CHROME. This site passed no `embedded` at all,
                    // so every nested container in a board drew as a bare run —
                    // which is what "why arent the workout trackers boxes like
                    // the rest" was describing. It is a FLAG rather than `true`
                    // because there are 539 nested board containers on the live
                    // grid, every schedule time slot among them; boxing all of
                    // them is a change nobody asked for. `0215` sets it on the
                    // four tracker groups. (The canvas renderer above honours
                    // the same flag.)
                    embedded={instance?.meta?.cardChrome === true}
                    pageOccurrenceId={pageOccurrenceId || null}
                    // Without this a NESTED container's own "+ → Item" throws
                    // `addInstanceToContainer is not a function` and adds
                    // nothing — measured on claude-grid 2026-08-18, where a
                    // board inside a board could not take a single row.
                    addInstanceToContainer={addInstanceToContainer}
                    // THIS container is what rendered the child — the same
                    // reason `occurrenceOverride` is pinned here rather than
                    // looked up ("multi-parent-safe", above).
                    renderParentOccurrenceId={containerOccurrence?.id || null}
                    dispatch={dispatch}
                    socket={socket}
                    gapPx={6}
                  />
                );
              } else {
                let renderBody = null;
                if (role === "artifact") {
                  renderBody = () => <ArtifactCard module={instance} label={instance.label} occurrence={occurrence} />;
                }
                // This site passes NO floatHandle — do not add one; the canvas and
                // page sites do, and ModuleTextblock passes it through rather than
                // supplying it precisely so these two stay different.
                node = role === "textblock" ? (
                  <ModuleTextblock
                    context="card"
                    module={instance}
                    occurrence={occurrence}
                    containerId={module.id}
                    panelId={panelId}
                    panel={panel}
                    container={module}
                    containerOccurrence={containerOccurrence}
                    dragOutDisabled={isGraphContainer}
                    dispatch={dispatch}
                    socket={socket}
                    allowedEdges={containerAllowedEdges}
                    onInstanceFocus={null}
                  />
                ) : (
                  <ModuleInstance
                    module={instance}
                    occurrence={occurrence}
                    containerId={module.id}
                    panelId={panelId}
                    panel={panel}
                    container={module}
                    containerOccurrence={containerOccurrence}
                    // A GRAPH's members are DATA, not placements (user,
                    // 2026-08-07: "even if its dragged in, it shouldnt be a
                    // draggable occurance once dropped … we can delete them but
                    // not drag them from inside the graph"). Dragging IN still
                    // works — that is the container's own drop target, which
                    // wraps this list — and delete still works, since that is
                    // the context menu, not the drag system.
                    dragOutDisabled={isGraphContainer}
                    dispatch={dispatch}
                    socket={socket}
                    allowedEdges={containerAllowedEdges}
                    onInstanceFocus={null}
                    renderBody={renderBody}
                  />
                );
              }
              // Insert-here gap BEFORE each item (only when this container's
              // occurrence is resolvable so the splice has a real parent).
              return (
                <React.Fragment key={occurrence.id}>
                  {containerOccurrence && (
                    <InsertGap parentOccurrence={containerOccurrence} index={idx} hostOccurrence={containerOccurrence} panelId={panelId} containerLabel={module?.label || ""} />
                  )}
                  {node}
                </React.Fragment>
              );
            })}
            {/* THE WINDOW'S SEAM. A sentinel after the last rendered row asks
               for the next chunk as it approaches the viewport, so a long board
               stays fully browsable — nothing here is permanently unreachable.
               The count is announced because a silent cap reads as missing data,
               which is the one thing worse than a slow board. */}
            {renderWindow.hidden > 0 && (
              <div
                ref={renderWindow.sentinelRef}
                className="container-window-seam"
                style={{ padding: "6px 4px", fontSize: 12, opacity: 0.6, textAlign: "center" }}
              >
                {renderWindow.hidden} more — scroll to load
              </div>
            )}
            {/* Trailing gap — append-at-end insert point. */}
            {containerOccurrence && items.length > 0 && renderWindow.hidden === 0 && (
              <InsertGap parentOccurrence={containerOccurrence} index={itemsWithOccurrences.length} hostOccurrence={containerOccurrence} panelId={panelId} containerLabel={module?.label || ""} />
            )}
            {/* Empty container still gets the insert-here / quick-add bar so you
               can add the first item without dropping (gated on the occurrence
               resolving, same as the between-item gaps). */}
            {containerOccurrence && items.length === 0 && (
              <InsertGap parentOccurrence={containerOccurrence} index={0} hostOccurrence={containerOccurrence} panelId={panelId} containerLabel={module?.label || ""} emptyBody />
            )}
          </div>
        </div>
        );
        return isGraphContainer ? (
          // No source board: a graph PULLS its rows from its feed now, so there
          // is nothing to drag in and the child list would be an editable copy
          // of a query result (user, 2026-08-10).
          <ContainerGraph
            occurrence={containerOccurrence}
            renderParentOccurrenceId={renderParentOccurrenceId}
            dispatch={dispatch}
            socket={socket}
          />
        ) : childList;
      })())}

      {/* Gap hitbox */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: gapPx, marginBottom: -gapPx, pointerEvents: "auto", zIndex: 2 }} />

      {/* Filter override quick-popup */}
      {filterPopupPos && createPortal(
        <FilterOverridePopup
          pos={filterPopupPos}
          occurrence={containerOccurrence}
          activeFilterValues={ctxGrid?.activeFilterValues || {}}
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
        gridId={ctxGridId}
        moduleId={module.id}
      />

      {dropdownAnchor && (
        <HeaderDropdown anchorRect={dropdownAnchor} onClose={closeDropdown}>
          {/* TABBED, like a page's. This dropdown opens from `HeaderChevron` —
              the FILTER chevron — and rendered every section in one flat column,
              so sorting, feeds, fields, layout and the chart editor all read as
              part of "the filter menu" (user 2026-08-28: *"the graph stuff is in
              the main filter tab"* / *"that should be seperated into tabs as
              well"*). `ModulePage` has had exactly these tabs since MenuTabs
              landed; the container never got them.

              AND THE CHART EDITOR LEFT ENTIRELY. It was rendered here
              unconditionally, so every ordinary container offered chart type /
              label field / value field for a chart it does not draw — *"its
              shown when i click the filter button on a container header that
              isnt a graph."* It now lives in ContainerForm's "Chart" tab, gated
              on `kind === "graph"`: how a graph is drawn belongs to the
              occurrence's settings, not to filtering. */}
          <MenuTabs
            tabs={[
              { id: "filter", label: "Filter", content: <FiltersSection occurrence={containerOccurrence} /> },
              { id: "sort",   label: "Sort",   content: <SortSection occurrence={containerOccurrence} /> },
              { id: "data",   label: "Data",   content: (
                <>
                  <FeedSection occurrence={containerOccurrence} />
                  {/* The chart editor is NOT here: it moved to ContainerForm's
                      "Chart" tab — the occurrence's own settings sheet — because
                      this dropdown opens from the FILTER chevron and how a graph
                      is drawn is not a filtering concern. */}
                </>
              ) },
              { id: "fields", label: "Fields", content: <FieldVisibilitySection occurrence={containerOccurrence} /> },
              { id: "layout", label: "Layout", content: (
                <>
                  <ViewModeSection occurrence={containerOccurrence} />
                  <LayoutCascadeSection occurrence={containerOccurrence} />
                </>
              ) },
            ]}
          />
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
