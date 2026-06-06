// docs/pills/InstanceTextblockInlineNode.jsx
// NodeView for the `instanceTextblockInline` TipTap node — an inline atom
// that displays a short rich-text snippet sourced from the linked
// occurrence's textmap. Distinct from `InstanceTextblockNode` (block).
//
// Render shape: inline `<span>` that blends with the surrounding paragraph
// (no border, no margin), styled with a subtle background tint so the user
// can see where the textblock starts and ends. Double-click → inline
// contenteditable edit; Enter / blur commits.
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { GridActionsContext, useGridActions } from "../../GridActionsContext";
import * as CommitHelpers from "../../helpers/CommitHelpers";

// Walk a TipTap doc and join its text nodes with a single space — preserves
// readability without inserting paragraph breaks (this node is inline).
function textmapToInlineText(doc) {
  if (!doc || typeof doc !== "object") return "";
  const parts = [];
  const walk = (n) => {
    if (!n) return;
    if (n.type === "text" && typeof n.text === "string") parts.push(n.text);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// Build a minimal `{type:"doc", content:[paragraph]}` shape from raw text.
function textToTextmap(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return { type: "doc", content: [{ type: "paragraph" }] };
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: trimmed }] }],
  };
}

export default function InstanceTextblockInlineNode({ node, editor }) {
  const { occurrencesById, dispatch, socket } = useGridActions() || {};
  const { occurrenceId, instanceId } = node.attrs;
  const occurrence = occurrencesById?.[occurrenceId] || null;

  const storedText = useMemo(() => textmapToInlineText(occurrence?.textmap), [occurrence?.textmap]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(storedText);
  const spanRef = useRef(null);
  const wrapperRef = useRef(null);

  // Wire Pragmatic DnD so the chip can be dragged anywhere a textblock
  // can land — other docs (as an embed), board containers, grid cells,
  // canvas. Same payload shape the block textblock uses so every drop
  // handler that already understands role:"textblock" + sourceType
  // "doc-embed" handles us identically. Latest attrs are read via a
  // ref so getInitialData stays fresh without re-running the cleanup
  // effect on every render. canDrag returns false during inline edit
  // so contenteditable text-selection isn't hijacked by drag.
  const latestRef = useRef({ occurrence, instanceId, occurrenceId, editing });
  useEffect(() => { latestRef.current = { occurrence, instanceId, occurrenceId, editing }; });
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    return draggable({
      element: el,
      canDrag: () => !latestRef.current.editing,
      getInitialData: () => {
        const { occurrence: o, instanceId: iId, occurrenceId: oId } = latestRef.current;
        return {
          type: "module",
          sourceType: "doc-embed",
          role: "textblock",
          kind: "inline",
          id: iId,
          data: { id: iId, role: "textblock", kind: "inline", label: "" },
          occurrence: o,
          occurrenceId: oId,
          context: { occurrenceId: oId, sourceType: "doc-embed" },
        };
      },
    });
  }, []);

  // Sync draft with stored text whenever the occurrence updates from elsewhere.
  useEffect(() => {
    if (!editing) setDraft(storedText);
  }, [storedText, editing]);

  // When editing flips on, focus the contenteditable span and select all so the
  // user can immediately retype.
  useEffect(() => {
    if (!editing) return;
    const el = spanRef.current;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing]);

  const commit = useCallback(() => {
    setEditing(false);
    const nextText = (draft || "").trim();
    if (nextText === storedText) return;
    if (!occurrenceId || !dispatch || !socket) return;
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: occurrenceId, textmap: textToTextmap(nextText) },
      emit: true,
    });
  }, [draft, storedText, occurrenceId, dispatch, socket]);

  const cancel = useCallback(() => {
    setDraft(storedText);
    setEditing(false);
  }, [storedText]);

  const onKeyDown = useCallback((e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); cancel(); }
  }, [commit, cancel]);

  const onDoubleClick = useCallback((e) => {
    if (!editor?.isEditable) return;
    e.preventDefault();
    e.stopPropagation();
    setEditing(true);
  }, [editor]);

  // Display text falls back to a placeholder so empty inline textblocks are
  // still visible / clickable.
  const display = storedText || "inline textblock";

  // Link mini-textblock: when the occurrence (or its module) carries meta.link,
  // render a clickable chip instead of an editable snippet. The markdown importer
  // emits these for [text](url) links so they render inline as chips that flow in
  // the sentence (wrappable — white-space:normal). The whole node is the drag
  // handle (wrapperRef draggable above; canDrag false while editing), so it can
  // be dragged out from any part — there's no inner edit surface for a link chip.
  const link = occurrence?.meta?.link || null;
  if (link && (link.url || link.occId || link.target)) {
    const isUrl = link.kind === "url" || (!!link.url && !link.occId && !link.target);
    const chipLabel = storedText || link.url || "link";
    const chipStyle = {
      display: "inline", whiteSpace: "normal",
      padding: "0 6px", borderRadius: 999, fontSize: "0.92em",
      background: isUrl ? "rgba(110,170,230,0.14)" : "rgba(130,200,150,0.14)",
      border: isUrl ? "1px solid rgba(110,170,230,0.4)" : "1px solid rgba(130,200,150,0.4)",
      color: isUrl ? "var(--accent-blue-text, rgb(150,195,250))" : "var(--accent-green-text, rgb(150,210,170))",
      textDecoration: "none", cursor: "pointer",
    };
    return (
      <NodeViewWrapper
        as="span"
        ref={wrapperRef}
        data-instance-textblock-inline="true"
        data-occurrence-id={occurrenceId || undefined}
        className="instance-textblock-inline instance-textblock-inline--link"
      >
        {isUrl ? (
          <a href={link.url} target="_blank" rel="noopener noreferrer" style={chipStyle} title={link.url}>
            {chipLabel} <span style={{ opacity: 0.7 }}>↗</span>
          </a>
        ) : (
          <span style={chipStyle} title="Linked item">{chipLabel} <span style={{ opacity: 0.7 }}>→</span></span>
        )}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      ref={wrapperRef}
      data-instance-textblock-inline="true"
      data-occurrence-id={occurrenceId || undefined}
      className={`instance-textblock-inline${editing ? " is-editing" : ""}${storedText ? "" : " is-empty"}`}
      onDoubleClick={onDoubleClick}
    >
      {editing ? (
        <span
          ref={spanRef}
          className="instance-textblock-inline-edit"
          contentEditable
          suppressContentEditableWarning
          onInput={(e) => setDraft(e.currentTarget.textContent || "")}
          onBlur={commit}
          onKeyDown={onKeyDown}
        >
          {storedText}
        </span>
      ) : (
        <span className="instance-textblock-inline-text">{display}</span>
      )}
    </NodeViewWrapper>
  );
}
