// docs/pills/FootnoteNode.jsx
// ============================================================
// React node view for the Footnote TipTap node.
// Renders a superscript number (auto-derived from doc position).
// Click to open an inline popover for editing the footnote text;
// hover shows the text as a tooltip. Numbering re-derives on every
// render so adding/removing footnotes auto-renumbers — no
// persisted ordering state.
// ============================================================

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";

export default function FootnoteNode({ node, updateAttributes, getPos, editor, deleteNode }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.attrs.text || "");
  const popoverRef = useRef(null);
  const textareaRef = useRef(null);

  // Keep draft in sync if attrs change externally (collab / undo).
  useEffect(() => { setDraft(node.attrs.text || ""); }, [node.attrs.text]);

  // Derive the footnote's number from its position in the doc.
  // Counting every footnote node before this one gives sequential
  // numbering that survives inserts/deletes/reorders without any
  // bookkeeping. Recomputed on each render; cheap (one descendants
  // walk per footnote per render).
  const number = useMemo(() => {
    if (!editor || typeof getPos !== "function") return 1;
    let myPos;
    try { myPos = getPos(); } catch { return 1; }
    if (typeof myPos !== "number") return 1;
    let count = 0;
    editor.state.doc.descendants((n, pos) => {
      if (n.type.name === "footnote" && pos < myPos) count++;
    });
    return count + 1;
  }, [editor, getPos, node, editor?.state?.doc]);

  // Click outside the popover → commit + close.
  useEffect(() => {
    if (!editing) return;
    const handler = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        commit();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editing, draft]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editing]);

  const commit = useCallback(() => {
    if (draft !== (node.attrs.text || "")) {
      updateAttributes({ text: draft });
    }
    setEditing(false);
  }, [draft, node.attrs.text, updateAttributes]);

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setDraft(node.attrs.text || "");
      setEditing(false);
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && draft === "") {
      // Empty footnote + backspace → remove the marker entirely.
      e.preventDefault();
      setEditing(false);
      deleteNode?.();
    }
  };

  const tooltipText = node.attrs.text || "(empty footnote — click to add text)";

  return (
    <NodeViewWrapper
      as="sup"
      className="footnote-ref"
      style={{
        display: "inline-block",
        position: "relative",
        lineHeight: 1,
        verticalAlign: "super",
      }}
    >
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditing(true); }}
        title={tooltipText}
        style={{
          fontSize: "0.7em",
          fontFamily: "var(--font-mono, monospace)",
          color: "var(--accent-blue-text, rgb(96,165,250))",
          background: "var(--accent-blue-bg, rgba(59,130,246,0.08))",
          border: "1px solid var(--accent-blue-border, rgba(59,130,246,0.25))",
          borderRadius: 3,
          padding: "0 3px",
          margin: "0 1px",
          cursor: "pointer",
          minWidth: 14,
          textAlign: "center",
          opacity: node.attrs.text ? 1 : 0.6,
        }}
      >
        {number}
      </button>
      {editing && (
        <span
          ref={popoverRef}
          contentEditable={false}
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 4,
            zIndex: 50,
            background: "var(--surface-overlay)",
            border: "1px solid var(--border-default, rgba(255,255,255,0.12))",
            borderRadius: 6,
            padding: 8,
            boxShadow: "var(--menu-shadow-1)",
            minWidth: 260,
            fontSize: 12,
            lineHeight: 1.4,
            verticalAlign: "baseline",
          }}
        >
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Footnote {number}
          </div>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Footnote text…"
            rows={3}
            style={{
              width: "100%",
              fontSize: 12,
              fontFamily: "inherit",
              background: "var(--input-bg, rgba(255,255,255,0.04))",
              border: "1px solid var(--input-border, rgba(255,255,255,0.12))",
              borderRadius: 4,
              padding: "4px 6px",
              color: "var(--text-primary)",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, fontSize: 12, color: "var(--text-faint)" }}>
            <span>⌘↵ save · Esc cancel · ⌫ (empty) deletes</span>
            <button
              type="button"
              onClick={commit}
              style={{
                fontSize: 12,
                padding: "2px 8px",
                background: "var(--accent-blue-bg)",
                border: "1px solid var(--accent-blue-border)",
                color: "var(--accent-blue-text)",
                borderRadius: 3,
                cursor: "pointer",
              }}
            >
              Save
            </button>
          </div>
        </span>
      )}
    </NodeViewWrapper>
  );
}
