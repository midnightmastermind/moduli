// modules/containerHelpers.jsx
// Small sub-components used by Container.jsx
// Extracted to reduce Container.jsx size.

import React, { useRef, useState, useCallback, useEffect } from "react";
import Editor from "../ui/Editor";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { Lock, Unlock, X } from "lucide-react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";

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
export const CanvasCard = React.memo(function CanvasCard({ instance, occurrence, dispatch, socket }) {
  const dragRef = useRef(null);
  const startPosRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const [pos, setPos] = useState({ x: occurrence?.meta?.x ?? 20, y: occurrence?.meta?.y ?? 20 });
  const [dragging, setDragging] = useState(false);

  // Sync if occurrence meta.x/y changes externally
  React.useEffect(() => {
    setPos({ x: occurrence?.meta?.x ?? 20, y: occurrence?.meta?.y ?? 20 });
  }, [occurrence?.meta?.x, occurrence?.meta?.y]);

  const onPointerDown = useCallback((e) => {
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
    // Persist new position to DB
    if (occurrence?.id) {
      CommitHelpers.updateOccurrence({ dispatch, socket,
        occurrence: { ...occurrence, meta: { ...(occurrence.meta || {}), x: pos.x, y: pos.y } },
        emit: true });
    }
  }, [dragging, occurrence, pos, dispatch, socket]);

  return (
    <div
      ref={dragRef}
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
        zIndex: dragging ? 100 : 1,
        userSelect: "none", WebkitUserSelect: "none",
        transition: dragging ? "none" : "box-shadow 0.15s",
      }}
    >
      <div style={{ fontSize: 11, color: "var(--text-primary)", fontFamily: "var(--font-mono)", marginBottom: 2 }}>
        {instance.label || "Untitled"}
      </div>
      {/* Field pills row */}
      {(instance.fieldBindings || []).slice(0, 3).map(b => (
        <span key={b.fieldId} style={{ display: "inline-block", fontSize: 9, background: "rgba(134,239,172,0.08)", border: "1px solid rgba(134,239,172,0.2)", borderRadius: 999, padding: "1px 5px", marginRight: 3, color: "rgba(134,239,172,0.7)" }}>
          {b.fieldId.slice(0, 6)}
        </span>
      ))}
    </div>
  );
});
