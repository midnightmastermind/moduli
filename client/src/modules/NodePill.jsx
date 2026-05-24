// modules/NodePill.jsx
// Compact draggable pill representing any module in the manifest tree or folder views.
// Two variants: "compact" (tight tree sidebar) and "entity" (DraggableEntityRow style).

import React, { useRef, useEffect } from "react";
import { GripVertical } from "lucide-react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { getModuleTypeIcon, getModuleTypeColor } from "../helpers/moduleIcons";

// Pulls the shared icon + color from helpers/moduleIcons. The local
// getColor wrapper preserves the legacy active/inactive dim: inactive
// rows render the shared color with reduced opacity so the active row
// pops. The shared color is returned at full opacity by default.
function getColor(module, isActive) {
  const baseColor = getModuleTypeColor(module);
  if (isActive) return baseColor;
  // Inactive: dim by appending or substituting 0.7 alpha. Works for
  // rgba(...) strings and hex (fallback to opacity wrapper for hex).
  if (typeof baseColor === "string" && baseColor.startsWith("rgba(")) {
    return baseColor.replace(/[\d.]+\)$/, "0.7)");
  }
  return baseColor;
}

export default function NodePill({
  occurrence,
  module,
  onClick,
  isActive = false,
  depth = 0,
  dragType = "module",
  dragData,
  externalDragData = null,
  variant = "entity",
  reverseIndent = false,
  style: extraStyle,
  children,
  leadingSlot,
  // Optional hover tooltip — surfaces the artifact's original filename +
  // human-readable file size (per file/artifact audit gap #5). Falls back
  // to label + kind when no explicit title is provided.
  title,
}) {
  const ref = useRef(null);
  const Icon = getModuleTypeIcon(module);
  const color = getColor(module, isActive);
  const label = module?.label || "Untitled";

  useEffect(() => {
    if (!ref.current || !dragData) return;
    return draggable({
      element: ref.current,
      getInitialData: () => dragData,
      // Pragmatic exposes `getInitialDataForExternal` for stamping
      // non-app data formats (text/uri-list, DownloadURL, etc.) so
      // dragging the pill OUT of the browser triggers a save-as
      // instead of doing nothing. Docket §8 gap #24.
      ...(externalDragData ? { getInitialDataForExternal: () => externalDragData } : {}),
    });
  }, [dragData, externalDragData]);

  const isEntity = variant === "entity";
  // Depth indentation lives OUTSIDE the pill (the row wrapper applies
  // marginLeft based on depth). Pill keeps a constant base padding so the
  // content sits tight against the left edge of the pill body.
  const basePaddingLeft = isEntity ? 6 : 4;
  const indentedPaddingLeft = basePaddingLeft;

  return (
    <div
      ref={ref}
      onClick={onClick}
      title={title}
      style={{
        display: "flex",
        flexDirection: reverseIndent ? "row-reverse" : "row",
        alignItems: "center",
        gap: isEntity ? 5 : 3,
        padding: isEntity ? "5px 8px" : "1px 5px 1px 4px",
        paddingLeft: indentedPaddingLeft,
        paddingRight: isEntity ? 8 : 5,
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
        boxSizing: "border-box",
        ...extraStyle,
      }}
    >
      {isEntity && (
        <GripVertical size={10} style={{ opacity: 0.35, flexShrink: 0 }} />
      )}
      {leadingSlot}
      <Icon size={isEntity ? 10 : 9} style={{ color, flexShrink: 0 }} />
      <span
        style={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: isEntity ? 11 : 10,
          fontFamily: "var(--font-mono)",
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}
