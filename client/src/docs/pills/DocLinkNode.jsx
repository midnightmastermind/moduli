// docs/pills/DocLinkNode.jsx
// ============================================================
// React component for rendering Document Links in Tiptap editor
// Displays [[bracketed]] links to other documents
// ============================================================

import { useMemo, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { FileText, Calendar, FolderOpen } from "lucide-react";
import { useGridActions } from "../../GridActionsContext";

/**
 * DocLinkNode - Renders a document link as [[bracketed text]]
 *
 * Props from Tiptap NodeViewWrapper:
 * - node: The ProseMirror node with attrs
 * - selected: Whether the node is currently selected
 */
export default function DocLinkNode({ node, selected }) {
  const { containersById } = useGridActions() || {};

  const { targetId, label, linkType = "doc" } = node.attrs;

  const target = useMemo(() => {
    if (!targetId) return null;
    return containersById?.[targetId] || null;
  }, [containersById, targetId]);

  // Determine display label
  const displayLabel = label || target?.label || target?.title || targetId || "Unknown";

  // Determine if link is valid
  const isValid = !!target || linkType === "dayPage";

  // Icon based on link type
  const Icon = linkType === "dayPage" ? Calendar : linkType === "folder" ? FolderOpen : FileText;

  // Handle click to navigate — fire custom event (ArtifactDisplay panels listen for it)
  const handleClick = useCallback((e) => {
    e.preventDefault();
    if (!targetId) return;
    document.dispatchEvent(
      new CustomEvent("moduli:navigate-doc", { detail: { targetId, linkType } })
    );
  }, [targetId, linkType]);

  return (
    <NodeViewWrapper
      as="span"
      className={`
        doc-link inline-flex items-center gap-0.5
        cursor-pointer select-none
        transition-colors duration-150
        ${isValid ? "text-blue-400 hover:text-blue-300" : "text-red-400 line-through"}
        ${selected ? "bg-blue-500/20 rounded" : ""}
      `}
      contentEditable={false}
      data-target-id={targetId}
      data-link-type={linkType}
      onClick={handleClick}
    >
      {/* Opening bracket */}
      <span className="opacity-50">[[</span>

      {/* Icon */}
      <Icon className="w-3 h-3 opacity-70" />

      {/* Label */}
      <span className="hover:underline">{displayLabel}</span>

      {/* Closing bracket */}
      <span className="opacity-50">]]</span>
    </NodeViewWrapper>
  );
}
