// ui/RepresentationView.jsx
//
// Compact `[Icon] Label` chip representing an occurrence without rendering
// its content. Used by the representation view mode (see
// `helpers/viewMode.js`): mind-map nodes, value-builder breadcrumb crumbs,
// search results, anywhere an occurrence reference needs a stable visual
// tag.
//
// Click invokes `onJump` (jump-to-source pattern — opens the page the
// source occurrence lives on, scrolls to it, briefly highlights). The
// jump-to helper itself lives outside this component; callers pass an
// `onJump(occurrenceId)` callback.

import React, { useContext } from "react";
import { GridActionsContext } from "../GridActionsContext";
import { getModuleTypeIcon, getModuleTypeColor } from "../helpers/moduleIcons";

export default function RepresentationView({
  occurrence,
  onJump,
  size = "md",          // "sm" | "md" | "lg"
  showBreadcrumb = false,
  className = "",
  style: extraStyle,
}) {
  const { modulesById, occurrencesById } = useContext(GridActionsContext) || {};
  const module = occurrence?.moduleId ? modulesById?.[occurrence.moduleId] : null;
  const Icon = getModuleTypeIcon(module);
  const color = getModuleTypeColor(module);
  const label = module?.label || occurrence?.label || "Untitled";

  // Optional ancestor breadcrumb — walks `parentId` two levels up. Kept
  // shallow on purpose; the value-builder card spec calls for deeper
  // breadcrumbs but those render OUTSIDE this component.
  const breadcrumb = (() => {
    if (!showBreadcrumb || !occurrence?.parentId || !occurrencesById) return null;
    const parent = occurrencesById[occurrence.parentId];
    const parentMod = parent?.moduleId ? modulesById?.[parent.moduleId] : null;
    const parentLabel = parentMod?.label || parent?.label;
    return parentLabel ? `${parentLabel} ›` : null;
  })();

  const sizing = SIZE_MAP[size] || SIZE_MAP.md;

  return (
    <div
      className={`representation-view ${className}`}
      data-occurrence-id={occurrence?.id}
      onClick={(e) => {
        if (!onJump || !occurrence?.id) return;
        e.stopPropagation();
        onJump(occurrence.id);
      }}
      title={onJump ? `Jump to ${label}` : label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sizing.gap,
        padding: sizing.padding,
        borderRadius: sizing.radius,
        border: `1px solid ${dimColor(color, 0.35)}`,
        background: dimColor(color, 0.10),
        fontSize: sizing.fontSize,
        lineHeight: 1,
        fontFamily: "var(--font-mono)",
        color: "var(--text-primary)",
        cursor: onJump ? "pointer" : "default",
        userSelect: "none",
        whiteSpace: "nowrap",
        overflow: "hidden",
        maxWidth: "100%",
        ...extraStyle,
      }}
    >
      <Icon size={sizing.icon} style={{ color, flexShrink: 0 }} />
      {breadcrumb && (
        <span style={{ opacity: 0.55, fontSize: sizing.fontSize - 1 }}>
          {breadcrumb}
        </span>
      )}
      <span
        style={{
          flex: "0 1 auto",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </span>
    </div>
  );
}

const SIZE_MAP = {
  sm: { gap: 3, padding: "1px 5px", radius: 3, fontSize: 9,  icon: 9  },
  md: { gap: 4, padding: "3px 7px", radius: 4, fontSize: 11, icon: 11 },
  lg: { gap: 5, padding: "4px 9px", radius: 5, fontSize: 13, icon: 14 },
};

// Best-effort opacity-dim for a color string. Handles `rgba(...)` and
// falls back to wrapping in a `color-mix()` for hex / named colors.
function dimColor(color, alpha) {
  if (typeof color !== "string") return color;
  if (color.startsWith("rgba(")) {
    return color.replace(/[\d.]+\)$/, `${alpha})`);
  }
  // CSS `color-mix` requires a baseline browser; fallback to a flat
  // semi-transparent overlay otherwise.
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}
