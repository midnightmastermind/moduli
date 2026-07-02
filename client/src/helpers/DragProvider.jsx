// helpers/DragProvider.jsx
// ============================================================
// DRAG PROVIDER - THE BRAIN
// ============================================================
//
// This owns ALL drag/drop state and logic.
// Components just attach hooks and read from context.
//
// RESPONSIBILITIES:
// - Track active drag payload
// - Track hot target (what's being hovered)
// - Handle drop commits (panel→cell, container→panel, instance→container)
// - Manage draft state for live previews
// - Handle external/cross-window drops

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DragContext,
  DragHotContext,
  DragType,
  NATIVE_DND_MIME,
  parseExternalDrop,
  getWindowId,
  setupAutoScroll,
} from "./dragSystem";
import * as CommitHelpers from "./CommitHelpers";
import * as LayoutHelpers from "./LayoutHelpers";
import { runMatchingOperations } from "./operationExecutor";
import { batchUpdateModulesAction } from "../state/actions";
import { routeDrop } from "./dropHandlers";
import { operationsBridge } from "../state/bindSocketToStore";
import { buildDropContext, buildRawDropEvent, DROP_TARGET_KIND } from "./dragHitTesting";
import { snapshotRenders, diffRenders } from "./renderProbe";
import { dragPerf } from "./dragPerf";

// ============================================================
// UTILITIES
// ============================================================
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function deepClonePanels(panels = []) {
  return panels.map((p) => ({
    ...p,
    layout: p.layout ? { ...p.layout, style: { ...(p.layout.style || {}) } } : p.layout,
    _occurrence: p._occurrence
      ? { ...p._occurrence, occurrences: [...(p._occurrence.occurrences || [])] }
      : null,
  }));
}

function deepCloneContainers(containers = []) {
  return containers.map((c) => ({ ...c }));
}

function cloneOccurrencesForDraft(occurrencesById) {
  const draft = Object.create(null);
  for (const [id, occ] of Object.entries(occurrencesById)) {
    draft[id] = { ...occ, occurrences: [...(occ.occurrences || [])] };
  }
  return draft;
}

function cellKeyFromPanel(p) {
  return `cell-${p.row}-${p.col}`;
}

function panelDisplay(p) {
  return p?.layout?.style?.display ?? "block";
}

function makeUUID() {
  return crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ============================================================
// DIRECT-DOM DROP INDICATORS (zero re-render)
// ============================================================
// Two singleton overlay elements positioned via direct DOM (no React state, no
// re-renders — same spirit as the `data-drop-active` outline), updated each
// rAF tick of handleDragMove:
//   • drop-area BOX  — a border around the hovered container (the "drop area"),
//     so you always see WHICH container you're dropping into. Stable: it just
//     repositions to the new container as you cross — never flickers on/off
//     (unlike the React `isOver` page outline, which sputtered).
//   • insertion LINE — a thin line at the computed gap between cards, so you
//     see WHERE within the container it lands. Hidden for empty containers
//     (the box alone is the indicator there). Box sits ABOVE the line (z).
// The per-element pragmatic closestEdge indicators only fired directly over a
// card (never in the gaps where users aim) and churned re-renders — this
// replaces them for leaf drags.
const _LINE_CSS =
  "position:fixed;z-index:9998;pointer-events:none;display:none;" +
  "background:rgb(50,150,255);border-radius:2px;" +
  "box-shadow:0 0 6px rgba(50,150,255,0.85);will-change:left,top,width,height;";
const _AREA_CSS =
  "position:fixed;z-index:9999;pointer-events:none;display:none;box-sizing:border-box;" +
  "border:2px solid rgba(50,150,255,0.9);border-radius:8px;" +
  "box-shadow:0 0 0 3px rgba(50,150,255,0.16);will-change:left,top,width,height;";

function _getEl(id, css) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.style.cssText = css;
    document.body.appendChild(el);
  }
  return el;
}

function hideDropIndicators() {
  const l = document.getElementById("__moduli_insert_line");
  if (l) l.style.display = "none";
  const a = document.getElementById("__moduli_drop_area");
  if (a) a.style.display = "none";
}

// Outline the hovered container (drop area) + draw the insertion line at the
// computed gap. Returns { index } or null when there's no container.
function showDropIndicators(containerEl, x, y) {
  if (!containerEl) { hideDropIndicators(); return null; }
  const area = _getEl("__moduli_drop_area", _AREA_CSS);
  const line = _getEl("__moduli_insert_line", _LINE_CSS);

  // Drop-area border around the hovered container (box-sizing:border-box so the
  // 2px border draws inside the rect — visually flush with the container edge).
  const cr = containerEl.getBoundingClientRect();
  Object.assign(area.style, {
    display: "block",
    left: `${cr.left}px`, top: `${cr.top}px`,
    width: `${cr.width}px`, height: `${cr.height}px`,
  });

  // Only direct cards of THIS container (exclude nested-container children).
  const cards = Array.from(containerEl.querySelectorAll(".instance-wrap"))
    .filter((c) => c.closest("[data-container-id]") === containerEl);
  if (cards.length === 0) {
    // Empty container — the box border IS the indicator; no line.
    line.style.display = "none";
    return { index: 0 };
  }

  // Detect layout axis from the first two cards (board can be row OR column).
  const r0 = cards[0].getBoundingClientRect();
  const r1 = cards.length > 1 ? cards[1].getBoundingClientRect() : null;
  const horizontal = r1 ? Math.abs(r1.left - r0.left) > Math.abs(r1.top - r0.top) : false;

  let index = cards.length;
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect();
    const mid = horizontal ? r.left + r.width / 2 : r.top + r.height / 2;
    if ((horizontal ? x : y) < mid) { index = i; break; }
  }

  const ref = (index < cards.length ? cards[index] : cards[cards.length - 1]).getBoundingClientRect();
  if (horizontal) {
    const lineX = index < cards.length ? ref.left - 2 : ref.right - 1;
    Object.assign(line.style, { display: "block", left: `${lineX}px`, top: `${ref.top}px`, width: "3px", height: `${ref.height}px` });
  } else {
    const lineY = index < cards.length ? ref.top - 2 : ref.bottom - 1;
    Object.assign(line.style, { display: "block", left: `${ref.left}px`, top: `${lineY}px`, width: `${ref.width}px`, height: "3px" });
  }
  return { index };
}

// ============================================================
// DRAG PROVIDER
// ============================================================
export function DragProvider({
  children,
  state,
  dispatch,
  socket,
  gridRef,
  rows = 1,
  cols = 1,
  rowSizes = [],
  colSizes = [],
  visiblePanels = [],
  onTick,
  activeCell,
  setActiveCell,
  isTouch,
  isMobileLayout,
}) {
  // ============================================================
  // STATE
  // ============================================================
  const [activePayload, setActivePayload] = useState(null);
  const [panelOverCellId, setPanelOverCellId] = useState(null);
  // Drag mode: 'move' | 'copy' | 'copylink'
  const [dragMode, setDragMode] = useState('move');
  // Native external-drag preview pill (docket §6.5 drop UX polish). Set
  // by the .grid-frame native-dragover listener whenever a drag from
  // outside the app (browser tab, OS file picker) is over the grid;
  // cleared on drop / dragend / dragleave-of-window. Renders a floating
  // "Convert HTML → modules" chip near the cursor so the user knows the
  // import pipeline will run when they release.
  const [externalImportPreview, setExternalImportPreview] = useState(null);

  // NOTE: internal Pragmatic DnD drags no longer render a JS-followed
  // cursor pill. The action verb (Move / Copy / Copy-link) + the source
  // label now live INSIDE the native drag image (see dragSystem.js
  // `attachDragPreview`), which the OS moves with zero lag. The live
  // destination is conveyed by the container drop-highlight ring.

  const activeType = activePayload?.type || null;
  const activeId = activePayload?.id || null;
  const isDragging = activePayload !== null;

  // ============================================================
  // REFS
  // ============================================================
  const sessionRef = useRef({
    dragging: false,
    payload: null,
    startPanels: null,
    startContainers: null,
    draftPanels: null,
    draftContainers: null,
    draftOccurrences: null,
  });

  const pointerRef = useRef({ x: 0, y: 0 });
  // B3: Stable ref for values that change but don't need to recreate callbacks
  const dragConfigRef = useRef({ activeCell, setActiveCell, rows, cols, isTouch, isMobileLayout });
  dragConfigRef.current = { activeCell, setActiveCell, rows, cols, isTouch, isMobileLayout };
  const rafRef = useRef(0);
  // Mobile drag-to-edge cell navigation timer
  const dragEdgeTimerRef = useRef(null);
  const dragEdgeIndicatorRef = useRef(null);
  // Continuous-autoscroll loop. Per-frame scroll while the finger sits in
  // the scroll edge zone — without this, mobile autoscroll only happens
  // while the finger is actively moving (no touchmove → no autoscroll).
  const autoscrollRafRef = useRef(0);
  const autoscrollStateRef = useRef({ el: null, dir: 0 });
  // Cache of the last scrollable-ancestor scan (elementsFromPoint + getComputedStyle
  // is a per-frame style recalc — the main touch-drag jank on slower tablets).
  // Re-scan at most every AUTOSCROLL_SCAN_MS; each frame only reads the cached
  // element's rect (cheap) to decide scroll direction.
  const autoscrollScanRef = useRef({ el: null, at: 0 });
  const stopAutoscroll = useCallback(() => {
    if (autoscrollRafRef.current) cancelAnimationFrame(autoscrollRafRef.current);
    autoscrollRafRef.current = 0;
    autoscrollStateRef.current = { el: null, dir: 0 };
  }, []);
  const tickAutoscroll = useCallback(() => {
    const { el, dir } = autoscrollStateRef.current;
    if (!el || !dir) { autoscrollRafRef.current = 0; return; }
    const speed = 10;
    if (dir < 0) el.scrollTop = Math.max(0, el.scrollTop - speed);
    else el.scrollTop = Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + speed);
    autoscrollRafRef.current = requestAnimationFrame(tickAutoscroll);
  }, []);
  // Track last hot target to skip redundant DOM updates on every mouse-move
  const lastHotRef = useRef({ panelId: null, containerId: null, instanceId: null });
  // Sticky deepest-leaf container the drop-area box is on — prevents the box
  // jumping to the outer parent container when the cursor crosses gaps between
  // child containers (the "outer schedule container border sputter").
  const dropBoxElRef = useRef(null);
  // B2: Cache last preview target to skip redundant draft mutations
  const lastPreviewRef = useRef({ containerId: null, instanceId: null, panelId: null });

  // Direct DOM highlight — bypasses React state for zero-lag drop outline.
  // Targets either container (data-container-id) or panel (data-panel-id)
  // depending on what's being dragged: leaf drops light up the container,
  // page drops light up the destination panel.
  const highlightedRef = useRef({ id: null, attr: null });
  const highlightRAFRef = useRef(null);
  const setDropHighlight = useCallback((id, attr = "data-container-id") => {
    const cur = highlightedRef.current;
    if (cur.id === id && cur.attr === attr) return;
    cancelAnimationFrame(highlightRAFRef.current);
    highlightRAFRef.current = requestAnimationFrame(() => {
      if (cur.id) {
        document.querySelector(`[${cur.attr}="${cur.id}"]`)
          ?.removeAttribute("data-drop-active");
      }
      if (id) {
        const matchCount = document.querySelectorAll(`[${attr}="${id}"]`).length;
        const target = document.querySelector(`[${attr}="${id}"]`);
        if (window.__dragDiag === true) {
          console.log("[dragDiag] highlight", { attr, id, found: !!target, matchCount });
          if (matchCount > 1) console.warn("[dragDiag] highlight AMBIGUOUS — querySelector lights the FIRST of", matchCount, "elements with", attr, "=", id, "(may not be the hovered one)");
        }
        target?.setAttribute("data-drop-active", "true");
      }
      highlightedRef.current = { id, attr };
    });
  }, []);

  // ============================================================
  // BASE DATA
  // ============================================================
  const basePanels = useMemo(
    () => (Array.isArray(visiblePanels) ? visiblePanels : []),
    [visiblePanels]
  );

  // baseAllPanels must use visiblePanels (basePanels) since they carry _occurrenceId + placement.
  // state.panels are raw modules without placement — useless for drag drop occurrence updates.
  const baseAllPanels = useMemo(() => {
    return basePanels.length ? basePanels : (Array.isArray(state?.panels) ? state.panels : []);
  }, [state?.panels, basePanels]);

  const baseContainers = useMemo(
    () => (Array.isArray(state?.containers) ? state.containers : []),
    [state?.containers]
  );

  // Build occurrences lookup for finding occurrence IDs by target
  const occurrencesById = useMemo(() => {
    const map = Object.create(null);
    const occs = Array.isArray(state?.occurrences) ? state.occurrences : [];
    for (const occ of occs) {
      if (occ?.id) map[occ.id] = occ;
    }
    return map;
  }, [state?.occurrences]);

  // Modules lookup. Redux state stores modules as an array — drop routing
  // and dropView need a moduleId→module map to resolve role. App.jsx builds
  // its own from state.modules; we build ours here so the drag layer doesn't
  // depend on App.jsx's GridActionsContext memo.
  const modulesById = useMemo(() => {
    const map = Object.create(null);
    const mods = Array.isArray(state?.modules) ? state.modules : [];
    for (const m of mods) {
      if (m?.id) map[m.id] = m;
    }
    return map;
  }, [state?.modules]);

  // ============================================================
  // DRAFT-AWARE GETTERS
  // ============================================================
  const getWorkingPanels = useCallback(() => {
    const s = sessionRef.current;
    return s.dragging && s.draftPanels ? s.draftPanels : basePanels;
  }, [basePanels]);

  const getWorkingAllPanels = useCallback(() => {
    const s = sessionRef.current;
    return s.dragging && s.draftPanels ? s.draftPanels : baseAllPanels;
  }, [baseAllPanels]);

  const getWorkingContainers = useCallback(() => {
    const s = sessionRef.current;
    return s.dragging && s.draftContainers ? s.draftContainers : baseContainers;
  }, [baseContainers]);

  // ============================================================
  // GEOMETRY
  // ============================================================
  const getCellFromPoint = useCallback((x, y) => {
    const el = gridRef?.current;
    if (!el) return null;

    const rect = el.getBoundingClientRect();
    const relX = (x - rect.left) / rect.width;
    const relY = (y - rect.top) / rect.height;

    const totalCols = (colSizes || []).reduce((a, b) => a + b, 0) || 1;
    const totalRows = (rowSizes || []).reduce((a, b) => a + b, 0) || 1;

    let acc = 0, col = 0;
    for (let i = 0; i < colSizes.length; i++) {
      acc += colSizes[i];
      if (relX <= acc / totalCols) { col = i; break; }
    }

    acc = 0;
    let row = 0;
    for (let i = 0; i < rowSizes.length; i++) {
      acc += rowSizes[i];
      if (relY <= acc / totalRows) { row = i; break; }
    }

    return {
      row: clamp(row, 0, rows - 1),
      col: clamp(col, 0, cols - 1),
      cellId: `cell-${clamp(row, 0, rows - 1)}-${clamp(col, 0, cols - 1)}`,
    };
  }, [gridRef, rows, cols, rowSizes, colSizes]);

  // ============================================================
  // HIT TESTING — single elementsFromPoint per frame (B1)
  // ============================================================
  // For schedule-style modules with one occurrence per date, multiple DOM nodes
  // can share the same data-container-id / data-instance-id (the module ID).
  // We also collect the per-occurrence IDs (data-occ-id on containers,
  // data-occurrence-id on instances) so callers can target the SPECIFIC node
  // under the cursor instead of `Object.values(...).find(o => o.moduleId === ...)`
  // which silently picks the wrong day.
  const getHoveredIds = useCallback((x, y) => {
    const elements = document.elementsFromPoint(x, y);
    let panelId = null, containerId = null, containerOccId = null, containerEl = null, instanceId = null, instanceOccId = null;
    for (const el of elements) {
      if (!panelId) { const v = el.getAttribute("data-panel-id"); if (v) panelId = v; }
      if (!containerId) {
        const v = el.getAttribute("data-container-id");
        if (v) {
          containerId = v;
          containerOccId = el.getAttribute("data-occ-id") || null;
          containerEl = el;
        }
      }
      if (!instanceId) {
        const v = el.getAttribute("data-instance-id");
        if (v) {
          instanceId = v;
          instanceOccId = el.getAttribute("data-occurrence-id") || null;
        }
      }
      if (panelId && containerId && instanceId) break;
    }
    return { panelId, containerId, containerOccId, containerEl, instanceId, instanceOccId };
  }, []);

  // Keep individual getters for one-off callers (e.g. handleDrop fallbacks)
  const getTopmostAttr = useCallback((attr) => {
    const elements = document.elementsFromPoint(pointerRef.current.x, pointerRef.current.y);
    for (const el of elements) {
      const val = el.getAttribute(attr);
      if (val) return val;
    }
    return null;
  }, []);
  const getHoveredPanelId = useCallback(() => getTopmostAttr("data-panel-id"), [getTopmostAttr]);
  const getHoveredContainerId = useCallback(() => getTopmostAttr("data-container-id"), [getTopmostAttr]);
  const getHoveredInstanceId = useCallback(() => getTopmostAttr("data-instance-id"), [getTopmostAttr]);

  // ============================================================
  // SESSION MANAGEMENT
  // ============================================================
  const startSession = useCallback((payload, mode = 'move') => {
    const s = sessionRef.current;
    if (s.dragging) return;

    s.dragging = true;
    s.dropHandled = false;
    s.payload = payload;
    s.mode = mode; // Store mode in session ref for immediate access in drop handlers
    s.startPanels = deepClonePanels(basePanels);
    s.startContainers = deepCloneContainers(baseContainers);
    s.draftPanels = deepClonePanels(basePanels);
    s.draftContainers = deepCloneContainers(baseContainers);
    s.draftOccurrences = null; // lazy-init on first live-preview access (see handleDragMove)

    setActivePayload(payload);
    setDragMode(mode); // Also set state for UI updates
  }, [basePanels, baseContainers]);

  // Ref for mobile edge barrier elements (anti-split-screen)
  const edgeBarriersRef = useRef(null);

  const removeEdgeBarriers = useCallback(() => {
    if (edgeBarriersRef.current) {
      edgeBarriersRef.current.forEach(el => el.remove());
      edgeBarriersRef.current = null;
    }
  }, []);

  const spawnEdgeBarriers = useCallback(() => {
    removeEdgeBarriers();
    const EDGE = 40; // px thickness — covers Android's gesture zone
    const edges = [
      { top: '0', left: '0', width: `${EDGE}px`, height: '100vh' },       // left
      { top: '0', right: '0', width: `${EDGE}px`, height: '100vh' },      // right
      { top: '0', left: '0', width: '100vw', height: `${EDGE}px` },       // top
      { bottom: '0', left: '0', width: '100vw', height: `${EDGE}px` },    // bottom
    ];
    const els = edges.map(pos => {
      const el = document.createElement('div');
      el.className = 'drag-edge-barrier';
      Object.assign(el.style, {
        position: 'fixed',
        zIndex: '2147483647', // max 32-bit int — above everything
        pointerEvents: 'auto',
        background: 'transparent',
        ...pos,
      });
      // Consume ALL events that could leak to the OS
      const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
      el.addEventListener('dragover', stop, { passive: false });
      el.addEventListener('dragenter', stop, { passive: false });
      el.addEventListener('dragleave', stop, { passive: false });
      el.addEventListener('drop', stop, { passive: false });
      el.addEventListener('touchstart', stop, { capture: true, passive: false });
      el.addEventListener('touchmove', stop, { capture: true, passive: false });
      el.addEventListener('touchend', stop, { capture: true, passive: false });
      el.addEventListener('pointerdown', stop, { capture: true, passive: false });
      el.addEventListener('pointermove', stop, { capture: true, passive: false });
      el.addEventListener('pointerup', stop, { capture: true, passive: false });
      document.body.appendChild(el);
      return el;
    });
    edgeBarriersRef.current = els;
  }, [removeEdgeBarriers]);

  const clearSession = useCallback(() => {
    // Release the interaction flag so op-run-log persistence drain can
    // resume. See handleDragStart for the pairing.
    if (typeof window !== "undefined") window.__moduli_interacting = false;

    // Restore touch-action + overscroll-behavior on document (set during drag start on mobile)
    document.documentElement.style.touchAction = '';
    document.documentElement.style.overscrollBehavior = '';
    removeEdgeBarriers();

    const s = sessionRef.current;
    s.dragging = false;
    s.payload = null;
    s.mode = 'move'; // Reset mode to default
    s.startPanels = null;
    s.startContainers = null;
    s.draftPanels = null;
    s.draftContainers = null;
    s.draftOccurrences = null;

    setActivePayload(null);
    setPanelOverCellId(null);
    lastHotRef.current = { panelId: null, containerId: null, instanceId: null };
    lastPreviewRef.current = { containerId: null, instanceId: null, panelId: null };
    setDropHighlight(null);
    hideDropIndicators();
    dropBoxElRef.current = null;

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    stopAutoscroll();

    // Clear mobile drag-to-edge timer + indicator
    if (dragEdgeTimerRef.current) {
      clearTimeout(dragEdgeTimerRef.current);
      dragEdgeTimerRef.current = null;
    }
    if (dragEdgeIndicatorRef.current) {
      dragEdgeIndicatorRef.current.remove();
      dragEdgeIndicatorRef.current = null;
    }

    onTick?.();
  }, [onTick, removeEdgeBarriers]);

  // ============================================================
  // PREVIEW MUTATIONS
  // ============================================================
  // Preview mutations work on draftOccurrences — occurrence.occurrences is the sole source of ordering.
  const previewMoveInstance = useCallback(({ occurrenceId, toContainerOccId, toIndex }) => {
    const s = sessionRef.current;
    if (!s.draftOccurrences || !occurrenceId) return;

    // Remove from all container occurrences
    for (const occ of Object.values(s.draftOccurrences)) {
      if (Array.isArray(occ.occurrences) && occ.occurrences.includes(occurrenceId)) {
        occ.occurrences = occ.occurrences.filter((id) => id !== occurrenceId);
      }
    }

    // Add to target container occurrence
    const toContainerOcc = s.draftOccurrences[toContainerOccId];
    if (!toContainerOcc) return;

    const list = toContainerOcc.occurrences || [];
    if (toIndex != null && toIndex >= 0) {
      list.splice(toIndex, 0, occurrenceId);
    } else {
      list.push(occurrenceId);
    }
    toContainerOcc.occurrences = list;
  }, []);

  const previewMoveContainer = useCallback(({ occurrenceId, toPanelOccId, toIndex }) => {
    const s = sessionRef.current;
    if (!s.draftOccurrences || !occurrenceId) return;

    // Remove from all panel occurrences
    for (const occ of Object.values(s.draftOccurrences)) {
      if (Array.isArray(occ.occurrences) && occ.occurrences.includes(occurrenceId)) {
        occ.occurrences = occ.occurrences.filter((id) => id !== occurrenceId);
      }
    }

    // Add to target panel occurrence
    const toPanelOcc = s.draftOccurrences[toPanelOccId];
    if (!toPanelOcc) return;

    const list = toPanelOcc.occurrences || [];
    if (toIndex != null && toIndex >= 0) {
      list.splice(toIndex, 0, occurrenceId);
    } else {
      list.push(occurrenceId);
    }
    toPanelOcc.occurrences = list;
  }, []);

  // ============================================================
  // DRAG HANDLERS
  // ============================================================
  // Cycle drag mode: move → copy → copylink → move
  const toggleDragMode = useCallback(() => {
    setDragMode(prev => prev === 'move' ? 'copy' : prev === 'copy' ? 'copylink' : 'move');
  }, []);

  const handleDragStart = useCallback((payload, clientX, clientY, options = {}) => {
    pointerRef.current = { x: clientX, y: clientY };

    // Signal to background tasks (op-run-log persistence) that the user
    // is actively interacting. The idle-callback drain in operationExecutor
    // checks this and skips when set, so a multi-MB JSON.stringify can't
    // hiccup mid-drag. Cleared in clearSession on drop / drag-end.
    if (typeof window !== "undefined") window.__moduli_interacting = true;

    // Prevent Android split-screen gesture from intercepting drags on touch.
    if (dragConfigRef.current.isTouch) {
      document.documentElement.style.touchAction = 'none';
      document.documentElement.style.overscrollBehavior = 'none';
      spawnEdgeBarriers();
    }

    // Determine initial mode from options or default to 'move'
    // Alt/Option key = copy mode
    const initialMode = options.mode || 'move';
    if (window.__dragDiag === true) {
      console.log("[dragDiag] dragStart", { type: payload?.type, mode: initialMode, label: payload?.data?.label || payload?.id });
    }
    startSession(payload, initialMode);

    const cell = getCellFromPoint(clientX, clientY);
    if (payload.type === DragType.PANEL) {
      setPanelOverCellId(cell?.cellId || null);
    }

    onTick?.();
  }, [startSession, getCellFromPoint, onTick, spawnEdgeBarriers]);

  const handleDragMove = useCallback((clientX, clientY) => {
    const s = sessionRef.current;
    if (!s.dragging) return;

    pointerRef.current = { x: clientX, y: clientY };

    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const _frameT0 = performance.now();

      const { panelId, containerId: rawContainerId, containerOccId: rawContainerOccId, containerEl: rawContainerEl, instanceId, instanceOccId } = getHoveredIds(clientX, clientY);
      const cell = getCellFromPoint(clientX, clientY);

      // Sticky container highlight — when cursor passes over gaps/margins within
      // the same panel, keep the previous containerId to prevent flicker
      const last = lastHotRef.current;
      const stickyToLast = !rawContainerId && panelId && panelId === last.panelId;
      const containerId = stickyToLast ? last.containerId : rawContainerId;
      const containerOccId = stickyToLast ? last.containerOccId : rawContainerOccId;

      const t = s.payload?.type;
      // Leaf-ish drags (instance/module/artifact/external/file/text/url) get a
      // direct-DOM INSERTION LINE inside the hovered container instead of the
      // coarse, hopping container outline. Precise (works in the gaps between
      // cards), smooth (no class-hopping = no sputter), zero re-render. The
      // outline is suppressed so the line is the sole indicator.
      const isLeafDrag = t === DragType.INSTANCE || t === DragType.MODULE || t === DragType.ARTIFACT
        || t === DragType.EXTERNAL || t === DragType.FILE || t === DragType.TEXT || t === DragType.URL;

      if (isLeafDrag) {
        // Only box a LEAF drop container (no nested container inside it). A
        // parent like the Schedule's outer container shouldn't get the box —
        // that was the flicker as the cursor crossed timeslot gaps. When over a
        // parent, keep the last leaf box (sticky) so it never jumps to the big
        // outer border.
        let boxEl = rawContainerEl;
        if (boxEl && boxEl.querySelector("[data-container-id]")) {
          const lastEl = dropBoxElRef.current;
          boxEl = (lastEl && lastEl.isConnected && boxEl.contains(lastEl)) ? lastEl : null;
        }
        if (boxEl) { showDropIndicators(boxEl, clientX, clientY); dropBoxElRef.current = boxEl; }
        else { hideDropIndicators(); dropBoxElRef.current = null; }
        setDropHighlight(null); // idempotent — clears any leftover outline
      } else if (t === DragType.PAGE) {
        hideDropIndicators();
        if (last.panelId !== panelId) setDropHighlight(panelId || null, "data-panel-id");
      } else {
        // container / panel drags — edge indicators come from useDragDrop's
        // closestEdge; no outline or line here.
        hideDropIndicators();
      }
      if (last.panelId !== panelId || last.containerId !== containerId || last.instanceId !== instanceId) {
        if (window.__dragDiag === true) {
          console.log("[dragDiag] hover", {
            type: t, panelId, rawContainerId, stickyToLast,
            containerId, instanceId,
          });
        }
        lastHotRef.current = { panelId, containerId, containerOccId, instanceId, instanceOccId };
      }

      if (s.payload?.type === DragType.PANEL) {
        setPanelOverCellId(cell?.cellId || null);
      }

      // Auto-scroll the cursor's nearest scrollable ancestor when dragging
      // anything but a panel. Walks up from the element under the cursor to
      // find an element with overflow-y auto/scroll AND overflowing content.
      // Drives a continuous rAF loop (autoscrollStateRef + tickAutoscroll)
      // so the scroll keeps progressing even if the finger stops moving —
      // mobile drag has no equivalent of mousemove-while-still.
      const isDraggingPanel = s.payload?.type === DragType.PANEL;
      let nextScrollEl = null, nextScrollDir = 0;
      if (!isDraggingPanel) {
        // The scrollable ancestor under the finger almost never changes during a
        // drag, but elementsFromPoint + getComputedStyle-per-element forces a
        // style recalc every frame. Re-scan only every AUTOSCROLL_SCAN_MS; between
        // scans reuse the cached element (its rect read below is cheap).
        const AUTOSCROLL_SCAN_MS = 150;
        const nowTs = performance.now();
        const scan = autoscrollScanRef.current;
        if (nowTs - scan.at > AUTOSCROLL_SCAN_MS || !scan.el || !scan.el.isConnected) {
          let found = null;
          const stack = document.elementsFromPoint(clientX, clientY);
          for (const el of stack) {
            if (!el || el === document.body || el === document.documentElement) continue;
            const cs = getComputedStyle(el);
            const oy = cs.overflowY;
            if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) {
              found = el;
              break;
            }
          }
          autoscrollScanRef.current = { el: found, at: nowTs };
          nextScrollEl = found;
        } else {
          nextScrollEl = scan.el;
        }
        if (nextScrollEl) {
          const rect = nextScrollEl.getBoundingClientRect();
          const scrollZone = 80;
          if (clientY < rect.top + scrollZone) nextScrollDir = -1;
          else if (clientY > rect.bottom - scrollZone) nextScrollDir = 1;
        }
      }
      const cur = autoscrollStateRef.current;
      if (cur.el !== nextScrollEl || cur.dir !== nextScrollDir) {
        autoscrollStateRef.current = { el: nextScrollEl, dir: nextScrollDir };
        if (nextScrollDir === 0 || !nextScrollEl) {
          if (autoscrollRafRef.current) cancelAnimationFrame(autoscrollRafRef.current);
          autoscrollRafRef.current = 0;
        } else if (!autoscrollRafRef.current) {
          autoscrollRafRef.current = requestAnimationFrame(tickAutoscroll);
        }
      }

      // Mobile drag-to-edge cell navigation (B3: reads from dragConfigRef).
      // EDGE_DWELL_MS is the hold-at-edge time before the active grid cell
      // advances. Long enough to feel deliberate (not triggered by accidental
      // edge-grazes during a normal drop) but short enough to feel responsive.
      const dc = dragConfigRef.current;
      if (dc.isMobileLayout && dc.activeCell && dc.setActiveCell) {
        const edgeZone = 60;
        const EDGE_DWELL_MS = 900;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let dir = null;
        if (clientX < edgeZone && dc.activeCell.col > 0) dir = { dCol: -1, dRow: 0, edge: "left" };
        else if (clientX > vw - edgeZone && dc.activeCell.col < dc.cols - 1) dir = { dCol: 1, dRow: 0, edge: "right" };
        else if (clientY < edgeZone + 30 && dc.activeCell.row > 0) dir = { dCol: 0, dRow: -1, edge: "up" };
        else if (clientY > vh - edgeZone && dc.activeCell.row < dc.rows - 1) dir = { dCol: 0, dRow: 1, edge: "down" };

        if (dir && !dragEdgeTimerRef.current) {
          // Show edge glow indicator
          if (!dragEdgeIndicatorRef.current) {
            const el = document.createElement("div");
            el.className = `mobile-edge-indicator mobile-edge-${dir.edge}`;
            document.body.appendChild(el);
            dragEdgeIndicatorRef.current = el;
          }
          dragEdgeTimerRef.current = setTimeout(() => {
            dc.setActiveCell(prev => ({
              row: clamp(prev.row + dir.dRow, 0, dc.rows - 1),
              col: clamp(prev.col + dir.dCol, 0, dc.cols - 1),
            }));
            dragEdgeTimerRef.current = null;
            if (dragEdgeIndicatorRef.current) {
              dragEdgeIndicatorRef.current.remove();
              dragEdgeIndicatorRef.current = null;
            }
          }, EDGE_DWELL_MS);
        } else if (!dir) {
          if (dragEdgeTimerRef.current) {
            clearTimeout(dragEdgeTimerRef.current);
            dragEdgeTimerRef.current = null;
          }
          if (dragEdgeIndicatorRef.current) {
            dragEdgeIndicatorRef.current.remove();
            dragEdgeIndicatorRef.current = null;
          }
        }
      }

      // Lazy-init draftOccurrences on first live-preview access — avoids an
      // O(N) clone of all occurrences at drag-start (which caused the drag-start pause).
      if (!s.draftOccurrences &&
          (s.payload?.type === DragType.INSTANCE || s.payload?.type === DragType.CONTAINER)) {
        s.draftOccurrences = cloneOccurrencesForDraft(occurrencesById);
      }

      // Live preview for instance sorting (B2: skip if same target)
      // Ordering is in draftOccurrences (occurrence.occurrences), not draftContainers.
      if (s.payload?.type === DragType.INSTANCE && containerId &&
          (lastPreviewRef.current.containerId !== containerId || lastPreviewRef.current.instanceId !== instanceId)) {
        lastPreviewRef.current = { containerId, instanceId, panelId };
        const toC = s.draftContainers?.find((c) => c.id === containerId);
        const fromC = s.startContainers?.find((c) => c.id === s.payload.context?.containerId);
        let toIndex = null;

        // Resolve container occurrences. Schedule slots have one occurrence per
        // day sharing the same module id, so prefer the per-occurrence ids
        // exposed via DOM attributes / payload context. Falling back to a
        // moduleId-based find() picks the first day's slot — which is rarely
        // the visible one.
        const fromCOccId = s.payload.context?.containerOccurrenceId
          || s.payload.context?.containerOccId
          || s.payload.context?.parentOccurrenceId
          || null;
        const fromCOcc = (fromCOccId && s.draftOccurrences?.[fromCOccId])
          || (fromC ? Object.values(s.draftOccurrences || {}).find(o => o.moduleId === fromC.id) : null);
        const toCOcc = (containerOccId && s.draftOccurrences?.[containerOccId])
          || (toC ? Object.values(s.draftOccurrences || {}).find(o => o.moduleId === toC.id) : null);

        // Source occurrence ID — prefer payload context (set by ModuleInstance) so
        // we don't have to walk fromCOcc.occurrences[] looking for a target match.
        const draggedOccId = s.payload.context?.occurrenceId
          || (fromCOcc ? LayoutHelpers.findOccurrenceIdByTarget(
            s.payload.id,
            fromCOcc.occurrences || [],
            occurrencesById
          ) : null);

        if (toCOcc && instanceId && instanceId !== s.payload.id && draggedOccId) {
          // Find the index of hovered instance in target container occurrence
          const hoveredIndex = LayoutHelpers.getTargetIndexInOccurrences(
            instanceId,
            toCOcc.occurrences || [],
            occurrencesById
          );

          if (hoveredIndex !== -1) {
            // Calculate edge from cursor position. Prefer the per-occurrence
            // attribute so we hit the SPECIFIC DOM node under the cursor —
            // querying by data-instance-id alone returns the first match,
            // which can be far offscreen when the same instance module
            // appears in multiple slots.
            const instanceEl = (instanceOccId && document.querySelector(`[data-occurrence-id="${instanceOccId}"]`))
              || document.querySelector(`[data-instance-id="${instanceId}"]`);
            if (instanceEl) {
              const rect = instanceEl.getBoundingClientRect();
              const { x, y } = pointerRef.current;

              // Determine container orientation
              const isHorizontal = toC?.layout?.orientation === 'horizontal';

              // Calculate which side of the element we're on
              if (isHorizontal) {
                const midX = rect.left + rect.width / 2;
                const isLeft = x < midX;
                toIndex = isLeft ? hoveredIndex : hoveredIndex + 1;
              } else {
                const midY = rect.top + rect.height / 2;
                const isTop = y < midY;
                toIndex = isTop ? hoveredIndex : hoveredIndex + 1;
              }

              // Adjust if moving within same container
              if (fromCOcc && fromCOcc.id === toCOcc.id) {
                const fromIndex = LayoutHelpers.getTargetIndexInOccurrences(
                  s.payload.id,
                  fromCOcc.occurrences || [],
                  occurrencesById
                );
                if (fromIndex !== -1 && fromIndex < hoveredIndex) {
                  toIndex = Math.max(0, toIndex - 1);
                }
              }
            }
          }
        }

        if (draggedOccId && toCOcc) {
          previewMoveInstance({ occurrenceId: draggedOccId, toContainerOccId: toCOcc.id, toIndex });
        }
      }

      // Live preview for container sorting (B2: skip if same target)
      // Ordering is in draftOccurrences (occurrence.occurrences), not draftPanels.
      if (s.payload?.type === DragType.CONTAINER && panelId &&
          (lastPreviewRef.current.panelId !== panelId || lastPreviewRef.current.containerId !== containerId)) {
        lastPreviewRef.current = { containerId, instanceId, panelId };
        const toPanel = s.draftPanels?.find((p) => p.id === panelId);
        const fromPanel = s.startPanels?.find((p) => p.id === s.payload.context?.panelId);
        const hoveredContainerId = containerId; // Already resolved by getHoveredIds above
        let toIndex = null;

        // Find panel occurrences via draftOccurrences (panel occ = occ with moduleId === panel.id)
        const fromPanelOcc = fromPanel?._occurrence ? (s.draftOccurrences?.[fromPanel._occurrence.id] || null) : null;
        const toPanelOcc = toPanel?._occurrence ? (s.draftOccurrences?.[toPanel._occurrence.id] || null) : null;

        // Find the occurrence ID for the dragged container within the from panel occurrence
        const draggedOccId = fromPanelOcc ? LayoutHelpers.findOccurrenceIdByTarget(
          s.payload.id,
          fromPanelOcc.occurrences || [],
          occurrencesById
        ) : null;

        if (toPanelOcc && hoveredContainerId && hoveredContainerId !== s.payload.id && draggedOccId) {
          // Find the index of hovered container in target panel occurrence
          const hoveredIndex = LayoutHelpers.getTargetIndexInOccurrences(
            hoveredContainerId,
            toPanelOcc.occurrences || [],
            occurrencesById
          );

          if (hoveredIndex !== -1) {
            // Calculate edge from cursor position - use 4-directional detection
            const containerEl = document.querySelector(`[data-container-id="${hoveredContainerId}"]`);
            if (containerEl) {
              const rect = containerEl.getBoundingClientRect();
              const { x, y } = pointerRef.current;

              // Calculate distances to all four edges
              const distanceToTop = Math.abs(y - rect.top);
              const distanceToBottom = Math.abs(y - rect.bottom);
              const distanceToLeft = Math.abs(x - rect.left);
              const distanceToRight = Math.abs(x - rect.right);

              // Find closest edge
              const minDistance = Math.min(distanceToTop, distanceToBottom, distanceToLeft, distanceToRight);
              let closestEdge;
              if (minDistance === distanceToTop) closestEdge = 'top';
              else if (minDistance === distanceToBottom) closestEdge = 'bottom';
              else if (minDistance === distanceToLeft) closestEdge = 'left';
              else closestEdge = 'right';

              // All edges use sequential insertion - layout determines visual arrangement
              if (closestEdge === 'top' || closestEdge === 'left') {
                toIndex = hoveredIndex;  // Insert before
              } else {
                toIndex = hoveredIndex + 1;  // Insert after
              }

              // Adjust if moving within same panel
              if (fromPanelOcc && fromPanelOcc.id === toPanelOcc.id) {
                const fromIndex = LayoutHelpers.getTargetIndexInOccurrences(
                  s.payload.id,
                  fromPanelOcc.occurrences || [],
                  occurrencesById
                );
                if (fromIndex !== -1 && fromIndex < hoveredIndex) {
                  toIndex = Math.max(0, toIndex - 1);
                }
              }
            }
          }
        }

        if (draggedOccId && toPanelOcc) {
          previewMoveContainer({ occurrenceId: draggedOccId, toPanelOccId: toPanelOcc.id, toIndex });
        }
      }

      onTick?.();
      dragPerf.frame(performance.now() - _frameT0);
    });
  }, [getCellFromPoint, getHoveredIds, previewMoveInstance, previewMoveContainer, occurrencesById, onTick]);

  const handleDragOver = useCallback((target) => {
    // Called by useDroppable/useDragDrop on dragover. Pragmatic DnD fires
    // onDrag on EVERY nested drop target, not just the innermost — so when
    // a slot's container-list is inside a page's page-content drop zone,
    // both fire and the outer one (no containerId) would clobber the inner
    // one's highlight, causing rapid flicker. Sticky behaviour: when the
    // new context has no containerId but the panel matches, keep the
    // previous containerId.
    const s = sessionRef.current;
    if (!s.dragging) return;

    const newPanelId = target.context?.panelId ?? null;
    const rawContainerId = target.context?.containerId ?? null;
    const newInstanceId = target.context?.instanceId ?? null;

    const last = lastHotRef.current;
    const stickyToLast = !rawContainerId && newPanelId && newPanelId === last.panelId && last.containerId;
    const newContainerId = stickyToLast ? last.containerId : rawContainerId;

    if (last.panelId === newPanelId && last.containerId === newContainerId && last.instanceId === newInstanceId) {
      return;
    }

    lastHotRef.current = { panelId: newPanelId, containerId: newContainerId, instanceId: newInstanceId };
    const t = s.payload?.type;
    if (t === DragType.PAGE) {
      setDropHighlight(newPanelId || null, "data-panel-id");
    }
    // Leaf/container drags: do NOT set the data-drop-active outline here. This
    // path is driven by useDroppable LIST targets — including the OUTER
    // container's list (active during instance drags) — so it highlighted the
    // outer shell and fought handleDragMove. Leaf-drag feedback is now owned
    // entirely by handleDragMove's direct-DOM drop-area box + insertion line.
  }, []);

  // ============================================================
  // DROP HANDLER - COMMITS CHANGES
  // ============================================================
  const handleDrop = useCallback((dropTarget) => {
    // STOPWATCH — instrument the drop pipeline so we can see where time goes
    // between "user releases mouse" and "browser paints the result".
    const _dropT0 = performance.now();
    const _lap = (label) => console.log(`[drop] +${Math.round(performance.now() - _dropT0)}ms ${label}`);
    const _renders0 = snapshotRenders();
    _lap("handleDrop entry");
    const s = sessionRef.current;
    if (s.dropHandled) return;
    const payload = s?.payload || dropTarget?.source;
    if (!s.dragging && !payload) return;

    if (dropTarget.clientX !== undefined && dropTarget.clientY !== undefined) {
      pointerRef.current = { x: dropTarget.clientX, y: dropTarget.clientY };
    }
    const { x, y } = pointerRef.current;
    // The doc Editor's OWN Pragmatic drop target owns every drop that lands inside a
    // `.doc-editor` (re-morph a wrap, reorder/insert an embed, form a wrap-beside column).
    // DragProvider's monitor fires for the SAME drop — if it ALSO routes it as an
    // occurrence move, the two fight: the embed gets re-parented + ops re-fire, which
    // reads as "the page resets / the block doesn't move." The narrow doc-CONTAINER guard
    // below missed a `role:"textblock"` wrap host, so broaden it: bail whenever the drop
    // point is over a doc editor and let the Editor handle it.
    if (document.elementFromPoint(x, y)?.closest?.(".doc-editor")) {
      s.dropHandled = true; clearSession(); return;
    }
    const dt = { ...dropTarget, clientX: x, clientY: y };
    const hovered = getHoveredIds(x, y);
    // Pages register `useDroppable({ type: "page-content", context: {pageOccurrenceId} })`
    // and don't put `occurrenceId` in context — so empty-page or above/below
    // drops would otherwise resolve to no target. Forward the page's id and
    // also compute insertAt directly (0 if cursor in top half of the page,
    // page.occurrences.length if bottom half). This bypasses the parent-
    // relative edge math in buildDropContext, which would otherwise treat
    // the target as a position next to the page within its panel — wrong
    // for "drop INTO the page" semantics.
    if (!dt.context?.occurrenceId && dt.context?.pageOccurrenceId) {
      const pageOccId = dt.context.pageOccurrenceId;
      const pageEl = document.querySelector(`[data-page-occ-id="${pageOccId}"]`);
      const pageRect = pageEl?.getBoundingClientRect?.();
      const pageOcc = occurrencesById[pageOccId];
      const childCount = (pageOcc?.occurrences || []).length;
      const insertAt = pageRect && y < pageRect.top + pageRect.height / 2 ? 0 : childCount;
      dt.context = { ...dt.context, occurrenceId: pageOccId, insertAt };
    }
    // Stash the actual drop target's rect on context so handlers don't have
    // to guess via querySelector (used by canvas drop to compute meta.x/y).
    if (dt.targetRect && !dt.context?.targetRect) {
      dt.context = { ...dt.context, targetRect: dt.targetRect };
    }

    const rawEvent = buildRawDropEvent({
      dropTarget: dt,
      payload,
      sessionMode: s?.mode,
      hovered,
      getCellFromPoint,
    });
    if (!rawEvent) return;
    _lap("rawEvent built");

    const hoveredOccId = rawEvent.hover.dropTargetData?.occurrenceId;
    if (hoveredOccId) {
      const occ = occurrencesById[hoveredOccId];
      const mod = occ ? modulesById[occ.moduleId] : null;
      if (mod?.kind === "doc" && mod.role === "container") {
        s.dropHandled = true; clearSession(); return;
      }
    }

    const dropContext = buildDropContext(rawEvent, { occurrencesById, modulesById });
    if (!dropContext) return;
    _lap(`dropContext built (target=${dropContext?.target?.kind || "?"} mode=${s?.mode || "?"})`);

    s.dropHandled = true;
    // Defer all operation fires until after rAF — lets the browser paint the
    // committed drop position before any op work runs (eliminates post-drop freeze).
    operationsBridge.beginDropBatch?.();
    routeDrop(dropContext, {
      dispatch, socket,
      state: { ...state, modulesById },
      occurrencesById, baseAllPanels, baseContainers,
      clearSession, sessionRef, getCellFromPoint,
    });
    operationsBridge.endDropBatch?.();
    _lap("routeDrop returned (sync mutations + op fires done)");
    clearSession();
    _lap("clearSession done — handleDrop synchronous end");
    // The browser can't paint until this synchronous task finishes. React then
    // commits the dispatched state and the browser lays out + paints. Measure
    // that tail separately: rAF fires just before the next paint; a follow-up
    // setTimeout(0) fires after that frame has been committed. The gap between
    // "handleDrop synchronous end" and "first frame after commit" is render +
    // paint cost — i.e. time that is NOT operations.
    requestAnimationFrame(() => {
      _lap("rAF #1 (pre-paint of next frame)");
      requestAnimationFrame(() => {
        _lap("rAF #2 (next frame painted)");
        const d = diffRenders(_renders0);
        console.log(`[drop-renders] panel=${d.panel} container=${d.container} instance=${d.instance} page=${d.page} field=${d.field || 0}`);
      });
    });
  }, [dispatch, socket, getCellFromPoint, getHoveredIds, baseAllPanels, baseContainers, occurrencesById, modulesById, clearSession, state]);

  const handleDragEnd = useCallback(() => {
    clearSession();
  }, [clearSession]);

  // ============================================================
  // EXTERNAL DRAG DETECTION - Removed (handled by Pragmatic)
  // ============================================================
  // Native grid listeners removed - Pragmatic Drag and Drop handles all events
  // External drags (files/text/URLs) are now handled through Pragmatic's
  // dropTargetForElements with dataTransfer passed through nativeEvent

  // ============================================================
  // AUTO SCROLL SETUP (Pragmatic Drag and Drop)
  // ============================================================
  useEffect(() => {
    const cleanup = setupAutoScroll();
    return cleanup;
  }, []);

  // ============================================================
  // PREVENT ANDROID SPLIT-SCREEN / POPUP WINDOW ON DRAG-TO-EDGE
  // Multiple layers of defense:
  // 1. dragover/dragenter preventDefault → signals browser this is a web drop
  // 2. touchmove preventDefault → blocks OS gesture recognition during drags
  // 3. touch-action: none on documentElement (set in handleDragStart)
  // 4. Fullscreen mode on handle pointerdown → disables OS edge gesture zones
  // ============================================================
  useEffect(() => {
    if (!isTouch) return;
    const preventDrag = (e) => {
      if (sessionRef.current.dragging) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      }
    };
    const preventTouch = (e) => {
      if (sessionRef.current.dragging) {
        e.preventDefault();
      }
    };
    // Capture-phase touchstart prevention near edges during active drag
    const preventEdgeTouch = (e) => {
      if (!sessionRef.current.dragging) return;
      const t = e.touches?.[0];
      if (!t) return;
      const edge = 40;
      const vw = window.innerWidth, vh = window.innerHeight;
      if (t.clientX < edge || t.clientX > vw - edge ||
          t.clientY < edge || t.clientY > vh - edge) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('dragover', preventDrag, { passive: false });
    document.addEventListener('dragenter', preventDrag, { passive: false });
    document.addEventListener('touchmove', preventTouch, { passive: false });
    document.addEventListener('touchstart', preventEdgeTouch, { capture: true, passive: false });
    return () => {
      document.removeEventListener('dragover', preventDrag);
      document.removeEventListener('dragenter', preventDrag);
      document.removeEventListener('touchmove', preventTouch);
      document.removeEventListener('touchstart', preventEdgeTouch, { capture: true });
    };
  }, [isTouch]);

  // Recovery: if Android triggers split-screen despite prevention, cancel the drag
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden && sessionRef.current.dragging) {
        clearSession();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [clearSession]);

  // Native file drop fallback — catches OS file drops + native HTML /
  // plain-text drops that Pragmatic DnD might miss. The HTML branch
  // is what enables the drag-to-import flow (docket #6.5): the user
  // selects content in another browser tab + drags it onto the grid;
  // we route to handleExternalDrop which fans the content through the
  // server-side importer.
  useEffect(() => {
    const gridFrame = document.querySelector(".grid-frame");
    if (!gridFrame) return;
    const onDragOver = (e) => {
      // Skip when an internal Pragmatic DnD session is active. Two
      // checks because dataTransfer.types may not yet include
      // NATIVE_DND_MIME on the FIRST few dragover events (Pragmatic
      // DnD writes external dataTransfer lazily via
      // `getInitialDataForExternal`, which fires only when the drag
      // crosses the app boundary). Session ref is the authoritative
      // "internal drag in progress" signal — checking both is
      // defense-in-depth.
      if (sessionRef.current?.dragging) return;
      const types = e.dataTransfer?.types || [];
      if (types.includes(NATIVE_DND_MIME)) return;
      // Files OR rich text from another tab OR a plain-text selection.
      const isFile = types.includes("Files");
      const isHtml = !isFile && types.includes("text/html");
      const isText = !isFile && !isHtml && types.includes("text/plain");
      if (!isFile && !isHtml && !isText) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      // Update the preview pill (only re-render when position/format/
      // destination actually changes — onDragOver fires every few ms).
      const format = isFile ? "file" : isHtml ? "html" : "text";
      // Resolve the hovered destination so the pill can read out
      // "into <container/page label>" or "new panel in this cell".
      // Pure DOM peek — no side effects (the actual mint happens at
      // drop-time inside handleExternalDrop.resolveImportParent).
      const x = e.clientX, y = e.clientY;
      const { containerId: hoveredContainerId } = getHoveredIds(x, y);
      let destination = null;
      if (hoveredContainerId) {
        const c = baseContainers.find(c => c.id === hoveredContainerId);
        if (c) destination = { kind: "container", label: c.label || "container" };
      }
      if (!destination) {
        const el = document.elementFromPoint?.(x, y);
        const pageNode = el?.closest?.("[data-page-occ-id]");
        const pageOccId = pageNode?.getAttribute?.("data-page-occ-id");
        if (pageOccId && occurrencesById[pageOccId]) {
          const pageOcc = occurrencesById[pageOccId];
          const pageMod = state?.modulesById?.[pageOcc.moduleId];
          destination = { kind: "page", label: pageMod?.label || "page" };
        }
      }
      if (!destination && getCellFromPoint?.(x, y)) {
        destination = { kind: "cell", label: "new panel" };
      }
      setExternalImportPreview(prev => {
        if (prev
          && prev.x === x && prev.y === y
          && prev.format === format
          && prev.destination?.kind === destination?.kind
          && prev.destination?.label === destination?.label) return prev;
        return { x, y, format, destination };
      });
    };
    const clearPreview = () => setExternalImportPreview(null);
    const onDragLeaveFrame = (e) => {
      // dragleave fires when entering child elements — only clear when
      // we've left the window (relatedTarget=null in Chrome/Firefox).
      if (e.relatedTarget == null) clearPreview();
    };
    const onDrop = (e) => {
      const dt = e.dataTransfer;
      if (!dt) return;

      const hasFiles = dt.files?.length > 0;
      let html = "";
      let text = "";
      try { html = dt.getData("text/html") || ""; } catch { /* ignore */ }
      try { text = dt.getData("text/plain") || ""; } catch { /* ignore */ }
      if (!hasFiles && !html && !text) return;
      e.preventDefault();

      const x = e.clientX, y = e.clientY;
      const { containerId } = getHoveredIds(x, y);
      const cellFromPoint = getCellFromPoint?.(x, y) || null;
      // Walk from the hit element up to the nearest [data-page-occ-id]
      // so a drop on a page (no container hit) can be resolved by
      // handleExternalDrop's resolveImportParent.
      const pageOccId = (() => {
        const el = document.elementFromPoint?.(x, y);
        const node = el?.closest?.("[data-page-occ-id]");
        return node?.getAttribute?.("data-page-occ-id") || null;
      })();

      // Build a `target` shape that dropView() can read: when a
      // container is hovered we expose it via `moduleId` so dropView's
      // role lookup classifies it as container. The native-drop path
      // doesn't get Pragmatic DnD's edge/insertIndex so position is
      // empty — handleExternalDrop falls back to y-based nearest-index
      // resolution. `raw` carries the page/grid-cell hints that
      // handleExternalDrop.resolveImportParent reads via dropTarget.context.
      const target = {
        occurrenceId: null,
        moduleId: containerId || null,
        kind: !containerId && !pageOccId && cellFromPoint ? DROP_TARGET_KIND.GRID_CELL : null,
        raw: {
          ...(pageOccId ? { pageOccurrenceId: pageOccId } : {}),
          ...(cellFromPoint ? { row: cellFromPoint.row, col: cellFromPoint.col, cellId: cellFromPoint.cellId } : {}),
        },
      };

      // File drop → routeDrop dispatches to handleFileDrop via sourceKind.
      // Text/HTML drop → sourceKind:"external" routes to handleExternalDrop,
      // which detects whether the content warrants the import pipeline.
      const payload = hasFiles
        ? {
            type: DragType.FILE,
            sourceKind: "file",
            payloadType: DragType.FILE,
            id: "__file__",
            data: { files: Array.from(dt.files), name: dt.files[0]?.name },
          }
        : {
            type: html ? DragType.EXTERNAL : DragType.TEXT,
            sourceKind: "external",
            payloadType: html ? DragType.EXTERNAL : DragType.TEXT,
            data: { text },
          };

      const dropContext = {
        payload,
        target,
        position: { edge: null, insertIndex: null },
        pointer: { x, y },
        dataTransfer: dt,
      };
      const ctx = { dispatch, socket, state, occurrencesById, baseAllPanels, baseContainers, clearSession, sessionRef, getCellFromPoint, getHoveredPanelId, getHoveredContainerId, getHoveredInstanceId };
      routeDrop(dropContext, ctx);
      clearPreview();
    };
    gridFrame.addEventListener("dragover", onDragOver);
    gridFrame.addEventListener("drop", onDrop);
    gridFrame.addEventListener("dragleave", onDragLeaveFrame);
    // Window-level dragend catches "drag canceled" (user released over
    // a no-drop target, hit Escape, etc) so the pill doesn't linger.
    document.addEventListener("dragend", clearPreview);
    return () => {
      gridFrame.removeEventListener("dragover", onDragOver);
      gridFrame.removeEventListener("drop", onDrop);
      gridFrame.removeEventListener("dragleave", onDragLeaveFrame);
      document.removeEventListener("dragend", clearPreview);
    };
  }, [dispatch, socket, state, occurrencesById, baseAllPanels, baseContainers, clearSession, getCellFromPoint, getHoveredIds, getHoveredPanelId, getHoveredContainerId, getHoveredInstanceId]);

  // Clean up edge barriers on unmount
  useEffect(() => removeEdgeBarriers, [removeEdgeBarriers]);

  // ============================================================
  // STACK HELPERS
  // ============================================================
  const getStacksByCell = useCallback(() => {
    const panels = getWorkingPanels();
    const map = new Map();
    for (const p of panels) {
      const key = cellKeyFromPanel(p);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    }
    return map;
  }, [getWorkingPanels]);

  const getStackForPanel = useCallback((panel) => {
    if (!panel) return [];
    return getStacksByCell().get(cellKeyFromPanel(panel)) || [];
  }, [getStacksByCell]);

  const setActivePanelInCell = useCallback((row, col, nextPanelId) => {
    const panels = getWorkingPanels();
    const key = `cell-${row}-${col}`;
    const stack = panels.filter((p) => cellKeyFromPanel(p) === key);
    if (stack.length <= 1) return;

    stack.forEach((p) => {
      LayoutHelpers.setPanelStackDisplay({
        dispatch, socket, panel: p,
        display: p.id === nextPanelId ? "block" : "none",
        emit: true,
      });
    });
  }, [dispatch, socket, getWorkingPanels]);

  const cyclePanelStack = useCallback(({ panelId, cellKey, dir = 1 }) => {
    const panels = getWorkingPanels();

    // Resolve stack — either by panelId anchor or by cellKey (for empty-pocket button)
    let stack;
    if (panelId) {
      const anchor = panels.find((p) => p.id === panelId);
      if (!anchor) return;
      stack = getStackForPanel(anchor);
    } else if (cellKey) {
      stack = panels.filter((p) => cellKeyFromPanel(p) === cellKey);
    }
    if (!stack || stack.length === 0) return;

    // Find currently visible panel index. -1 = all hidden (empty pocket showing).
    const visibleIdx = stack.findIndex((p) => (p?.layout?.style?.display ?? "block") !== "none");
    // Total states = stack.length panels + 1 "all hidden" state (index = stack.length)
    const effectiveCurrIdx = visibleIdx === -1 ? stack.length : visibleIdx;
    const nextIdx = (effectiveCurrIdx + (dir >= 0 ? 1 : -1) + stack.length + 1) % (stack.length + 1);

    // nextIdx === stack.length means "all hidden"; otherwise show panel at nextIdx
    const updatedModules = stack.map((p, idx) => ({
      ...p,
      layout: { ...(p.layout || {}), style: { ...(p.layout?.style || {}), display: (nextIdx < stack.length && idx === nextIdx) ? "block" : "none" } },
    }));

    dispatch(batchUpdateModulesAction(updatedModules));
    for (const mod of updatedModules) {
      socket?.emit("update_module", { module: mod });
    }
  }, [dispatch, socket, getWorkingPanels, getStackForPanel]);

  // ============================================================
  // CONTEXT VALUE
  // ============================================================
  // Stable context — only changes at drag start/end, NOT during hover
  const contextValue = useMemo(() => ({
    // Handlers
    handleDragStart,
    handleDragMove,
    handleDragOver,
    handleDrop,
    handleDragEnd,
    getActiveType: () => sessionRef.current.payload?.type || null,

    // State (drag start/end only — not hover)
    activePayload,
    activeType,
    activeId,
    isDragging,

    // Copy/Move mode
    dragMode,
    setDragMode,
    toggleDragMode,
    isCopyMode: dragMode === 'copy',
    isMoveMode: dragMode === 'move',
    isCopylinkMode: dragMode === 'copylink',

    // Booleans (from activeType — drag start/end only)
    isPanelDrag: activeType === DragType.PANEL,
    isContainerDrag: activeType === DragType.CONTAINER,
    isInstanceDrag: activeType === DragType.INSTANCE,
    isExternalDrag: [DragType.EXTERNAL, DragType.FILE, DragType.TEXT, DragType.URL].includes(activeType),

    // Getters
    getWorkingPanels,
    getWorkingAllPanels,
    getWorkingContainers,

    // Stack helpers
    getStacksByCell,
    getStackForPanel,
    setActivePanelInCell,
    cyclePanelStack,

    // Hit testing
    getHoveredPanelId,
    getHoveredContainerId,
  }), [
    handleDragStart, handleDragMove, handleDragOver, handleDrop, handleDragEnd,
    activePayload, activeType, activeId, isDragging,
    dragMode, toggleDragMode,
    getWorkingPanels, getWorkingAllPanels, getWorkingContainers,
    getStacksByCell, getStackForPanel, setActivePanelInCell, cyclePanelStack,
    getHoveredPanelId, getHoveredContainerId,
  ]);

  // Hot context — changes during drag hover (container crossings)
  // Separated so container/instance components don't re-render on every crossing.
  const hotContextValue = useMemo(() => ({
    panelOverCellId,
  }), [panelOverCellId]);

  return (
    <DragContext.Provider value={contextValue}>
      <DragHotContext.Provider value={hotContextValue}>
        {children}
        {externalImportPreview && (
          <ExternalImportPreview
            x={externalImportPreview.x}
            y={externalImportPreview.y}
            format={externalImportPreview.format}
            destination={externalImportPreview.destination}
          />
        )}
      </DragHotContext.Provider>
    </DragContext.Provider>
  );
}

// Floating preview pill rendered near the cursor during a native external
// drag (HTML/text from another tab, files from the OS). Tells the user
// the drop will route through the import pipeline rather than minting a
// single instance. position:fixed + pointer-events:none so it never
// intercepts the drop event itself.
function ExternalImportPreview({ x, y, format, destination }) {
  const action = format === "file" ? "Upload file"
    : format === "html" ? "Convert HTML → modules"
    : "Convert text → modules";
  const dest = destination
    ? (destination.kind === "cell"
        ? "→ new panel in this cell"
        : `→ into ${destination.label}`)
    : null;
  return (
    <div
      style={{
        position: "fixed",
        left: x + 14,
        top: y + 14,
        zIndex: 9999,
        pointerEvents: "none",
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        fontWeight: 500,
        background: "rgba(15, 25, 40, 0.92)",
        color: "rgb(180, 225, 245)",
        border: "1px solid rgba(120, 170, 220, 0.45)",
        boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
        whiteSpace: "nowrap",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span>{action}</span>
      {dest && (
        <span style={{ opacity: 0.7, fontWeight: 400 }}>{dest}</span>
      )}
    </div>
  );
}

export default DragProvider;
