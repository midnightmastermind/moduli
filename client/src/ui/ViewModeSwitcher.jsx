// ui/ViewModeSwitcher.jsx
//
// 3-button segmented control for switching an occurrence's render mode.
// Drives the representation view-toggle (see `helpers/viewMode.js`).
//
// Three input forms (priority order):
//   1. `allowedModes` + `allowChange` — layout cascade output. Strongest.
//   2. `contextTag` — legacy context-tag based defaults (folderPage / mindMap).
//   3. fallback to "default" context.
// When `allowChange === false`, the switcher renders nothing.

import React from "react";
import { Eye, Tag, Layers } from "lucide-react";
import {
  VIEW_MODE_LABELS,
  getAllowedViewModes,
  getEffectiveViewMode,
} from "../helpers/viewMode";

// Curated mode icons — paired with the labels for the 3 modes.
const MODE_ICON = {
  preview:        Eye,
  representation: Tag,
  actual:         Layers,
  "actual-converted": Layers,
};

export default function ViewModeSwitcher({
  occurrence,
  contextTag = "default",
  allowedModes = null,    // layout cascade — array of allowed modes (overrides contextTag)
  allowChange = true,     // layout cascade — false hides the switcher entirely
  onChange,
  size = "md",          // "sm" | "md"
  className = "",
}) {
  if (!allowChange) return null;
  const allowed = allowedModes ?? getAllowedViewModes(contextTag);
  if (!allowed || allowed.length === 0) return null;
  // For "current" resolution: stored value wins if allowed; else first allowed.
  const stored = occurrence?.meta?.viewMode;
  const current = (stored && allowed.includes(stored))
    ? stored
    : (allowedModes ? allowed[0] : getEffectiveViewMode(occurrence, contextTag));
  const sz = size === "sm" ? SIZES.sm : SIZES.md;

  return (
    <div
      className={`view-mode-switcher ${className}`}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        display: "inline-flex",
        gap: 0,
        borderRadius: sz.radius,
        border: "1px solid var(--border-default)",
        overflow: "hidden",
        background: "var(--input-bg)",
      }}
    >
      {allowed.map((mode) => {
        const Icon = MODE_ICON[mode];
        const isActive = current === mode;
        return (
          <button
            key={mode}
            type="button"
            title={VIEW_MODE_LABELS[mode]}
            aria-label={VIEW_MODE_LABELS[mode]}
            aria-pressed={isActive}
            onClick={(e) => {
              e.stopPropagation();
              if (isActive) return;
              onChange?.(mode);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              padding: sz.padding,
              fontSize: sz.fontSize,
              fontFamily: "var(--font-mono)",
              border: "none",
              background: isActive ? "var(--accent-blue-bg)" : "transparent",
              color: isActive ? "var(--accent-blue-text)" : "var(--text-muted)",
              cursor: isActive ? "default" : "pointer",
              lineHeight: 1,
            }}
          >
            {Icon ? <Icon size={sz.icon} /> : null}
          </button>
        );
      })}
    </div>
  );
}

const SIZES = {
  sm: { padding: "2px 5px", radius: 3, fontSize: 9,  icon: 10 },
  md: { padding: "3px 7px", radius: 4, fontSize: 10, icon: 12 },
};
