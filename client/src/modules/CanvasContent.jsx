// modules/CanvasContent.jsx
// CanvasDrawSection — draw toolbar + HTML5 canvas overlay + floating cards.
// Canvas is a large pannable WORLD (CANVAS_WORLD_SIZE px square). Surface
// scrolls; world contains the drawing canvas + floating cards. Grab/Hand
// tool pans by dragging the surface; edges autoscroll during drag-and-drop
// (after a short delay so dragging cards OUT doesn't pre-pan). Snap-to-
// center recentres the viewport on the card bounding-box centroid (or world
// center if empty).
//
// Mobile (≤600px): the horizontal toolbar collapses into a single dropdown
// button (replaces the desktop hide button). Items render grouped vertically
// inside the dropdown panel.

import React, { useRef, useState, useCallback, useEffect, useLayoutEffect } from "react";
import { MousePointer2, Hand, Pencil, Square, Circle, Minus, Eraser, Undo2, Redo2, ChevronUp, ChevronDown, Crosshair, Link2 } from "lucide-react";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { useMobileDetect } from "../hooks/useMobileDetect";

// World size — large enough to feel expansive but small enough that canvas
// rendering and scroll math stay snappy.
const CANVAS_WORLD_SIZE = 4000;

// ============================================================
// CANVAS DRAW SECTION — draw toolbar + HTML5 canvas overlay + floating cards
// ============================================================
const DRAW_TOOLS = [
  { id: "select",  icon: MousePointer2, title: "Select / move cards" },
  { id: "grab",    icon: Hand,          title: "Grab to pan" },
  { id: "connect", icon: Link2,         title: "Connect cards (drag card → card)" },
  { id: "pen",     icon: Pencil,        title: "Freehand pen" },
  { id: "line",    icon: Minus,         title: "Straight line" },
  { id: "rect",    icon: Square,        title: "Rectangle" },
  { id: "circle",  icon: Circle,        title: "Ellipse" },
  { id: "eraser",  icon: Eraser,        title: "Eraser" },
];

const DRAW_COLORS = ["#e2e8f0", "#f87171", "#fb923c", "#facc15", "#4ade80", "#38bdf8", "#818cf8", "#e879f9"];
const DRAW_SIZES = [2, 4, 8, 16];

function renderStrokes(ctx, strokes) {
  const prev = ctx.globalCompositeOperation;
  for (const s of strokes) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (s.tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = s.width;
    } else {
      ctx.globalCompositeOperation = "source-over";
    }
    if (s.tool === "pen" || s.tool === "eraser") {
      if (!s.points || s.points.length < 1) continue;
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
      ctx.stroke();
    } else if (s.tool === "line") {
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
    } else if (s.tool === "rect") {
      ctx.strokeRect(s.x1, s.y1, s.x2 - s.x1, s.y2 - s.y1);
    } else if (s.tool === "circle") {
      const rx = Math.abs(s.x2 - s.x1) / 2, ry = Math.abs(s.y2 - s.y1) / 2;
      const cx = (s.x1 + s.x2) / 2, cy = (s.y1 + s.y2) / 2;
      if (rx < 1 || ry < 1) continue;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = prev;
}

export const CanvasContent = React.memo(function CanvasContent({
  containerOccurrence, itemsWithOccurrences, dispatch, socket, module, listDropRef,
  onDoubleClickBackground, ctxState, containerId, panelId, renderCard,
  showToolbar = false,
}) {
  const { isMobile } = useMobileDetect();
  const [drawTool, setDrawTool] = useState("select");
  const [drawColor, setDrawColor] = useState("#e2e8f0");
  const [drawSize, setDrawSize] = useState(2);
  const [strokes, setStrokes] = useState(() => containerOccurrence?.meta?.drawData || []);
  // Unified undo / redo. Each entry: { type, payload }
  //   "stroke-add"  — payload is the stroke object (push at end of `strokes`)
  //   "edge-add"    — payload is the edge object (push at end of `edges`)
  //   "edge-delete" — payload is the deleted edge (was removed from `edges`)
  // Undo pops the top, inverts, pushes onto redoStack; redo replays.
  // History does not persist server-side — fresh each session.
  const [history, setHistory] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  // Connection edges between cards. Persisted on the page occurrence's
  // meta.edges array. Each entry: { id, from: occurrenceId, to:
  // occurrenceId }. Rendered as bezier curves in an SVG layer inside
  // the world; pointer hit-tested for delete-on-click in connect mode.
  const [edges, setEdges] = useState(() => containerOccurrence?.meta?.edges || []);
  // In-progress connection drag (connect tool only): { fromOccId,
  // startX, startY, x, y } in world coords. Null when not dragging.
  const [connectDrag, setConnectDrag] = useState(null);
  // Tick that bumps when a card position changes so the SVG edge layer
  // re-reads card center coords. Cheap (a number); no DOM measurement
  // until render time.
  const [cardPosTick, setCardPosTick] = useState(0);
  // Local override — once user hides the toolbar with the in-toolbar button,
  // we collapse to a small "show" pill until they click it. Defaults to the
  // parent-passed showToolbar so this is opt-in.
  const [toolbarOpen, setToolbarOpen] = useState(showToolbar);
  useEffect(() => { setToolbarOpen(showToolbar); }, [showToolbar]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Viewport position + dimensions tracked for the minimap. Updates on scroll
  // and resize so the minimap reflects the current pan + visible window.
  const [viewportPos, setViewportPos] = useState({ x: 0, y: 0, w: 0, h: 0 });

  const canvasRef = useRef(null);
  const surfaceRef = useRef(null);
  const isDrawing = useRef(false);
  const currentPath = useRef([]);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  // Mirror edges into a ref so undo/redo can read the latest array
  // without depending on stale state captured by useCallback closures.
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  // Combined ref for surface so the parent's drop ref and our local ref both
  // attach to the same node.
  const setSurfaceRef = useCallback((el) => {
    surfaceRef.current = el;
    if (el) {
      prevScrollRef.current = { x: el.scrollLeft, y: el.scrollTop };
    }
    if (typeof listDropRef === "function") listDropRef(el);
    else if (listDropRef) listDropRef.current = el;
  }, [listDropRef]);

  // Resolve the viewport center target — bounding-box centroid of existing
  // cards if any, else world center. Used by snap-to-center AND initial
  // restore so "center" means the same thing in both places.
  const computeCenterTarget = useCallback(() => {
    const items = itemsWithOccurrences || [];
    const pts = items
      .map(({ occurrence: o }) => o?.meta)
      .filter(m => typeof m?.x === "number" && typeof m?.y === "number");
    if (pts.length === 0) return { x: CANVAS_WORLD_SIZE / 2, y: CANVAS_WORLD_SIZE / 2 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const m of pts) {
      if (m.x < minX) minX = m.x;
      if (m.x > maxX) maxX = m.x;
      if (m.y < minY) minY = m.y;
      if (m.y > maxY) maxY = m.y;
    }
    // Add a generous offset so the card's BODY (not just its top-left anchor)
    // appears centered — cards are typically 200-300px wide.
    return { x: (minX + maxX) / 2 + 120, y: (minY + maxY) / 2 + 60 };
  }, [itemsWithOccurrences]);

  const snapToCenter = useCallback((behavior = "smooth") => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const { x, y } = computeCenterTarget();
    surface.scrollTo({
      left: Math.max(0, x - surface.clientWidth / 2),
      top: Math.max(0, y - surface.clientHeight / 2),
      behavior,
    });
  }, [computeCenterTarget]);

  // Initial mount + occurrence switch — restore saved viewport position from
  // occurrence.meta.viewportX/Y if present, else center on cards (or world
  // center if no cards). Uses a ResizeObserver to retry once `clientWidth`
  // becomes nonzero — surface dimensions are 0 on first paint while the
  // parent flex layout measures, and a one-shot effect would miss that.
  const readyForSaveRef = useRef(false);
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    let didRestore = false;
    readyForSaveRef.current = false;
    const tryRestore = () => {
      if (didRestore) return;
      const s = surfaceRef.current;
      if (!s || !s.clientWidth || !s.clientHeight) return;
      didRestore = true;
      const savedX = containerOccurrence?.meta?.viewportX;
      const savedY = containerOccurrence?.meta?.viewportY;
      if (typeof savedX === "number" && typeof savedY === "number") {
        s.scrollLeft = savedX;
        s.scrollTop = savedY;
      } else {
        const { x, y } = computeCenterTarget();
        s.scrollLeft = Math.max(0, x - s.clientWidth / 2);
        s.scrollTop = Math.max(0, y - s.clientHeight / 2);
      }
      requestAnimationFrame(() => { readyForSaveRef.current = true; });
    };
    tryRestore();
    const obs = new ResizeObserver(() => tryRestore());
    obs.observe(surface);
    return () => obs.disconnect();
  }, [containerOccurrence?.id, computeCenterTarget]);

  // Persist viewport position on scroll (debounced) so navigating away +
  // back restores the same pan position. Skips saves until the initial
  // restore has settled (see readyForSaveRef above).
  const saveTimerRef = useRef(null);
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !containerOccurrence?.id) return;
    const onScroll = () => {
      if (!readyForSaveRef.current) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const s = surfaceRef.current;
        if (!s) return;
        CommitHelpers.updateOccurrence({
          dispatch, socket,
          occurrence: {
            ...containerOccurrence,
            meta: { ...(containerOccurrence.meta || {}), viewportX: s.scrollLeft, viewportY: s.scrollTop },
          },
          emit: true,
        });
      }, 600);
    };
    surface.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      surface.removeEventListener("scroll", onScroll);
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    };
  }, [containerOccurrence, dispatch, socket]);

  // Sync strokes when occurrence changes externally. Clear undo/redo on
  // occurrence switch — history is per-canvas and shouldn't bleed across
  // navigations.
  useEffect(() => {
    setStrokes(containerOccurrence?.meta?.drawData || []);
    setHistory([]);
    setRedoStack([]);
  }, [containerOccurrence?.id]);

  // Sync edges when occurrence changes externally (page switch, sibling
  // session edit). Skipped for in-flight connect drags so we don't snap
  // the user's drag back to the persisted state mid-drag.
  useEffect(() => {
    setEdges(containerOccurrence?.meta?.edges || []);
  }, [containerOccurrence?.id, containerOccurrence?.meta?.edges]);

  // Lazy cleanup of stale edges — drop entries whose endpoints no
  // longer exist as cards on this canvas. Runs whenever the rendered
  // card list changes (delete, drag-out, etc.). Persists back through
  // saveEdges only if something was actually orphaned, so canvases
  // with no orphans pay zero write cost. Bounded to occurrence-id
  // mismatches (not e.g. filter-hidden cards) because the canvas
  // doesn't filter — itemsWithOccurrences IS the full child list.
  useEffect(() => {
    if (!containerOccurrence?.id) return;
    const persisted = containerOccurrence?.meta?.edges || [];
    if (persisted.length === 0) return;
    const liveIds = new Set((itemsWithOccurrences || []).map(it => it.occurrence?.id).filter(Boolean));
    const kept = persisted.filter(ed => liveIds.has(ed.from) && liveIds.has(ed.to));
    if (kept.length !== persisted.length) {
      // Skip the history push — this is a passive cleanup, not a
      // user action, and it shouldn't crowd undo/redo.
      saveEdges(kept);
    }
  }, [containerOccurrence?.id, itemsWithOccurrences, saveEdges]);

  // Size the drawing canvas to the world size once on mount.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== CANVAS_WORLD_SIZE) canvas.width = CANVAS_WORLD_SIZE;
    if (canvas.height !== CANVAS_WORLD_SIZE) canvas.height = CANVAS_WORLD_SIZE;
    const ctx = canvas.getContext("2d");
    renderStrokes(ctx, strokesRef.current);
  }, []);

  // Re-render strokes on change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.width) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderStrokes(ctx, strokes);
  }, [strokes]);

  const getPos = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const saveStrokes = useCallback((newStrokes) => {
    setStrokes(newStrokes);
    if (containerOccurrence?.id) {
      // Patch shape is just { id, meta } — the spread-the-whole-
      // occurrence pattern was wasteful (large socket payload) and
      // could clobber a stale field on the occurrence if some other
      // session edited it between renders. updateOccurrence merges
      // partials so this is safe.
      CommitHelpers.updateOccurrence({ dispatch, socket,
        occurrence: {
          id: containerOccurrence.id,
          meta: { ...(containerOccurrence.meta || {}), drawData: newStrokes },
        },
        emit: true });
    }
  }, [containerOccurrence, dispatch, socket]);

  const saveEdges = useCallback((nextEdges) => {
    setEdges(nextEdges);
    if (containerOccurrence?.id) {
      // Same id+meta patch shape as saveStrokes — see comment there.
      CommitHelpers.updateOccurrence({ dispatch, socket,
        occurrence: {
          id: containerOccurrence.id,
          meta: { ...(containerOccurrence.meta || {}), edges: nextEdges },
        },
        emit: true });
    }
  }, [containerOccurrence, dispatch, socket]);

  // Unified undo: peek the most recent action and inverse it. Each
  // action type knows how to roll back its own payload. The reversed
  // entry is pushed onto redoStack so redo can re-apply.
  const undo = useCallback(() => {
    setHistory(h => {
      if (h.length === 0) return h;
      const last = h[h.length - 1];
      setRedoStack(r => [...r, last]);
      if (last.type === "stroke-add") {
        // Strokes are append-only; the most recent stroke is always at
        // the tail of strokes[]. Slice it off.
        saveStrokes(strokesRef.current.slice(0, -1));
      } else if (last.type === "edge-add") {
        saveEdges(edgesRef.current.filter(e => e.id !== last.payload.id));
      } else if (last.type === "edge-delete") {
        saveEdges([...edgesRef.current, last.payload]);
      }
      return h.slice(0, -1);
    });
  }, [saveStrokes, saveEdges]);

  // Unified redo: pop from redoStack, re-apply, push back onto history.
  const redo = useCallback(() => {
    setRedoStack(r => {
      if (r.length === 0) return r;
      const last = r[r.length - 1];
      setHistory(h => [...h, last]);
      if (last.type === "stroke-add") {
        saveStrokes([...strokesRef.current, last.payload]);
      } else if (last.type === "edge-add") {
        saveEdges([...edgesRef.current, last.payload]);
      } else if (last.type === "edge-delete") {
        saveEdges(edgesRef.current.filter(e => e.id !== last.payload.id));
      }
      return r.slice(0, -1);
    });
  }, [saveStrokes, saveEdges]);

  // Hit-test: given a viewport-space pointer event, return the
  // occurrence id of the card under the pointer (or null). Uses
  // document.elementFromPoint so the routine works regardless of
  // whether the card is an instance (data-occurrence-id) or a
  // container (data-occ-id). The SVG edge overlay is already
  // pointer-events:none at the layer level, so it doesn't shadow
  // cards even when edges are dense.
  const hitTestOccId = useCallback((clientX, clientY) => {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return null;
    const card = el.closest("[data-occurrence-id], [data-occ-id]");
    if (!card) return null;
    return card.getAttribute("data-occurrence-id") || card.getAttribute("data-occ-id") || null;
  }, []);

  // Force the SVG edge layer to refresh card centers when an occurrence
  // moves (drag-release writes meta.x/y → re-read on next tick). This
  // useEffect keys on the meta.x/y of any occurrence that's an edge
  // endpoint, so connecting two cards and moving one updates the curve.
  // Triggered by parent re-renders too — cheap when nothing has changed.
  const itemsKey = (itemsWithOccurrences || []).map(it => `${it.occurrence?.id}:${it.occurrence?.meta?.x}:${it.occurrence?.meta?.y}`).join("|");
  useEffect(() => { setCardPosTick(t => t + 1); }, [itemsKey]);

  // ─── Edge autoscroll state + classifier — declared BEFORE the pointer
  // handlers that depend on them. `onSurfacePointerMove` lists
  // `classifyEdges` in its useCallback dep array, which is evaluated at
  // declaration time; moving classifyEdges below the pointer handler put
  // the dep array in the temporal dead zone and crashed the canvas panel
  // at mount (minified: "can't access lexical declaration 'Ie' before
  // initialization"). Edge state is shared with both the pan handlers
  // (which paint edges during grab-pan) and the dragover autoscroll.
  const dxRef = useRef(0);
  const dyRef = useRef(0);
  const autoscrollTimerRef = useRef(null);
  const autoscrollIntervalRef = useRef(null);
  // Edge state per direction: 0 = off, 1 = blue (active / panning toward),
  // 2 = red (scroll hit the world boundary, can't go further).
  const [edgeHover, setEdgeHover] = useState({ top: 0, bottom: 0, left: 0, right: 0 });

  // Scroll-driven minimap visibility — true for ~900ms after the last scroll
  // event so a mouse-wheel / trackpad scroll surfaces the minimap and edge
  // bars (same affordance as grab-pan and dragover).
  const [isScrolling, setIsScrolling] = useState(false);
  const prevScrollRef = useRef({ x: 0, y: 0 });
  const scrollHideTimerRef = useRef(null);

  // Boundary-aware edge classification: given a "this direction is active"
  // flag per edge, paint red if the surface is already pinned at that side
  // of the world (max scroll reached), otherwise blue.
  const classifyEdges = useCallback((active) => {
    const surface = surfaceRef.current;
    if (!surface) return { top: 0, bottom: 0, left: 0, right: 0 };
    const maxX = Math.max(0, surface.scrollWidth - surface.clientWidth);
    const maxY = Math.max(0, surface.scrollHeight - surface.clientHeight);
    return {
      left:   active.left   ? (surface.scrollLeft <= 0    ? 2 : 1) : 0,
      right:  active.right  ? (surface.scrollLeft >= maxX ? 2 : 1) : 0,
      top:    active.top    ? (surface.scrollTop  <= 0    ? 2 : 1) : 0,
      bottom: active.bottom ? (surface.scrollTop  >= maxY ? 2 : 1) : 0,
    };
  }, []);

  const stopAutoscroll = useCallback(() => {
    if (autoscrollTimerRef.current) { clearTimeout(autoscrollTimerRef.current); autoscrollTimerRef.current = null; }
    if (autoscrollIntervalRef.current) { clearInterval(autoscrollIntervalRef.current); autoscrollIntervalRef.current = null; }
    dxRef.current = 0; dyRef.current = 0;
    setEdgeHover({ top: 0, bottom: 0, left: 0, right: 0 });
  }, []);

  // Grab / pan navigation — pointer drag on the surface moves scroll position.
  const panStateRef = useRef(null);
  const onSurfacePointerDown = useCallback((e) => {
    if (drawTool !== "grab") return;
    if (e.target?.closest?.("[data-dnd-handle], .module-drag-handle, button, input, textarea, [contenteditable]")) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    panStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startScrollLeft: surface.scrollLeft,
      startScrollTop: surface.scrollTop,
      pointerId: e.pointerId,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [drawTool]);

  const onSurfacePointerMove = useCallback((e) => {
    const state = panStateRef.current;
    if (!state) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    surface.scrollLeft = state.startScrollLeft - dx;
    surface.scrollTop = state.startScrollTop - dy;
    // Pan direction → edge bars on the side the world is being pulled toward.
    // Cursor moving right pans the content right (scroll decreases), so the
    // LEFT edge becomes visible — light up that edge. Red if pinned at 0.
    const active = {
      left:   dx > 8,
      right:  dx < -8,
      top:    dy > 8,
      bottom: dy < -8,
    };
    const next = classifyEdges(active);
    setEdgeHover(prev => {
      if (prev.top === next.top && prev.bottom === next.bottom && prev.left === next.left && prev.right === next.right) return prev;
      return next;
    });
  }, [classifyEdges]);

  const onSurfacePointerUp = useCallback((e) => {
    const state = panStateRef.current;
    if (!state) return;
    try { e.currentTarget.releasePointerCapture(state.pointerId); } catch (err) {}
    panStateRef.current = null;
    setEdgeHover({ top: 0, bottom: 0, left: 0, right: 0 });
  }, []);

  // Mouse-wheel / trackpad scroll on the surface should surface the minimap
  // + edge bars the same way grab-pan does: gives the user spatial awareness
  // of where they are inside the 4000×4000 world. The dragover autoscroll
  // path also fires onScroll (it programmatically nudges scrollLeft/Top), so
  // we bail when a pan or dragover is already driving edges — they own that
  // state and we'd just thrash it.
  const onSurfaceScroll = useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    // Don't fight the pan handler — it sets edges from pointer delta which is
    // strictly better-signal than scroll delta during a drag.
    if (panStateRef.current) return;
    const sx = surface.scrollLeft;
    const sy = surface.scrollTop;
    const dx = sx - prevScrollRef.current.x;
    const dy = sy - prevScrollRef.current.y;
    prevScrollRef.current = { x: sx, y: sy };
    // Only paint edges when the scroll actually moved (filter rounding noise).
    const active = {
      left:   dx < -2,
      right:  dx >  2,
      top:    dy < -2,
      bottom: dy >  2,
    };
    if (active.left || active.right || active.top || active.bottom) {
      setEdgeHover(classifyEdges(active));
    }
    setIsScrolling(true);
    if (scrollHideTimerRef.current) clearTimeout(scrollHideTimerRef.current);
    scrollHideTimerRef.current = setTimeout(() => {
      setIsScrolling(false);
      // Clear edge bars too — but only if we still own them (no pan / dragover
      // started in the meantime).
      if (!panStateRef.current && !autoscrollIntervalRef.current) {
        setEdgeHover({ top: 0, bottom: 0, left: 0, right: 0 });
      }
    }, 900);
  }, [classifyEdges]);

  // Drawing pointer events — only when a draw tool is active. Run on the world
  // div (not the surface) so coordinates map to world space directly.
  const onWorldPointerDown = useCallback((e) => {
    if (drawTool === "select" || drawTool === "grab") return;
    if (e.target?.closest?.("[data-dnd-handle]")) return;
    // Connect tool: begin an edge from the card under the pointer. If
    // no card is hit, do nothing (clicking empty space in connect mode
    // is a no-op so the user doesn't accidentally start a draw).
    if (drawTool === "connect") {
      const fromOccId = hitTestOccId(e.clientX, e.clientY);
      if (!fromOccId) return;
      e.stopPropagation();
      const pos = getPos(e);
      setConnectDrag({ fromOccId, startX: pos.x, startY: pos.y, x: pos.x, y: pos.y });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    e.stopPropagation();
    isDrawing.current = true;
    currentPath.current = [getPos(e)];
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [drawTool, getPos, hitTestOccId]);

  const onWorldPointerMove = useCallback((e) => {
    // Connect tool: update the in-flight edge endpoint to the current
    // pointer. Render runs inline in the SVG layer so we just patch state.
    if (drawTool === "connect" && connectDrag) {
      const pos = getPos(e);
      setConnectDrag(d => d ? { ...d, x: pos.x, y: pos.y } : d);
      return;
    }
    if (!isDrawing.current) return;
    const pos = getPos(e);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderStrokes(ctx, strokesRef.current);
    // Live preview of current stroke
    ctx.strokeStyle = drawTool === "eraser" ? "rgba(200,200,200,0.4)" : drawColor;
    ctx.lineWidth = drawTool === "eraser" ? drawSize * 3 : drawSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = drawTool === "eraser" ? "destination-out" : "source-over";
    if (drawTool === "pen" || drawTool === "eraser") {
      currentPath.current.push(pos);
      ctx.beginPath();
      ctx.moveTo(currentPath.current[0].x, currentPath.current[0].y);
      for (let i = 1; i < currentPath.current.length; i++) ctx.lineTo(currentPath.current[i].x, currentPath.current[i].y);
      ctx.stroke();
    } else {
      const s = currentPath.current[0];
      if (drawTool === "line") {
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      } else if (drawTool === "rect") {
        ctx.strokeRect(s.x, s.y, pos.x - s.x, pos.y - s.y);
      } else if (drawTool === "circle") {
        const rx = Math.abs(pos.x - s.x) / 2, ry = Math.abs(pos.y - s.y) / 2;
        const cx = (s.x + pos.x) / 2, cy = (s.y + pos.y) / 2;
        if (rx > 0 && ry > 0) { ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke(); }
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }, [drawTool, drawColor, drawSize, getPos, connectDrag]);

  const onWorldPointerUp = useCallback((e) => {
    // Connect tool: drop endpoint on the target card. If the drop lands
    // on a different card, persist a new edge. Same-card drops + drops
    // on empty space discard the drag silently.
    if (drawTool === "connect" && connectDrag) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
      const toOccId = hitTestOccId(e.clientX, e.clientY);
      if (toOccId && toOccId !== connectDrag.fromOccId) {
        // Dedup — don't add the same edge twice in either direction.
        const exists = edges.some(ed =>
          (ed.from === connectDrag.fromOccId && ed.to === toOccId) ||
          (ed.from === toOccId && ed.to === connectDrag.fromOccId)
        );
        if (!exists) {
          const newEdge = { id: `e-${connectDrag.fromOccId}-${toOccId}-${Date.now()}`, from: connectDrag.fromOccId, to: toOccId };
          saveEdges([...edges, newEdge]);
          setHistory(h => [...h, { type: "edge-add", payload: newEdge }]);
          setRedoStack([]);
        }
      }
      setConnectDrag(null);
      return;
    }
    if (!isDrawing.current) return;
    isDrawing.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const pos = getPos(e);
    const s = currentPath.current[0];
    let newStroke;
    if (drawTool === "pen" || drawTool === "eraser") {
      newStroke = { tool: drawTool, color: drawColor, width: drawTool === "eraser" ? drawSize * 3 : drawSize, points: [...currentPath.current] };
    } else if (drawTool === "line") {
      newStroke = { tool: drawTool, color: drawColor, width: drawSize, x1: s.x, y1: s.y, x2: pos.x, y2: pos.y };
    } else if (drawTool === "rect") {
      newStroke = { tool: drawTool, color: drawColor, width: drawSize, x1: s.x, y1: s.y, x2: pos.x, y2: pos.y };
    } else if (drawTool === "circle") {
      newStroke = { tool: drawTool, color: drawColor, width: drawSize, x1: s.x, y1: s.y, x2: pos.x, y2: pos.y };
    }
    currentPath.current = [];
    if (newStroke) {
      // New stroke clears any pending redo branch and pushes onto the
      // unified undo history so Cmd-Z rolls back the most recent action
      // regardless of type.
      setRedoStack([]);
      setHistory(h => [...h, { type: "stroke-add", payload: newStroke }]);
      saveStrokes([...strokesRef.current, newStroke]);
    }
  }, [drawTool, drawColor, drawSize, getPos, saveStrokes, connectDrag, edges, hitTestOccId, saveEdges]);

  // dragover fires continuously while an item is being dragged over the
  // surface. When the pointer is within EDGE px of an edge we kick off a
  // ~400ms delay timer before starting the autoscroll interval — this stops
  // the canvas from pre-navigating when the user is just dragging a card OUT
  // toward the edge. The matching edge bar lights up immediately on hover (no
  // delay) so the user can see the affordance even before autoscroll engages.
  // (Edge state + classifyEdges are declared up top — see comment there.)
  const onSurfaceDragOver = useCallback((e) => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const EDGE = 60;
    const SPEED = 10;
    let dx = 0, dy = 0;
    const left = x >= 0 && x < EDGE;
    const right = x > rect.width - EDGE && x <= rect.width;
    const top = y >= 0 && y < EDGE;
    const bottom = y > rect.height - EDGE && y <= rect.height;
    if (left) dx = -SPEED;
    else if (right) dx = SPEED;
    if (top) dy = -SPEED;
    else if (bottom) dy = SPEED;

    dxRef.current = dx;
    dyRef.current = dy;

    // Update edge bars immediately for visual feedback (no delay) — only the
    // autoscroll itself has the 400ms grace. Classifier paints red if the
    // surface is already pinned at the world boundary in that direction.
    const next = classifyEdges({ top, bottom, left, right });
    setEdgeHover(prev => {
      if (prev.top === next.top && prev.bottom === next.bottom && prev.left === next.left && prev.right === next.right) return prev;
      return next;
    });

    if (dx === 0 && dy === 0) {
      if (autoscrollTimerRef.current) { clearTimeout(autoscrollTimerRef.current); autoscrollTimerRef.current = null; }
      if (autoscrollIntervalRef.current) { clearInterval(autoscrollIntervalRef.current); autoscrollIntervalRef.current = null; }
      return;
    }
    if (autoscrollIntervalRef.current || autoscrollTimerRef.current) return;
    autoscrollTimerRef.current = setTimeout(() => {
      autoscrollTimerRef.current = null;
      autoscrollIntervalRef.current = setInterval(() => {
        const s = surfaceRef.current;
        if (!s) return;
        s.scrollLeft += dxRef.current;
        s.scrollTop += dyRef.current;
      }, 16);
    }, 400);
  }, [classifyEdges]);

  const onSurfaceDragLeave = useCallback((e) => {
    const surface = surfaceRef.current;
    if (!surface) return;
    if (!surface.contains(e.relatedTarget)) stopAutoscroll();
  }, [stopAutoscroll]);

  // Cleanup on unmount
  useEffect(() => () => stopAutoscroll(), [stopAutoscroll]);

  // Track viewport scroll + size for the minimap. Single subscription that
  // refreshes both on scroll and on surface resize.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const update = () => {
      setViewportPos({
        x: surface.scrollLeft,
        y: surface.scrollTop,
        w: surface.clientWidth,
        h: surface.clientHeight,
      });
    };
    update();
    surface.addEventListener("scroll", update, { passive: true });
    const obs = new ResizeObserver(update);
    obs.observe(surface);
    return () => { surface.removeEventListener("scroll", update); obs.disconnect(); };
  }, []);

  const effectiveContainerId = containerId || module?.id;
  // canUndo/canRedo come from the unified history (strokes + edges).
  // Was previously gated on strokes.length, which left undo grayed-out
  // for canvases that only had edge actions.
  const canUndo = history.length > 0;
  const canRedo = redoStack.length > 0;

  // Per-tool cursor for the surface — grab/grabbing for pan, otherwise based
  // on draw tool.
  const surfaceCursor = drawTool === "grab"
    ? (panStateRef.current ? "grabbing" : "grab")
    : drawTool === "select" ? "default"
    : drawTool === "connect" ? "crosshair"
    : drawTool === "eraser" ? "cell"
    : "crosshair";

  // ─── Minimap ─────────────────────────────────────────────────────────────
  // Visible when the grab tool is active OR an edge bar is showing (drag-
  // hover or pan). Click on the minimap recentres the viewport on that
  // world-coord point.
  const MINIMAP_SIZE = 120;
  const minimapScale = MINIMAP_SIZE / CANVAS_WORLD_SIZE;
  // Coerce to boolean — edgeHover values are 0/1/2 (not booleans). Without
  // !! the JSX guard `{showMinimap && (...)}` would render the literal `0`
  // as text when all edge values are 0 and drawTool isn't "grab". `isScrolling`
  // makes the minimap appear on plain mouse-wheel / trackpad scroll too.
  const showMinimap = !!(
    drawTool === "grab" ||
    isScrolling ||
    edgeHover.top || edgeHover.bottom || edgeHover.left || edgeHover.right
  );
  const handleMinimapClick = useCallback((e) => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const worldX = px / minimapScale;
    const worldY = py / minimapScale;
    surface.scrollTo({
      left: Math.max(0, worldX - surface.clientWidth / 2),
      top: Math.max(0, worldY - surface.clientHeight / 2),
      behavior: "smooth",
    });
  }, [minimapScale]);

  // ─── Toolbar content — shared between desktop bar + mobile dropdown ──────
  const toolButtons = (
    <div className="canvas-toolbar-group">
      {DRAW_TOOLS.map(t => (
        <button key={t.id} title={t.title} onClick={() => { setDrawTool(t.id); setMobileMenuOpen(false); }}
          style={{ background: drawTool === t.id ? "rgba(99,102,241,0.25)" : "none", border: drawTool === t.id ? "1px solid rgba(99,102,241,0.5)" : "1px solid transparent", borderRadius: 5, padding: "3px 5px", cursor: "pointer", color: drawTool === t.id ? "#818cf8" : "var(--text-muted)", display: "flex", alignItems: "center" }}>
          <t.icon style={{ width: 13, height: 13 }} />
        </button>
      ))}
    </div>
  );
  const colorSwatches = (
    <div className="canvas-toolbar-group">
      {DRAW_COLORS.map(c => (
        <button key={c} onClick={() => { setDrawColor(c); if (drawTool === "select" || drawTool === "grab") setDrawTool("pen"); }}
          title={c}
          style={{ width: 14, height: 14, borderRadius: "50%", background: c, border: drawColor === c ? "2px solid #818cf8" : "1px solid rgba(255,255,255,0.15)", cursor: "pointer", padding: 0, flexShrink: 0 }} />
      ))}
    </div>
  );
  const sizeButtons = (
    <div className="canvas-toolbar-group">
      {DRAW_SIZES.map(sz => (
        <button key={sz} onClick={() => setDrawSize(sz)}
          title={`${sz}px`}
          style={{ background: drawSize === sz ? "rgba(99,102,241,0.2)" : "none", border: drawSize === sz ? "1px solid rgba(99,102,241,0.4)" : "1px solid transparent", borderRadius: 4, padding: "2px 5px", cursor: "pointer", color: "var(--text-muted)", fontSize: 9, fontFamily: "var(--font-mono)" }}>
          {sz}
        </button>
      ))}
    </div>
  );
  const historyButtons = (
    <div className="canvas-toolbar-group">
      <button onClick={undo} disabled={!canUndo} title="Undo last action (stroke or edge)"
        style={{ background: "none", border: "1px solid transparent", borderRadius: 5, padding: "3px 5px", cursor: canUndo ? "pointer" : "not-allowed", color: canUndo ? "var(--text-muted)" : "var(--text-faint)", display: "flex", alignItems: "center", opacity: canUndo ? 1 : 0.4 }}>
        <Undo2 style={{ width: 12, height: 12 }} />
      </button>
      <button onClick={redo} disabled={!canRedo} title="Redo"
        style={{ background: "none", border: "1px solid transparent", borderRadius: 5, padding: "3px 5px", cursor: canRedo ? "pointer" : "not-allowed", color: canRedo ? "var(--text-muted)" : "var(--text-faint)", display: "flex", alignItems: "center", opacity: canRedo ? 1 : 0.4 }}>
        <Redo2 style={{ width: 12, height: 12 }} />
      </button>
    </div>
  );
  const centerButton = (
    <div className="canvas-toolbar-group">
      <button onClick={() => { snapToCenter(); setMobileMenuOpen(false); }} title="Snap view to center"
        style={{ background: "none", border: "1px solid transparent", borderRadius: 5, padding: "3px 5px", cursor: "pointer", color: "var(--text-muted)", display: "flex", alignItems: "center" }}>
        <Crosshair style={{ width: 12, height: 12 }} />
      </button>
    </div>
  );

  const sep = <div style={{ width: 1, height: 18, background: "var(--border-subtle)", margin: "0 2px" }} />;

  // ─── Edge geometry ─────────────────────────────────────────────────────
  // Card center for edge anchoring. Tries the DOM rect first so tall
  // containers (200+px) anchor at their visual center, not 30px below
  // their top. World coords come from subtracting the world div's
  // viewport rect from the card's — both are bounding-client rects so
  // scroll cancels out. Falls back to fixed (CARD_W, CARD_H) when the
  // card isn't in the DOM yet (mid-paste, off-screen render, etc.).
  //
  // The query is scoped to surfaceRef so we never accidentally hit a
  // matching card in another canvas page mounted elsewhere.
  // `cardPosTick` (bumped by the itemsKey effect) forces this to
  // recompute when meta.x/y changes on any card.
  const CARD_W = 180;
  const CARD_H = 60;
  const cardCenterFor = (occId) => {
    if (!occId) return null;
    const surface = surfaceRef.current;
    const worldEl = surface?.querySelector(".canvas-world");
    if (worldEl) {
      // CSS.escape so UUIDs / odd characters don't break the selector.
      const sel = `[data-occurrence-id="${CSS.escape(occId)}"], [data-occ-id="${CSS.escape(occId)}"]`;
      const cardEl = worldEl.querySelector(sel);
      if (cardEl) {
        const wRect = worldEl.getBoundingClientRect();
        const cRect = cardEl.getBoundingClientRect();
        return {
          x: cRect.left - wRect.left + cRect.width / 2,
          y: cRect.top - wRect.top + cRect.height / 2,
        };
      }
    }
    // Fallback: meta-based estimate. Used pre-mount and during DnD
    // when the card briefly detaches.
    const it = (itemsWithOccurrences || []).find(x => x.occurrence?.id === occId);
    if (!it) return null;
    const m = it.occurrence?.meta || {};
    const x = typeof m.x === "number" ? m.x : 40;
    const y = typeof m.y === "number" ? m.y : 40;
    return { x: x + CARD_W / 2, y: y + CARD_H / 2 };
  };
  // Bezier path between two world points — gentle horizontal control
  // points so curves feel like wires, not straight lines.
  const edgePath = (a, b) => {
    if (!a || !b) return "";
    const dx = Math.abs(b.x - a.x);
    const offset = Math.max(40, dx * 0.4);
    return `M ${a.x} ${a.y} C ${a.x + offset} ${a.y}, ${b.x - offset} ${b.y}, ${b.x} ${b.y}`;
  };
  const handleEdgeClick = (edgeId) => {
    if (drawTool !== "connect") return;
    const removed = edges.find(e => e.id === edgeId);
    saveEdges(edges.filter(e => e.id !== edgeId));
    if (removed) {
      setHistory(h => [...h, { type: "edge-delete", payload: removed }]);
      setRedoStack([]);
    }
  };
  // Suppress the lint warning about cardPosTick — its purpose is to
  // force a re-render of the SVG layer when an upstream card moves.
  void cardPosTick;

  return (
    <div
      data-container-id={effectiveContainerId}
      style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, position: "relative" }}
    >
      {/* Toolbar — desktop horizontal bar, hidden when collapsed */}
      {showToolbar && toolbarOpen && !isMobile && (
        <div className="canvas-toolbar canvas-toolbar-desktop" onPointerDown={e => e.stopPropagation()}>
          {toolButtons}
          {sep}
          {colorSwatches}
          {sep}
          {sizeButtons}
          {sep}
          {historyButtons}
          {sep}
          {centerButton}
          <button onClick={() => setToolbarOpen(false)} title="Hide toolbar"
            style={{ marginLeft: "auto", background: "none", border: "1px solid transparent", borderRadius: 5, padding: "3px 5px", cursor: "pointer", color: "var(--text-faint)", display: "flex", alignItems: "center" }}>
            <ChevronUp style={{ width: 12, height: 12 }} />
          </button>
        </div>
      )}

      {/* Toolbar — mobile collapsed dropdown button + popout panel */}
      {showToolbar && toolbarOpen && isMobile && (
        <>
          <div className="canvas-toolbar canvas-toolbar-mobile" onPointerDown={e => e.stopPropagation()}>
            {/* Only the snap-to-center button is always-visible on mobile;
                everything else lives in the dropdown so we keep the top edge
                tidy on small screens. */}
            {centerButton}
            <button onClick={() => setMobileMenuOpen(v => !v)} title="Toolbar"
              style={{ marginLeft: "auto", background: mobileMenuOpen ? "rgba(99,102,241,0.18)" : "none", border: "1px solid transparent", borderRadius: 5, padding: "3px 6px", cursor: "pointer", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontFamily: "var(--font-mono)" }}>
              <Pencil style={{ width: 11, height: 11 }} />
              <ChevronDown style={{ width: 11, height: 11, transform: mobileMenuOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
            </button>
          </div>
          {mobileMenuOpen && (
            <div className="canvas-toolbar-dropdown" onPointerDown={e => e.stopPropagation()}>
              <div className="canvas-toolbar-dropdown-row">{toolButtons}</div>
              <div className="canvas-toolbar-dropdown-row">{colorSwatches}</div>
              <div className="canvas-toolbar-dropdown-row">{sizeButtons}</div>
              <div className="canvas-toolbar-dropdown-row">{historyButtons}</div>
            </div>
          )}
        </>
      )}

      {/* Collapsed-toolbar affordance — small pencil pill to re-open. */}
      {showToolbar && !toolbarOpen && (
        <div style={{ position: "absolute", top: 6, right: 6, zIndex: 20 }} onPointerDown={e => e.stopPropagation()}>
          <button onClick={() => setToolbarOpen(true)} title="Show draw toolbar"
            style={{ background: "var(--surface-overlay)", border: "1px solid var(--border-subtle)", borderRadius: 999, padding: "3px 8px", cursor: "pointer", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontFamily: "var(--font-mono)" }}>
            <Pencil style={{ width: 11, height: 11 }} />
            Tools
          </button>
        </div>
      )}

      {/* Minimap — bottom-left overview of the world. Only visible during pan
          (grab tool) or drag-over. Click anywhere in the minimap to recentre
          the viewport on that world point. */}
      {showMinimap && (
        <div className="canvas-minimap" onPointerDown={(e) => e.stopPropagation()}>
          <svg
            width={MINIMAP_SIZE}
            height={MINIMAP_SIZE}
            onClick={handleMinimapClick}
            style={{ display: "block", cursor: "crosshair" }}
          >
            <rect x={0} y={0} width={MINIMAP_SIZE} height={MINIMAP_SIZE} fill="rgba(11,18,38,0.92)" stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
            {/* Card dots */}
            {(itemsWithOccurrences || []).map(({ occurrence: o }) => {
              const mx = o?.meta?.x;
              const my = o?.meta?.y;
              if (typeof mx !== "number" || typeof my !== "number") return null;
              const cx = mx * minimapScale;
              const cy = my * minimapScale;
              if (cx < 0 || cy < 0 || cx > MINIMAP_SIZE || cy > MINIMAP_SIZE) return null;
              return <circle key={o.id} cx={cx} cy={cy} r={1.8} fill="rgba(134,239,172,0.85)" />;
            })}
            {/* Current viewport rectangle */}
            <rect
              x={viewportPos.x * minimapScale}
              y={viewportPos.y * minimapScale}
              width={Math.max(2, viewportPos.w * minimapScale)}
              height={Math.max(2, viewportPos.h * minimapScale)}
              fill="rgba(129,140,248,0.12)"
              stroke="rgba(129,140,248,0.85)"
              strokeWidth={1.2}
            />
          </svg>
        </div>
      )}
      {/* Edge bars — sticky to the surface viewport (not the world). Light up
          on dragover edge zones AND while grab-panning in that direction.
          State value 1 = blue (can scroll further); 2 = red (pinned at world
          boundary, can't pan that way). */}
      {!!(edgeHover.top || edgeHover.bottom || edgeHover.left || edgeHover.right) && (
        <>
          {edgeHover.top    ? <div className={`canvas-edge-bar canvas-edge-top    ${edgeHover.top    === 2 ? "canvas-edge-blocked" : ""}`} /> : null}
          {edgeHover.bottom ? <div className={`canvas-edge-bar canvas-edge-bottom ${edgeHover.bottom === 2 ? "canvas-edge-blocked" : ""}`} /> : null}
          {edgeHover.left   ? <div className={`canvas-edge-bar canvas-edge-left   ${edgeHover.left   === 2 ? "canvas-edge-blocked" : ""}`} /> : null}
          {edgeHover.right  ? <div className={`canvas-edge-bar canvas-edge-right  ${edgeHover.right  === 2 ? "canvas-edge-blocked" : ""}`} /> : null}
        </>
      )}
      {/* Surface — viewport that scrolls over the world. Receives drop events
          (listDropRef), pan pointer events, and drag-edge autoscroll. */}
      <div
        ref={setSurfaceRef}
        className="canvas-surface"
        style={{ flex: 1, position: "relative", overflow: "auto", background: "var(--surface-overlay)", minHeight: 200,
          cursor: surfaceCursor,
          touchAction: drawTool === "select" || drawTool === "grab" ? "auto" : "none",
        }}
        onPointerDown={onSurfacePointerDown}
        onPointerMove={onSurfacePointerMove}
        onPointerUp={onSurfacePointerUp}
        onPointerCancel={onSurfacePointerUp}
        onDragOver={onSurfaceDragOver}
        onDragLeave={onSurfaceDragLeave}
        onDrop={stopAutoscroll}
        onScroll={onSurfaceScroll}
      >
        {/* World — fixed huge size; pan moves scroll of the surface */}
        <div
          className="canvas-world"
          style={{
            position: "relative",
            width: CANVAS_WORLD_SIZE,
            height: CANVAS_WORLD_SIZE,
            backgroundImage: "radial-gradient(circle, var(--border-subtle) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
          onDoubleClick={(e) => { if (drawTool === "select") onDoubleClickBackground?.(e); }}
          onPointerDown={onWorldPointerDown}
          onPointerMove={onWorldPointerMove}
          onPointerUp={onWorldPointerUp}
        >
          {/* Drawing canvas overlay — sized to world; pointer-events disabled
              so drag-and-drop events reach the world / cards. */}
          <canvas
            ref={canvasRef}
            style={{
              position: "absolute", inset: 0, width: CANVAS_WORLD_SIZE, height: CANVAS_WORLD_SIZE,
              pointerEvents: "none",
              zIndex: drawTool === "select" || drawTool === "grab" ? 0 : 10,
            }}
          />
          {/* Edge overlay — SVG sized to the world. Sits BETWEEN the
              drawing canvas and the floating cards (zIndex 2). Pointer
              events are off by default; individual edge paths re-enable
              them so they can be clicked for deletion in connect mode. */}
          <svg
            style={{
              position: "absolute", inset: 0, width: CANVAS_WORLD_SIZE, height: CANVAS_WORLD_SIZE,
              pointerEvents: "none", zIndex: 2,
            }}
          >
            {edges.map((ed) => {
              const a = cardCenterFor(ed.from);
              const b = cardCenterFor(ed.to);
              if (!a || !b) return null;
              const isHot = drawTool === "connect";
              return (
                <g key={ed.id}>
                  {/* Wide invisible hit path so click targeting is forgiving */}
                  <path
                    d={edgePath(a, b)}
                    stroke="transparent"
                    strokeWidth={16}
                    fill="none"
                    style={{ pointerEvents: isHot ? "stroke" : "none", cursor: isHot ? "pointer" : "default" }}
                    onClick={(e) => { e.stopPropagation(); handleEdgeClick(ed.id); }}
                  />
                  <path
                    d={edgePath(a, b)}
                    stroke="rgba(129,140,248,0.85)"
                    strokeWidth={2}
                    fill="none"
                    style={{ pointerEvents: "none" }}
                  />
                </g>
              );
            })}
            {/* In-progress connect drag — light, dashed feedback line */}
            {connectDrag && (() => {
              const a = cardCenterFor(connectDrag.fromOccId);
              if (!a) return null;
              return (
                <path
                  d={edgePath(a, { x: connectDrag.x, y: connectDrag.y })}
                  stroke="rgba(129,140,248,0.7)"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  fill="none"
                  style={{ pointerEvents: "none" }}
                />
              );
            })()}
          </svg>
          {/* Floating module cards (instances or embedded containers) */}
          {itemsWithOccurrences.map(({ module: mod, occurrence: occ }) =>
            renderCard && renderCard({
              module: mod,
              occurrence: occ,
              style: {
                zIndex: drawTool === "select" || drawTool === "grab" ? 1 : 5,
                // Connect mode keeps cards pointer-active so elementFromPoint
                // hit-tests find them on press / release; the cards' own
                // event handlers are still inert because the world's
                // pointer handlers stopPropagation in connect mode.
                pointerEvents:
                  drawTool === "select" || drawTool === "grab" || drawTool === "connect"
                    ? "all"
                    : "none",
              },
              containerId,
              panelId,
            })
          )}
          {itemsWithOccurrences.length === 0 && drawTool === "select" && (
            <div style={{ position: "absolute", top: CANVAS_WORLD_SIZE / 2, left: CANVAS_WORLD_SIZE / 2, transform: "translate(-50%,-50%)", fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-mono)", pointerEvents: "none", textAlign: "center", lineHeight: 1.6 }}>
              Double-click to add cards<br />or pick a draw tool above
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

// Named alias for backward compatibility with containerHelpers.jsx imports
export const CanvasDrawSection = CanvasContent;

export default CanvasContent;
