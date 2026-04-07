// modules/DocContent.jsx
// DocEditorShell — thin wrapper around the TipTap Editor: lock toggle + scroll-to-anchor.
// Extracted from containerHelpers.jsx.

import React, { useRef, useState, useEffect, useCallback } from "react";
import Editor from "../ui/Editor";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { Lock, Unlock } from "lucide-react";

export const DocContent = React.memo(function DocContent({ occurrence, dispatch, socket, onConvertListToInstances, hideToolbar = false, scrollAnchor, onExitBlock, onAutoCreateTextblock }) {
  const [showLockBtn, setShowLockBtn] = useState(false);
  const wrapRef = useRef(null);
  const editorRef = useRef(null);
  const isLocked = !!occurrence?.locked;

  // Scroll-to-anchor: when scrollAnchor is set, find the element and scroll to it
  useEffect(() => {
    if (!scrollAnchor) return;
    const target = wrapRef.current?.querySelector(`[data-occ-id="${scrollAnchor}"]`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [scrollAnchor]);
  // Auto-create textblock: when user types on empty paragraph, replace it with an instancePill block
  const handleAutoCreateTextblock = useCallback((nodeStart, typedText, nodeSize) => {
    if (!occurrence?.id || !socket || !dispatch) return;
    const editor = editorRef.current?.editor;
    if (!editor) return;

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

    // Create occurrence with the typed text as initial textmap
    const initialTextmap = {
      type: "doc",
      content: [{ type: "paragraph", content: typedText ? [{ type: "text", text: typedText }] : [] }],
    };
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

    // Replace the paragraph with an instancePill block node
    const schema = editor.state.schema;
    if (!schema.nodes.instancePill) return;
    const tr = editor.state.tr;
    tr.setMeta("skipAutoCreate", true);
    tr.replaceWith(nodeStart, nodeStart + nodeSize, schema.nodes.instancePill.create({
      instanceId: modId,
      instanceLabel: "",
      occurrenceId: occId,
      pillDisplay: "block",
      showIcon: false,
      showHeader: false,
    }));
    editor.view.dispatch(tr);

    // After React renders the new pill, focus its sub-editor
    setTimeout(() => {
      const wrapper = editor.view.dom.closest(".doc-editor-wrapper");
      const subEditor = wrapper?.querySelector(`[data-occurrence-id="${occId}"] .ProseMirror`);
      if (subEditor) subEditor.focus();
    }, 60);
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
      onClick={(e) => {
        if (isLocked || e.target !== e.currentTarget) return;
        const editor = editorRef.current?.editor;
        if (!editor || !editor.isEditable) return;
        const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
        if (pos) {
          editor.chain().setTextSelection(pos.pos).focus().run();
        } else {
          editor.commands.focus("end");
        }
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
        content={occurrence?.textmap ?? null}
        occurrence={occurrence}
        dispatch={dispatch}
        socket={socket}
        editable={!isLocked}
        showToolbar={false}
        className="flex-1"
        onConvertListToInstances={onConvertListToInstances}
        onExitBlock={onExitBlock}
        onAutoCreateTextblock={onExitBlock ? null : (onAutoCreateTextblock || handleAutoCreateTextblock)}
      />
    </div>
  );
});

// Named alias for backward compatibility with containerHelpers.jsx imports
export const DocEditorShell = DocContent;

export default DocContent;
