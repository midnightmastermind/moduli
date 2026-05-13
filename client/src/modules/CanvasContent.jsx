// modules/CanvasContent.jsx
// CanvasDrawSection — draw toolbar + HTML5 canvas overlay + floating cards.
// Extracted from containerHelpers.jsx.

import React, { useRef, useState, useCallback, useEffect } from "react";
import { MousePointer2, Pencil, Square, Circle, Minus, Eraser, Trash2, Undo2, Redo2, ChevronUp } from "lucide-react";
import * as CommitHelpers from "../helpers/CommitHelpers";

// ============================================================
// CANVAS DRAW SECTION — draw toolbar + HTML5 canvas overlay + floating cards
// ============================================================
const DRAW_TOOLS = [
  { id: "select",  icon: MousePointer2, title: "Select / move cards" },
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
  const [drawTool, setDrawTool] = useState("select");
  const [drawColor, setDrawColor] = useState("#e2e8f0");
  const [drawSize, setDrawSize] = useState(2);
  const [strokes, setStrokes] = useState(() => containerOccurrence?.meta?.drawData || []);
  const [redoStack, setRedoStack] = useState([]);
  // Local override — once user hides the toolbar with the in-toolbar button,
  // we collapse to a small "show" pill until they click it. Defaults to the
  // parent-passed showToolbar so this is opt-in.
  const [toolbarOpen, setToolbarOpen] = useState(showToolbar);
  useEffect(() => { setToolbarOpen(showToolbar); }, [showToolbar]);
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const currentPath = useRef([]);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;

  // Sync strokes when occurrence changes externally
  useEffect(() => {
    setStrokes(containerOccurrence?.meta?.drawData || []);
    setRedoStack([]);
  }, [containerOccurrence?.id]);

  // Size canvas to match CSS size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const obs = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = canvas;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        renderStrokes(ctx, strokesRef.current);
      }
    });
    obs.observe(canvas);
    return () => obs.disconnect();
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
      CommitHelpers.updateOccurrence({ dispatch, socket,
        occurrence: { ...containerOccurrence, meta: { ...(containerOccurrence.meta || {}), drawData: newStrokes } },
        emit: true });
    }
  }, [containerOccurrence, dispatch, socket]);

  const undo = useCallback(() => {
    if (strokesRef.current.length === 0) return;
    const last = strokesRef.current[strokesRef.current.length - 1];
    const next = strokesRef.current.slice(0, -1);
    setRedoStack(r => [...r, last]);
    saveStrokes(next);
  }, [saveStrokes]);

  const redo = useCallback(() => {
    setRedoStack(r => {
      if (r.length === 0) return r;
      const last = r[r.length - 1];
      saveStrokes([...strokesRef.current, last]);
      return r.slice(0, -1);
    });
  }, [saveStrokes]);

  const onPointerDown = useCallback((e) => {
    if (drawTool === "select") return;
    // Don't draw if clicking the grip handle of a CanvasCard
    if (e.target?.closest?.("[data-dnd-handle]")) return;
    e.stopPropagation();
    isDrawing.current = true;
    currentPath.current = [getPos(e)];
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [drawTool, getPos]);

  const onPointerMove = useCallback((e) => {
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
  }, [drawTool, drawColor, drawSize, getPos]);

  const onPointerUp = useCallback((e) => {
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
      // New stroke clears any pending redo branch.
      setRedoStack([]);
      saveStrokes([...strokesRef.current, newStroke]);
    }
  }, [drawTool, drawColor, drawSize, getPos, saveStrokes]);

  const toolbarStyle = {
    display: "flex", alignItems: "center", gap: 4,
    padding: "4px 8px",
    background: "var(--surface-overlay)",
    borderBottom: "1px solid var(--border-subtle)",
    flexShrink: 0,
  };

  const effectiveContainerId = containerId || module?.id;
  const canUndo = strokes.length > 0;
  const canRedo = redoStack.length > 0;

  return (
    <div
      data-container-id={effectiveContainerId}
      style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
    >
      {/* Draw toolbar — hidden by default; opt-in via showToolbar prop */}
      {showToolbar && toolbarOpen && <div style={toolbarStyle} onPointerDown={e => e.stopPropagation()}>
        {DRAW_TOOLS.map(t => (
          <button key={t.id} title={t.title} onClick={() => setDrawTool(t.id)}
            style={{ background: drawTool === t.id ? "rgba(99,102,241,0.25)" : "none", border: drawTool === t.id ? "1px solid rgba(99,102,241,0.5)" : "1px solid transparent", borderRadius: 5, padding: "3px 5px", cursor: "pointer", color: drawTool === t.id ? "#818cf8" : "var(--text-muted)", display: "flex", alignItems: "center" }}>
            <t.icon style={{ width: 13, height: 13 }} />
          </button>
        ))}
        <div style={{ width: 1, height: 18, background: "var(--border-subtle)", margin: "0 2px" }} />
        {/* Color swatches */}
        {DRAW_COLORS.map(c => (
          <button key={c} onClick={() => { setDrawColor(c); if (drawTool === "select") setDrawTool("pen"); }}
            title={c}
            style={{ width: 14, height: 14, borderRadius: "50%", background: c, border: drawColor === c ? "2px solid #818cf8" : "1px solid rgba(255,255,255,0.15)", cursor: "pointer", padding: 0, flexShrink: 0 }} />
        ))}
        <div style={{ width: 1, height: 18, background: "var(--border-subtle)", margin: "0 2px" }} />
        {/* Size selector */}
        {DRAW_SIZES.map(sz => (
          <button key={sz} onClick={() => setDrawSize(sz)}
            title={`${sz}px`}
            style={{ background: drawSize === sz ? "rgba(99,102,241,0.2)" : "none", border: drawSize === sz ? "1px solid rgba(99,102,241,0.4)" : "1px solid transparent", borderRadius: 4, padding: "2px 5px", cursor: "pointer", color: "var(--text-muted)", fontSize: 9, fontFamily: "var(--font-mono)" }}>
            {sz}
          </button>
        ))}
        <div style={{ width: 1, height: 18, background: "var(--border-subtle)", margin: "0 2px" }} />
        {/* Undo / Redo */}
        <button onClick={undo} disabled={!canUndo} title="Undo (last stroke)"
          style={{ background: "none", border: "1px solid transparent", borderRadius: 5, padding: "3px 5px", cursor: canUndo ? "pointer" : "not-allowed", color: canUndo ? "var(--text-muted)" : "var(--text-faint)", display: "flex", alignItems: "center", opacity: canUndo ? 1 : 0.4 }}>
          <Undo2 style={{ width: 12, height: 12 }} />
        </button>
        <button onClick={redo} disabled={!canRedo} title="Redo"
          style={{ background: "none", border: "1px solid transparent", borderRadius: 5, padding: "3px 5px", cursor: canRedo ? "pointer" : "not-allowed", color: canRedo ? "var(--text-muted)" : "var(--text-faint)", display: "flex", alignItems: "center", opacity: canRedo ? 1 : 0.4 }}>
          <Redo2 style={{ width: 12, height: 12 }} />
        </button>
        <div style={{ width: 1, height: 18, background: "var(--border-subtle)", margin: "0 2px" }} />
        <button onClick={() => saveStrokes([])} title="Clear drawing"
          style={{ background: "none", border: "1px solid transparent", borderRadius: 5, padding: "3px 5px", cursor: "pointer", color: "var(--text-faint)", display: "flex", alignItems: "center" }}>
          <Trash2 style={{ width: 12, height: 12 }} />
        </button>
        {/* Hide the toolbar — collapses to a small show-pill at the top of the canvas. */}
        <button onClick={() => setToolbarOpen(false)} title="Hide toolbar"
          style={{ marginLeft: "auto", background: "none", border: "1px solid transparent", borderRadius: 5, padding: "3px 5px", cursor: "pointer", color: "var(--text-faint)", display: "flex", alignItems: "center" }}>
          <ChevronUp style={{ width: 12, height: 12 }} />
        </button>
      </div>}

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

      {/* Canvas area — pointer events here for drawing; canvas element always pointer-events:none so drops work */}
      <div
        ref={listDropRef}
        className="canvas-surface"
        style={{ flex: 1, position: "relative", overflow: "hidden", background: "var(--surface-overlay)", minHeight: 200,
          backgroundImage: "radial-gradient(circle, var(--border-subtle) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          cursor: drawTool === "select" ? "default" : drawTool === "eraser" ? "cell" : "crosshair",
          touchAction: drawTool === "select" ? "auto" : "none",
        }}
        onDoubleClick={(e) => { if (drawTool === "select") onDoubleClickBackground?.(e); }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* Drawing canvas overlay — always pointer-events:none so drag-and-drop events reach this div */}
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            pointerEvents: "none",
            zIndex: drawTool === "select" ? 0 : 10,
          }}
        />
        {/* Floating module cards (instances or embedded containers) */}
        {itemsWithOccurrences.map(({ module: mod, occurrence: occ }) =>
          renderCard && renderCard({
            module: mod,
            occurrence: occ,
            style: { zIndex: drawTool === "select" ? 1 : 5, pointerEvents: drawTool === "select" ? "all" : "none" },
            containerId,
            panelId,
          })
        )}
        {itemsWithOccurrences.length === 0 && drawTool === "select" && (
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-mono)", pointerEvents: "none", textAlign: "center", lineHeight: 1.6 }}>
            Double-click to add cards<br />or pick a draw tool above
          </div>
        )}
      </div>
    </div>
  );
});

// Named alias for backward compatibility with containerHelpers.jsx imports
export const CanvasDrawSection = CanvasContent;

export default CanvasContent;
