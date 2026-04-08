// docs/pills/InstancePillNode.jsx
// ============================================================
// Instance Pills in Tiptap editor — inline or block display
// Block pills have editable markdown body (double-click to edit)
// ============================================================

import React, { useContext, useMemo, useState, useCallback, useRef, useEffect } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { GridActionsContext } from "../../GridActionsContext";
import { Copy, Link, Trash2, Settings, Move, Check, Box, Eye, EyeOff, Maximize2 } from "lucide-react";
import RadialMenu from "../../ui/RadialMenu";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import DocContent from "../../modules/DocContent.jsx";

// Render TipTap JSON nodes as React elements with markdown-like styling
const HEADING_STYLES = {
  1: { fontSize: 13, fontWeight: 700, color: "var(--text-primary)", margin: "6px 0 2px" },
  2: { fontSize: 12, fontWeight: 700, color: "var(--text-primary)", margin: "5px 0 2px" },
  3: { fontSize: 11, fontWeight: 600, color: "rgba(134,239,172,0.85)", margin: "4px 0 1px", borderLeft: "2px solid rgba(134,239,172,0.4)", paddingLeft: 6 },
  4: { fontSize: 10.5, fontWeight: 600, color: "var(--text-primary)", margin: "3px 0 1px" },
  5: { fontSize: 10, fontWeight: 600, color: "var(--text-primary)", margin: "2px 0 1px" },
  6: { fontSize: 10, fontWeight: 600, color: "var(--text-muted)", margin: "2px 0 1px" },
};
function renderTipTapNode(node, key) {
  if (!node) return null;
  if (node.type === "text") {
    const marks = node.marks || [];
    let el = node.text || "";
    if (marks.some(m => m.type === "code")) el = <code key={`${key}c`} style={{ background: "var(--border-subtle)", borderRadius: 3, padding: "0 3px", fontSize: "0.9em" }}>{el}</code>;
    if (marks.some(m => m.type === "bold") && marks.some(m => m.type === "italic")) el = <strong key={`${key}bi`}><em>{el}</em></strong>;
    else if (marks.some(m => m.type === "bold")) el = <strong key={`${key}b`}>{el}</strong>;
    else if (marks.some(m => m.type === "italic")) el = <em key={`${key}i`}>{el}</em>;
    if (marks.some(m => m.type === "strike")) el = <s key={`${key}s`}>{el}</s>;
    return <React.Fragment key={key}>{el}</React.Fragment>;
  }
  const children = (node.content || []).map((n, i) => renderTipTapNode(n, `${key}-${i}`));
  switch (node.type) {
    case "paragraph": {
      const hasText = children.some(Boolean);
      return hasText ? <p key={key} style={{ margin: "2px 0", lineHeight: 1.5 }}>{children}</p> : <br key={key} />;
    }
    case "heading": {
      const level = node.attrs?.level || 2;
      return <div key={key} style={HEADING_STYLES[level] || HEADING_STYLES[6]}>{children}</div>;
    }
    case "bulletList": return <ul key={key} style={{ margin: "2px 0", paddingLeft: 14, listStyle: "disc" }}>{children}</ul>;
    case "orderedList": return <ol key={key} style={{ margin: "2px 0", paddingLeft: 14 }}>{children}</ol>;
    case "listItem": return <li key={key} style={{ margin: "1px 0" }}>{children}</li>;
    case "blockquote": return <blockquote key={key} style={{ borderLeft: "2px solid var(--border-default)", margin: "3px 0", paddingLeft: 8, opacity: 0.8 }}>{children}</blockquote>;
    case "codeBlock": return <pre key={key} style={{ background: "var(--input-bg)", borderRadius: 4, padding: "4px 8px", margin: "2px 0", fontSize: 9.5, overflowX: "auto", border: "1px solid var(--border-default)" }}>{children}</pre>;
    case "hardBreak": return <br key={key} />;
    case "horizontalRule": return <hr key={key} style={{ border: "none", borderTop: "1px solid var(--border-default)", margin: "4px 0" }} />;
    default: return <React.Fragment key={key}>{children}</React.Fragment>;
  }
}
function renderTipTapContent(textmap) {
  if (!textmap?.content) return null;
  return textmap.content.map((node, i) => renderTipTapNode(node, i)).filter(Boolean);
}

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

  // Inline edit state
  const [inlineEditing, setInlineEditing] = useState(false);
  const [inlineEditValue, setInlineEditValue] = useState("");
  const inlineInputRef = useRef(null);

  const {
    instanceId, instanceLabel, occurrenceId, containerId,
    pillDisplay = "inline", showHeader = false,
  } = node.attrs;

  const showMenu = hovered || menuOpen;

  const instance = useMemo(() => instancesById?.[instanceId] || null, [instancesById, instanceId]);
  const displayLabel = instance?.label || instanceLabel || "Unknown Item";
  const isBlockMode = pillDisplay === "block";

  // Field values from occurrences
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
        if (!field || field.mode === "derived") return null;
        const stored = merged[b.fieldId];
        if (!stored) return null;
        const raw = extractRaw(stored);
        const formatted = formatFieldValue(field, raw);
        if (!formatted) return null;
        return { field, formatted, isBoolean: field.type === "boolean" };
      })
      .filter(Boolean);
  }, [instance?.fieldBindings, instanceId, occurrencesById, fieldsById]);

  // ---- Edit (inline/block shared — double-click label to rename) ----

  const enterInlineEdit = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    setInlineEditValue(displayLabel);
    setInlineEditing(true);
  }, [displayLabel]);

  const commitInlineEdit = useCallback(() => {
    const trimmed = inlineEditValue.trim();
    if (trimmed && trimmed !== displayLabel && instance && dispatch && socket) {
      CommitHelpers.updateModule({
        dispatch, socket,
        module: { id: instance.id, label: trimmed },
        emit: true,
      });
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

  // ---- Shared ----

  const handleCopy = useCallback(() => navigator.clipboard?.writeText(`#${displayLabel}`), [displayLabel]);
  const handleCopyLink = useCallback(() => navigator.clipboard?.writeText(`[[instance:${instanceId}]]`), [instanceId]);
  const handleMove = useCallback(() => navigator.clipboard?.writeText(instanceId), [instanceId]);
  const handleDelete = useCallback(() => deleteNode?.(), [deleteNode]);
  const handleToggleHeader = useCallback(() => updateAttributes?.({ showHeader: !showHeader }), [updateAttributes, showHeader]);

  const handleConvertToEmbed = useCallback(() => {
    if (!editor || !getPos || !occurrenceId) return;
    const pos = getPos();
    const nodeSize = node.nodeSize;
    editor.chain().focus()
      .deleteRange({ from: pos, to: pos + nodeSize })
      .insertContentAt(pos, { type: "moduleEmbed", attrs: { occurrenceId } })
      .run();
  }, [editor, getPos, node, occurrenceId]);

  const radialItems = useMemo(() => [
    { icon: Copy, label: "Copy", onClick: handleCopy, color: "bg-blue-600 hover:bg-blue-500" },
    { icon: Link, label: "Copy Link", onClick: handleCopyLink, color: "bg-emerald-700 hover:bg-emerald-600" },
    { icon: Move, label: "Move", onClick: handleMove, color: "bg-slate-600 hover:bg-slate-500" },
    ...(isBlockMode ? [{ icon: showHeader ? EyeOff : Eye, label: showHeader ? "Hide Header" : "Show Header", onClick: handleToggleHeader, color: "bg-teal-700 hover:bg-teal-600" }] : []),
    { icon: Maximize2, label: "Convert to Embed", onClick: handleConvertToEmbed, color: "bg-indigo-600 hover:bg-indigo-500" },
    { icon: Trash2, label: "Remove", onClick: handleDelete, color: "bg-red-600 hover:bg-red-500" },
  ], [handleCopy, handleCopyLink, handleMove, handleDelete, handleToggleHeader, handleConvertToEmbed, isBlockMode, showHeader]);

  // Pragmatic DnD — drag pill OUT of doc → creates copy occurrence in target container
  // Uses "module" type so DragProvider's CC/pool handler creates a copy via copyInstanceToContainer
  // Block pills: only make the radial handle area draggable (not the whole pill),
  // otherwise draggable="true" on the wrapper blocks cursor placement in the sub-editor.
  const dragHandleRef = useRef(null);
  useEffect(() => {
    const el = pillRef.current;
    if (!el || inlineEditing) return;
    const handleEl = isBlockMode ? dragHandleRef.current : null;
    const cleanup = draggable({
      element: el,
      ...(handleEl ? { dragHandle: handleEl } : {}),
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
    // For block pills, remove draggable="true" from wrapper so Chrome allows
    // cursor placement in the sub-editor. Re-add only when handle is pressed.
    let handleCleanup = null;
    if (handleEl) {
      el.removeAttribute('draggable');
      const onDown = () => { el.setAttribute('draggable', 'true'); };
      const onUp = () => { el.removeAttribute('draggable'); };
      handleEl.addEventListener('pointerdown', onDown);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('dragend', onUp);
      handleCleanup = () => {
        handleEl.removeEventListener('pointerdown', onDown);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('dragend', onUp);
      };
    }
    return () => { cleanup(); handleCleanup?.(); };
  }, [instanceId, displayLabel, occurrenceId, inlineEditing, instance, isBlockMode]);

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

  // Block mode — computed unconditionally to respect hooks rules
  const blockOcc = useMemo(() => occurrencesById?.[occurrenceId] || null, [occurrencesById, occurrenceId]);

  // Exit block: move parent editor cursor to after this node
  const handleExitBlock = useCallback(() => {
    if (!editor || !getPos) return;
    const pos = getPos();
    const nodeSize = node.nodeSize;
    editor.chain().setTextSelection(pos + nodeSize).focus().run();
  }, [editor, getPos, node.nodeSize]);

  // Delete block: remove the TipTap node + occurrence + module when empty
  const handleDeleteBlock = useCallback(() => {
    if (!editor || !getPos) return;
    const pos = getPos();
    const nodeSize = node.nodeSize;
    // Remove the TipTap node and move cursor to before it
    editor.chain().focus().deleteRange({ from: pos, to: pos + nodeSize }).run();
    // Clean up the occurrence and module
    if (occurrenceId && dispatch && socket) {
      CommitHelpers.removeOccurrence({ dispatch, socket, occurrenceId, emit: true });
    }
  }, [editor, getPos, node.nodeSize, occurrenceId, dispatch, socket]);

  // ==================================================================
  // BLOCK MODE — docInstance textblock with optional header
  // ==================================================================
  if (isBlockMode) {
    return (
      <NodeViewWrapper as="div" contentEditable={false}>
        <div
          ref={pillRef}
          className="doc-instance-block"
          data-instance-id={instanceId}
          data-occurrence-id={occurrenceId}
          style={{
            position: "relative",
            margin: "6px 0 2px 0",
            background: "rgba(134,239,172,0.06)",
            border: "none",
            borderRadius: 6,
            overflow: "hidden",
            cursor: "default",
          }}
          onMouseEnter={() => { clearTimeout(hoverTimeout.current); setHovered(true); }}
          onMouseLeave={() => { hoverTimeout.current = setTimeout(() => setHovered(false), 200); }}
        >
          {/* Radial handle — positioned top-left, doubles as drag handle for block pills */}
          <div
            ref={dragHandleRef}
            contentEditable={false}
            draggable={false}
            style={{ position: "absolute", top: 1, left: -2, zIndex: 10 }}
          >
            <RadialMenu
              items={radialItems}
              size="sm"
              forceDirection="right"
              onOpenChange={setMenuOpen}
              onDelete={handleDelete}
            />
          </div>

          {/* Optional header row — label (shown when showHeader) */}
          {showHeader && (
            <div
              contentEditable={false}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 8px 2px 24px",
                background: "rgba(134,239,172,0.10)",
                borderBottom: "1px solid rgba(134,239,172,0.18)",
              }}
            >
              {!inlineEditing ? (
                <span
                  style={{ fontSize: 11, color: "rgba(134,239,172,0.9)", fontFamily: "var(--font-mono)", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "text" }}
                  onDoubleClick={enterInlineEdit}
                >
                  {displayLabel}
                </span>
              ) : (
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
                  className="bg-black/30 border border-white/20 rounded px-1 outline-none text-inherit font-medium text-xs min-w-[40px] flex-1"
                  style={{ caretColor: "white" }}
                />
              )}
            </div>
          )}

          {/* Editable content via DocContent sub-editor */}
          <div
            style={{ padding: showHeader ? "8px 4px 3px 20px" : "8px 4px 3px 20px" }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {blockOcc ? (
              <DocContent
                occurrence={blockOcc}
                dispatch={dispatch}
                socket={socket}
                hideToolbar={true}
                onExitBlock={handleExitBlock}
                onDeleteBlock={handleDeleteBlock}
              />
            ) : (
              <span style={{ opacity: 0.25, fontSize: 11 }}>—</span>
            )}
          </div>
        </div>
      </NodeViewWrapper>
    );
  }

  // ==================================================================
  // INLINE MODE
  // ==================================================================
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
