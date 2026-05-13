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
import { buildDropContext, buildRawDropEvent, DROP_TARGET_KIND } from "./dragHitTesting";

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
  isMobile,
}) {
  // ============================================================
  // STATE
  // ============================================================
  const [activePayload, setActivePayload] = useState(null);
  const [panelOverCellId, setPanelOverCellId] = useState(null);
  // Drag mode: 'move' | 'copy' | 'copylink'
  const [dragMode, setDragMode] = useState('move');

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
  const dragConfigRef = useRef({ activeCell, setActiveCell, rows, cols, isMobile });
  dragConfigRef.current = { activeCell, setActiveCell, rows, cols, isMobile };
  const rafRef = useRef(0);
  // Mobile drag-to-edge cell navigation timer
  const dragEdgeTimerRef = useRef(null);
  const dragEdgeIndicatorRef = useRef(null);
  // Continuous-autoscroll loop. Per-frame scroll while the finger sits in
  // the scroll edge zone — without this, mobile autoscroll only happens
  // while the finger is actively moving (no touchmove → no autoscroll).
  const autoscrollRafRef = useRef(0);
  const autoscrollStateRef = useRef({ el: null, dir: 0 });
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
        document.querySelector(`[${attr}="${id}"]`)
          ?.setAttribute("data-drop-active", "true");
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
    let panelId = null, containerId = null, containerOccId = null, instanceId = null, instanceOccId = null;
    for (const el of elements) {
      if (!panelId) { const v = el.getAttribute("data-panel-id"); if (v) panelId = v; }
      if (!containerId) {
        const v = el.getAttribute("data-container-id");
        if (v) {
          containerId = v;
          containerOccId = el.getAttribute("data-occ-id") || null;
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
    return { panelId, containerId, containerOccId, instanceId, instanceOccId };
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
    s.draftOccurrences = cloneOccurrencesForDraft(occurrencesById);

    setActivePayload(payload);
    setDragMode(mode); // Also set state for UI updates
  }, [basePanels, baseContainers, occurrencesById]);

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

    // Prevent Android split-screen gesture from intercepting drags on mobile.
    if (dragConfigRef.current.isMobile) {
      document.documentElement.style.touchAction = 'none';
      document.documentElement.style.overscrollBehavior = 'none';
      spawnEdgeBarriers();
    }

    // Determine initial mode from options or default to 'move'
    // Alt/Option key = copy mode
    const initialMode = options.mode || 'move';
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

      const { panelId, containerId: rawContainerId, containerOccId: rawContainerOccId, instanceId, instanceOccId } = getHoveredIds(clientX, clientY);
      const cell = getCellFromPoint(clientX, clientY);

      // Sticky container highlight — when cursor passes over gaps/margins within
      // the same panel, keep the previous containerId to prevent flicker
      const last = lastHotRef.current;
      const stickyToLast = !rawContainerId && panelId && panelId === last.panelId;
      const containerId = stickyToLast ? last.containerId : rawContainerId;
      const containerOccId = stickyToLast ? last.containerOccId : rawContainerOccId;

      // Update highlight when the relevant target changes.
      // Page drags highlight the destination PANEL (where the page tab will
      // land); leaf drags (instance/module/external/file) highlight the
      // CONTAINER they're dropping into; container/panel drags get edge
      // indicators via useDragDrop's closestEdge instead, no panel/container
      // outline.
      const t = s.payload?.type;
      if (t === DragType.PAGE) {
        if (last.panelId !== panelId) {
          setDropHighlight(panelId || null, "data-panel-id");
        }
      } else if (last.containerId !== containerId) {
        const shouldHL = t !== DragType.PANEL && t !== DragType.CONTAINER;
        setDropHighlight(shouldHL ? (containerId || null) : null);
      }
      if (last.panelId !== panelId || last.containerId !== containerId || last.instanceId !== instanceId) {
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
        const stack = document.elementsFromPoint(clientX, clientY);
        for (const el of stack) {
          if (!el || el === document.body || el === document.documentElement) continue;
          const cs = getComputedStyle(el);
          const oy = cs.overflowY;
          if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) {
            nextScrollEl = el;
            break;
          }
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
      if (dc.isMobile && dc.activeCell && dc.setActiveCell) {
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
    } else {
      const shouldHighlight = t !== DragType.PANEL && t !== DragType.CONTAINER;
      setDropHighlight(shouldHighlight ? (newContainerId || null) : null);
    }
  }, []);

  // ============================================================
  // DROP HANDLER - COMMITS CHANGES
  // ============================================================
  const handleDrop = useCallback((dropTarget) => {
    const s = sessionRef.current;
    if (s.dropHandled) return;
    const payload = s?.payload || dropTarget?.source;
    if (!s.dragging && !payload) return;

    if (dropTarget.clientX !== undefined && dropTarget.clientY !== undefined) {
      pointerRef.current = { x: dropTarget.clientX, y: dropTarget.clientY };
    }
    const { x, y } = pointerRef.current;
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

    s.dropHandled = true;
    routeDrop(dropContext, {
      dispatch, socket,
      state: { ...state, modulesById },
      occurrencesById, baseAllPanels, baseContainers,
      clearSession, sessionRef, getCellFromPoint,
    });
    clearSession();
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
    if (!isMobile) return;
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
  }, [isMobile]);

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

  // Native file drop fallback — catches OS file drops that Pragmatic DnD might miss
  useEffect(() => {
    const gridFrame = document.querySelector(".grid-frame");
    if (!gridFrame) return;
    const onDragOver = (e) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    };
    const onDrop = (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      const payload = { type: DragType.FILE, id: "__file__", data: { files, name: files[0]?.name } };
      const x = e.clientX, y = e.clientY;
      // pointerRef.current is stale for OS-native drags — use event coords directly
      const { panelId, containerId } = getHoveredIds(x, y);
      const ctx = { dispatch, socket, state, occurrencesById, baseAllPanels, baseContainers, clearSession, sessionRef, getCellFromPoint, getHoveredPanelId, getHoveredContainerId, getHoveredInstanceId };
      const drop = { payload, dropTarget: {}, panelId, containerId, instanceId: null, x, y, getCellFromPoint };
      handleFileDrop(ctx, drop);
    };
    gridFrame.addEventListener("dragover", onDragOver);
    gridFrame.addEventListener("drop", onDrop);
    return () => {
      gridFrame.removeEventListener("dragover", onDragOver);
      gridFrame.removeEventListener("drop", onDrop);
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
      </DragHotContext.Provider>
    </DragContext.Provider>
  );
}

export default DragProvider;
