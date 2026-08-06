// ui/RepresentationView.jsx
//
// Compact `[thumb] [Icon] Label` chip representing an occurrence without
// rendering its content. Used by the representation view mode (see
// `helpers/viewMode.js`): mind-map nodes, value-builder breadcrumb crumbs,
// search results, anywhere an occurrence reference needs a stable visual
// tag. Also serves as the canvas-pill primitive — task #35 merged the
// (previously planned) standalone CanvasPill into this view per user
// direction 2026-05-22 ("just merge this with the representation view
// cause i want type in there too").
//
// Behaviour:
//   - Renders a thumbnail (left) if the occurrence has a media-role
//     binding with a value (same field used by ArtifactCard/ModuleInstance
//     poster pipeline). Falls back to the type icon when no media exists.
//   - Hover with delay → popup with the ACTUAL component (full
//     ModuleInstance render). Closes on mouse-leave or escape.
//   - Click invokes `onJump` (jump-to-source pattern — opens the page the
//     source occurrence lives on, scrolls to it, briefly highlights).
//
// Future (task #36 Layout cascade): the cascade decides per-kind whether
// this view is the default for a given container/page (folder-page →
// Representation; canvas → Representation; page in container → forced
// Representation). The `fieldIds` prop (when set) limits which fields the
// HOVER POPUP shows on the embedded ModuleInstance — set per-occurrence
// from the user via Layout cascade UI (task #36).

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useGridActions } from "../GridActionsContext";
import { getModuleTypeIcon, getModuleTypeColor } from "../helpers/moduleIcons";
import { resolveLabelTokens } from "../helpers/labelTokens";
import { resolveEffectiveLayout } from "../helpers/layoutCascade";
import { primaryMediaOf } from "../helpers/occurrenceMedia";
// Static import — ModuleInstance is statically imported elsewhere
// (ModuleContainer, ContainerTable, PageCanvas, ModuleEmbedNode), so
// the earlier dynamic-import-for-lazy-load was useless: Vite couldn't
// split it into its own chunk and emitted a `dynamic import will not
// move module into another chunk` warning. Importing it here directly
// fixes the warning at zero cost (already in the main bundle).
import ModuleInstanceComponent from "../modules/ModuleInstance.jsx";

const HOVER_OPEN_MS = 320;
const HOVER_CLOSE_MS = 140;

export default function RepresentationView({
  occurrence,
  onJump,
  size = "md",          // "sm" | "md" | "lg"
  showBreadcrumb = false,
  className = "",
  style: extraStyle,
  // task #35 — opt-in hover popup with the actual component. Off by default
  // so legacy callers (compact breadcrumb crumbs) aren't affected.
  enableHoverPopup = false,
  // task #35 / #36 — optional whitelist of fields to render inside the hover
  // popup. Null = ModuleInstance default. Pass [] for label-only.
  popupFieldIds = null,
  // task #35 — optional whitelist of fields to render INLINE on the chip
  // next to the label. Resolved per-occurrence — defaults to the
  // `occurrence.meta.representationFieldIds` value (which the layout cascade
  // or the user populates from the LayoutCascadeEditor). Pass [] to force
  // label-only; pass null to allow the cascade fallback.
  inlineFieldIds = null,
}) {
  const { modulesById, occurrencesById, fieldsById } = useGridActions() || {};
  const module = occurrence?.moduleId ? modulesById?.[occurrence.moduleId] : null;
  const Icon = getModuleTypeIcon(module);
  const color = getModuleTypeColor(module);
  // "[Field Name]" tokens in the label render the occurrence's live value
  // (helpers/labelTokens.js) — chips mirror the interpolated instance label.
  const label = resolveLabelTokens(
    module?.label || occurrence?.label || "Untitled", occurrence, fieldsById);

  // Resolve which fields render inline next to the label. Precedence:
  //   1) explicit `inlineFieldIds` prop
  //   2) per-occurrence `meta.representationFieldIds`
  //   3) layout cascade's `representationFieldIds` (resolved through the
  //      cascade chain — set by LayoutCascadeEditor at any level)
  const cascadeInlineFieldIds = (() => {
    if (!occurrence || !occurrencesById || !modulesById) return null;
    try {
      const layout = resolveEffectiveLayout({ occurrence, occurrencesById, modulesById, grid: null });
      return Array.isArray(layout?.representationFieldIds) ? layout.representationFieldIds : null;
    } catch {
      return null;
    }
  })();
  const resolvedInlineFieldIds = (Array.isArray(inlineFieldIds))
    ? inlineFieldIds
    : (Array.isArray(occurrence?.meta?.representationFieldIds)
        ? occurrence.meta.representationFieldIds
        : cascadeInlineFieldIds);
  const inlineFields = (resolvedInlineFieldIds && resolvedInlineFieldIds.length > 0 && fieldsById)
    ? resolvedInlineFieldIds.map(fid => {
        const f = fieldsById[fid];
        const v = occurrence?.fields?.[fid]?.value;
        if (!f) return null;
        return { id: fid, name: f.name || f.id, value: v };
      }).filter(Boolean)
    : [];

  // Resolve the poster through helpers/occurrenceMedia — the media value is an
  // artifact OCCURRENCE ID, so the thumbnail is the artifact's own fileRef.
  // Every thumbnail site reads through that one resolver (2026-08-06).
  const mediaSrc = primaryMediaOf(occurrence, { occurrencesById, modulesById, fieldsById })?.src || null;

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

  // Hover-popup state (task #35). Opens after HOVER_OPEN_MS to avoid
  // flashing on transient mouse-over; closes after HOVER_CLOSE_MS so the
  // user has a moment to move into the popup if they want to interact.
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupPos, setPopupPos] = useState(null);
  const wrapRef = useRef(null);
  const openTimerRef = useRef(null);
  const closeTimerRef = useRef(null);
  useEffect(() => () => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const openPopup = () => {
    if (!enableHoverPopup) return;
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    if (openTimerRef.current) return;
    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null;
      const rect = wrapRef.current?.getBoundingClientRect();
      if (rect) setPopupPos({ x: rect.left, y: rect.bottom + 6 });
      setPopupOpen(true);
    }, HOVER_OPEN_MS);
  };
  const closePopup = () => {
    if (openTimerRef.current) { clearTimeout(openTimerRef.current); openTimerRef.current = null; }
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setPopupOpen(false);
    }, HOVER_CLOSE_MS);
  };

  return (
    <>
      <div
        ref={wrapRef}
        className={`representation-view ${className}`}
        data-occurrence-id={occurrence?.id}
        onClick={(e) => {
          if (!onJump || !occurrence?.id) return;
          e.stopPropagation();
          onJump(occurrence.id);
        }}
        onMouseEnter={openPopup}
        onMouseLeave={closePopup}
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
        {mediaSrc ? (
          <img
            src={mediaSrc}
            alt=""
            style={{
              width: sizing.thumb, height: sizing.thumb,
              objectFit: "cover", borderRadius: 2,
              flexShrink: 0,
            }}
          />
        ) : (
          <Icon size={sizing.icon} style={{ color, flexShrink: 0 }} />
        )}
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
        {/* User-configured inline field values (task #35). Compact name:value
            chips after the label. Empty values render as `—` so authors can
            see the field is bound but unset. */}
        {inlineFields.map(({ id, name, value }) => (
          <span
            key={id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              padding: "0 4px",
              borderRadius: 2,
              fontSize: sizing.fontSize - 1,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.06)",
              color: "var(--text-muted)",
              flexShrink: 0,
              maxWidth: 100,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={`${name}: ${formatInlineValue(value)}`}
          >
            <span style={{ opacity: 0.65 }}>{name}</span>
            <span style={{ color: "var(--text-primary)" }}>
              {formatInlineValue(value)}
            </span>
          </span>
        ))}
        {/* Type icon — small badge after the label when we showed a thumb
            (otherwise the leading Icon already conveys type). */}
        {mediaSrc && (
          <Icon size={sizing.icon - 1} style={{ color, opacity: 0.6, flexShrink: 0 }} />
        )}
      </div>
      {enableHoverPopup && popupOpen && popupPos && createPortal(
        <RepresentationHoverPopup
          occurrence={occurrence}
          module={module}
          x={popupPos.x}
          y={popupPos.y}
          popupFieldIds={popupFieldIds}
          onMouseEnter={() => { if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; } }}
          onMouseLeave={closePopup}
        />,
        document.body
      )}
    </>
  );
}

// Hover popup renderer. Mounts ModuleInstance for instance / artifact /
// textblock occurrences. ModuleInstance is statically imported at the top
// of the file (other modules pull it into the main bundle anyway, so the
// previous lazy-import was a no-op that Vite warned about).
function RepresentationHoverPopup({ occurrence, module, x, y, popupFieldIds, onMouseEnter, onMouseLeave }) {
  const Comp = ModuleInstanceComponent;
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "fixed",
        left: x,
        top: y,
        zIndex: 9000,
        maxWidth: 360,
        minWidth: 240,
        padding: 8,
        background: "var(--surface, #1f2125)",
        border: "1px solid var(--border-default, rgba(255,255,255,0.12))",
        borderRadius: 8,
        boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
      }}
    >
      {Comp ? (
        <Comp
          module={module}
          occurrence={occurrence}
          // No drag/socket/dispatch — read-only preview. Field-visibility
          // whitelist sets which fields render (task #35 user-configurable).
          fieldVisibilityOverride={Array.isArray(popupFieldIds) ? { mode: "show", fieldIds: popupFieldIds } : null}
        />
      ) : (
        <div style={{ fontSize: 12, opacity: 0.7 }}>{module?.label || occurrence?.label || "Loading…"}</div>
      )}
    </div>
  );
}

const SIZE_MAP = {
  sm: { gap: 3, padding: "1px 5px", radius: 3, fontSize: 9,  icon: 9,  thumb: 14 },
  md: { gap: 4, padding: "3px 7px", radius: 4, fontSize: 11, icon: 11, thumb: 18 },
  lg: { gap: 5, padding: "4px 9px", radius: 5, fontSize: 13, icon: 14, thumb: 24 },
};

// Compact display of an arbitrary field value for the inline chip. Handles
// the common cases without pulling in Field.jsx's full formatter.
function formatInlineValue(v) {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "✓" : "✗";
  if (Array.isArray(v)) return v.length === 0 ? "—" : `${v.length} sel`;
  if (typeof v === "object") return "{…}";
  const s = String(v);
  return s.length > 12 ? s.slice(0, 11) + "…" : s;
}

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
