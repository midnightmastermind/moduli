// modules/DocContent.jsx
// DocEditorShell — thin wrapper around the TipTap Editor: lock toggle + scroll-to-anchor.
// Extracted from containerHelpers.jsx.

import React, { useRef, useState, useEffect, useCallback } from "react";
import Editor from "../ui/Editor";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { Lock, Unlock } from "lucide-react";
import { logCaretInterference } from "../helpers/caretDiag";

export const DocContent = React.memo(function DocContent({ occurrence, dispatch, socket, onConvertListToInstances, hideToolbar = false, scrollAnchor, onExitBlock, onDeleteBlock, onAutoCreateTextblock }) {
  const [showLockBtn, setShowLockBtn] = useState(false);
  const wrapRef = useRef(null);
  const editorRef = useRef(null);
  const isLocked = !!occurrence?.locked;
  const autoCreateCooldownRef = useRef(false);
  // Tracks the most recent auto-created textblock so the outer editor's merge
  // pre-pass only absorbs paragraphs that landed during the focus-race window.
  // `occId` is set when auto-create runs, cleared the moment focus lands in
  // the sub-editor (or the rAF retry cap is hit). `expireAt` adds a short
  // time gate (~200ms) so deliberate gestures that happen later — Enter,
  // Shift+Enter, click, cursor move — don't fall into the merge path.
  const recentAutoCreateRef = useRef({ occId: null, expireAt: 0 });

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

    // Create the text module (role: textblock — same role used by the
    // QuickAddMenu "+ Textblock" path so all textblocks share one shape).
    CommitHelpers.createModule({
      dispatch, socket,
      module: { id: modId, userId, gridId, role: "textblock", kind: "doc", label: "" },
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
        moduleId: modId,
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

    // Mark this occurrence as the active focus-race target. The merge
    // pre-pass uses `occId` to fold continuation keystrokes into the right
    // textblock; `expireAt` is a SLIDING bound that Editor.jsx onUpdate
    // bumps on every keystroke during the focus race. Initial window is
    // 1500 ms to cover slow saves + slow first-mount of the sub-editor;
    // the merge AND any onUpdate during the race keep re-arming it.
    recentAutoCreateRef.current = { occId, expireAt: Date.now() + 1500 };

    // Focus the sub-editor at END of content as soon as it appears in the DOM.
    // Retry generously (~1s) because the inner ProseMirror is mounted by
    // React + TipTap on the next render cycle and may not appear for several
    // frames. The outer-editor onUpdate merge pre-pass catches any chars
    // that land in a fresh paragraph after the textblock during this window.
    const tryFocus = (attempts = 0) => {
      const wrapper = editor.view.dom.closest(".doc-editor-wrapper");
      const subEditor = wrapper?.querySelector(`[data-occurrence-id="${occId}"] .ProseMirror`);
      if (subEditor) {
        subEditor.focus();
        try {
          const range = document.createRange();
          range.selectNodeContents(subEditor);
          range.collapse(false);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        } catch (_) {}
        // VERIFY focus actually moved before we close the merge window.
        // The element can appear in the DOM a frame before it accepts
        // focus (React paint still in flight); clearing the refs at that
        // point lets the next fast keystroke escape the merge and spawn
        // a brand-new textblock, which looks to the user like "the text
        // wrapped to a new line inside the textblock."
        const focused = document.activeElement === subEditor
          || subEditor.contains(document.activeElement);
        if (focused) {
          autoCreateCooldownRef.current = false;
          recentAutoCreateRef.current = { occId: null, expireAt: 0 };
          return;
        }
      }
      if (attempts < 60) {
        requestAnimationFrame(() => tryFocus(attempts + 1));
      } else {
        autoCreateCooldownRef.current = false;
        recentAutoCreateRef.current = { occId: null, expireAt: 0 };
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
        logCaretInterference("docContent.padding-click focus('end')", {
          occId: (occurrence?.id || "").slice(0, 8),
        });
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
        recentAutoCreateRef={recentAutoCreateRef}
        onAutoCreateTextblock={onExitBlock ? null : (onAutoCreateTextblock || handleAutoCreateTextblock)}
        enableInsertGaps={!onExitBlock && !onDeleteBlock}
      />
    </div>
  );
});

// Named alias for backward compatibility with containerHelpers.jsx imports
export const DocEditorShell = DocContent;

export default DocContent;
