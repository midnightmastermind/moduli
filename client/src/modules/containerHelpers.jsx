// modules/containerHelpers.jsx
// Small sub-components used by Container.jsx
// Extracted to reduce Container.jsx size.

import React, { useRef, useState, useCallback, useEffect } from "react";
import Editor from "../ui/Editor";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { Lock, Unlock, X, MousePointer2, Pencil, Square, Circle, Eraser, Trash2, GripVertical } from "lucide-react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { DragType } from "../helpers/dragSystem";

// ============================================================
// DOC EDITOR SHELL — thin wrapper: adds click-to-edit state
// ============================================================
export const DocEditorShell = React.memo(function DocEditorShell({ occurrence, dispatch, socket, onConvertListToInstances, hideToolbar = false }) {
  const [isEditing, setIsEditing] = useState(false);
  const [showLockBtn, setShowLockBtn] = useState(false);
  const wrapRef = useRef(null);
  const isLocked = !!occurrence?.locked;
  const handleToggleLock = (e) => {
    e.stopPropagation();
    if (!occurrence?.id) return;
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { ...occurrence, locked: !isLocked } });
  };
  return (
    <div
      ref={wrapRef}
      className={`doc-container flex flex-col flex-1 min-h-0 relative${isEditing ? " is-editing" : ""}`}
      onClick={() => { if (!isLocked) setIsEditing(true); }}
      onBlur={(e) => { if (!wrapRef.current?.contains(e.relatedTarget)) setIsEditing(false); }}
      onMouseEnter={() => setShowLockBtn(true)}
      onMouseLeave={() => setShowLockBtn(false)}
      style={{ cursor: isLocked ? "default" : (isEditing ? "text" : "default") }}
    >
      {(showLockBtn || isLocked) && (
        <button
          onMouseDown={handleToggleLock}
          title={isLocked ? "Unlock document" : "Lock document"}
          style={{
            position: "absolute", top: 4, right: 4, zIndex: 10,
            background: "none", border: "none", cursor: "pointer",
            opacity: isLocked ? 0.7 : 0.3, padding: 2,
            color: isLocked ? "var(--danger)" : "var(--text-muted)",
          }}
        >
          {isLocked ? <Lock size={11} /> : <Unlock size={11} />}
        </button>
      )}
      <Editor
        content={occurrence?.textmap ?? null}
        occurrence={occurrence}
        dispatch={dispatch}
        socket={socket}
        editable={!isLocked}
        className="flex-1"
        onConvertListToInstances={onConvertListToInstances}
      />
    </div>
  );
});

// ============================================================
// POOL PILL — draggable item in a pool container
// ============================================================
export const PoolPill = React.memo(function PoolPill({ instanceModule, occurrence, onDelete }) {
  const ref = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return draggable({
      element: el,
      getInitialData: () => ({
        type: "module",
        role: "instance",
        id: instanceModule.id,
        data: instanceModule,
        sourceType: "pool",
        occurrenceId: occurrence?.id,
      }),
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    });
  }, [instanceModule, occurrence]);

  return (
    <div
      ref={ref}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "3px 8px 3px 6px",
        background: isDragging ? "rgba(99,102,241,0.35)" : "var(--input-bg)",
        border: `1px solid ${isDragging ? "rgba(99,102,241,0.6)" : "var(--input-border)"}`,
        borderRadius: 20,
        cursor: "grab",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        color: "var(--text-primary)",
        userSelect: "none",
        opacity: isDragging ? 0.5 : 1,
        transition: "opacity 0.1s, background 0.1s",
        position: "relative",
      }}
      className="pool-pill group"
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
        {instanceModule.label || "Untitled"}
      </span>
      <button
        onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        style={{
          display: "none", alignItems: "center", justifyContent: "center",
          width: 12, height: 12, padding: 0,
          background: "rgba(255,80,80,0.25)", border: "none",
          borderRadius: "50%", cursor: "pointer", color: "rgba(255,120,120,0.9)",
          flexShrink: 0,
        }}
        className="pool-pill-delete"
        title="Remove from pool"
      >
        <X size={8} />
      </button>
    </div>
  );
});

// ============================================================
// CANVAS CARD — free-positioned instance card on a canvas container
// ============================================================
export const CanvasCard = React.memo(function CanvasCard({ instance, occurrence, dispatch, socket, style, containerId, panelId }) {
  const cardRef = useRef(null);
  const dndHandleRef = useRef(null);
  const startPosRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const [pos, setPos] = useState({ x: occurrence?.meta?.x ?? 20, y: occurrence?.meta?.y ?? 20 });
  const [dragging, setDragging] = useState(false);

  // Sync if occurrence meta.x/y changes externally
  React.useEffect(() => {
    setPos({ x: occurrence?.meta?.x ?? 20, y: occurrence?.meta?.y ?? 20 });
  }, [occurrence?.meta?.x, occurrence?.meta?.y]);

  // Pragmatic DnD — drag OUT of canvas via the grip handle (INSTANCE type = move behavior)
  useEffect(() => {
    const el = cardRef.current;
    const handle = dndHandleRef.current;
    if (!el || !handle) return;
    return draggable({
      element: el,
      dragHandle: handle,
      getInitialData: () => ({
        type: DragType.INSTANCE,
        id: instance.id,
        data: { ...instance, occurrence },
        context: { containerId, panelId, instanceId: instance.id, occurrenceId: occurrence?.id },
      }),
    });
  }, [instance.id, occurrence?.id, containerId, panelId]);

  const onPointerDown = useCallback((e) => {
    // Don't start canvas reposition if the DnD grip handle was clicked
    if (dndHandleRef.current?.contains(e.target)) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    startPosRef.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y };
    setDragging(true);
  }, [pos]);

  const onPointerMove = useCallback((e) => {
    if (!dragging) return;
    const dx = e.clientX - startPosRef.current.x;
    const dy = e.clientY - startPosRef.current.y;
    setPos({ x: Math.max(0, startPosRef.current.ox + dx), y: Math.max(0, startPosRef.current.oy + dy) });
  }, [dragging]);

  const onPointerUp = useCallback((e) => {
    if (!dragging) return;
    setDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (occurrence?.id) {
      CommitHelpers.updateOccurrence({ dispatch, socket,
        occurrence: { ...occurrence, meta: { ...(occurrence.meta || {}), x: pos.x, y: pos.y } },
        emit: true });
    }
  }, [dragging, occurrence, pos, dispatch, socket]);

  return (
    <div
      ref={cardRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        position: "absolute",
        left: pos.x, top: pos.y,
        minWidth: 140, maxWidth: 240,
        background: "var(--surface-overlay)",
        border: `1px solid ${dragging ? "rgba(99,102,241,0.6)" : "var(--input-border)"}`,
        borderRadius: 8, padding: "6px 8px",
        cursor: dragging ? "grabbing" : "grab",
        boxShadow: dragging ? "0 8px 24px rgba(0,0,0,0.5)" : "0 2px 8px rgba(0,0,0,0.3)",
        ...style,
        zIndex: dragging ? 100 : 1,
        userSelect: "none", WebkitUserSelect: "none",
        transition: dragging ? "none" : "box-shadow 0.15s",
      }}
    >
      {/* DnD grip — drag this handle to move the card OUT of the canvas to another container */}
      <div
        ref={dndHandleRef}
        data-dnd-handle="true"
        title="Drag to another panel"
        style={{
          position: "absolute", top: 3, right: 4,
          cursor: "grab", opacity: 0.3, display: "flex", alignItems: "center",
          padding: 2,
          pointerEvents: "auto",  // Always interactive regardless of parent pointerEvents
        }}
        onPointerEnter={e => { e.currentTarget.style.opacity = "0.8"; }}
        onPointerLeave={e => { e.currentTarget.style.opacity = "0.3"; }}
      >
        <GripVertical size={10} />
      </div>
      <div style={{ fontSize: 11, color: "var(--text-primary)", fontFamily: "var(--font-mono)", marginBottom: 2, paddingRight: 14 }}>
        {instance.label || "Untitled"}
      </div>
      {(instance.fieldBindings || []).slice(0, 3).map(b => (
        <span key={b.fieldId} style={{ display: "inline-block", fontSize: 9, background: "rgba(134,239,172,0.08)", border: "1px solid rgba(134,239,172,0.2)", borderRadius: 999, padding: "1px 5px", marginRight: 3, color: "rgba(134,239,172,0.7)" }}>
          {b.fieldId.slice(0, 6)}
        </span>
      ))}
    </div>
  );
});

// ============================================================
// CANVAS DRAW SECTION — draw toolbar + HTML5 canvas overlay + floating cards
// ============================================================
const DRAW_TOOLS = [
  { id: "select",  icon: MousePointer2, title: "Select / move cards" },
  { id: "pen",     icon: Pencil,        title: "Freehand pen" },
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

export const CanvasDrawSection = React.memo(function CanvasDrawSection({
  containerOccurrence, itemsWithOccurrences, dispatch, socket, module, listDropRef,
  onDoubleClickBackground, ctxState, containerId, panelId,
}) {
  const [drawTool, setDrawTool] = useState("select");
  const [drawColor, setDrawColor] = useState("#e2e8f0");
  const [drawSize, setDrawSize] = useState(2);
  const [strokes, setStrokes] = useState(() => containerOccurrence?.meta?.drawData || []);
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const currentPath = useRef([]);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;

  // Sync strokes when occurrence changes externally
  useEffect(() => {
    setStrokes(containerOccurrence?.meta?.drawData || []);
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
      if (drawTool === "rect") {
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
    } else if (drawTool === "rect") {
      newStroke = { tool: drawTool, color: drawColor, width: drawSize, x1: s.x, y1: s.y, x2: pos.x, y2: pos.y };
    } else if (drawTool === "circle") {
      newStroke = { tool: drawTool, color: drawColor, width: drawSize, x1: s.x, y1: s.y, x2: pos.x, y2: pos.y };
    }
    currentPath.current = [];
    if (newStroke) saveStrokes([...strokesRef.current, newStroke]);
  }, [drawTool, drawColor, drawSize, getPos, saveStrokes]);

  const toolbarStyle = {
    display: "flex", alignItems: "center", gap: 4,
    padding: "4px 8px",
    background: "var(--surface-overlay)",
    borderBottom: "1px solid var(--border-subtle)",
    flexShrink: 0,
  };

  const effectiveContainerId = containerId || module?.id;

  return (
    <div
      data-container-id={effectiveContainerId}
      style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
    >
      {/* Draw toolbar */}
      <div style={toolbarStyle} onPointerDown={e => e.stopPropagation()}>
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
        <button onClick={() => saveStrokes([])} title="Clear drawing"
          style={{ background: "none", border: "1px solid transparent", borderRadius: 5, padding: "3px 5px", cursor: "pointer", color: "var(--text-faint)", display: "flex", alignItems: "center" }}>
          <Trash2 style={{ width: 12, height: 12 }} />
        </button>
      </div>

      {/* Canvas area — pointer events here for drawing; canvas element always pointer-events:none so drops work */}
      <div
        ref={listDropRef}
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
        {/* Floating instance cards */}
        {itemsWithOccurrences.map(({ instance, occurrence: occ }) => (
          <CanvasCard
            key={occ.id}
            instance={instance}
            occurrence={occ}
            dispatch={dispatch}
            socket={socket}
            containerId={containerId}
            panelId={panelId}
            style={{ zIndex: drawTool === "select" ? 1 : 5, pointerEvents: drawTool === "select" ? "all" : "none" }}
          />
        ))}
        {itemsWithOccurrences.length === 0 && drawTool === "select" && (
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-mono)", pointerEvents: "none", textAlign: "center", lineHeight: 1.6 }}>
            Double-click to add cards<br />or pick a draw tool above
          </div>
        )}
      </div>
    </div>
  );
});
