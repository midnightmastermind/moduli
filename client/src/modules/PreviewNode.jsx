// modules/PreviewNode.jsx
// Preview card component for folder page views.
// Shows a module occurrence as a card with iframe content preview.
// Click triggers drilldown animation.
//
// Uses ?previewOcc=<occId> iframe that loads PagePreviewApp — a lightweight
// app that connects via socket with previewOcc param to get only the
// occurrence subtree needed.

import React, { useRef, useEffect, useContext, useState } from "react";
import { FileText, Layout, Paintbrush, Monitor, Folder, Hash, File } from "lucide-react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { GridActionsContext } from "../GridActionsContext.js";

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

function getColor(module) {
  if (!module) return "var(--text-secondary)";
  const kind = module.kind;
  const role = module.role;
  if (kind === "folder") return "#f59e0b";
  if (role === "page") return "#06b6d4";
  if (role === "container") return "rgba(134,239,172,0.9)";
  return "rgba(100,180,255,0.9)";
}

// Iframe preview — loads /?previewOcc=<occId> which renders PagePreviewApp
function IframePreview({ occurrenceId, landscape = false }) {
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef(null);
  const [scale, setScale] = useState(0.15);
  const iframeW = landscape ? 560 : 600;
  const iframeH = landscape ? 380 : 800;

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width } = entry.contentRect;
      if (width > 0) setScale(width / iframeW);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [iframeW]);

  if (!occurrenceId) {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <File size={20} style={{ color: "var(--text-faint)", opacity: 0.3 }} />
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden" }}>
      <iframe
        src={`/?previewOcc=${occurrenceId}`}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: iframeW,
          height: iframeH,
          border: "none",
          transformOrigin: "top left",
          transform: `scale(${scale})`,
          pointerEvents: "none",
          opacity: loaded ? 1 : 0,
          transition: "opacity 0.3s ease",
        }}
        title="Preview"
        onLoad={() => setLoaded(true)}
        tabIndex={-1}
      />
      {!loaded && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--text-faint)", fontSize: 10,
        }}>
          …
        </div>
      )}
    </div>
  );
}

export default function PreviewNode({
  occurrence,
  module,
  onDrillDown,
  isAnimating = false,
  loadPreview = true,
  loadIndex = 0,
  style: extraStyle,
  className = "",
}) {
  const ref = useRef(null);
  const Icon = getIcon(module);
  const color = getColor(module);
  const label = module?.label || "Untitled";
  const kind = module?.kind;
  const role = module?.role;

  // Drag setup
  useEffect(() => {
    if (!ref.current || !module) return;
    return draggable({
      element: ref.current,
      getInitialData: () => ({
        type: "module",
        sourceType: "folder-node",
        role: role || "container",
        id: module.id,
        data: module,
        occurrenceId: occurrence?.id,
      }),
    });
  }, [module, occurrence?.id, role]);

  const canDrillDown = role === "page" || kind === "folder";
  const isLandscape = kind === "folder";

  return (
    <div
      ref={ref}
      className={`preview-node-card${isLandscape ? " preview-node-landscape" : ""} ${className}`}
      data-preview-node-id={occurrence?.id}
      data-occurrence-id={occurrence?.id}
      onClick={(e) => {
        if (isAnimating || !canDrillDown) return;
        onDrillDown?.(occurrence?.id, ref.current);
      }}
      style={extraStyle}
    >
      <div className="preview-node-preview" style={isLandscape ? { aspectRatio: "4 / 3" } : undefined}>
        {loadPreview
          ? <IframePreview occurrenceId={occurrence?.id} landscape={isLandscape} />
          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <File size={20} style={{ color: "var(--text-faint)", opacity: 0.3 }} />
            </div>
        }
      </div>
      <div className="preview-node-title">
        <Icon size={10} style={{ color, flexShrink: 0 }} />
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
      </div>
    </div>
  );
}
