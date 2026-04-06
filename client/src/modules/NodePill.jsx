// modules/NodePill.jsx
// Compact draggable pill representing any module in the manifest tree or folder views.
// Two variants: "compact" (tight tree sidebar) and "entity" (DraggableEntityRow style).

import React, { useRef, useEffect } from "react";
import { FileText, Layout, Paintbrush, Monitor, Folder, Hash, File, GripVertical } from "lucide-react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";

const KIND_ICON = {
  board: Layout,
  canvas: Paintbrush,
  doc: FileText,
  display: Monitor,
  folder: Folder,
  artifact: FileText,
};

const ROLE_ICON = {
  page: Layout,
  container: Hash,
  instance: File,
};

function getIcon(module) {
  if (!module) return File;
  return KIND_ICON[module.kind] || ROLE_ICON[module.role] || File;
}

function getColor(module, isActive) {
  if (!module) return "var(--text-secondary)";
  const role = module.role;
  const kind = module.kind;
  if (kind === "folder") return isActive ? "#f59e0b" : "rgba(245,158,11,0.7)";
  if (role === "page") return isActive ? "#06b6d4" : "rgba(6,182,212,0.7)";
  if (role === "container") return isActive ? "rgba(134,239,172,1)" : "rgba(134,239,172,0.7)";
  return isActive ? "rgba(100,180,255,1)" : "rgba(100,180,255,0.7)";
}

export default function NodePill({
  occurrence,
  module,
  onClick,
  isActive = false,
  depth = 0,
  dragType = "module",
  dragData,
  variant = "entity",
  reverseIndent = false,
  style: extraStyle,
  children,
}) {
  const ref = useRef(null);
  const Icon = getIcon(module);
  const color = getColor(module, isActive);
  const label = module?.label || "Untitled";

  useEffect(() => {
    if (!ref.current || !dragData) return;
    return draggable({
      element: ref.current,
      getInitialData: () => dragData,
    });
  }, [dragData]);

  const isEntity = variant === "entity";

  return (
    <div
      ref={ref}
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: reverseIndent ? "row-reverse" : "row",
        alignItems: "center",
        gap: isEntity ? 5 : 3,
        padding: isEntity ? "5px 8px" : "1px 5px 1px 4px",
        paddingLeft: reverseIndent ? (isEntity ? 8 : 4) : (isEntity ? (depth * 12 + 8) : (depth * 4 + 4)),
        paddingRight: reverseIndent ? (isEntity ? (depth * 12 + 8) : (depth * 4 + 4)) : (isEntity ? 8 : 5),
        borderRadius: isEntity ? 6 : 4,
        border: isActive
          ? `1px solid ${color}`
          : `1px solid ${isEntity ? "var(--border-default)" : "transparent"}`,
        background: isActive
          ? `${color.replace(/[\d.]+\)$/, "0.08)")}`
          : (isEntity ? "var(--input-bg)" : "transparent"),
        cursor: "pointer",
        userSelect: "none",
        marginBottom: 0,
        ...extraStyle,
      }}
    >
      {isEntity && (
        <GripVertical size={10} style={{ opacity: 0.35, flexShrink: 0 }} />
      )}
      <Icon size={isEntity ? 10 : 9} style={{ color, flexShrink: 0 }} />
      <span
        style={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: isEntity ? 11 : 10,
          fontFamily: "var(--font-mono)",
          color: isActive ? color : "var(--text-secondary)",
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}
