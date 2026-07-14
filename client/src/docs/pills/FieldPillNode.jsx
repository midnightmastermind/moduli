// docs/pills/FieldPillNode.jsx
// ============================================================
// React component for rendering Field Pills in Tiptap editor
// Displays field name + live calculated value as a colored pill
// ============================================================

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { useGridActions } from "../../GridActionsContext";
import { useFieldValue } from "../hooks/useDocFieldValues";
import { Copy, Link, Trash2, Settings } from "lucide-react";
import RadialMenu from "../../ui/RadialMenu";
import * as CommitHelpers from "../../helpers/CommitHelpers";

// Pill style matching Field.jsx compact display (neutral teal-green pill)
const PILL_STYLE = {
  display: "inline-flex", alignItems: "center", gap: 3,
  padding: "2px 6px", borderRadius: 999,
  border: "1px solid rgba(134,239,172,0.25)",
  background: "rgba(134,239,172,0.08)",
  fontSize: 10, fontFamily: "var(--font-mono)",
  color: "rgba(134,239,172,0.85)", flexShrink: 0,
  cursor: "pointer", userSelect: "none",
  transition: "border-color 0.15s, background 0.15s",
};
const PILL_STYLE_HOVER = {
  ...PILL_STYLE,
  border: "1px solid rgba(134,239,172,0.45)",
  background: "rgba(134,239,172,0.14)",
};

/**
 * FieldPillNode - Renders a field reference as an inline pill
 *
 * Props from Tiptap NodeViewWrapper:
 * - node: The ProseMirror node with attrs
 * - updateAttributes: Function to update node attributes
 * - selected: Whether the node is currently selected
 * - deleteNode: Function to delete this node
 */
export default function FieldPillNode({ node, selected, deleteNode }) {
  const { fieldsById, dispatch, socket } = useGridActions() || {};
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const showMenu = hovered || menuOpen;
  const hoverTimeout = useRef(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const pillRef = useRef(null);
  const inputRef = useRef(null);

  const {
    fieldId,
    fieldName,
    fieldType = "text",
    showValue = true,
    showLabel = true,
  } = node.attrs;

  // Get the field definition
  const field = useMemo(() => {
    return fieldsById?.[fieldId] || null;
  }, [fieldsById, fieldId]);

  // Get live calculated value using the hook
  const { displayValue, error } = useFieldValue(fieldId);

  // Use the live value or fallback
  const currentValue = useMemo(() => {
    if (!showValue) return null;
    if (error) return "!";
    return displayValue;
  }, [showValue, displayValue, error]);

  const displayName = field?.name || fieldName || "Unknown Field";

  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText(`#${displayName}${currentValue != null ? `: ${currentValue}` : ""}`);
  }, [displayName, currentValue]);

  const handleCopyLink = useCallback(() => {
    navigator.clipboard?.writeText(`[[field:${fieldId}]]`);
  }, [fieldId]);

  const handleDelete = useCallback(() => {
    deleteNode?.();
  }, [deleteNode]);

  // Double-click to edit field name
  const handleDoubleClick = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    setEditValue(displayName);
    setEditing(true);
  }, [displayName]);

  const commitEdit = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== displayName && field && dispatch && socket) {
      CommitHelpers.updateField({
        dispatch,
        socket,
        field: { ...field, name: trimmed },
        emit: true,
      });
    }
    setEditing(false);
  }, [editValue, displayName, field, dispatch, socket]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
  }, []);

  // Focus input when editing starts
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // RadialMenu items for this pill
  const radialItems = useMemo(() => [
    {
      icon: Copy,
      label: "Copy",
      onClick: handleCopy,
      color: "bg-blue-600 hover:bg-blue-500",
    },
    {
      icon: Link,
      label: "Copy Link",
      onClick: handleCopyLink,
      color: "bg-purple-600 hover:bg-purple-500",
    },
    {
      icon: Trash2,
      label: "Remove",
      onClick: handleDelete,
      color: "bg-red-600 hover:bg-red-500",
    },
  ], [handleCopy, handleCopyLink, handleDelete]);

  // Set up pragmatic DnD so the pill can be dragged out of the doc
  useEffect(() => {
    const el = pillRef.current;
    if (!el) return;

    return draggable({
      element: el,
      getInitialData: () => ({
        type: "field",
        fieldId,
        fieldName: displayName,
        fromDoc: true,
      }),
    });
  }, [fieldId, displayName]);

  return (
    <NodeViewWrapper as="span" contentEditable={false}>
      <span
        ref={pillRef}
        className="field-pill"
        style={{
          ...(hovered ? PILL_STYLE_HOVER : PILL_STYLE),
          outline: selected ? "1px solid var(--border-default)" : "none",
          outlineOffset: 1,
          position: "relative",
        }}
        data-field-id={fieldId}
        onMouseEnter={() => { clearTimeout(hoverTimeout.current); setHovered(true); }}
        onMouseLeave={() => { hoverTimeout.current = setTimeout(() => setHovered(false), 200); }}
        onDoubleClick={handleDoubleClick}
      >
        {/* Field name — editable on double-click */}
        {showLabel && !editing && (
          <span style={{ opacity: 0.65 }}>{displayName}:</span>
        )}
        {showLabel && editing && (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
              if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ background: "transparent", border: "none", outline: "none", color: "inherit", fontFamily: "var(--font-mono)", fontSize: 10, width: `${Math.max(editValue.length, 3)}ch`, minWidth: 30 }}
          />
        )}

        {/* Value */}
        {showValue && currentValue !== null && !editing && (
          <span>{currentValue}</span>
        )}

        {/* Cog button with radial menu — appears on hover */}
        <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 2, marginRight: -2, opacity: showMenu ? 1 : 0, pointerEvents: showMenu ? "auto" : "none", transition: "opacity 0.15s" }} contentEditable={false}>
          <RadialMenu
            items={radialItems}
            handleIcon={Settings}
            handleTitle={`${displayName} — Click for actions`}
            size="sm"
            handleClassName="border-none !rounded !w-4 !h-4 !px-0"
            forceDirection="down"
            onOpenChange={setMenuOpen}
          />
        </span>
      </span>
    </NodeViewWrapper>
  );
}
