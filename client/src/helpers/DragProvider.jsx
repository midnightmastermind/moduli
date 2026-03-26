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
  const lastDropRef = useRef({ payload: null, containerId: null, timestamp: 0 });
  // Mobile drag-to-edge cell navigation timer
  const dragEdgeTimerRef = useRef(null);
  const dragEdgeIndicatorRef = useRef(null);
  // Track last hot target to skip redundant DOM updates on every mouse-move
  const lastHotRef = useRef({ panelId: null, containerId: null, instanceId: null });
  // B2: Cache last preview target to skip redundant draft mutations
  const lastPreviewRef = useRef({ containerId: null, instanceId: null, panelId: null });

  // Direct DOM highlight — bypasses React state for zero-lag container outline
  const highlightedContainerRef = useRef(null);
  const highlightRAFRef = useRef(null);
  const setDropHighlight = useCallback((containerId) => {
    if (highlightedContainerRef.current === containerId) return;
    cancelAnimationFrame(highlightRAFRef.current);
    highlightRAFRef.current = requestAnimationFrame(() => {
      // Clear previous
      if (highlightedContainerRef.current) {
        document.querySelector(`[data-container-id="${highlightedContainerRef.current}"]`)
          ?.removeAttribute("data-drop-active");
      }
      // Set new
      if (containerId) {
        document.querySelector(`[data-container-id="${containerId}"]`)
          ?.setAttribute("data-drop-active", "true");
      }
      highlightedContainerRef.current = containerId;
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
  const getHoveredIds = useCallback((x, y) => {
    const elements = document.elementsFromPoint(x, y);
    let panelId = null, containerId = null, instanceId = null;
    for (const el of elements) {
      if (!panelId) { const v = el.getAttribute("data-panel-id"); if (v) panelId = v; }
      if (!containerId) { const v = el.getAttribute("data-container-id"); if (v) containerId = v; }
      if (!instanceId) { const v = el.getAttribute("data-instance-id"); if (v) instanceId = v; }
      if (panelId && containerId && instanceId) break;
    }
    return { panelId, containerId, instanceId };
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

      const { panelId, containerId, instanceId } = getHoveredIds(clientX, clientY);
      const cell = getCellFromPoint(clientX, clientY);

      // Only re-render if panel/container/instance changed (not on every pixel)
      // NOTE: setDropHighlight is intentionally NOT called here — elementsFromPoint can return null
      // when the drag clone covers the container, causing the highlight to blink. handleDragOver
      // (which uses Pragmatic DnD's accurate drop target tracking) handles highlighting instead.
      const last = lastHotRef.current;
      if (last.panelId !== panelId || last.containerId !== containerId || last.instanceId !== instanceId) {
        lastHotRef.current = { panelId, containerId, instanceId };
      }

      if (s.payload?.type === DragType.PANEL) {
        setPanelOverCellId(cell?.cellId || null);
      }

      // Auto-scroll panel content when dragging instances/containers/external (not panels)
      const isDraggingPanel = s.payload?.type === DragType.PANEL;
      if (panelId && !isDraggingPanel) {
        const panelElement = document.querySelector(`[data-panel-id="${panelId}"]`);
        if (panelElement) {
          const panelRect = panelElement.getBoundingClientRect();
          const panelContent = panelElement.querySelector('.panel-content');

          if (panelContent && panelContent.scrollHeight > panelContent.clientHeight) {
            const scrollZone = 80; // Pixels from top/bottom to trigger scroll
            const scrollSpeed = 10; // Pixels per frame

            // Check if cursor is in top zone (including header)
            if (clientY < panelRect.top + scrollZone) {
              panelContent.scrollTop = Math.max(0, panelContent.scrollTop - scrollSpeed);
            }
            // Check if cursor is in bottom zone
            else if (clientY > panelRect.bottom - scrollZone) {
              panelContent.scrollTop = Math.min(
                panelContent.scrollHeight - panelContent.clientHeight,
                panelContent.scrollTop + scrollSpeed
              );
            }
          }
        }
      }

      // Mobile drag-to-edge cell navigation (B3: reads from dragConfigRef)
      const dc = dragConfigRef.current;
      if (dc.isMobile && dc.activeCell && dc.setActiveCell) {
        const edgeZone = 60;
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
          }, 300);
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

        // Find container occurrences via draftOccurrences
        // The container occurrence is the occ whose targetId === container module id
        const fromCOcc = fromC ? Object.values(s.draftOccurrences || {}).find(o => o.targetId === fromC.id) : null;
        const toCOcc = toC ? (s.draftOccurrences ? Object.values(s.draftOccurrences).find(o => o.targetId === toC.id) : null) : null;

        // Find the occurrence ID for the dragged instance within the from container occurrence
        const draggedOccId = fromCOcc ? LayoutHelpers.findOccurrenceIdByTarget(
          s.payload.id,
          fromCOcc.occurrences || [],
          occurrencesById
        ) : null;

        if (toCOcc && instanceId && instanceId !== s.payload.id && draggedOccId) {
          // Find the index of hovered instance in target container occurrence
          const hoveredIndex = LayoutHelpers.getTargetIndexInOccurrences(
            instanceId,
            toCOcc.occurrences || [],
            occurrencesById
          );

          if (hoveredIndex !== -1) {
            // Calculate edge from cursor position
            const instanceEl = document.querySelector(`[data-instance-id="${instanceId}"]`);
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

        // Find panel occurrences via draftOccurrences (panel occ = occ with targetId === panel.id)
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
    // Called by useDroppable/useDragDrop on dragover.
    // Deduplicate: only update state when panel/container actually changes,
    // not on every pixel of mouse movement (which would cause 60fps re-renders).
    const s = sessionRef.current;
    if (!s.dragging) return;

    const newPanelId = target.context?.panelId ?? null;
    const newContainerId = target.context?.containerId ?? null;
    const newInstanceId = target.context?.instanceId ?? null;

    const last = lastHotRef.current;
    if (last.panelId === newPanelId && last.containerId === newContainerId && last.instanceId === newInstanceId) {
      return; // Nothing changed — skip re-render
    }

    lastHotRef.current = { panelId: newPanelId, containerId: newContainerId, instanceId: newInstanceId };
    // Only highlight containers for instance/external drags, not container drags
    const shouldHighlight = s.payload?.type === DragType.INSTANCE || s.payload?.type === DragType.EXTERNAL;
    setDropHighlight(shouldHighlight ? (newContainerId || null) : null);
  }, []);

  // ============================================================
  // DROP HANDLER - COMMITS CHANGES
  // ============================================================
  const handleDrop = useCallback((dropTarget) => {
    const s = sessionRef.current;

    // For external drops (files, text, URLs), there's no session, so use the source from dropTarget
    const payload = s?.payload || dropTarget?.source;

    if (!s.dragging && !payload) {
      clearSession();
      return;
    }

    // Update pointer position from drop event if available
    if (dropTarget.clientX !== undefined && dropTarget.clientY !== undefined) {
      pointerRef.current = { x: dropTarget.clientX, y: dropTarget.clientY };
    }

    const { x, y } = pointerRef.current;

    // Resolve targets from hit testing + drop target context
    const panelId = dropTarget.context?.panelId || getHoveredPanelId();
    const containerId = dropTarget.context?.containerId || getHoveredContainerId();
    const instanceId = dropTarget.context?.instanceId || getHoveredInstanceId();

    // ============================================================
    // DEDUPLICATION - Prevent multiple drop zones from handling the same drop
    // ============================================================
    const now = Date.now();
    const last = lastDropRef.current;
    const isDuplicate =
      last.payload === payload?.id &&
      // FILE drops deduplicate by payload id alone (both container-list and panel-content fire)
      (last.containerId === containerId || payload?.id === "__file__") &&
      (now - last.timestamp) < 100; // 100ms window for duplicate detection

    if (isDuplicate) {
      return;
    }

    // Record this drop
    lastDropRef.current = {
      payload: payload?.id,
      containerId,
      timestamp: now,
    };

    // ============================================================
    // PANEL → CELL
    // ============================================================
    if (payload?.type === DragType.PANEL) {
      // Check if this is a cross-window drop
      let isCrossWindow = false;
      if (dropTarget.dataTransfer) {
        const parsed = parseExternalDrop(dropTarget.dataTransfer);
        isCrossWindow = parsed.isCrossWindow;
      }

      // Use grid cell context if available (from grid-cell drop zone), otherwise fall back to getCellFromPoint
      let cell = null;
      if (dropTarget.type === "grid-cell" && dropTarget.context?.row !== undefined && dropTarget.context?.col !== undefined) {
        cell = {
          row: dropTarget.context.row,
          col: dropTarget.context.col,
          cellId: dropTarget.context.cellId,
        };
      } else {
        cell = getCellFromPoint(x, y);
      }

      if (cell && isCrossWindow) {
        // Create a copy of the panel with all its containers and instances
        const sourcePanel = payload.data;
        const newPanelId = makeUUID();
        const newContainerIds = [];

        // Copy all containers and their instances
        const sourceContainers = sourcePanel?.containerObjects || [];
        sourceContainers.forEach(sourceContainer => {
          const newContainerId = makeUUID();
          newContainerIds.push(newContainerId);

          // Copy instances for this container
          const sourceInstances = sourceContainer?.instanceObjects || [];
          const newInstanceIds = [];

          sourceInstances.forEach(sourceInstance => {
            const newInstanceId = makeUUID();
            newInstanceIds.push(newInstanceId);
            const newInstance = {
              id: newInstanceId,
              label: sourceInstance.label || "Instance",
            };
            CommitHelpers.createModule({ dispatch, socket, module: { ...newInstance, role: "instance" }, emit: true });
          });

          // Create the container with copied instances
          const newContainer = {
            id: newContainerId,
            label: sourceContainer.label || "Container",
            occurrences: newInstanceIds,
          };
          CommitHelpers.createModule({ dispatch, socket, module: { ...newContainer, role: "container" }, emit: true });
        });

        // Create the panel (without row/col - that's in occurrence.placement)
        const newPanel = {
          id: newPanelId,
          containers: newContainerIds,
          layout: sourcePanel?.layout || {},
        };

        // Create panel with occurrence in grid (handles placement)
        LayoutHelpers.createPanelInGrid({
          dispatch,
          socket,
          grid: state?.grid,
          panel: newPanel,
          placement: {
            row: cell.row,
            col: cell.col,
            width: sourcePanel?.width || 1,
            height: sourcePanel?.height || 1,
          },
          userId: state?.userId,
          emit: true,
        });

        // Handle stack visibility for destination cell
        const destStack = baseAllPanels.filter((p) => p.row === cell.row && p.col === cell.col);
        destStack.forEach((p) => {
          LayoutHelpers.setPanelStackDisplay({ dispatch, socket, panel: p, display: "none", emit: true });
        });
      } else if (cell) {
        const panel = baseAllPanels.find((p) => p.id === payload.id);
        if (panel && (panel.row !== cell.row || panel.col !== cell.col)) {
          const fromRow = panel.row, fromCol = panel.col;
          const toRow = cell.row, toCol = cell.col;

          // Update occurrence placement (the source of truth for panel position)
          const occurrenceId = panel._occurrenceId;
          const occurrence = occurrenceId ? occurrencesById[occurrenceId] : null;

          if (occurrence) {
            // Update the occurrence's placement
            CommitHelpers.updateOccurrence({
              dispatch, socket,
              occurrence: {
                ...occurrence,
                placement: {
                  ...(occurrence.placement || {}),
                  row: toRow,
                  col: toCol,
                },
              },
              emit: true,
            });
          }

          // Also update module layout to ensure it's visible (use updateModule — server handles it)
          CommitHelpers.updateModule({
            dispatch, socket,
            module: {
              ...panel,
              layout: {
                ...(panel.layout || {}),
                style: {
                  ...(panel.layout?.style || {}),
                  display: "block",
                },
              },
            },
            emit: true,
          });

          // Stack visibility management
          const allPanels = baseAllPanels;
          const sourceCellKey = `cell-${fromRow}-${fromCol}`;
          const destCellKey = `cell-${toRow}-${toCol}`;

          const sourceStack = allPanels.filter((p) => p.id !== payload.id && cellKeyFromPanel(p) === sourceCellKey);
          const destStack = allPanels.filter((p) => p.id !== payload.id && cellKeyFromPanel(p) === destCellKey);

          if (sourceStack.length > 0 && sourceStack[0]) {
            // Show the first remaining panel in the source stack
            LayoutHelpers.setPanelStackDisplay({ dispatch, socket, panel: sourceStack[0], display: "block", emit: true });
            // Hide all other panels in the source stack
            sourceStack.slice(1).forEach((p) => {
              if (p) {
                LayoutHelpers.setPanelStackDisplay({ dispatch, socket, panel: p, display: "none", emit: true });
              }
            });
          }

          // Hide all panels in the destination stack (the moved panel will be on top)
          destStack.forEach((p) => {
            LayoutHelpers.setPanelStackDisplay({ dispatch, socket, panel: p, display: "none", emit: true });
          });
        }
      }
    }

    // ============================================================
    // CONTAINER → PANEL
    // ============================================================
    if (payload?.type === DragType.CONTAINER && panelId) {
      // Check if this is a cross-window drop - if so, create a copy instead of moving
      let isCrossWindow = false;
      if (dropTarget.dataTransfer) {
        const parsed = parseExternalDrop(dropTarget.dataTransfer);
        isCrossWindow = parsed.isCrossWindow;
      }

      if (isCrossWindow) {
        // Create a copy of the container in the target panel with all its instances
        const sourceContainer = payload.data;
        const targetPanel = baseAllPanels.find((p) => p.id === panelId);
        if (!targetPanel) {
          clearSession();
          return;
        }

        // Get gridId from state
        const gridId = state?.gridId || state?.grid?._id;

        // Calculate insertion index using the target panel occurrence
        const targetPanelOcc = targetPanel?._occurrence ? occurrencesById[targetPanel._occurrence.id] : null;
        let toIndex = null;
        if (dropTarget.context?.insertAt !== undefined) {
          toIndex = dropTarget.context.insertAt;
        } else if (containerId) {
          const hoveredIndex = LayoutHelpers.getTargetIndexInOccurrences(
            containerId,
            targetPanelOcc?.occurrences || [],
            occurrencesById
          );
          if (hoveredIndex !== -1) {
            const edge = dropTarget.context?.closestEdge;
            if (edge === 'top' || edge === 'left') {
              toIndex = hoveredIndex;
            } else if (edge === 'bottom' || edge === 'right') {
              toIndex = hoveredIndex + 1;
            }
          }
        }

        // Create new container with occurrences (empty initially, instances will be added)
        const newContainerId = makeUUID();
        const newContainer = {
          id: newContainerId,
          label: sourceContainer?.label || "Container",
          occurrences: [], // Will be populated as instances are added
        };

        // Create the container with its occurrence in the panel
        LayoutHelpers.createContainerInPanel({
          dispatch, socket, gridId,
          panel: targetPanel,
          container: newContainer,
          userId: state?.userId,
          index: toIndex,
          emit: true,
        });

        // Copy all instances from the source container and add to the new container
        const sourceInstanceObjects = sourceContainer?.instanceObjects || [];
        sourceInstanceObjects.forEach(sourceInstance => {
          const newInstanceId = makeUUID();
          const newInstance = {
            id: newInstanceId,
            label: sourceInstance.label || "Instance",
          };

          // Need to get the updated container from state - but since this is optimistic,
          // we can create the instance and occurrence directly
          LayoutHelpers.createInstanceInContainer({
            dispatch, socket, gridId,
            container: { ...newContainer, id: newContainerId },
            instance: newInstance,
            userId: state?.userId,
            emit: true,
          });
        });
      } else {
        // Same-window drop - use move behavior
        // Use baseAllPanels (original state) NOT draftPanels (preview state)
        const all = baseAllPanels;
        const fromPanel = all.find((p) => p.id === payload.context?.panelId);
        const toPanel = all.find((p) => p.id === panelId);

        // Resolve panel occurrences (where ordering lives)
        const fromPanelOcc = fromPanel?._occurrence ? occurrencesById[fromPanel._occurrence.id] : null;
        const toPanelOcc = toPanel?._occurrence ? occurrencesById[toPanel._occurrence.id] : null;

        if (fromPanel && toPanel && fromPanelOcc) {
          // Find the occurrence ID for the dragged container
          const draggedContainerId = payload.id;
          const occurrenceId = LayoutHelpers.findOccurrenceIdByTarget(
            draggedContainerId,
            fromPanelOcc.occurrences || [],
            occurrencesById
          );

          if (!occurrenceId) {
            console.warn('[CONTAINER DROP] Could not find occurrence for container:', draggedContainerId);
            clearSession();
            return;
          }

          const effectiveToPanelOcc = toPanelOcc || fromPanelOcc;

          let toIndex = null;

          // Check for explicit insertion index (e.g., panel header drop = 0)
          if (dropTarget.context?.insertAt !== undefined) {
            toIndex = dropTarget.context.insertAt;
          } else if (containerId) {
            // Dropping over a specific container - calculate insertion based on edge
            const hoveredIndex = LayoutHelpers.getTargetIndexInOccurrences(
              containerId,
              effectiveToPanelOcc.occurrences || [],
              occurrencesById
            );

            if (hoveredIndex !== -1) {
              const edge = dropTarget.context?.closestEdge;

              if (edge === 'top' || edge === 'left') {
                toIndex = hoveredIndex;  // Insert before
              } else if (edge === 'bottom' || edge === 'right') {
                toIndex = hoveredIndex + 1;  // Insert after
              }

              // Adjust index if moving within same panel
              if (fromPanel.id === toPanel.id) {
                const fromIndex = LayoutHelpers.getTargetIndexInOccurrences(
                  draggedContainerId,
                  fromPanelOcc.occurrences || [],
                  occurrencesById
                );
                if (fromIndex !== -1 && fromIndex < hoveredIndex) {
                  toIndex = Math.max(0, toIndex - 1);
                }
              }
            }
          }
          // else: toIndex stays null, which means append to end

          // Get gridId for creating new occurrences
          const gridId = state?.gridId || state?.grid?._id;

          // Check if we're in copy mode - use session ref for immediate access
          const isCopyMode = sessionRef.current.mode === 'copy';
          const samePanel = fromPanel.id === toPanel.id;

          if (isCopyMode && samePanel) {
            // Same panel + copy = just reorder, don't duplicate
            const fromIndex = LayoutHelpers.getTargetIndexInOccurrences(
              draggedContainerId,
              fromPanelOcc.occurrences || [],
              occurrencesById
            );
            if (fromIndex !== -1) {
              if (toIndex === null) { clearSession(); return; }
              if (fromIndex !== toIndex) {
                LayoutHelpers.reorderContainersInPanel({
                  dispatch, socket, panelOccurrence: fromPanelOcc,
                  fromIndex, toIndex, emit: true,
                });
              }
            }
          } else if (isCopyMode) {
            // COPY MODE: Create new occurrence for the container in target panel
            // Source occurrence remains intact — toPanel._occurrence carries ordering
            LayoutHelpers.copyContainerToPanel({
              dispatch,
              socket,
              gridId,
              sourceContainerId: draggedContainerId,
              toPanel,
              userId: state?.userId,
              toIndex,
              emit: true,
            });
          } else if (fromPanel.id === toPanel.id) {
            // MOVE MODE: Same panel - use reorder helper
            const fromIndex = LayoutHelpers.getTargetIndexInOccurrences(
              draggedContainerId,
              fromPanelOcc.occurrences || [],
              occurrencesById
            );

            if (fromIndex !== -1) {
              // If toIndex is null (dropped on empty space, not over a sibling), keep in place
              if (toIndex === null) {
                clearSession();
                return;
              }

              if (fromIndex !== toIndex) {
                LayoutHelpers.reorderContainersInPanel({
                  dispatch, socket, panelOccurrence: fromPanelOcc,
                  fromIndex,
                  toIndex,
                  emit: true,
                });
              }
            }
          } else {
            // MOVE MODE: Cross-panel move (pass occurrence ID, not container ID)
            LayoutHelpers.moveContainerBetweenPanels({
              dispatch, socket,
              fromPanelOccurrence: fromPanelOcc,
              toPanelOccurrence: effectiveToPanelOcc,
              occurrenceId,
              toIndex,  // null = append to end
              emit: true,
            });
          }
        }
      }
    }

    // ============================================================
    // INSTANCE → CONTAINER (MOVE BEHAVIOR - no duplication in same window)
    // ============================================================
    if (payload?.type === DragType.INSTANCE && containerId) {
      // Skip if this is a cross-window drop - let CROSS-WINDOW handler deal with it
      if (dropTarget.dataTransfer) {
        const parsed = parseExternalDrop(dropTarget.dataTransfer);
        if (parsed.isCrossWindow) {
          // Let CROSS-WINDOW handler process this - don't clear session yet
          return;
        }
      }

      // Use baseContainers (original state) NOT draftContainers (preview state)
      const fromC = baseContainers.find((c) => c.id === payload.context?.containerId);
      const toC = baseContainers.find((c) => c.id === containerId);

      // Resolve container occurrences (where ordering lives)
      // Scan occurrencesById for occurrence with targetId === container.id
      const fromCOcc = fromC ? Object.values(occurrencesById).find(o => o.targetId === fromC.id) : null;
      const toCOcc = toC ? Object.values(occurrencesById).find(o => o.targetId === toC.id) : null;

      if (fromC && toC) {
        // If target container has droppable: false, skip
        if (toC.behaviorMode === "own" && toC.behavior?.droppable === false) {
          clearSession();
          return;
        }
        // If target is a doc container, skip normal move/copy — DocContainer handles pill insertion
        if (toC.kind === "doc") {
          clearSession();
          return;
        }

        // Find the occurrence ID for the dragged instance within the from container occurrence
        const draggedInstanceId = payload.id;
        const occurrenceId = fromCOcc ? LayoutHelpers.findOccurrenceIdByTarget(
          draggedInstanceId,
          fromCOcc.occurrences || [],
          occurrencesById
        ) : null;

        if (!occurrenceId) {
          console.warn('[INSTANCE DROP] Could not find occurrence for instance:', draggedInstanceId, 'fromCOcc:', fromCOcc?.id);
          clearSession();
          return;
        }

        let toIndex = null;

        // Check if drop target specifies explicit insertion index (e.g., header drop = 0)
        if (dropTarget.context?.insertAt !== undefined) {
          toIndex = dropTarget.context.insertAt;
        } else if (instanceId && toCOcc) {
          // Find the index of the hovered instance in the target container occurrence
          const hoveredIndex = LayoutHelpers.getTargetIndexInOccurrences(
            instanceId,
            toCOcc.occurrences || [],
            occurrencesById
          );

          if (hoveredIndex !== -1) {
            // Extract edge from drop target context
            const edge = dropTarget.context?.closestEdge;

            // Determine insertion position based on edge
            if (edge === 'top' || edge === 'left') {
              toIndex = hoveredIndex;  // Insert before
            } else if (edge === 'bottom' || edge === 'right') {
              toIndex = hoveredIndex + 1;  // Insert after
            } else {
              toIndex = hoveredIndex;
            }

            // For same-container drops, adjust for removal of source item
            if (fromCOcc && fromCOcc.id === toCOcc.id) {
              const fromIndex = LayoutHelpers.getTargetIndexInOccurrences(
                draggedInstanceId,
                fromCOcc.occurrences || [],
                occurrencesById
              );
              if (fromIndex !== -1 && fromIndex < hoveredIndex) {
                toIndex = Math.max(0, toIndex - 1);
              }
            }
          }
        }

        // Get gridId for creating new occurrences
        const gridId = state?.gridId || state?.grid?._id;

        // For canvas containers, compute drop position relative to the canvas area
        const getCanvasMeta = (container, cx, cy) => {
          if (container?.kind !== "canvas") return null;
          const el = document.querySelector(`[data-container-id="${container.id}"]`);
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return { x: Math.max(0, Math.round(cx - rect.left)), y: Math.max(0, Math.round(cy - rect.top)) };
        };

        // Get current iteration date for new occurrences
        const grid = state?.grid;
        const iterations = grid?.iterations || [];
        const selectedIterationId = state?.selectedIterationId || grid?.selectedIterationId || "default";
        const selectedIteration = iterations.find(i => i.id === selectedIterationId) || iterations[0];
        const currentIterationDate = state?.currentIterationValue || selectedIteration?.currentDate || new Date();

        // Check drag mode - use session ref for immediate access
        const isCopyMode = sessionRef.current.mode === 'copy';
        const isCopylinkMode = sessionRef.current.mode === 'copylink';

        // If copy/copylink drops in the SAME container, treat as a move (reorder)
        const sameContainer = fromC.id === toC.id;

        // Block reordering if container has sortable: false
        if (sameContainer && toC?.behaviorMode === "own" && toC?.behavior?.sortable === false) {
          clearSession(); return;
        }

        if ((isCopylinkMode || isCopyMode) && sameContainer) {
          // Same container + copy/copylink = just reorder, don't duplicate
          if (fromCOcc) {
            const fromIndex = LayoutHelpers.getTargetIndexInOccurrences(
              draggedInstanceId,
              fromCOcc.occurrences || [],
              occurrencesById
            );
            if (fromIndex !== -1) {
              if (toIndex === null) { clearSession(); return; }
              if (fromIndex !== toIndex) {
                LayoutHelpers.reorderInstancesInContainer({
                  dispatch, socket, containerOccurrence: fromCOcc,
                  fromIndex, toIndex, emit: true,
                });
              }
            }
          }
        } else if (isCopylinkMode) {
          // COPYLINK MODE: Create a linked occurrence — field edits propagate to all linked
          // Pass toContainer with _occurrence set so copylink can add to container occurrence
          LayoutHelpers.copylinkInstanceToContainer({
            dispatch,
            socket,
            gridId,
            sourceInstanceId: draggedInstanceId,
            sourceOccurrenceId: occurrenceId,
            toContainer: toCOcc ? { ...toC, _occurrence: toCOcc } : toC,
            userId: state?.userId,
            toIndex,
            emit: true,
            iterationMode: "specific",
            iterationValue: currentIterationDate,
            sourceOccurrence: occurrenceId ? occurrencesById[occurrenceId] : null,
            initialMeta: getCanvasMeta(toC, clientX, clientY),
          });
        } else if (isCopyMode) {
          // COPY MODE: Create a new occurrence in the target container
          // New occurrence is "specific" to current iteration (not persistent)
          const copyResult = LayoutHelpers.copyInstanceToContainer({
            dispatch,
            socket,
            gridId,
            sourceInstanceId: draggedInstanceId,
            toContainer: toCOcc ? { ...toC, _occurrence: toCOcc } : toC,
            userId: state?.userId,
            toIndex,
            emit: true,
            iterationMode: "specific",  // Copies are specific to this date
            iterationValue: currentIterationDate,
            sourceOccurrence: occurrenceId ? occurrencesById[occurrenceId] : null,
            initialMeta: getCanvasMeta(toC, clientX, clientY),
          });

          // Auto-check boolean fields on drop
          const droppedInstance = (state?.instances || []).find(i => i.id === draggedInstanceId);
          if (droppedInstance?.meta?.autoCheckOnDrop && copyResult?.occurrence?.id) {
            const boolBindings = (droppedInstance.fieldBindings || []).filter(b => {
              const field = (state?.fields || []).find(f => f.id === b.fieldId);
              return field?.type === "boolean";
            });
            if (boolBindings.length > 0) {
              const autoFields = {};
              boolBindings.forEach(b => {
                autoFields[b.fieldId] = { value: true, flow: "in" };
              });
              CommitHelpers.updateOccurrence({
                dispatch, socket,
                occurrence: { id: copyResult.occurrence.id, fields: autoFields },
                emit: true,
              });
            }
          }
        } else if (fromC.id === toC.id) {
          // MOVE MODE: Same container - reorder
          if (fromCOcc) {
            const fromIndex = LayoutHelpers.getTargetIndexInOccurrences(
              draggedInstanceId,
              fromCOcc.occurrences || [],
              occurrencesById
            );
            if (fromIndex !== -1) {
              // If toIndex is null (dropped on empty space, not over a sibling), keep in place
              if (toIndex === null) { clearSession(); return; }
              if (fromIndex !== toIndex) {
                LayoutHelpers.reorderInstancesInContainer({
                  dispatch,
                  socket,
                  containerOccurrence: fromCOcc,
                  fromIndex,
                  toIndex,
                  emit: true,
                });
              }
            }
          }
        } else {
          // MOVE MODE: Different containers - move (pass occurrence ID, not instance ID)
          if (fromCOcc && toCOcc) {
            LayoutHelpers.moveInstanceBetweenContainers({
              dispatch,
              socket,
              fromContainerOccurrence: fromCOcc,
              toContainerOccurrence: toCOcc,
              occurrenceId,
              toIndex,
              emit: true,
            });

            // If dropping into a canvas container, stamp drop position onto the occurrence
            const canvasMeta = getCanvasMeta(toC, clientX, clientY);
            if (canvasMeta) {
              const occ = occurrencesById[occurrenceId];
              if (occ) {
                CommitHelpers.updateOccurrence({
                  dispatch, socket,
                  occurrence: { ...occ, meta: { ...(occ.meta || {}), ...canvasMeta } },
                  emit: true,
                });
              }
            }

            // Fire OccurrenceMoveOp so operations with onMove trigger can react
            const allOccs = Object.values(occurrencesById);
            const fromPanelOcc = fromCOcc.parentId ? allOccs.find(o => o.id === fromCOcc.parentId) : null;
            const toPanelOcc = toCOcc.parentId ? allOccs.find(o => o.id === toCOcc.parentId) : null;
            const tx = {
              type: "OccurrenceMoveOp",
              occurrenceId,
              instanceId: draggedInstanceId,
              fromContainerId: fromC.id,
              toContainerId: toC.id,
              fromPanelId: fromPanelOcc?.targetId || null,
              toPanelId: toPanelOcc?.targetId || null,
            };
            const operations = Object.values(state?.operationsById || {});
            const fieldsById = Object.fromEntries((state?.fields || []).map(f => [f.id, f]));
            const occurrencesForOps = { ...occurrencesById };
            const allUpdates = runMatchingOperations(operations, "OccurrenceMoveOp", tx, {
              state,
              fieldsById,
              operationsById: state?.operationsById || {},
              occurrencesById: occurrencesForOps,
            });
            if (allUpdates?.length) {
              dispatch({ type: "SET_COMPUTED_VALUES", updates: allUpdates });
            }
          }

          // Auto-check boolean fields on move drop
          const movedInstance = (state?.instances || []).find(i => i.id === draggedInstanceId);
          if (movedInstance?.meta?.autoCheckOnDrop && occurrenceId) {
            const boolBindings = (movedInstance.fieldBindings || []).filter(b => {
              const field = (state?.fields || []).find(f => f.id === b.fieldId);
              return field?.type === "boolean";
            });
            if (boolBindings.length > 0) {
              const autoFields = {};
              boolBindings.forEach(b => {
                autoFields[b.fieldId] = { value: true, flow: "in" };
              });
              CommitHelpers.updateOccurrence({
                dispatch, socket,
                occurrence: { id: occurrenceId, fields: autoFields },
                emit: true,
              });
            }
          }
        }
      }
    }

    // ============================================================
    // EXTERNAL FILE DROP → UPLOAD AND CREATE ARTIFACT PANEL
    // ============================================================
    if (payload?.type === DragType.FILE && payload?.data?.files?.length > 0) {
      const file = payload.data.files[0];
      const cell = getCellFromPoint(x, y);
      const fileGridId = state?.gridId || state?.grid?._id;
      const fileUserId = state?.userId;
      const fileGrid = state?.grid;

      if (fileGridId && fileUserId && fileGrid) {
        // Capture panel state before async (closure may be stale after fetch resolves)
        const capturedPanelOcc = panelId
          ? Object.values(occurrencesById).find(o => o.targetId === panelId)
          : null;
        const capturedPanelView = capturedPanelOcc?.viewId ? state?.viewsById?.[capturedPanelOcc.viewId] : null;
        const isExistingArtifactPanel = capturedPanelView?.viewType === "artifact" || capturedPanelView?.hasTree;

        const formData = new FormData();
        formData.append("file", file);
        formData.append("userId", fileUserId);
        formData.append("gridId", fileGridId);

        fetch("/api/artifacts/upload", { method: "POST", body: formData })
          .then(r => r.json())
          .then(({ occurrence: uploadedOcc }) => {
            if (!uploadedOcc?.id) return;
            if (isExistingArtifactPanel && capturedPanelView) {
              // Drop onto existing artifact panel → switch active doc
              CommitHelpers.updateView({
                dispatch, socket,
                view: { ...capturedPanelView, activeOccurrenceId: uploadedOcc.id },
              });
            } else {
              // Create new artifact panel at the drop cell
              const targetCell = cell || { row: 0, col: 0 };
              const newPanelModule = { id: makeUUID(), label: file.name || "Uploaded File", role: "panel", kind: "list" };
              const panelResult = LayoutHelpers.createPanelInGrid({
                dispatch, socket, grid: fileGrid,
                panel: newPanelModule,
                placement: { row: targetCell.row, col: targetCell.col, width: 1, height: 1 },
                userId: fileUserId, emit: true,
              });
              if (panelResult?.occurrence) {
                const viewId = makeUUID();
                CommitHelpers.createView({
                  dispatch, socket,
                  view: { id: viewId, userId: fileUserId, gridId: fileGridId, viewType: "artifact", hasTree: false, manifestId: null, activeOccurrenceId: uploadedOcc.id },
                  emit: true,
                });
                CommitHelpers.updateOccurrence({
                  dispatch, socket,
                  occurrence: { ...panelResult.occurrence, viewId },
                  emit: true,
                });
              }
            }
          })
          .catch(err => console.error("[FILE DROP] Upload error:", err));
      }

      clearSession();
      return;
    }

    // ============================================================
    // EXTERNAL (TEXT/URL) → CONTAINER
    // ============================================================
    if ([DragType.TEXT, DragType.URL, DragType.EXTERNAL].includes(payload?.type) && containerId) {
      let label = "Untitled";
      if (payload.type === DragType.TEXT) label = (payload.data?.text || "").slice(0, 80) || "Text";
      else if (payload.type === DragType.URL) label = payload.data?.url || "Link";

      const id = makeUUID();
      let toIndex = dropTarget.context?.insertAt ?? null;

      const container = baseContainers.find((c) => c.id === containerId);
      if (!container) {
        clearSession();
        return;
      }

      // Find nearest instance based on cursor position using occurrence ordering
      const containerOcc = Object.values(occurrencesById).find(o => o.targetId === container.id);
      if (toIndex === null) {
        const occurrenceIds = containerOcc?.occurrences || [];

        if (occurrenceIds.length > 0) {
          let nearestIndex = 0;
          let nearestDistance = Infinity;

          // Find the nearest instance based on cursor position
          occurrenceIds.forEach((occId, index) => {
            const occ = occurrencesById[occId];
            if (occ && occ.targetType === 'instance') {
              const el = document.querySelector(`[data-instance-id="${occ.targetId}"]`);
              if (el) {
                const rect = el.getBoundingClientRect();
                const centerY = rect.top + rect.height / 2;
                const distance = Math.abs(y - centerY);

                if (distance < nearestDistance) {
                  nearestDistance = distance;
                  nearestIndex = index;
                }
              }
            }
          });

          // Determine if cursor is above or below the nearest instance
          const nearestOcc = occurrencesById[occurrenceIds[nearestIndex]];
          if (nearestOcc) {
            const nearestEl = document.querySelector(`[data-instance-id="${nearestOcc.targetId}"]`);
            if (nearestEl) {
              const rect = nearestEl.getBoundingClientRect();
              const centerY = rect.top + rect.height / 2;

              if (y < centerY) {
                toIndex = nearestIndex;  // Insert before
              } else {
                toIndex = nearestIndex + 1;  // Insert after
              }
            }
          }
        }
      }

      // Get gridId from state
      const gridId = state?.gridId || state?.grid?._id;

      LayoutHelpers.createInstanceInContainer({
        dispatch, socket, gridId,
        container,
        containerOccurrence: containerOcc || null,
        instance: { id, label },
        userId: state?.userId,
        index: toIndex,
        emit: true,
      });
    }

    // ============================================================
    // CROSS-WINDOW DROP
    // ============================================================
    if (dropTarget.dataTransfer && containerId) {
      const parsed = parseExternalDrop(dropTarget.dataTransfer);

      // Handle cross-window instance drops
      if (parsed.isCrossWindow && parsed.type === DragType.INSTANCE) {
        const id = makeUUID();
        let toIndex = dropTarget.context?.insertAt ?? null;

        const container = baseContainers.find((c) => c.id === containerId);
        if (!container) {
          clearSession();
          return;
        }

        // Find nearest instance based on cursor position using occurrence ordering
        const xwContainerOcc = Object.values(occurrencesById).find(o => o.targetId === container.id);
        if (toIndex === null) {
          const occurrenceIds = xwContainerOcc?.occurrences || [];

          if (occurrenceIds.length > 0) {
            let nearestIndex = 0;
            let nearestDistance = Infinity;

            // Find the nearest instance based on cursor position
            occurrenceIds.forEach((occId, index) => {
              const occ = occurrencesById[occId];
              if (occ && occ.targetType === 'instance') {
                const el = document.querySelector(`[data-instance-id="${occ.targetId}"]`);
                if (el) {
                  const rect = el.getBoundingClientRect();
                  const centerY = rect.top + rect.height / 2;
                  const distance = Math.abs(y - centerY);

                  if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestIndex = index;
                  }
                }
              }
            });

            // Determine if cursor is above or below the nearest instance
            const nearestOcc = occurrencesById[occurrenceIds[nearestIndex]];
            if (nearestOcc) {
              const nearestEl = document.querySelector(`[data-instance-id="${nearestOcc.targetId}"]`);
              if (nearestEl) {
                const rect = nearestEl.getBoundingClientRect();
                const centerY = rect.top + rect.height / 2;

                if (y < centerY) {
                  toIndex = nearestIndex;  // Insert before
                } else {
                  toIndex = nearestIndex + 1;  // Insert after
                }
              }
            }
          }
        }

        // Get gridId from state
        const gridId = state?.gridId || state?.grid?._id;

        const label = parsed.meta?.label || parsed.data?.label || "Untitled";
        LayoutHelpers.createInstanceInContainer({
          dispatch, socket, gridId,
          container,
          containerOccurrence: xwContainerOcc || null,
          instance: { id, label },
          userId: state?.userId,
          index: toIndex,
          emit: true,
        });
      }
    }

    // ============================================================
    // TEMPLATE FROM COMMAND CENTER → CONTAINER (fills container from template)
    // ============================================================
    if (payload?.type === "template" && payload?.sourceType === "command-center") {
      if (containerId) {
        const gridId = state?.gridId || state?.grid?._id;
        const currentIterationValue = state?.grid?.currentIterationValue;
        CommitHelpers.fillFromTemplate({
          socket,
          gridId,
          templateId: payload.id,
          containerId,
          iterationValue: currentIterationValue,
        });
      }
    }

    // ============================================================
    // MODULE FROM COMMAND CENTER → CONTAINER, PANEL, or INSTANCE
    // Handles all module roles (instance, container, panel) from the EntityTreeTab.
    // ============================================================
    if (payload?.type === "module" && (payload?.sourceType === "command-center" || payload?.sourceType === "pool" || payload?.sourceType === "doc" || payload?.sourceType === "canvas")) {
      const role = payload?.data?.role || payload?.role;
      const gridId = state?.gridId || state?.grid?._id?.toString() || state?.grid?.id;

      // INSTANCE role: create a persistent occurrence in the target container/panel
      if (!role || role === "instance") {
        let targetContainer = null;

        if (containerId) {
          // Dropped directly on a container
          const c = baseContainers.find(c => c.id === containerId);
          const droppable = !(c?.behaviorMode === "own" && c?.behavior?.droppable === false);
          if (c && droppable) targetContainer = c;
        } else if (panelId) {
          // Dropped on a panel — add to first droppable container
          const panel = baseAllPanels.find(p => p.id === panelId);
          if (panel) {
            // Get container IDs from the panel occurrence (ordering lives there)
            const panelOcc = panel._occurrence ? occurrencesById[panel._occurrence.id] : null;
            const panelContainerIds = (panelOcc?.occurrences || [])
              .map(occId => occurrencesById[occId])
              .filter(occ => occ?.targetId)
              .map(occ => occ.targetId);
            const candidates = baseContainers.filter(c => panelContainerIds.includes(c.id));
            targetContainer = candidates.find(c =>
              !(c.behaviorMode === "own" && c.behavior?.droppable === false)
            ) || candidates[0] || null;
          }
        }

        if (targetContainer && gridId) {
          // Find the container occurrence for ordering
          const targetContainerOcc = Object.values(occurrencesById).find(o => o.targetId === targetContainer.id);
          LayoutHelpers.copyInstanceToContainer({
            dispatch,
            socket,
            gridId,
            sourceInstanceId: payload.id,
            toContainer: targetContainerOcc ? { ...targetContainer, _occurrence: targetContainerOcc } : targetContainer,
            userId: state?.userId,
            iterationMode: "persistent",
            emit: true,
            initialMeta: getCanvasMeta(targetContainer, clientX, clientY),
          });
        }
      }

      // CONTAINER role → PANEL: add a new occurrence of this container to the target panel
      if (role === "container" && panelId && gridId) {
        const panel = baseAllPanels.find(p => p.id === panelId);
        const container = baseContainers.find(c => c.id === payload.id);
        if (panel && container) {
          LayoutHelpers.createContainerInPanel({
            dispatch, socket, gridId,
            panel,
            container: { id: container.id, label: container.label, kind: container.kind },
            userId: state?.userId,
            index: null,
            emit: true,
          });
        }
      }

      // CONTAINER role → GRID CELL: create new panel with the container as its sole child (drilldown)
      if (role === "container" && dropTarget.type === "grid-cell" && dropTarget.context?.row !== undefined) {
        const cell = { row: dropTarget.context.row, col: dropTarget.context.col };
        const grid = state?.grid;
        const userId = state?.userId;
        const container = baseContainers.find(c => c.id === payload.id);
        if (cell && grid && userId && container) {
          const newPanel = { id: makeUUID(), label: container.label || "Panel", role: "panel", kind: "list" };
          const { occurrence: panelOcc } = LayoutHelpers.createPanelInGrid({
            dispatch, socket, grid, panel: newPanel,
            placement: { row: cell.row, col: cell.col, width: 1, height: 1 },
            userId, emit: true,
          });
          LayoutHelpers.createContainerInPanel({
            dispatch, socket, gridId,
            panel: { ...newPanel, _occurrence: panelOcc },
            container: { id: container.id, label: container.label, kind: container.kind },
            userId, emit: true,
          });
        }
      }

      // INSTANCE role → GRID CELL: create new panel + container, then place instance inside (drilldown)
      if ((!role || role === "instance") && dropTarget.type === "grid-cell" && dropTarget.context?.row !== undefined) {
        const cell = { row: dropTarget.context.row, col: dropTarget.context.col };
        const grid = state?.grid;
        const userId = state?.userId;
        const instance = (state?.instances || []).find(i => i.id === payload.id);
        if (cell && grid && userId && instance) {
          const newPanel = { id: makeUUID(), label: instance.label || "Panel", role: "panel", kind: "list" };
          const { occurrence: panelOcc } = LayoutHelpers.createPanelInGrid({
            dispatch, socket, grid, panel: newPanel,
            placement: { row: cell.row, col: cell.col, width: 1, height: 1 },
            userId, emit: true,
          });
          const newContainer = { id: makeUUID(), label: instance.label || "Container", role: "container", kind: "list" };
          const { occurrence: containerOcc } = LayoutHelpers.createContainerInPanel({
            dispatch, socket, gridId,
            panel: { ...newPanel, _occurrence: panelOcc },
            container: newContainer,
            userId, emit: true,
          });
          LayoutHelpers.copyInstanceToContainer({
            dispatch, socket, gridId,
            sourceInstanceId: instance.id,
            toContainer: { ...newContainer, _occurrence: containerOcc },
            userId, iterationMode: "persistent", emit: true,
          });
        }
      }

      // PANEL role: move panel to a different grid cell
      if (role === "panel" && gridId) {
        const cell = (dropTarget.type === "grid-cell" && dropTarget.context?.row !== undefined)
          ? { row: dropTarget.context.row, col: dropTarget.context.col }
          : getCellFromPoint(x, y);
        if (cell) {
          const panelModule = baseAllPanels.find(p => p.id === payload.id);
          const occurrenceId = panelModule?._occurrenceId;
          const panelOcc = occurrenceId ? occurrencesById[occurrenceId] : null;
          if (panelModule && panelOcc) {
            CommitHelpers.updateOccurrence({
              dispatch, socket,
              occurrence: {
                ...panelOcc,
                placement: { ...(panelOcc.placement || {}), row: cell.row, col: cell.col },
              },
              emit: true,
            });
          }
        }
      }
    }

    // ============================================================
    // FIELD FROM COMMAND CENTER → INSTANCE (adds to fieldBindings)
    // ============================================================
    if (payload?.type === "field" && payload?.sourceType === "command-center") {
      const targetInstanceId = dropTarget.context?.instanceId || instanceId;
      if (targetInstanceId) {
        const instance = state?.instances?.find(i => i.id === targetInstanceId);
        if (instance) {
          const fieldId = payload.id;
          const existing = instance.fieldBindings || [];
          if (!existing.some(b => b.fieldId === fieldId)) {
            const updated = {
              ...instance,
              fieldBindings: [...existing, { fieldId, showLabel: true }],
            };
            CommitHelpers.updateModule({ dispatch, socket, module: updated });
          }
        }
      }
    }

    // ============================================================
    // OPERATION FROM COMMAND CENTER → INSTANCE (adds to operationBindings)
    // ============================================================
    if (payload?.type === "operation" && payload?.sourceType === "command-center") {
      const targetInstanceId = dropTarget.context?.instanceId || instanceId;
      if (targetInstanceId) {
        const instance = state?.instances?.find(i => i.id === targetInstanceId);
        if (instance) {
          const operationId = payload.id;
          const existing = instance.operationBindings || [];
          if (!existing.some(b => b.operationId === operationId)) {
            const updated = {
              ...instance,
              operationBindings: [...existing, {
                operationId,
                widgetType: "trigger",
                displayName: payload.data?.name || "",
              }],
            };
            CommitHelpers.updateModule({ dispatch, socket, module: updated });
          }
        }
      }
    }

    // ============================================================
    // ARTIFACT FROM MANIFEST TREE → PANEL (switches active document)
    // When an artifact doc row is dragged from ManifestTree and dropped
    // on a panel (not inside a container), set view.activeOccurrenceId.
    // ============================================================
    if (payload?.type === DragType.ARTIFACT && payload?.occurrenceId) {
      // N2: Drop on a list container → create instance occurrence referencing the artifact module
      if (containerId) {
        const artifactOcc = occurrencesById[payload.occurrenceId];
        const artifactModule = artifactOcc ? (state?.modules || []).find(m => m.id === artifactOcc.targetId) : null;
        if (artifactModule) {
          const toC = baseContainers.find(c => c.id === containerId);
          const toCOcc = toC ? Object.values(occurrencesById).find(o => o.targetId === toC.id) : null;
          if (toCOcc) {
            LayoutHelpers.copyInstanceToContainer({
              dispatch, socket,
              sourceInstanceId: artifactModule.id,
              toContainer: { ...toC, _occurrence: toCOcc },
              userId: state?.userId,
              gridId: state?.gridId || state?.grid?._id,
              emit: true,
            });
          }
        }
        clearSession();
        return;
      }

      // Drop on existing panel-content → switch active document
      if (panelId && !containerId && dropTarget.type === "panel-content") {
        const panelOcc = Object.values(occurrencesById).find(o => o.targetId === panelId);
        const viewId = panelOcc?.viewId;
        const view = viewId ? state?.viewsById?.[viewId] : null;
        if (view) {
          CommitHelpers.updateView({
            dispatch, socket,
            view: { ...view, activeOccurrenceId: payload.occurrenceId, scrollAnchor: null },
          });
        }
      }

      // Drop on empty grid cell → create new artifact panel
      if (dropTarget.type === "grid-cell" && dropTarget.context?.row !== undefined) {
        const cell = { row: dropTarget.context.row, col: dropTarget.context.col };
        const grid = state?.grid;
        const userId = state?.userId;
        if (cell && grid && userId) {
          const artifactOcc = occurrencesById[payload.occurrenceId];
          const artifactModule = artifactOcc ? (state?.modules || []).find(m => m.id === artifactOcc.targetId) : null;
          const label = artifactModule?.label || "Artifact";

          const newPanel = { id: makeUUID(), label, role: "panel", kind: "list" };
          const { occurrence: panelOcc } = LayoutHelpers.createPanelInGrid({
            dispatch, socket, grid, panel: newPanel,
            placement: { row: cell.row, col: cell.col, width: 1, height: 1 },
            userId, emit: true,
          });

          const viewId = makeUUID();
          CommitHelpers.createView({
            dispatch, socket,
            view: { id: viewId, userId, viewType: "artifact", hasTree: false, manifestId: null, activeOccurrenceId: payload.occurrenceId },
            emit: true,
          });

          CommitHelpers.updateOccurrence({
            dispatch, socket,
            occurrence: { ...panelOcc, viewId },
            emit: true,
          });
        }
      }
    }

    clearSession();
  }, [dispatch, socket, getCellFromPoint, getHoveredPanelId, getHoveredContainerId, getHoveredInstanceId, baseAllPanels, baseContainers, occurrencesById, clearSession, state]);

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
    if (!stack || stack.length <= 1) return;

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
