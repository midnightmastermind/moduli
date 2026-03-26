// modules/ModuleInstance.jsx
// Instance wrapper within a Container — handles drag/drop, context menu, and doc toggle.
// Extracted from Container.jsx to reduce file size.

import React, { useState, useCallback, useRef } from "react";
import ContextMenu from "../ui/ContextMenu";
import * as CommitHelpers from "../helpers/CommitHelpers";
import {
  useDragDrop,
  useDragContext,
  DragType,
  DropAccepts,
} from "../helpers/dragSystem";
import { Copy, Trash2, Link2, Focus } from "lucide-react";
import Instance from "./Instance.jsx";
import { DocEditorShell } from "./containerHelpers.jsx";
import { hexToRgba } from "../helpers/colorHelpers.js";

// ============================================================
// MODULE INSTANCE (was SortableInstance.jsx — used within Container only)
// ============================================================
function ModuleInstance({
  module,
  occurrence,
  containerId,
  panelId,
  panel,
  container,
  containerOccurrence,
  dispatch,
  socket,
  allowedEdges = ["top", "bottom"],
  onInstanceFocus,
}) {
  const dragCtx = useDragContext();
  const { isContainerDrag } = dragCtx;
  const [ctxMenu, setCtxMenu] = useState(null);
  const [showDoc, setShowDoc] = useState(false);

  const handleContextMenu = useCallback((e) => {
    if ("ontouchstart" in window) return;
    e.preventDefault();
    e.stopPropagation();
    const items = [
      onInstanceFocus && { label: "Focus", icon: Focus, onClick: () => onInstanceFocus(module, occurrence) },
      onInstanceFocus && { separator: true },
      {
        label: "Copy instance",
        icon: Copy,
        onClick: () => {
          const newInstance = { ...module, id: crypto.randomUUID(), label: `${module.label} (Copy)` };
          CommitHelpers.createInstanceInContainer({ dispatch, socket, containerId, instance: newInstance, emit: true });
        },
      },
      {
        label: "Remove from container", icon: Trash2, danger: true,
        onClick: () => {
          if (!occurrence?.id) return;
          CommitHelpers.removeOccurrence({ dispatch, socket, occurrenceId: occurrence.id, parentOccurrence: containerOccurrence || null, emit: true });
        },
      },
    ].filter(Boolean);
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, [module, occurrence, containerId, containerOccurrence, onInstanceFocus, dispatch, socket]);

  const handleRef = useRef(null);

  const { ref, isDragging, isOver, closestEdge, props } = useDragDrop({
    type: DragType.INSTANCE,
    id: module.id,
    data: { ...module, occurrence },
    context: { containerId, panelId, instanceId: module.id, occurrenceId: occurrence?.id },
    disabled: isContainerDrag,
    nativeEnabled: true,
    accepts: DropAccepts.INSTANCE,
    allowedEdges,
    dragHandleRef: handleRef,
  });

  const toggleDoc = () => setShowDoc(v => !v);

  return (
    <div
      ref={ref}
      data-instance-id={module.id}
      data-occurrence-id={occurrence?.id}
      data-testid="instance-wrap"
      tabIndex={0}
      className="no-select instance-wrap"
      style={{
        touchAction: "manipulation", userSelect: "none", WebkitUserSelect: "none",
        opacity: isDragging ? 0.4 : 1,
        background: "transparent", borderRadius: 4,
        transition: "opacity 0.1s", marginBottom: 2, position: "relative",
      }}
      {...props}
      onContextMenu={handleContextMenu}
    >
      <ContextMenu ctx={ctxMenu} onClose={() => setCtxMenu(null)} />

      {isOver && closestEdge === "top" && <div className="drop-indicator drop-indicator-inst-top" />}
      {isOver && closestEdge === "bottom" && <div className="drop-indicator drop-indicator-inst-bottom" />}
      {isOver && closestEdge === "left" && <div className="drop-indicator drop-indicator-inst-left" />}
      {isOver && closestEdge === "right" && <div className="drop-indicator drop-indicator-inst-right" />}

      {occurrence?.linkedGroupId && (
        <Link2 title="Linked copy" className="linked-copy-badge" />
      )}

      <Instance
        id={module.id}
        label={module.label}
        instance={module}
        occurrence={occurrence}
        panel={panel}
        container={container}
        dispatch={dispatch}
        socket={socket}
        dragHandleRef={handleRef}
        toggleDoc={toggleDoc}
        onDoubleClick={onInstanceFocus ? () => onInstanceFocus(module, occurrence) : undefined}
      />
      {occurrence && showDoc && (() => {
        const bg = container?.ownStyle?.bg || null;
        return (
          <div style={{
            borderLeft: `2px solid ${hexToRgba(bg, 0.45) ?? "rgba(255,255,255,0.08)"}`,
            background: hexToRgba(bg, 0.06) ?? "transparent",
            marginLeft: 4,
          }}>
            <DocEditorShell occurrence={occurrence} dispatch={dispatch} socket={socket} hideToolbar={true} />
          </div>
        );
      })()}
    </div>
  );
}

export default React.memo(ModuleInstance);
