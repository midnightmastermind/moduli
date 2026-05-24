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
import { MousePointer2, Hand, Pencil, Highlighter, PaintBucket, Square, Circle, Minus, Eraser, Undo2, Redo2, ChevronUp, ChevronDown, Crosshair, Link2, Type } from "lucide-react";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { useMobileDetect } from "../hooks/useMobileDetect";

// World size — large enough to feel expansive but small enough that canvas
// rendering and scroll math stay snappy.
const CANVAS_WORLD_SIZE = 4000;

// ============================================================
// CANVAS DRAW SECTION — draw toolbar + HTML5 canvas overlay + floating cards
// ============================================================
// Drawing-mode tools — left-to-right. Select + grab are split off as
// TRAILING_TOOLS so they render on the right side of the toolbar next
// to the center button (per #5 spec: "move the Select/Hand tool to the
// right side of the toolbar next to the center").
const DRAW_TOOLS = [
  { id: "connect",     icon: Link2,         title: "Connect cards (drag card → card)" },
  { id: "rect-link",   icon: Square,        title: "Linked rectangle — groups occurrences inside as children" },
  { id: "circle-link", icon: Circle,        title: "Linked ellipse — groups occurrences inside as children" },
  { id: "pen",         icon: Pencil,        title: "Freehand pen — crisp thin lines" },
  { id: "marker",      icon: Highlighter,   title: "Marker — thicker, semi-transparent" },
  { id: "fill",        icon: PaintBucket,   title: "Fill canvas background with current color" },
  { id: "line",        icon: Minus,         title: "Straight line" },
  { id: "rect",        icon: Square,        title: "Rectangle (visual only)" },
  { id: "circle",      icon: Circle,        title: "Ellipse (visual only)" },
  { id: "eraser",      icon: Eraser,        title: "Eraser" },
];
const TRAILING_TOOLS = [
  { id: "grab",    icon: Hand,          title: "Grab to pan" },
  { id: "select",  icon: MousePointer2, title: "Select / move cards" },
];

const DRAW_COLORS = ["#e2e8f0", "#f87171", "#fb923c", "#facc15", "#4ade80", "#38bdf8", "#818cf8", "#e879f9"];
const DRAW_SIZES = [2, 4, 8, 16];

function renderStrokes(ctx, strokes) {
  const prev = ctx.globalCompositeOperation;
  const prevAlpha = ctx.globalAlpha;
  for (const s of strokes) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = 1;
    if (s.tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = s.width;
    } else if (s.tool === "marker") {
      // Marker — semi-transparent + multiply blend so overlapping strokes
      // darken naturally like a real highlighter / brush.
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 0.55;
    } else {
      ctx.globalCompositeOperation = "source-over";
    }
    if (s.tool === "fill") {
      // Fill stroke is a full-canvas color wash committed at fire time.
      ctx.fillStyle = s.color;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      continue;
    }
    if (s.tool === "pen" || s.tool === "marker" || s.tool === "eraser") {
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
  ctx.globalAlpha = prevAlpha;
}

// Inline-rename row for a canvas layer in the layers dropdown. Single
// click → set active; double-click → enter rename mode; Enter / blur
// commits, Escape cancels. Per #51 layer system follow-up.
function LayerNameInput({ layer, fallbackName, onSelect, onRename }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(layer?.name || fallbackName || "");
  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { onRename?.(draft.trim() || fallbackName); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { setDraft(layer?.name || fallbackName); setEditing(false); }
        }}
        style={{
          flex: 1, padding: "1px 4px", borderRadius: 3,
          background: "var(--input-bg)", border: "1px solid var(--input-border)",
          color: "var(--text-primary)", fontSize: 10, fontFamily: "var(--font-mono)", outline: "none",
        }}
      />
    );
  }
  return (
    <button
      title="Click to set active · Double-click to rename"
      onClick={onSelect}
      onDoubleClick={() => { setDraft(layer?.name || fallbackName); setEditing(true); }}
      style={{ flex: 1, textAlign: "left", background: "none", border: "none", padding: "1px 3px", cursor: "pointer", color: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
    >
      {layer?.name || fallbackName}
    </button>
  );
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
  // Canvas layers (task #51 follow-up). Each layer has an id, name,
  // visibility flag. Strokes carry an optional `layerId` — strokes
  // without one are treated as belonging to the default layer (so
  // pre-layer canvases keep rendering). The active layer is where new
  // strokes land. Persisted on `containerOccurrence.meta.layers`.
  const DEFAULT_LAYER = { id: "default", name: "Layer 1", visible: true };
  const [layers, setLayers] = useState(() => {
    const stored = containerOccurrence?.meta?.layers;
    if (Array.isArray(stored) && stored.length > 0) return stored;
    return [DEFAULT_LAYER];
  });
  const [activeLayerId, setActiveLayerId] = useState(() => {
    const stored = containerOccurrence?.meta?.layers;
    if (Array.isArray(stored) && stored.length > 0) return stored[0].id;
    return "default";
  });
  const [layersOpen, setLayersOpen] = useState(false);
  // Linked shapes (#5 spec — linked-rect / linked-circle). Each entry:
  //   { id, kind: "rect"|"circle", x1, y1, x2, y2 }
  // Persisted on containerOccurrence.meta.linkedShapes. Children are
  // computed at render time: any occurrence whose card center sits
  // inside the shape's bbox. Auto-rendered with fainter connection
  // lines from the shape's center to each child.
  const [linkedShapes, setLinkedShapes] = useState(
    () => containerOccurrence?.meta?.linkedShapes || []
  );
  // In-progress linked-shape draw (rect-link / circle-link tools).
  // { kind, x1, y1, x2, y2 } in world coords. Null when not drawing.
  const [shapeDraft, setShapeDraft] = useState(null);
  // Group-drag state (#5 spec line 628): pointer-pressed on a linked
  // shape with the select tool → drag → both the shape AND every
  // contained occurrence (snapshotted at drag-start) move by the same
  // delta. Shape: { shapeId, startX, startY, dx, dy, children: [{occId, x, y}] }.
  // Children move on RELEASE (avoid socket spam during the drag).
  const [shapeDragMove, setShapeDragMove] = useState(null);
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
  // Endpoint-drag state (task #5 link tools follow-up). When the user
  // pointer-presses an edge endpoint ball with the select tool, this
  // tracks the drag; on pointer-up we re-target the endpoint to the
  // occurrence under the cursor (or cancel if dropped on empty space).
  // Shape: { edgeId, endpoint: "from"|"to", x, y } in world coords.
  const [edgeDrag, setEdgeDrag] = useState(null);
  // Edge midpoint drag — re-shape the bezier curve by dragging the
  // midpoint ball (select tool). Persists as `edge.cpOffset = {dx, dy}`.
  // Shape: { edgeId, startX, startY, dx, dy }.
  const [edgeCurveDrag, setEdgeCurveDrag] = useState(null);
  // Edge label inline editor (#5 follow-up: typed labels on edges,
  // foundation for the LATER "link data semantics" item). Click an
  // existing label in select mode → inline input; commit on blur/enter.
  // Shape: { edgeId, draft } | null
  const [edgeLabelEdit, setEdgeLabelEdit] = useState(null);
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

  // Strokes filtered by visible layers. Layer-less strokes (pre-layers
  // canvases or strokes drawn before the layer was added) always show.
  const visibleLayerIds = useMemo(() => {
    const set = new Set();
    for (const l of layers) {
      if (l?.visible !== false) set.add(l.id);
    }
    return set;
  }, [layers]);
  const visibleStrokes = useMemo(() => {
    return strokes.filter(s => !s.layerId || visibleLayerIds.has(s.layerId));
  }, [strokes, visibleLayerIds]);

  // Size the drawing canvas to the world size once on mount.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== CANVAS_WORLD_SIZE) canvas.width = CANVAS_WORLD_SIZE;
    if (canvas.height !== CANVAS_WORLD_SIZE) canvas.height = CANVAS_WORLD_SIZE;
    const ctx = canvas.getContext("2d");
    renderStrokes(ctx, visibleStrokes);
  }, []);

  // Re-render strokes on change (filter by visible layers).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.width) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderStrokes(ctx, visibleStrokes);
  }, [visibleStrokes]);

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

  const saveLinkedShapes = useCallback((next) => {
    setLinkedShapes(next);
    if (containerOccurrence?.id) {
      CommitHelpers.updateOccurrence({ dispatch, socket,
        occurrence: {
          id: containerOccurrence.id,
          meta: { ...(containerOccurrence.meta || {}), linkedShapes: next },
        },
        emit: true });
    }
  }, [containerOccurrence, dispatch, socket]);

  const saveLayers = useCallback((nextLayers) => {
    setLayers(nextLayers);
    if (containerOccurrence?.id) {
      CommitHelpers.updateOccurrence({ dispatch, socket,
        occurrence: {
          id: containerOccurrence.id,
          meta: { ...(containerOccurrence.meta || {}), layers: nextLayers },
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

  // Lazy cleanup of stale edges — drop entries whose endpoints no
  // longer exist as cards on this canvas. Runs whenever the rendered
  // card list changes (delete, drag-out, etc.). Persists back through
  // saveEdges only if something was actually orphaned, so canvases
  // with no orphans pay zero write cost. Bounded to occurrence-id
  // mismatches (not e.g. filter-hidden cards) because the canvas
  // doesn't filter — itemsWithOccurrences IS the full child list.
  //
  // Lives AFTER saveEdges' declaration: useEffect's deps array (which
  // references saveEdges) is evaluated synchronously during render, so
  // putting this above saveEdges' `const` declaration triggers a
  // temporal dead zone "can't access lexical declaration" crash on
  // mount. Same pattern as the classifyEdges note further down.
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
    // Linked-shape tools (#5): drag a rectangle / ellipse that persists
    // as a `linkedShape` entry. On release we add it to the persisted
    // linkedShapes; geometric containment + auto-connect render happens
    // each frame against the live shape bbox. When the active layer is
    // locked, suppress draw — matches stroke-commit behavior.
    if (drawTool === "rect-link" || drawTool === "circle-link") {
      const activeLayer = layers.find(l => l.id === activeLayerId);
      if (activeLayer?.locked) return;
      e.stopPropagation();
      const pos = getPos(e);
      const kind = drawTool === "circle-link" ? "circle" : "rect";
      setShapeDraft({ kind, x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    e.stopPropagation();
    isDrawing.current = true;
    currentPath.current = [getPos(e)];
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [drawTool, getPos, hitTestOccId, activeLayerId, layers]);

  const onWorldPointerMove = useCallback((e) => {
    // Connect tool: update the in-flight edge endpoint to the current
    // pointer. Render runs inline in the SVG layer so we just patch state.
    if (drawTool === "connect" && connectDrag) {
      const pos = getPos(e);
      setConnectDrag(d => d ? { ...d, x: pos.x, y: pos.y } : d);
      return;
    }
    // Edge endpoint re-snap (#5 follow-up): same pattern as connectDrag.
    if (edgeDrag) {
      const pos = getPos(e);
      setEdgeDrag(d => d ? { ...d, x: pos.x, y: pos.y } : d);
      return;
    }
    // Edge midpoint curve-drag.
    if (edgeCurveDrag) {
      const pos = getPos(e);
      setEdgeCurveDrag(d => d ? { ...d, dx: pos.x - d.startX, dy: pos.y - d.startY } : d);
      return;
    }
    // Linked-shape draft — update the bottom-right corner so the SVG
    // overlay can render a live preview rect / ellipse.
    if (shapeDraft) {
      const pos = getPos(e);
      setShapeDraft(d => d ? { ...d, x2: pos.x, y2: pos.y } : d);
      return;
    }
    // Linked-shape group-drag — track delta. Children commit on release.
    if (shapeDragMove) {
      const pos = getPos(e);
      setShapeDragMove(d => d ? { ...d, dx: pos.x - d.startX, dy: pos.y - d.startY } : d);
      return;
    }
    if (!isDrawing.current) return;
    const pos = getPos(e);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderStrokes(ctx, strokesRef.current);
    // Live preview of current stroke
    const prevAlpha = ctx.globalAlpha;
    ctx.strokeStyle = drawTool === "eraser" ? "rgba(200,200,200,0.4)" : drawColor;
    if (drawTool === "marker") {
      ctx.lineWidth = drawSize * 4;
      ctx.globalAlpha = 0.55;
    } else if (drawTool === "eraser") {
      ctx.lineWidth = drawSize * 3;
    } else {
      ctx.lineWidth = drawSize;
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = drawTool === "eraser" ? "destination-out" : "source-over";
    if (drawTool === "pen" || drawTool === "marker" || drawTool === "eraser") {
      currentPath.current.push(pos);
      ctx.beginPath();
      ctx.moveTo(currentPath.current[0].x, currentPath.current[0].y);
      for (let i = 1; i < currentPath.current.length; i++) ctx.lineTo(currentPath.current[i].x, currentPath.current[i].y);
      ctx.stroke();
      ctx.globalAlpha = prevAlpha;
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
  }, [drawTool, drawColor, drawSize, getPos, connectDrag, edgeDrag, edgeCurveDrag, shapeDraft, shapeDragMove]);

  const onWorldPointerUp = useCallback((e) => {
    // Linked-shape group-drag commit. Persist shape's new coords AND
    // each child occurrence's meta.x/y shifted by the same delta.
    if (shapeDragMove) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
      const { shapeId, dx, dy, children } = shapeDragMove;
      if (dx !== 0 || dy !== 0) {
        const nextShapes = linkedShapes.map(s => s.id === shapeId
          ? { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy }
          : s
        );
        saveLinkedShapes(nextShapes);
        // Move each captured child by the same delta. Read each
        // occurrence's current meta.x/y from the live itemsWithOccurrences
        // list at commit time so concurrent edits don't get clobbered.
        for (const ch of children) {
          const item = itemsWithOccurrences.find(it => it.occurrence?.id === ch.occId);
          const occ = item?.occurrence;
          if (!occ) continue;
          const curX = Number(occ.meta?.x) || 0;
          const curY = Number(occ.meta?.y) || 0;
          CommitHelpers.updateOccurrence({
            dispatch, socket,
            occurrence: {
              id: ch.occId,
              meta: { ...(occ.meta || {}), x: curX + dx, y: curY + dy },
            },
            emit: true,
          });
        }
      }
      setShapeDragMove(null);
      return;
    }
    // Linked-shape draft commit — persist the shape unless it's degenerate.
    if (shapeDraft) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
      const w = Math.abs(shapeDraft.x2 - shapeDraft.x1);
      const h = Math.abs(shapeDraft.y2 - shapeDraft.y1);
      if (w >= 8 && h >= 8) {
        const shape = {
          id: `ls-${shapeDraft.kind}-${Date.now()}`,
          kind: shapeDraft.kind,
          x1: Math.min(shapeDraft.x1, shapeDraft.x2),
          y1: Math.min(shapeDraft.y1, shapeDraft.y2),
          x2: Math.max(shapeDraft.x1, shapeDraft.x2),
          y2: Math.max(shapeDraft.y1, shapeDraft.y2),
        };
        saveLinkedShapes([...linkedShapes, shape]);
      }
      setShapeDraft(null);
      return;
    }
    // Edge midpoint curve-drag commit — persist cpOffset on the edge.
    if (edgeCurveDrag) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
      const { edgeId, dx, dy } = edgeCurveDrag;
      const prev = edges.find(ed => ed.id === edgeId);
      if (prev) {
        const baseX = Number(prev.cpOffset?.dx) || 0;
        const baseY = Number(prev.cpOffset?.dy) || 0;
        const next = edges.map(ed => ed.id === edgeId
          ? { ...ed, cpOffset: { dx: baseX + dx, dy: baseY + dy } }
          : ed
        );
        saveEdges(next);
      }
      setEdgeCurveDrag(null);
      return;
    }
    // Edge endpoint re-snap commit. If dropped on an occurrence different
    // from the OTHER endpoint, retarget the dragged endpoint; otherwise
    // discard the drag (occurrence unchanged).
    if (edgeDrag) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
      const target = hitTestOccId(e.clientX, e.clientY);
      const edge = edges.find(ed => ed.id === edgeDrag.edgeId);
      if (edge && target) {
        const otherEnd = edgeDrag.endpoint === "from" ? edge.to : edge.from;
        if (target !== otherEnd) {
          // Dedup — don't end up with an exact duplicate of an existing edge.
          const wouldDup = edges.some(ed =>
            ed.id !== edge.id &&
            ((edgeDrag.endpoint === "from" && ed.from === target && ed.to === edge.to) ||
             (edgeDrag.endpoint === "to"   && ed.from === edge.from && ed.to === target))
          );
          if (!wouldDup) {
            const next = edges.map(ed => ed.id === edge.id
              ? { ...ed, [edgeDrag.endpoint]: target }
              : ed
            );
            saveEdges(next);
          }
        }
      }
      setEdgeDrag(null);
      return;
    }
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
    if (drawTool === "pen" || drawTool === "marker" || drawTool === "eraser") {
      const w = drawTool === "eraser" ? drawSize * 3
              : drawTool === "marker" ? drawSize * 4
              : drawSize;
      newStroke = { tool: drawTool, color: drawColor, width: w, points: [...currentPath.current] };
    } else if (drawTool === "fill") {
      // Fill is committed on click (a single-point gesture). Wraps the
      // entire canvas — undo/redo work through the stroke stack like
      // everything else.
      newStroke = { tool: "fill", color: drawColor, width: 0 };
    } else if (drawTool === "line") {
      newStroke = { tool: drawTool, color: drawColor, width: drawSize, x1: s.x, y1: s.y, x2: pos.x, y2: pos.y };
    } else if (drawTool === "rect") {
      newStroke = { tool: drawTool, color: drawColor, width: drawSize, x1: s.x, y1: s.y, x2: pos.x, y2: pos.y };
    } else if (drawTool === "circle") {
      newStroke = { tool: drawTool, color: drawColor, width: drawSize, x1: s.x, y1: s.y, x2: pos.x, y2: pos.y };
    }
    currentPath.current = [];
    if (newStroke) {
      // Stamp the active layer so visibility filtering applies. Strokes
      // drawn before the layer was added pass through unfiltered (no
      // layerId = always visible). When the active layer is locked,
      // discard the stroke — the lock prevents writes to it (#51 layers).
      const activeLayer = layers.find(l => l.id === activeLayerId);
      if (activeLayer?.locked) {
        return; // don't commit
      }
      if (activeLayerId) newStroke.layerId = activeLayerId;
      // New stroke clears any pending redo branch and pushes onto the
      // unified undo history so Cmd-Z rolls back the most recent action
      // regardless of type.
      setRedoStack([]);
      setHistory(h => [...h, { type: "stroke-add", payload: newStroke }]);
      saveStrokes([...strokesRef.current, newStroke]);
    }
  }, [drawTool, drawColor, drawSize, activeLayerId, layers, getPos, saveStrokes, connectDrag, edgeDrag, edgeCurveDrag, shapeDraft, shapeDragMove, linkedShapes, saveLinkedShapes, itemsWithOccurrences, dispatch, socket, edges, hitTestOccId, saveEdges]);

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
  const renderToolList = (list) => list.map(t => {
    // Linked-variant tools (connect / *-link) get a small chain-link
    // badge overlay in the bottom-right corner to visually distinguish
    // from their plain drawing counterparts.
    const isLinkVariant = t.id === "connect" || t.id.endsWith("-link");
    return (
      <button key={t.id} title={t.title} onClick={() => { setDrawTool(t.id); setMobileMenuOpen(false); }}
        style={{ background: drawTool === t.id ? "rgba(99,102,241,0.25)" : "none", border: drawTool === t.id ? "1px solid rgba(99,102,241,0.5)" : "1px solid transparent", borderRadius: 5, padding: "3px 5px", cursor: "pointer", color: drawTool === t.id ? "#818cf8" : "var(--text-muted)", display: "flex", alignItems: "center", position: "relative" }}>
        <t.icon style={{ width: 13, height: 13 }} />
        {isLinkVariant && (
          <Link2 style={{
            width: 7, height: 7,
            position: "absolute",
            right: 1, bottom: 1,
            background: "var(--surface-overlay, rgba(20,22,26,0.95))",
            color: "#818cf8",
            borderRadius: 2,
            padding: 0.5,
          }} />
        )}
      </button>
    );
  });
  const toolButtons = (
    <div className="canvas-toolbar-group">
      {renderToolList(DRAW_TOOLS)}
    </div>
  );
  const trailingToolButtons = (
    <div className="canvas-toolbar-group">
      {renderToolList(TRAILING_TOOLS)}
    </div>
  );
  const colorSwatches = (
    <div className="canvas-toolbar-group">
      {DRAW_COLORS.map(c => (
        <button key={c} onClick={() => { setDrawColor(c); if (drawTool === "select" || drawTool === "grab") setDrawTool("pen"); }}
          title={c}
          style={{ width: 14, height: 14, borderRadius: "50%", background: c, border: drawColor === c ? "2px solid #818cf8" : "1px solid rgba(255,255,255,0.15)", cursor: "pointer", padding: 0, flexShrink: 0 }} />
      ))}
      {/* Native color input for arbitrary picks. The swatch list above stays
          as a quick-pick; this is the "open the full picker" affordance. */}
      <label
        title="Pick any color"
        style={{
          width: 16, height: 16, borderRadius: "50%",
          background: `conic-gradient(red, yellow, lime, cyan, blue, magenta, red)`,
          border: "1px solid rgba(255,255,255,0.25)",
          cursor: "pointer", padding: 0, flexShrink: 0,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <input
          type="color"
          value={drawColor}
          onChange={(e) => { setDrawColor(e.target.value); if (drawTool === "select" || drawTool === "grab") setDrawTool("pen"); }}
          style={{ opacity: 0, width: 16, height: 16, cursor: "pointer", padding: 0, border: "none" }}
          aria-label="Pick any color"
        />
      </label>
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

  // Layers dropdown (task #51 follow-up). Click the button → small popout
  // with per-layer row: visibility toggle • active-layer radio • name •
  // delete. + button at bottom mints a new layer; new strokes land on it.
  const layersButton = (
    <div className="canvas-toolbar-group" style={{ position: "relative" }}>
      <button
        title={`Layers (${layers.length})`}
        onClick={() => setLayersOpen(o => !o)}
        style={{
          background: layersOpen ? "rgba(99,102,241,0.2)" : "none",
          border: layersOpen ? "1px solid rgba(99,102,241,0.4)" : "1px solid transparent",
          borderRadius: 4, padding: "2px 6px", cursor: "pointer",
          color: "var(--text-muted)", fontSize: 9, fontFamily: "var(--font-mono)",
          display: "inline-flex", alignItems: "center", gap: 3,
        }}
      >
        ≡ {layers.length}
      </button>
      {layersOpen ? (
        <>
          <div onClick={() => setLayersOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }} />
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 100,
            minWidth: 180, padding: 6, borderRadius: 5,
            background: "var(--surface, #1f2125)",
            border: "1px solid var(--border-default)",
            boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
            display: "flex", flexDirection: "column", gap: 3,
            fontSize: 10, fontFamily: "var(--font-mono)",
          }}>
            <div style={{ fontSize: 9, color: "var(--text-faint)", marginBottom: 2 }}>Layers</div>
            {layers.map((l, idx) => (
              <div key={l.id} style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "2px 4px", borderRadius: 3,
                background: l.id === activeLayerId ? "rgba(99,102,241,0.15)" : "transparent",
              }}>
                <button
                  title={l.visible !== false ? "Hide layer" : "Show layer"}
                  onClick={() => {
                    const next = layers.map((x, i) => i === idx ? { ...x, visible: !(x.visible !== false) } : x);
                    saveLayers(next);
                  }}
                  style={{ background: "none", border: "1px solid transparent", borderRadius: 3, padding: "1px 3px", cursor: "pointer", color: l.visible !== false ? "var(--text-primary)" : "var(--text-faint)" }}
                >
                  {l.visible !== false ? "●" : "○"}
                </button>
                <button
                  title={l.locked ? "Unlock layer (allow new strokes)" : "Lock layer (block new strokes here)"}
                  onClick={() => {
                    const next = layers.map((x, i) => i === idx ? { ...x, locked: !x.locked } : x);
                    saveLayers(next);
                  }}
                  style={{ background: "none", border: "1px solid transparent", borderRadius: 3, padding: "1px 3px", cursor: "pointer", color: l.locked ? "rgb(248,113,113)" : "var(--text-faint)", fontSize: 10 }}
                >
                  {l.locked ? "🔒" : "🔓"}
                </button>
                <LayerNameInput
                  layer={l}
                  fallbackName={`Layer ${idx + 1}`}
                  onSelect={() => {
                    setActiveLayerId(l.id);
                    // Drawing into a hidden layer would confuse the user
                    // (strokes vanish on commit). Auto-show on activate.
                    if (l.visible === false) {
                      const next = layers.map((x, i) => i === idx ? { ...x, visible: true } : x);
                      saveLayers(next);
                    }
                  }}
                  onRename={(newName) => {
                    const next = layers.map((x, i) => i === idx ? { ...x, name: newName || `Layer ${idx + 1}` } : x);
                    saveLayers(next);
                  }}
                />
                {/* Reorder arrows — change layer order which dictates
                    render z-order (earlier-listed layers render first / underneath). */}
                <button
                  title="Move up (renders below)"
                  disabled={idx === 0}
                  onClick={() => {
                    if (idx === 0) return;
                    const next = layers.slice();
                    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                    saveLayers(next);
                  }}
                  style={{ background: "none", border: "none", borderRadius: 3, padding: "1px 3px", cursor: idx === 0 ? "not-allowed" : "pointer", color: "var(--text-faint)", fontSize: 10, opacity: idx === 0 ? 0.3 : 1 }}
                >▲</button>
                <button
                  title="Move down (renders on top)"
                  disabled={idx === layers.length - 1}
                  onClick={() => {
                    if (idx === layers.length - 1) return;
                    const next = layers.slice();
                    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                    saveLayers(next);
                  }}
                  style={{ background: "none", border: "none", borderRadius: 3, padding: "1px 3px", cursor: idx === layers.length - 1 ? "not-allowed" : "pointer", color: "var(--text-faint)", fontSize: 10, opacity: idx === layers.length - 1 ? 0.3 : 1 }}
                >▼</button>
                <button
                  title="Duplicate layer (clones strokes assigned to this layer)"
                  onClick={() => {
                    const newId = `layer-${Date.now()}`;
                    const newLayer = { id: newId, name: `${l.name || `Layer ${idx + 1}`} (copy)`, visible: l.visible !== false };
                    const nextLayers = [...layers.slice(0, idx + 1), newLayer, ...layers.slice(idx + 1)];
                    saveLayers(nextLayers);
                    // Clone strokes on this layer to the new layer
                    const cloned = strokes
                      .filter(s => s.layerId === l.id)
                      .map(s => ({ ...s, layerId: newId }));
                    if (cloned.length > 0) {
                      saveStrokes([...strokes, ...cloned]);
                    }
                    setActiveLayerId(newId);
                  }}
                  style={{ background: "none", border: "none", borderRadius: 3, padding: "1px 3px", cursor: "pointer", color: "var(--text-faint)", fontSize: 10 }}
                >⎘</button>
                {layers.length > 1 ? (
                  <button
                    title="Delete layer (strokes reassigned to the next layer)"
                    onClick={() => {
                      // Pick a fallback layer — prefer the previous sibling
                      // so reassigned strokes land on a visible neighbor.
                      const fallback = layers[idx - 1] || layers[idx + 1];
                      const fallbackId = fallback?.id || "default";
                      const nextLayers = layers.filter((_, i) => i !== idx);
                      saveLayers(nextLayers);
                      // Reassign strokes from the deleted layer to the
                      // fallback so they don't vanish from view.
                      const hasOrphans = strokes.some(s => s.layerId === l.id);
                      if (hasOrphans) {
                        const reassigned = strokes.map(s =>
                          s.layerId === l.id ? { ...s, layerId: fallbackId } : s
                        );
                        saveStrokes(reassigned);
                      }
                      if (activeLayerId === l.id) setActiveLayerId(fallbackId);
                    }}
                    style={{ background: "none", border: "none", borderRadius: 3, padding: "1px 3px", cursor: "pointer", color: "var(--text-faint)", fontSize: 11 }}
                  >×</button>
                ) : null}
              </div>
            ))}
            <button
              onClick={() => {
                const id = `layer-${Date.now()}`;
                const next = [...layers, { id, name: `Layer ${layers.length + 1}`, visible: true }];
                saveLayers(next);
                setActiveLayerId(id);
              }}
              style={{ marginTop: 4, padding: "3px 6px", borderRadius: 3, background: "var(--input-bg)", border: "1px dashed var(--border-default)", color: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)", cursor: "pointer" }}
            >
              + New layer
            </button>
          </div>
        </>
      ) : null}
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
  // Quick-add a new textblock at canvas center (#6 spec line 645:
  // "Canvas-toolbar shortcut for new textblock").
  const newTextblockButton = (
    <div className="canvas-toolbar-group">
      <button
        onClick={() => {
          if (!containerOccurrence) return;
          const res = CommitHelpers.createTextblockInContainer({
            dispatch, socket,
            gridId: containerOccurrence.gridId,
            userId: containerOccurrence.userId,
            containerOccurrence,
            label: "",
          });
          // Stamp meta.x/y near the canvas viewport center so the
          // textblock lands somewhere visible.
          if (res?.occurrenceId) {
            const surface = surfaceRef.current;
            const cx = surface ? (surface.scrollLeft + surface.clientWidth / 2) : CANVAS_WORLD_SIZE / 2;
            const cy = surface ? (surface.scrollTop + surface.clientHeight / 2) : CANVAS_WORLD_SIZE / 2;
            CommitHelpers.updateOccurrence({
              dispatch, socket,
              occurrence: { id: res.occurrenceId, meta: { x: cx, y: cy } },
              emit: true,
            });
          }
          setMobileMenuOpen(false);
        }}
        title="New textblock at canvas center"
        style={{ background: "none", border: "1px solid transparent", borderRadius: 5, padding: "3px 5px", cursor: "pointer", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 2 }}
      >
        <Type style={{ width: 12, height: 12 }} />
        <span style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>+</span>
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
  const edgePath = (a, b, cpOffset) => {
    if (!a || !b) return "";
    const dx = Math.abs(b.x - a.x);
    const offset = Math.max(40, dx * 0.4);
    const ox = cpOffset?.dx || 0;
    const oy = cpOffset?.dy || 0;
    // Bezier control points biased toward each endpoint, then shifted by
    // the user-set cpOffset so they can grab the midpoint and reshape
    // the curve. Both control points move by the same offset so the
    // curve stays roughly symmetric.
    return `M ${a.x} ${a.y} C ${a.x + offset + ox} ${a.y + oy}, ${b.x - offset + ox} ${b.y + oy}, ${b.x} ${b.y}`;
  };
  const handleEdgeClick = (edgeId) => {
    // Connect tool deletes edges directly on click. Select tool also
    // deletes (per #5 spec "Delete-from-select"). Other tools are
    // click-through, but the hit-path doesn't enable pointerEvents for
    // them anyway.
    if (drawTool !== "connect" && drawTool !== "select") return;
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
          {layersButton}
          {sep}
          {historyButtons}
          {sep}
          {newTextblockButton}
          <span style={{ marginLeft: "auto" }} />
          {trailingToolButtons}
          {sep}
          {centerButton}
          <button onClick={() => setToolbarOpen(false)} title="Hide toolbar"
            style={{ background: "none", border: "1px solid transparent", borderRadius: 5, padding: "3px 5px", cursor: "pointer", color: "var(--text-faint)", display: "flex", alignItems: "center" }}>
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
              <div className="canvas-toolbar-dropdown-row">{trailingToolButtons}</div>
              <div className="canvas-toolbar-dropdown-row">{colorSwatches}</div>
              <div className="canvas-toolbar-dropdown-row">{sizeButtons}</div>
              <div className="canvas-toolbar-dropdown-row">{layersButton}</div>
              <div className="canvas-toolbar-dropdown-row">{newTextblockButton}</div>
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
            {/* Linked shapes (#5): rect / ellipse with geometric containment.
                Children = occurrences whose card center sits inside the shape's
                bbox. Render each shape + fainter auto-connect line from the
                shape's center to each child's center. */}
            {linkedShapes.map((sh) => {
              const sx = Math.min(sh.x1, sh.x2);
              const sy = Math.min(sh.y1, sh.y2);
              const sw = Math.abs(sh.x2 - sh.x1);
              const sh2 = Math.abs(sh.y2 - sh.y1);
              const cx = sx + sw / 2;
              const cy = sy + sh2 / 2;
              // Find child occurrences whose card center is inside the bbox.
              const children = itemsWithOccurrences.map(({ occurrence: occ }) => {
                const c = cardCenterFor(occ?.id);
                if (!c) return null;
                if (sh.kind === "circle") {
                  const rx = sw / 2, ry = sh2 / 2;
                  if (rx === 0 || ry === 0) return null;
                  const nx = (c.x - cx) / rx, ny = (c.y - cy) / ry;
                  if (nx * nx + ny * ny > 1) return null;
                } else {
                  if (c.x < sx || c.x > sx + sw || c.y < sy || c.y > sy + sh2) return null;
                }
                return { occId: occ.id, center: c };
              }).filter(Boolean);
              const isHot = drawTool === "select";
              const drag = shapeDragMove?.shapeId === sh.id ? shapeDragMove : null;
              return (
                <g key={sh.id} transform={drag ? `translate(${drag.dx}, ${drag.dy})` : undefined}>
                  {sh.kind === "circle" ? (
                    <ellipse
                      cx={cx} cy={cy} rx={sw / 2} ry={sh2 / 2}
                      fill="rgba(129,140,248,0.06)"
                      stroke="rgba(129,140,248,0.55)"
                      strokeWidth={1.5}
                      style={{ pointerEvents: isHot ? "auto" : "none", cursor: isHot ? "grab" : "default" }}
                      onPointerDown={(e) => {
                        if (drawTool !== "select") return;
                        e.stopPropagation();
                        try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
                        const pos = getPos(e);
                        setShapeDragMove({
                          shapeId: sh.id,
                          startX: pos.x, startY: pos.y,
                          dx: 0, dy: 0,
                          children: children.map(c => ({ occId: c.occId, x: c.center.x, y: c.center.y })),
                        });
                      }}
                      onDoubleClick={(e) => {
                        if (drawTool !== "select") return;
                        e.stopPropagation();
                        saveLinkedShapes(linkedShapes.filter(x => x.id !== sh.id));
                      }}
                    />
                  ) : (
                    <rect
                      x={sx} y={sy} width={sw} height={sh2}
                      fill="rgba(129,140,248,0.06)"
                      stroke="rgba(129,140,248,0.55)"
                      strokeWidth={1.5}
                      rx={4}
                      style={{ pointerEvents: isHot ? "auto" : "none", cursor: isHot ? "grab" : "default" }}
                      onPointerDown={(e) => {
                        if (drawTool !== "select") return;
                        e.stopPropagation();
                        try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
                        const pos = getPos(e);
                        setShapeDragMove({
                          shapeId: sh.id,
                          startX: pos.x, startY: pos.y,
                          dx: 0, dy: 0,
                          children: children.map(c => ({ occId: c.occId, x: c.center.x, y: c.center.y })),
                        });
                      }}
                      onDoubleClick={(e) => {
                        if (drawTool !== "select") return;
                        e.stopPropagation();
                        saveLinkedShapes(linkedShapes.filter(x => x.id !== sh.id));
                      }}
                    />
                  )}
                  {/* Auto-connect fainter lines from shape center → each child */}
                  {children.map((ch, i) => (
                    <line
                      key={i}
                      x1={cx} y1={cy} x2={ch.center.x} y2={ch.center.y}
                      stroke="rgba(129,140,248,0.30)"
                      strokeWidth={1}
                      strokeDasharray="4 3"
                      style={{ pointerEvents: "none" }}
                    />
                  ))}
                  {/* Delete affordance — small ✕ in the top-right of the
                      shape's bbox when in select mode. More discoverable
                      than double-click (which is also kept). */}
                  {isHot && (
                    <g
                      style={{ pointerEvents: "auto", cursor: "pointer" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        saveLinkedShapes(linkedShapes.filter(x => x.id !== sh.id));
                      }}
                    >
                      <circle
                        cx={sx + sw - 8} cy={sy + 8} r={8}
                        fill="rgba(31,33,37,0.92)"
                        stroke="rgba(248,113,113,0.55)"
                        strokeWidth={1}
                      />
                      <text
                        x={sx + sw - 8} y={sy + 11}
                        textAnchor="middle"
                        fontSize={10}
                        fontFamily="var(--font-mono)"
                        fill="rgba(248,113,113,0.95)"
                        style={{ pointerEvents: "none", userSelect: "none" }}
                      >×</text>
                    </g>
                  )}
                </g>
              );
            })}
            {/* Linked-shape draft preview while drawing */}
            {shapeDraft && (() => {
              const sx = Math.min(shapeDraft.x1, shapeDraft.x2);
              const sy = Math.min(shapeDraft.y1, shapeDraft.y2);
              const sw = Math.abs(shapeDraft.x2 - shapeDraft.x1);
              const sh2 = Math.abs(shapeDraft.y2 - shapeDraft.y1);
              if (shapeDraft.kind === "circle") {
                if (sw < 2 || sh2 < 2) return null;
                return (
                  <ellipse
                    cx={sx + sw / 2} cy={sy + sh2 / 2} rx={sw / 2} ry={sh2 / 2}
                    fill="rgba(129,140,248,0.06)"
                    stroke="rgba(129,140,248,0.55)"
                    strokeWidth={1.5}
                    strokeDasharray="5 3"
                    style={{ pointerEvents: "none" }}
                  />
                );
              }
              return (
                <rect
                  x={sx} y={sy} width={sw} height={sh2}
                  fill="rgba(129,140,248,0.06)"
                  stroke="rgba(129,140,248,0.55)"
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                  rx={4}
                  style={{ pointerEvents: "none" }}
                />
              );
            })()}
            {edges.map((ed) => {
              const a = cardCenterFor(ed.from);
              const b = cardCenterFor(ed.to);
              if (!a || !b) return null;
              // Select tool + connect tool both let the user click an edge
              // to delete it (#5 spec: "Delete-from-select: with the select
              // tool, drawn lines + shapes are selectable; selected ones
              // can be deleted"). Other tools leave edges click-through.
              const isHot = drawTool === "connect" || drawTool === "select";
              const showHandles = drawTool === "select";
              // While THIS edge is being endpoint-dragged, render its
              // moving endpoint at the drag pointer position instead of
              // the source card's center.
              const dragging = edgeDrag?.edgeId === ed.id ? edgeDrag : null;
              const renderA = dragging?.endpoint === "from" ? { x: dragging.x, y: dragging.y } : a;
              const renderB = dragging?.endpoint === "to"   ? { x: dragging.x, y: dragging.y } : b;
              // Effective cpOffset includes any in-progress curve drag delta.
              const baseCp = ed.cpOffset || { dx: 0, dy: 0 };
              const curveLive = edgeCurveDrag?.edgeId === ed.id ? edgeCurveDrag : null;
              const cp = curveLive
                ? { dx: (baseCp.dx || 0) + curveLive.dx, dy: (baseCp.dy || 0) + curveLive.dy }
                : baseCp;
              // Midpoint of the edge — offset by half cpOffset so the ball
              // tracks the visual midpoint of the curve.
              const midX = (renderA.x + renderB.x) / 2 + (cp.dx || 0);
              const midY = (renderA.y + renderB.y) / 2 + (cp.dy || 0);
              return (
                <g key={ed.id}>
                  {/* Wide invisible hit path so click targeting is forgiving */}
                  <path
                    d={edgePath(renderA, renderB, cp)}
                    stroke="transparent"
                    strokeWidth={16}
                    fill="none"
                    style={{ pointerEvents: isHot ? "stroke" : "none", cursor: isHot ? "pointer" : "default" }}
                    onClick={(e) => { e.stopPropagation(); handleEdgeClick(ed.id); }}
                  />
                  <path
                    d={edgePath(renderA, renderB, cp)}
                    stroke="rgba(129,140,248,0.85)"
                    strokeWidth={2}
                    strokeDasharray={dragging || curveLive ? "6 4" : undefined}
                    fill="none"
                    style={{ pointerEvents: "none" }}
                  />
                  {/* Midpoint drag ball — select tool only. Pointer-down
                      starts a curve-reshape drag; the cpOffset persists
                      on release. */}
                  {showHandles && !dragging && (
                    <circle
                      cx={midX} cy={midY} r={5}
                      fill="rgba(129,140,248,0.6)"
                      stroke="rgba(255,255,255,0.5)"
                      strokeWidth={1.2}
                      style={{ cursor: "grab", pointerEvents: "auto" }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
                        const pos = getPos(e);
                        setEdgeCurveDrag({ edgeId: ed.id, startX: pos.x, startY: pos.y, dx: 0, dy: 0 });
                      }}
                    />
                  )}
                  {/* Edge label (#5 follow-up — foundation for the LATER
                      "link data semantics" docket item). Click the pill in
                      select mode to inline-edit; otherwise rendered as a
                      static badge. A "+ label" affordance shows when the
                      edge has no label and the user is in select mode. */}
                  {(() => {
                    const isEditing = edgeLabelEdit?.edgeId === ed.id;
                    if (isEditing) {
                      return (
                        <foreignObject x={midX - 56} y={midY - 11} width={112} height={22} style={{ overflow: "visible" }}>
                          <input
                            autoFocus
                            value={edgeLabelEdit.draft}
                            onChange={(e) => setEdgeLabelEdit({ ...edgeLabelEdit, draft: e.target.value })}
                            onBlur={() => {
                              const next = edges.map(x => x.id === ed.id
                                ? { ...x, label: edgeLabelEdit.draft || undefined }
                                : x
                              );
                              saveEdges(next);
                              setEdgeLabelEdit(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                              if (e.key === "Escape") setEdgeLabelEdit(null);
                            }}
                            placeholder="label…"
                            style={{
                              width: "100%", padding: "2px 6px",
                              border: "1px solid rgba(129,140,248,0.8)",
                              background: "rgba(31,33,37,0.95)",
                              color: "var(--text-primary)",
                              borderRadius: 4, fontSize: 10,
                              fontFamily: "var(--font-mono)",
                              outline: "none",
                            }}
                          />
                        </foreignObject>
                      );
                    }
                    if (ed.label) {
                      const labelText = String(ed.label).slice(0, 24);
                      // Approximate pixel width per char for monospace 10px font.
                      const labelW = Math.max(40, labelText.length * 6.2 + 12);
                      return (
                        <g
                          style={{ pointerEvents: showHandles ? "auto" : "none", cursor: showHandles ? "text" : "default" }}
                          onClick={(e) => {
                            if (!showHandles) return;
                            e.stopPropagation();
                            setEdgeLabelEdit({ edgeId: ed.id, draft: ed.label || "" });
                          }}
                        >
                          <rect
                            x={midX - labelW / 2} y={midY - 9}
                            width={labelW} height={18}
                            rx={4}
                            fill="rgba(31,33,37,0.92)"
                            stroke="rgba(129,140,248,0.65)"
                            strokeWidth={1}
                          />
                          <text
                            x={midX} y={midY + 3}
                            textAnchor="middle"
                            fontSize={10}
                            fontFamily="var(--font-mono)"
                            fill="rgba(190,215,255,0.95)"
                            style={{ pointerEvents: "none", userSelect: "none" }}
                          >
                            {labelText}
                          </text>
                        </g>
                      );
                    }
                    // No label + select mode → "+ label" affordance
                    if (showHandles) {
                      return (
                        <g
                          style={{ pointerEvents: "auto", cursor: "text" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEdgeLabelEdit({ edgeId: ed.id, draft: "" });
                          }}
                        >
                          <circle
                            cx={midX} cy={midY - 12} r={7}
                            fill="rgba(31,33,37,0.85)"
                            stroke="rgba(129,140,248,0.5)"
                            strokeWidth={1}
                          />
                          <text
                            x={midX} y={midY - 9}
                            textAnchor="middle"
                            fontSize={10}
                            fontFamily="var(--font-mono)"
                            fill="rgba(190,215,255,0.85)"
                            style={{ pointerEvents: "none", userSelect: "none" }}
                          >+</text>
                        </g>
                      );
                    }
                    return null;
                  })()}
                  {/* Endpoint balls — select tool only — pointer-down
                      starts a re-snap drag. */}
                  {showHandles && (
                    <>
                      <circle
                        cx={renderA.x} cy={renderA.y} r={6}
                        fill="rgba(129,140,248,0.85)"
                        stroke="rgba(255,255,255,0.65)"
                        strokeWidth={1.5}
                        style={{ cursor: "grab", pointerEvents: "auto" }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
                          setEdgeDrag({ edgeId: ed.id, endpoint: "from", x: a.x, y: a.y });
                        }}
                      />
                      <circle
                        cx={renderB.x} cy={renderB.y} r={6}
                        fill="rgba(129,140,248,0.85)"
                        stroke="rgba(255,255,255,0.65)"
                        strokeWidth={1.5}
                        style={{ cursor: "grab", pointerEvents: "auto" }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
                          setEdgeDrag({ edgeId: ed.id, endpoint: "to", x: b.x, y: b.y });
                        }}
                      />
                    </>
                  )}
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
