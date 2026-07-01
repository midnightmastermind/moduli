// docs/pills/InstanceTextblockInlineNode.jsx
// NodeView for the `instanceTextblockInline` TipTap node — an inline atom
// that displays a short rich-text snippet sourced from the linked
// occurrence's textmap. Distinct from `InstanceTextblockNode` (block).
//
// Three-zone chip (user-spec'd interaction model):
//   [ ⠿ handle ] [ editable content (text cursor) ] [ ↗ open ]
//   - LEFT handle  — hover-revealed RadialMenu; the ONLY drag origin.
//   - MIDDLE       — contenteditable text (commits on blur / Enter).
//   - RIGHT arrow  — link chips only: single-click opens the target (new tab
//                    for URLs, jump-to-occurrence for in-app targets).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { Trash2 } from "lucide-react";
import { useGridActions } from "../../GridActionsContext";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import { jumpToOccurrence } from "../../helpers/jumpToOccurrence";
import RadialMenu from "../../ui/RadialMenu.jsx";

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

// Normalize wiki-internal / relative hrefs to absolute so clicking opens the
// real page instead of <app-origin>/wiki/X (the importer SHOULD already emit
// absolute urls — this is defensive).
function resolveHref(u) {
  if (!u) return u;
  if (/^(https?:|mailto:|data:)/i.test(u)) return u;
  if (u.startsWith("//")) return `https:${u}`;
  if (u.startsWith("/wiki/")) return `https://en.wikipedia.org${u}`;
  if (u.startsWith("./")) return `https://en.wikipedia.org/wiki/${u.slice(2)}`;
  return u;
}

export default function InstanceTextblockInlineNode({ node, editor, getPos, deleteNode }) {
  const { occurrencesById, dispatch, socket } = useGridActions() || {};
  const { occurrenceId, instanceId } = node.attrs;
  const occurrence = occurrencesById?.[occurrenceId] || null;

  const storedText = useMemo(() => textmapToInlineText(occurrence?.textmap), [occurrence?.textmap]);
  const [draft, setDraft] = useState(storedText);
  const [hovered, setHovered] = useState(false);
  const contentRef = useRef(null);
  const wrapperRef = useRef(null);
  const handleRef = useRef(null);

  const link = occurrence?.meta?.link || null;
  const hasLink = !!(link && (link.url || link.occId || link.target));
  const isUrl = hasLink && (link.kind === "url" || (!!link.url && !link.occId && !link.target));
  const href = hasLink ? resolveHref(link.url) : null;
  const editable = !!editor?.isEditable;

  // Drag ONLY from the handle (Pragmatic DnD `dragHandle`). The handle span is
  // always in the DOM (stable ref) even though the RadialMenu inside it only
  // mounts on hover — so dragHandle resolves and the middle stays freely
  // editable (text selection there never starts a drag). Same payload shape the
  // block textblock uses so every drop handler that understands
  // role:"textblock" + sourceType "doc-embed" handles us identically.
  const latestRef = useRef({ occurrence, instanceId, occurrenceId });
  useEffect(() => { latestRef.current = { occurrence, instanceId, occurrenceId }; });
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    return draggable({
      element: el,
      dragHandle: handleRef.current || undefined,
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

  // Keep the editable surface in sync with external updates (but not while the
  // user is actively editing — don't clobber their caret).
  useEffect(() => {
    setDraft(storedText);
    if (contentRef.current && document.activeElement !== contentRef.current) {
      contentRef.current.textContent = storedText || (hasLink ? (link?.url || "link") : "");
    }
  }, [storedText, hasLink, link?.url]);

  const commit = useCallback(() => {
    const nextText = (draft || "").trim();
    if (nextText === storedText) return;
    if (!occurrenceId || !dispatch || !socket) return;
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: occurrenceId, textmap: textToTextmap(nextText) },
      emit: true,
    });
  }, [draft, storedText, occurrenceId, dispatch, socket]);

  const onKeyDown = useCallback((e) => {
    if (e.key === "Enter") { e.preventDefault(); contentRef.current?.blur(); }
    else if (e.key === "Escape") {
      e.preventDefault();
      if (contentRef.current) contentRef.current.textContent = storedText;
      setDraft(storedText);
      contentRef.current?.blur();
    }
  }, [storedText]);

  // RIGHT arrow — single-click opens the link. stopPropagation + preventDefault
  // on mousedown so ProseMirror never node-selects the atom first (that
  // selection scrolls the chip into view = the "have to click twice / it moves
  // the doc" bug). We open it ourselves on click.
  const openTarget = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    if (isUrl && href) { window.open(href, "_blank", "noopener,noreferrer"); return; }
    const targetId = link?.occId || link?.target;
    if (targetId) jumpToOccurrence(targetId);
  }, [isUrl, href, link?.occId, link?.target]);

  const radialItems = useMemo(() => ([
    {
      label: "Remove",
      icon: Trash2,
      color: "bg-red-600 hover:bg-red-500",
      onClick: () => { try { deleteNode?.(); } catch { /* node already gone */ } },
    },
  ]), [deleteNode]);

  return (
    <NodeViewWrapper
      as="span"
      ref={wrapperRef}
      data-instance-textblock-inline="true"
      data-occurrence-id={occurrenceId || undefined}
      className={
        "instance-textblock-inline instance-textblock-inline--zoned"
        + (hasLink ? (isUrl ? " itbi--url" : " itbi--occ") : "")
        + (storedText ? "" : " is-empty")
      }
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* LEFT — drag handle (hover-revealed RadialMenu). Always in the DOM so
          the Pragmatic DnD dragHandle ref is stable; the menu lazy-mounts on
          hover so a doc full of chips pays nothing at rest. */}
      <span
        ref={handleRef}
        className={"itbi-handle" + (hovered ? " is-shown" : "")}
        data-dnd-handle="true"
        contentEditable={false}
        title="Drag · menu"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {hovered && editable && (
          <RadialMenu size="sm" forceDirection="down" items={radialItems} />
        )}
      </span>

      {/* MIDDLE — editable content (text cursor). stopPropagation on mousedown
          so a click edits here instead of node-selecting + scrolling the doc.
          UNCONTROLLED: the content is owned imperatively by the sync effect (the
          standard React contentEditable pattern). If we rendered the text as a
          JSX child, every re-render (e.g. hover → RadialMenu mount) would
          reconcile the text node and collapse the caret to offset 0 — so a click
          to edit landed at the START instead of where the user pointed. With no
          JSX child, React never touches the text subtree, so the native click
          caret position is preserved. */}
      <span
        ref={contentRef}
        className="itbi-content"
        contentEditable={editable}
        suppressContentEditableWarning
        spellCheck={false}
        onMouseDown={(e) => e.stopPropagation()}
        onInput={(e) => setDraft(e.currentTarget.textContent || "")}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />

      {/* RIGHT — "enter" arrow: opens the link target in a new tab (URL) or
          jumps to the occurrence (in-app). Only for link chips. */}
      {hasLink && (
        <span
          className="itbi-arrow"
          contentEditable={false}
          role="button"
          tabIndex={-1}
          title={isUrl ? href : "Open linked item"}
          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
          onClick={openTarget}
        >
          {isUrl ? "↗" : "→"}
        </span>
      )}
    </NodeViewWrapper>
  );
}
