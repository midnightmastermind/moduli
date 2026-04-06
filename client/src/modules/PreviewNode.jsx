// modules/PreviewNode.jsx
// Preview card component for folder page views.
// Shows a module occurrence as a card with inline content preview from store data.
// Click triggers drilldown animation.
//
// Renders a lightweight mini-preview using occurrencesById/modulesById from context.
// No iframes, no server requests, no socket connections.

import React, { useRef, useEffect, useContext, useMemo } from "react";
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

// Extract first few text snippets from TipTap JSON for doc preview
function extractTextSnippets(textmap, maxLines = 4) {
  if (!textmap?.content) return [];
  const lines = [];
  for (const node of textmap.content) {
    if (lines.length >= maxLines) break;
    if (node.type === "heading" || node.type === "paragraph") {
      const text = (node.content || [])
        .filter(n => n.type === "text")
        .map(n => n.text || "")
        .join("")
        .trim();
      if (text) lines.push({ type: node.type, level: node.attrs?.level, text });
    }
  }
  return lines;
}

// Inline preview — renders from store data, no iframes
function InlinePreview({ occurrence, module, occurrencesById, modulesById }) {
  const kind = module?.kind;

  // Doc preview — show text snippets
  if (kind === "doc" && occurrence?.textmap) {
    const snippets = extractTextSnippets(occurrence.textmap);
    if (snippets.length > 0) {
      return (
        <div style={{ padding: "6px 8px", overflow: "hidden", height: "100%" }}>
          {snippets.map((s, i) => (
            <div key={i} style={{
              fontSize: s.type === "heading" ? (s.level === 1 ? 9 : 8) : 7,
              fontWeight: s.type === "heading" ? 600 : 400,
              color: s.type === "heading" ? "var(--text-primary)" : "var(--text-muted)",
              lineHeight: 1.3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginBottom: 1,
            }}>
              {s.text}
            </div>
          ))}
        </div>
      );
    }
  }

  // Board/folder preview — show child container bars
  if (kind === "board" || kind === "folder") {
    const childOccs = occurrence?.occurrences
      ?.map(id => occurrencesById?.[id])
      .filter(Boolean)
      .slice(0, 5) || [];

    if (childOccs.length > 0) {
      return (
        <div style={{ padding: "6px 8px", overflow: "hidden", height: "100%", display: "flex", flexDirection: "column", gap: 2 }}>
          {childOccs.map(co => {
            const cMod = modulesById?.[co.targetId];
            const childCount = co.occurrences?.length || 0;
            return (
              <div key={co.id} style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "2px 4px",
                borderRadius: 3,
                borderLeft: `2px solid ${cMod?.ownStyle?.bg || "rgba(100,180,255,0.4)"}`,
                background: "rgba(255,255,255,0.03)",
              }}>
                <span style={{ fontSize: 7, color: "var(--text-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {cMod?.label || "Container"}
                </span>
                {childCount > 0 && (
                  <span style={{ fontSize: 6, color: "var(--text-faint)", flexShrink: 0 }}>{childCount}</span>
                )}
              </div>
            );
          })}
        </div>
      );
    }
  }

  // Fallback — show kind icon
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <File size={20} style={{ color: "var(--text-faint)", opacity: 0.3 }} />
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
  const { occurrencesById, modulesById } = useContext(GridActionsContext) || {};
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

  return (
    <div
      ref={ref}
      className={`preview-node-card ${className}`}
      data-preview-node-id={occurrence?.id}
      data-occurrence-id={occurrence?.id}
      onClick={(e) => {
        if (isAnimating || !canDrillDown) return;
        onDrillDown?.(occurrence?.id, ref.current);
      }}
      style={extraStyle}
    >
      <div className="preview-node-preview">
        {loadPreview
          ? <InlinePreview occurrence={occurrence} module={module} occurrencesById={occurrencesById} modulesById={modulesById} />
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
