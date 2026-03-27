// modules/containerHelpers.jsx — re-export stub.
// DocEditorShell → DocContent.jsx
// PoolPill → PoolContent.jsx
// CanvasDrawSection → CanvasContent.jsx
// CanvasCard stays here until ModuleInstance canvas branch is implemented.

export { DocContent, DocEditorShell } from "./DocContent.jsx";
export { PoolContent, PoolPill } from "./PoolContent.jsx";
export { CanvasContent, CanvasDrawSection } from "./CanvasContent.jsx";

// CanvasCard — still used by Container.jsx renderCanvasCard. Kept here until
// its canvas behavior is absorbed into ModuleInstance.
import React, { useRef, useState, useCallback, useEffect } from "react";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { GripVertical } from "lucide-react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { DragType } from "../helpers/dragSystem";

export const CanvasCard = React.memo(function CanvasCard({ module, occurrence, dispatch, socket, style, containerId, panelId, children }) {
  const cardRef = useRef(null);
  const dndHandleRef = useRef(null);
  const startPosRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const [pos, setPos] = useState({ x: occurrence?.meta?.x ?? 20, y: occurrence?.meta?.y ?? 20 });
  const [dragging, setDragging] = useState(false);

  // Sync if occurrence meta.x/y changes externally
  React.useEffect(() => {
    setPos({ x: occurrence?.meta?.x ?? 20, y: occurrence?.meta?.y ?? 20 });
  }, [occurrence?.meta?.x, occurrence?.meta?.y]);

  // Pragmatic DnD — drag OUT of canvas via the grip handle
  // Containers drag as CONTAINER type; everything else as INSTANCE
  useEffect(() => {
    const el = cardRef.current;
    const handle = dndHandleRef.current;
    if (!el || !handle) return;
    const dragType = module?.role === "container" ? DragType.CONTAINER : DragType.INSTANCE;
    return draggable({
      element: el,
      dragHandle: handle,
      getInitialData: () => ({
        type: dragType,
        id: module.id,
        data: { ...module, occurrence },
        context: { containerId, panelId, instanceId: module.id, occurrenceId: occurrence?.id },
      }),
    });
  }, [module?.id, module?.role, occurrence?.id, containerId, panelId]);

  const onPointerDown = useCallback((e) => {
    // Don't start canvas reposition if the DnD grip handle was clicked
    if (dndHandleRef.current?.contains(e.target)) return;
    // Don't capture interactive elements inside Instance/Container
    if (e.target.closest?.("input, button, textarea, [contenteditable], .radial-handle, [data-no-canvas-drag]")) return;
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
        minWidth: 160, maxWidth: 300,
        background: "var(--surface-overlay)",
        border: `1px solid ${dragging ? "rgba(99,102,241,0.6)" : "var(--input-border)"}`,
        borderRadius: 8,
        cursor: dragging ? "grabbing" : "default",
        boxShadow: dragging ? "0 8px 24px rgba(0,0,0,0.5)" : "0 2px 8px rgba(0,0,0,0.3)",
        ...style,
        zIndex: dragging ? 100 : 1,
        userSelect: "none", WebkitUserSelect: "none",
        transition: dragging ? "none" : "box-shadow 0.15s",
        overflow: "hidden",
      }}
    >
      {/* DnD grip — drag OUT of canvas to another container */}
      <div
        ref={dndHandleRef}
        data-dnd-handle="true"
        title="Drag to another panel"
        style={{
          position: "absolute", top: 3, right: 4, zIndex: 10,
          cursor: "grab", opacity: 0.3, display: "flex", alignItems: "center",
          padding: 2,
          pointerEvents: "auto",
        }}
        onPointerEnter={e => { e.currentTarget.style.opacity = "0.8"; }}
        onPointerLeave={e => { e.currentTarget.style.opacity = "0.3"; }}
      >
        <GripVertical size={10} />
      </div>
      {children}
    </div>
  );
});
