// modules/PreviewContent.jsx
// ============================================================
// PREVIEW VIEW: Thumbnail card for artifact occurrences.
// viewType: "preview" — shows thumbnail + label + drilldown + embed actions.
// Draggable via Pragmatic DnD (type: "module") — drop on a doc to embed.
// ============================================================
import { useContext, useEffect, useRef } from "react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { GridActionsContext, useGridActions } from "../GridActionsContext.js";
import { updateView } from "../helpers/CommitHelpers.js";

const ICON = {
  image: "🖼",
  pdf: "📄",
  audio: "🎵",
  video: "🎬",
  markdown: "📝",
  doc: "📝",
  code: "💻",
  grid: "📊",
  default: "📁",
};

export default function PreviewContent({ occurrence, view, dispatch, socket }) {
  const { modulesById } = useGridActions();
  const dragRef = useRef(null);

  const module = occurrence?.moduleId ? modulesById?.[occurrence.moduleId] : null;
  const label = module?.label || "Untitled";
  const fileRef = module?.fileRef;
  const artifactType = view?.artifactType;
  const fileUrl = fileRef ? `/uploads/${fileRef}` : null;

  // Full view type to switch to when clicking "View Full"
  const fullViewType = artifactType ? "display" : (view?.viewType === "preview" ? "markdown" : view?.viewType ?? "display");

  // Wire Pragmatic DnD so card can be dropped into docs or onto the grid
  useEffect(() => {
    const el = dragRef.current;
    if (!el || !occurrence) return;
    return draggable(el, {
      getInitialData: () => ({
        type: "module",
        sourceType: "preview-card",
        role: module?.role ?? "instance",
        id: module?.id,
        occurrenceId: occurrence.id,
        label,
      }),
    });
  }, [occurrence?.id, module?.id]);

  const handleViewFull = () => {
    if (!view?.id) return;
    updateView({ dispatch, socket, view: { id: view.id, viewType: fullViewType } });
  };

  // Thumbnail
  let thumbnail;
  if (artifactType === "image" && fileUrl) {
    thumbnail = (
      <img
        src={fileUrl}
        alt={label}
        style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 4, display: "block" }}
      />
    );
  } else if (artifactType === "video" && fileUrl) {
    thumbnail = (
      <video
        src={fileUrl}
        style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 4, display: "block" }}
        muted
        preload="metadata"
      />
    );
  } else {
    // Icon fallback for pdf, audio, markdown, doc, code, grid
    const icon = ICON[artifactType] ?? ICON[view?.viewType] ?? ICON.default;
    thumbnail = (
      <div style={{
        height: 120, display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--input-bg)", borderRadius: 4, fontSize: 40,
      }}>
        {icon}
      </div>
    );
  }

  return (
    <div
      ref={dragRef}
      style={{
        display: "flex", flexDirection: "column", gap: 8,
        padding: 10, cursor: "grab", userSelect: "none",
        height: "100%", boxSizing: "border-box",
      }}
    >
      {thumbnail}

      {/* Label */}
      <div style={{
        fontSize: 12, fontWeight: 600, fontFamily: "var(--font-mono)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        opacity: 0.9,
      }}>
        {label}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 6, marginTop: "auto" }}>
        <button
          onClick={handleViewFull}
          style={{
            flex: 1, padding: "3px 0", fontSize: 11, fontFamily: "var(--font-mono)",
            background: "var(--border-subtle)", border: "1px solid var(--border-default)",
            borderRadius: 4, color: "inherit", cursor: "pointer",
          }}
          title="Switch to full view"
        >
          View Full
        </button>
      </div>
    </div>
  );
}
