// modules/DocContent.jsx
// DocEditorShell — thin wrapper around the TipTap Editor: lock toggle + scroll-to-anchor.
// Extracted from containerHelpers.jsx.

import React, { useRef, useState, useEffect, useCallback } from "react";
import Editor from "../ui/Editor";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { Lock, Unlock } from "lucide-react";

export const DocContent = React.memo(function DocContent({ occurrence, dispatch, socket, onConvertListToInstances, hideToolbar = false, scrollAnchor, onExitBlock, onDeleteBlock, onAutoCreateTextblock }) {
  const [showLockBtn, setShowLockBtn] = useState(false);
  const wrapRef = useRef(null);
  const editorRef = useRef(null);
  const isLocked = !!occurrence?.locked;
  const autoCreateCooldownRef = useRef(false);

  // Scroll-to-anchor: when scrollAnchor is set, find the element and scroll to it
  useEffect(() => {
    if (!scrollAnchor) return;
    const target = wrapRef.current?.querySelector(`[data-occ-id="${scrollAnchor}"]`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [scrollAnchor]);

  // A valid textmap is a JSON object. A compressed textmap is a base64 string —
  // treat it the same as missing (full_state delivers all textmaps decompressed upfront).
  const hasValidTextmap = occurrence?.textmap != null && typeof occurrence.textmap === "object";
  // Auto-create textblock: when user types on empty paragraph or a list appears at top level,
  // replace it with an instancePill block. nodeJson is optional — when provided (for lists),
  // it becomes the initial textmap content directly.
  const handleAutoCreateTextblock = useCallback((nodeStart, typedText, nodeSize, nodeJson) => {
    if (!occurrence?.id || !socket || !dispatch) return;
    if (autoCreateCooldownRef.current) return;
    const editor = editorRef.current?.editor;
    if (!editor) return;

    // Block further auto-creates until the sub-editor is focused
    autoCreateCooldownRef.current = true;

    const userId = occurrence.userId;
    const gridId = occurrence.gridId;
    const modId = crypto.randomUUID();
    const occId = crypto.randomUUID();

    // Create the text module (instance role, kind: doc)
    CommitHelpers.createModule({
      dispatch, socket,
      module: { id: modId, userId, gridId, role: "instance", kind: "doc", label: "" },
      emit: true,
    });

    // Create occurrence with the typed text or full node JSON as initial textmap
    const initialTextmap = nodeJson
      ? { type: "doc", content: [nodeJson] }
      : { type: "doc", content: [{ type: "paragraph", content: typedText ? [{ type: "text", text: typedText }] : [] }] };
    CommitHelpers.createOccurrence({
      dispatch, socket,
      occurrence: {
        id: occId, userId, gridId,
        targetId: modId, targetType: "module",
        parentId: occurrence.id,
        iteration: { mode: "persistent" },
        textmap: initialTextmap,
        fields: {},
      },
      emit: true,
    });

    // Replace the paragraph with an instanceTextblock node
    const schema = editor.state.schema;
    if (!schema.nodes.instanceTextblock) return;
    const tr = editor.state.tr;
    tr.setMeta("skipAutoCreate", true);
    tr.replaceWith(nodeStart, nodeStart + nodeSize, schema.nodes.instanceTextblock.create({
      instanceId: modId,
      occurrenceId: occId,
    }));
    editor.view.dispatch(tr);

    // Focus the sub-editor at END of content as soon as it appears in the DOM
    const tryFocus = (attempts = 0) => {
      const wrapper = editor.view.dom.closest(".doc-editor-wrapper");
      const subEditor = wrapper?.querySelector(`[data-occurrence-id="${occId}"] .ProseMirror`);
      if (subEditor) {
        subEditor.focus();
        // Place cursor at end so subsequent keystrokes append, not prepend
        try {
          const range = document.createRange();
          range.selectNodeContents(subEditor);
          range.collapse(false); // collapse to end
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        } catch (_) {}
        autoCreateCooldownRef.current = false;
      } else if (attempts < 10) {
        requestAnimationFrame(() => tryFocus(attempts + 1));
      } else {
        autoCreateCooldownRef.current = false;
      }
    };
    requestAnimationFrame(() => tryFocus());
  }, [occurrence, socket, dispatch]);

  const handleToggleLock = (e) => {
    e.stopPropagation();
    if (!occurrence?.id) return;
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { ...occurrence, locked: !isLocked } });
  };
  return (
    <div
      ref={wrapRef}
      className="doc-container flex flex-col flex-1 min-h-0 relative"
      onMouseEnter={() => setShowLockBtn(true)}
      onMouseLeave={() => setShowLockBtn(false)}
      style={{ cursor: isLocked ? "default" : "text" }}
      draggable={false}
      onClick={(e) => {
        if (isLocked || e.target !== e.currentTarget) return;
        const editor = editorRef.current?.editor;
        if (!editor || !editor.isEditable) return;
        // Use 'end' so TipTap doesn't default to editor.state.selection (pos 1
        // for an unfocused editor), which always places cursor at the beginning.
        editor.commands.focus('end');
      }}
    >
      {(showLockBtn || isLocked) && (
        <button
          onMouseDown={handleToggleLock}
          title={isLocked ? "Unlock document" : "Lock document"}
          style={{
            position: "absolute", top: 4, right: 4, zIndex: 10,
            background: "none", border: "none", cursor: "pointer",
            opacity: isLocked ? 0.7 : 0.3, padding: 2,
            color: isLocked ? "var(--danger)" : "var(--text-muted)",
          }}
        >
          {isLocked ? <Lock size={11} /> : <Unlock size={11} />}
        </button>
      )}
      <Editor
        ref={editorRef}
        content={hasValidTextmap ? occurrence.textmap : null}
        occurrence={occurrence}
        dispatch={dispatch}
        socket={socket}
        editable={!isLocked}
        showToolbar={false}
        className="flex-1"
        onConvertListToInstances={onConvertListToInstances}
        onExitBlock={onExitBlock}
        onDeleteBlock={onDeleteBlock}
        onAutoCreateTextblock={onExitBlock ? null : (onAutoCreateTextblock || handleAutoCreateTextblock)}
      />
    </div>
  );
});

// Named alias for backward compatibility with containerHelpers.jsx imports
export const DocEditorShell = DocContent;

export default DocContent;
