// docs/pills/InstancePillNode.jsx
// ============================================================
// Inline instance pill — a small colored badge referencing an instance.
// Used for @mentions and drag-in references inside doc editors.
//
// NOT for block textblocks — those use InstanceTextblockNode.jsx.
// ============================================================

import React, { useContext, useMemo, useState, useCallback, useRef, useEffect } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { GridActionsContext } from "../../GridActionsContext";
import { Copy, Link, Trash2, Settings, Move, Check, Box, Maximize2 } from "lucide-react";
import RadialMenu from "../../ui/RadialMenu";
import * as CommitHelpers from "../../helpers/CommitHelpers";

function extractRaw(stored) {
  if (stored && typeof stored === "object" && "value" in stored) return stored.value;
  return stored;
}

function formatFieldValue(field, rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") return null;
  const prefix = field?.meta?.prefix || "";
  const postfix = field?.meta?.postfix || "";
  if (field.type === "boolean") return rawValue ? "✓" : null;
  if (field.type === "duration") {
    if (typeof rawValue === "object") {
      const h = rawValue.hours || 0, m = rawValue.minutes || 0;
      if (!h && !m) return null;
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }
    return rawValue ? `${rawValue}` : null;
  }
  if (field.type === "rating") return rawValue ? `${"★".repeat(rawValue)}` : null;
  if (field.type === "select") return Array.isArray(rawValue) ? rawValue.join(", ") : String(rawValue);
  if (field.type === "number") return `${prefix}${rawValue}${postfix}`;
  if (field.type === "text") { const s = String(rawValue); return s.length > 20 ? s.slice(0, 18) + "…" : s; }
  return String(rawValue);
}

export default function InstancePillNode({ node, selected, deleteNode, updateAttributes, editor, getPos }) {
  const { instancesById, occurrencesById, fieldsById, dispatch, socket } = useContext(GridActionsContext) || {};
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pillRef = useRef(null);
  const hoverTimeout = useRef(null);

  const [inlineEditing, setInlineEditing] = useState(false);
  const [inlineEditValue, setInlineEditValue] = useState("");
  const inlineInputRef = useRef(null);

  const { instanceId, instanceLabel, occurrenceId, containerId } = node.attrs;
  const showMenu = hovered || menuOpen;

  const instance = useMemo(() => instancesById?.[instanceId] || null, [instancesById, instanceId]);
  const displayLabel = instance?.label || instanceLabel || "Unknown Item";

  // Field value badges
  const fieldValues = useMemo(() => {
    if (!instance?.fieldBindings?.length || !occurrencesById || !fieldsById) return [];
    const instanceOccs = Object.values(occurrencesById).filter(
      occ => occ.targetType === "instance" && occ.targetId === instanceId && occ.fields
    );
    if (instanceOccs.length === 0) return [];
    const merged = {};
    for (const occ of instanceOccs) {
      if (!occ.fields) continue;
      for (const [fid, val] of Object.entries(occ.fields)) {
        const raw = extractRaw(val);
        if (raw !== undefined && raw !== null && raw !== "") merged[fid] = val;
      }
    }
    return (instance.fieldBindings || [])
      .map(b => {
        const field = fieldsById[b.fieldId];
        if (!field || field.displayEnabled) return null;
        const stored = merged[b.fieldId];
        if (!stored) return null;
        const raw = extractRaw(stored);
        const formatted = formatFieldValue(field, raw);
        if (!formatted) return null;
        return { field, formatted, isBoolean: field.type === "boolean" };
      })
      .filter(Boolean);
  }, [instance?.fieldBindings, instanceId, occurrencesById, fieldsById]);

  // Inline label editing
  const enterInlineEdit = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    setInlineEditValue(displayLabel);
    setInlineEditing(true);
  }, [displayLabel]);

  const commitInlineEdit = useCallback(() => {
    const trimmed = inlineEditValue.trim();
    if (trimmed && trimmed !== displayLabel && instance && dispatch && socket) {
      CommitHelpers.updateModule({ dispatch, socket, module: { id: instance.id, label: trimmed }, emit: true });
    }
    setInlineEditing(false);
  }, [inlineEditValue, displayLabel, instance, dispatch, socket]);

  useEffect(() => {
    if (inlineEditing && inlineInputRef.current) {
      inlineInputRef.current.focus();
      const len = inlineInputRef.current.value.length;
      inlineInputRef.current.setSelectionRange(len, len);
    }
  }, [inlineEditing]);

  // Actions
  const handleCopy = useCallback(() => navigator.clipboard?.writeText(`#${displayLabel}`), [displayLabel]);
  const handleCopyLink = useCallback(() => navigator.clipboard?.writeText(`[[instance:${instanceId}]]`), [instanceId]);
  const handleMove = useCallback(() => navigator.clipboard?.writeText(instanceId), [instanceId]);
  const handleDelete = useCallback(() => deleteNode?.(), [deleteNode]);

  const handleConvertToEmbed = useCallback(() => {
    if (!editor || !getPos || !occurrenceId) return;
    editor.chain().focus().command(({ tr }) => {
      const pos = getPos();
      const $pos = tr.doc.resolve(pos);
      const depth = $pos.depth;
      const paraStart = $pos.before(depth);
      const paraEnd = paraStart + $pos.node(depth).nodeSize;
      const embedNode = tr.doc.type.schema.nodes.moduleEmbed?.create({ occurrenceId });
      if (!embedNode) return false;
      tr.setMeta("skipAutoCreate", true);
      tr.replaceWith(paraStart, paraEnd, embedNode);
      return true;
    }).run();
  }, [editor, getPos, occurrenceId]);

  const radialItems = useMemo(() => [
    { icon: Copy, label: "Copy", onClick: handleCopy, color: "bg-blue-600 hover:bg-blue-500" },
    { icon: Link, label: "Copy Link", onClick: handleCopyLink, color: "bg-emerald-700 hover:bg-emerald-600" },
    { icon: Move, label: "Move", onClick: handleMove, color: "bg-slate-600 hover:bg-slate-500" },
    { icon: Maximize2, label: "Convert to Embed", onClick: handleConvertToEmbed, color: "bg-indigo-600 hover:bg-indigo-500" },
    { icon: Trash2, label: "Remove", onClick: handleDelete, color: "bg-red-600 hover:bg-red-500" },
  ], [handleCopy, handleCopyLink, handleMove, handleDelete, handleConvertToEmbed]);

  // Pragmatic DnD — drag pill OUT of doc → creates copy occurrence in target container
  useEffect(() => {
    const el = pillRef.current;
    if (!el || inlineEditing) return;
    const cleanup = draggable({
      element: el,
      getInitialData: () => ({
        type: "module",
        sourceType: "doc",
        role: "instance",
        id: instanceId,
        data: instance || { id: instanceId, label: displayLabel, role: "instance" },
        instanceLabel: displayLabel,
        occurrenceId,
      }),
    });
    return cleanup;
  }, [instanceId, displayLabel, occurrenceId, inlineEditing, instance]);

  // Field value badges
  const fieldBadges = useMemo(() => {
    if (fieldValues.length === 0) return null;
    return (
      <span className="inline-flex items-center gap-0.5 ml-1">
        {fieldValues.map(({ field, formatted, isBoolean }, i) => (
          isBoolean ? (
            <span key={i} className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-green-500/30 text-green-300" title={field.name}>
              <Check className="w-2.5 h-2.5" />
            </span>
          ) : (
            <span key={i} className="inline-flex items-center px-1 py-0 rounded text-[10px] bg-white/10 text-gray-200 whitespace-nowrap" title={field.name}>
              {formatted}
            </span>
          )
        ))}
      </span>
    );
  }, [fieldValues]);

  return (
    <NodeViewWrapper as="span" contentEditable={false}>
      <span
        ref={pillRef}
        className={`
          instance-pill inline-flex items-center gap-1 relative
          bg-emerald-600/20 border-emerald-500/40 text-emerald-200
          px-2 py-0.5 rounded-full text-xs font-medium
          border cursor-pointer transition-all duration-150
          ${inlineEditing ? "" : "select-none"}
          ${selected ? "ring-2 ring-white ring-offset-1 ring-offset-transparent" : ""}
          hover:border-emerald-400/60 hover:bg-emerald-600/30
        `}
        data-instance-id={instanceId}
        data-occurrence-id={occurrenceId}
        data-container-id={containerId}
        onMouseEnter={() => { clearTimeout(hoverTimeout.current); setHovered(true); }}
        onMouseLeave={() => { hoverTimeout.current = setTimeout(() => setHovered(false), 200); }}
        onDoubleClick={enterInlineEdit}
      >
        <Box style={{ width: 9, height: 9, opacity: 0.7, flexShrink: 0 }} />
        {!inlineEditing && (
          <span className="font-medium truncate max-w-[120px]">{displayLabel}</span>
        )}
        {inlineEditing && (
          <input
            ref={inlineInputRef}
            type="text"
            value={inlineEditValue}
            onChange={(e) => setInlineEditValue(e.target.value)}
            onBlur={commitInlineEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitInlineEdit(); }
              if (e.key === "Escape") { e.preventDefault(); setInlineEditing(false); }
              e.stopPropagation();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="bg-black/30 border border-white/20 rounded px-1 outline-none text-inherit font-medium text-xs min-w-[40px]"
            style={{ width: `${Math.max(inlineEditValue.length + 1, 4)}ch`, caretColor: "white" }}
          />
        )}
        {fieldBadges}
        {!inlineEditing && (
          <span className={`inline-flex items-center ml-0.5 -mr-1 transition-opacity duration-150 ${showMenu ? "opacity-100" : "opacity-0 pointer-events-none"}`} contentEditable={false}>
            <RadialMenu
              items={radialItems}
              handleIcon={Settings}
              handleTitle={`${displayLabel} — Click for actions`}
              size="sm"
              handleClassName="bg-emerald-600 border-none rounded-full !w-4 !h-4 !px-0 !rounded-r-full !rounded-l-full"
              forceDirection="down"
              onOpenChange={setMenuOpen}
            />
          </span>
        )}
      </span>
    </NodeViewWrapper>
  );
}
