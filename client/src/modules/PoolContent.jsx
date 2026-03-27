// modules/PoolContent.jsx
// PoolPill — draggable item in a pool container.
// Extracted from containerHelpers.jsx.

import React, { useRef, useState, useEffect } from "react";
import { X } from "lucide-react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";

export const PoolContent = React.memo(function PoolContent({ instanceModule, occurrence, onDelete }) {
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

// Named alias for backward compatibility with containerHelpers.jsx imports
export const PoolPill = PoolContent;

export default PoolContent;
