// modules/DocContent.jsx
// DocEditorShell — thin wrapper around the TipTap Editor: lock toggle + scroll-to-anchor.
// Extracted from containerHelpers.jsx.

import React, { useRef, useState, useEffect, useCallback } from "react";
import Editor from "../ui/Editor";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { Lock, Unlock } from "lucide-react";
import { logCaretInterference } from "../helpers/caretDiag";
import { requestTextblockFocus, cancelTextblockFocus } from "../helpers/pendingTextblockFocus";
import { registerProvisionalTextblock, discardProvisionalTextblock, isProvisionalTextblock } from "../helpers/provisionalTextblock";
import { mintStep, mintMark } from "../helpers/mintDiag";
import { useLazyEditor, LAZY_PLACEHOLDER_CLASS } from "../helpers/lazyEditor.js";
import { createMintLedger } from "../helpers/provisionalMints.js";
import { planStaleCollapses } from "../helpers/staleProvisionalBlocks.js";
import { afterPaint } from "../helpers/afterPaint";

// One plain-text string per top-level block. Roughly height-matched — and, just as
// important, REAL TEXT ON SCREEN, because WrapGroupNode measures rendered
// characters to decide wrap vs stack and would read an empty placeholder as
// "blank host, nothing to wrap". Mirrors TextblockCard's own extractor.
function textmapBlocks(textmap) {
  if (!textmap || typeof textmap !== "object") return [];
  const content = Array.isArray(textmap.content) ? textmap.content : [];
  return content.map((node) => {
    const parts = [];
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      if (typeof n.text === "string") parts.push(n.text);
      if (Array.isArray(n.content)) n.content.forEach(walk);
    };
    walk(node);
    return parts.join("");
  });
}

// `lazy` defaults FALSE so every existing call site is byte-identical — only the
// doc BLOCK node view opts in, where 246 eager ProseMirror instances on poms grid
// are the measured cost.
export const DocContent = React.memo(function DocContent({ occurrence, dispatch, socket, onConvertListToInstances, hideToolbar = false, scrollAnchor, onExitBlock, onDeleteBlock, onAutoCreateTextblock, onEmptyBlur = null, lazy = false }) {
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
  // EVERY click-minted textblock that has not committed or been discarded yet,
  // with the deferred store writes for each — so an unmount can drop ALL of
  // them (a write that lands after the tree is gone mints an occurrence nothing
  // renders, and a LEAKED registry entry stops this document saving entirely).
  // Was two single slots holding only the last; see helpers/provisionalMints.
  const mintLedgerRef = useRef(null);
  if (!mintLedgerRef.current) mintLedgerRef.current = createMintLedger();

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

  // Lazy body. Declared with the other hooks (the `!live` early return sits after
  // every hook, so order stays stable). An EMPTY doc mounts eagerly — there is no
  // placeholder text to stand in for it and it is immediately editable.
  const { live, ref: lazyRef, goLive } = useLazyEditor({
    eager: !lazy || !hasValidTextmap,
    occurrenceId: occurrence?.id,
  });
  const lazyBlocks = React.useMemo(
    () => (live || !hasValidTextmap ? [] : textmapBlocks(occurrence.textmap)),
    [live, hasValidTextmap, occurrence?.textmap]
  );
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
    mintStep("replaceLineWithBlock", () => editor.view.dispatch(tr));

    // Mark this occurrence as the active focus-race target. The merge
    // pre-pass uses `occId` to fold continuation keystrokes into the right
    // textblock; `expireAt` is a SLIDING bound that Editor.jsx onUpdate
    // bumps on every keystroke during the focus race. Initial window is
    // 1500 ms to cover slow saves + slow first-mount of the sub-editor;
    // the merge AND any onUpdate during the race keep re-arming it.
    recentAutoCreateRef.current = { occId, expireAt: Date.now() + 1500 };

    // The new sub-editor takes the caret ITSELF, in its own onCreate — the
    // first frame it exists (helpers/pendingTextblockFocus). The DOM poll below
    // stays only to CLOSE the merge window once focus has actually landed; it
    // no longer has to win a race to place the caret, so a missed frame can't
    // strand the user in the outer editor spawning duplicate textblocks.
    requestTextblockFocus(occId);

    // Watch for focus landing so the cooldown + merge window clear at the right
    // moment. Retries ~1s; the outer-editor merge pre-pass folds any chars that
    // land in a fresh paragraph during the window into this textblock.
    const tryFocus = (attempts = 0) => {
      const wrapper = editor.view.dom.closest(".doc-editor-wrapper");
      const subEditor = wrapper?.querySelector(`[data-occurrence-id="${occId}"] .ProseMirror`);
      if (subEditor) {
        const alreadyFocused = document.activeElement === subEditor
          || subEditor.contains(document.activeElement);
        // Only place the caret when the sub-editor did NOT claim it itself —
        // a bound body (BoundBody) mounts its own editor and never runs the
        // Editor onCreate hook, so it still needs this. Re-focusing an editor
        // that already has the caret would yank it back to the end mid-typing.
        if (!alreadyFocused) {
          subEditor.focus();
          try {
            const range = document.createRange();
            range.selectNodeContents(subEditor);
            range.collapse(false);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
          } catch (_) {}
        }
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
        // Gave up watching. Drop the standing focus claim too, so an editor
        // that mounts minutes later (scrolled into view, undo) can't snatch
        // the caret away from whatever the user is doing by then.
        cancelTextblockFocus(occId);
        autoCreateCooldownRef.current = false;
        recentAutoCreateRef.current = { occId: null, expireAt: 0 };
      }
    };
    requestAnimationFrame(() => tryFocus());
  }, [occurrence, socket, dispatch]);

  // Click-to-mint: the caret entered an EMPTY top-level line, so that line
  // becomes a textblock right now — before any keystroke. This is the fix for
  // the first-textblock save lag (user 2026-08-05): the create no longer races
  // the first keypress, because by the time a character arrives the sub-editor
  // already exists and already has the caret.
  //
  // The block is minted LOCAL-ONLY (`emit: false`). Most lines you click into
  // are abandoned empty, and emitting a create for each one would mean deleting
  // rows the server has only just been told about — the documented
  // create-is-queued / delete-is-not asymmetry behind the recurring dangling
  // child refs. It earns its server row on the first character instead
  // (`commit`), and abandoning it is a purely local removal (`discard`).
  const handleCaretMintTextblock = useCallback((nodeStart, nodeSize) => {
    if (!occurrence?.id || !socket || !dispatch) return;
    const editor = editorRef.current?.editor;
    if (!editor) return;
    const schema = editor.state.schema;
    if (!schema.nodes.instanceTextblock) return;
    const userId = occurrence.userId;
    const gridId = occurrence.gridId;
    if (!userId || !gridId) return;

    const modId = crypto.randomUUID();
    const occId = crypto.randomUUID();
    const module = { id: modId, userId, gridId, role: "textblock", kind: "doc", label: "" };
    // Born carrying the parent's filter values (the day's date). Without them
    // the block is invisible to the date filter the moment it stops being empty
    // — the same hole 91e4a807 closed for the + menus.
    const stamped = CommitHelpers.parentFilterFields(occurrence);
    const newOccurrence = {
      id: occId, userId, gridId,
      moduleId: modId,
      parentId: occurrence.id,
      iteration: { mode: "persistent" },
      textmap: { type: "doc", content: [{ type: "paragraph", content: [] }] },
      fields: stamped || {},
    };

    // REGISTER BEFORE the transaction. Replacing the line fires the outer
    // editor's onUpdate synchronously, and that save path asks whether the doc
    // now embeds a provisional block — an entry added afterwards is too late,
    // and the parent textmap goes out with an embed the server cannot resolve.
    registerProvisionalTextblock(occId, {
      // Carried so the node view can render (and be typed into) before the
      // store write lands — see getProvisionalOccurrence.
      occurrence: newOccurrence,
      commit: (textmap) => {
        mintLedgerRef.current.settle(occId);
        CommitHelpers.createModule({ dispatch, socket, module, emit: true });
        CommitHelpers.createOccurrence({
          dispatch, socket,
          occurrence: { ...newOccurrence, textmap: textmap || newOccurrence.textmap },
          emit: true,
        });
        // The parent doc held its own textmap back while this block had no
        // server row (Editor.persistContent). Write it now that the embed
        // resolves — otherwise the textblock exists but nothing renders it.
        const ed = editorRef.current?.editor;
        if (ed && !ed.isDestroyed) {
          CommitHelpers.updateOccurrence({
            dispatch, socket,
            occurrence: { ...occurrence, textmap: ed.getJSON() },
            emit: true,
          });
        }
      },
      discard: () => {
        mintLedgerRef.current.settle(occId);
        cancelTextblockFocus(occId);
        CommitHelpers.removeOccurrence({
          dispatch, socket, occurrenceId: occId, emit: false, fireTrigger: false,
        });
        CommitHelpers.deleteModule({ dispatch, socket, moduleId: modId, emit: false });
      },
    });

    // THE CARET IS CLAIMED BEFORE THE TRANSACTION, for the same reason the
    // registry entry above is: dispatching runs handlers SYNCHRONOUSLY, and the
    // sub-editor takes the caret in its own `onCreate`. A claim added afterwards
    // can arrive too late to be seen, and then the block mounts UNFOCUSED — which
    // never blurs, and a block that never blurs never vanishes. User, 2026-09-18:
    // *"it creates a textblock (not focused)"*. Adding to a Set costs nothing and
    // cannot be too early.
    requestTextblockFocus(occId);
    mintMark("focus:requested", { occId: occId.slice(0, 8) });

    const tr = editor.state.tr;
    tr.setMeta("skipAutoCreate", true);
    tr.replaceWith(nodeStart, nodeStart + nodeSize, schema.nodes.instanceTextblock.create({
      instanceId: modId,
      occurrenceId: occId,
    }));

    // ── ONE PROVISIONAL BLOCK AT A TIME ──────────────────────────────────────
    // User's spec, verbatim: *"each click should, negate the last empty textblock,
    // and then focus on a new textblock."* A provisional block is empty and
    // unclaimed by definition — typing commits it out of the registry on the first
    // character — so at this moment every OTHER one is garbage the vanish path
    // failed to collect.
    //
    // It happens in the SAME transaction as the insert, which is what removes the
    // ordering hazard entirely: `nodeStart` was computed by the caller against the
    // pre-edit doc, so collapsing anything first would invalidate it. Planned
    // against `tr.doc` (post-insert) and applied DESCENDING — see
    // helpers/staleProvisionalBlocks.
    const stale = planStaleCollapses(tr.doc, occId, isProvisionalTextblock);
    for (const st of stale) {
      const para = schema.nodes.paragraph?.create();
      if (!para) break;
      // Back to an empty LINE, not deleted: the user clicked that line, and taking
      // the line away too would move everything under the pointer.
      tr.replaceWith(st.pos, st.pos + st.size, para);
    }

    mintStep("replaceLine", () => editor.view.dispatch(tr));

    // Local removal only — a provisional block was never emitted, so this cannot
    // race a create the way deleting a real row would.
    for (const st of stale) {
      mintMark("stale:collapsed", { occId: st.id.slice(0, 8) });
      discardProvisionalTextblock(st.id);
    }

    // ── THE STORE WRITES GO IN A LATER TASK, AND THAT ORDERING IS THE FIX ──
    // Measured (2026-08-07, docs/superpowers/plans/2026-08-07-instant-textblock-mint.md):
    // the transaction above costs **10ms**; the same click cost **1121ms** when
    // these two writes ran first. They EXECUTE in 0.9ms — what costs is the
    // app-wide re-render they provoke, and while it is in this task the browser
    // cannot paint the block the user just clicked for. So: insert, paint, then
    // write. Until they land the node view renders an empty shell (it knows the
    // id is provisional), so nothing flashes and nothing moves.
    // NOT `cancel the previous block's writes` — that denied a block still on
    // screen its server row the moment a second empty line was clicked. The
    // guard below already covers the case that cancel was written for.
    const cancel = afterPaint(() => {
      // The block may already be gone — abandoned, undone, the panel closed —
      // in which case the registry no longer holds it and writing would mint
      // an occurrence nothing renders.
      if (!isProvisionalTextblock(occId)) return;
      mintStep("createModule", () => CommitHelpers.createModule({ dispatch, socket, module, emit: false }));
      mintStep("createOccurrence", () => CommitHelpers.createOccurrence({
        dispatch, socket, occurrence: newOccurrence, emit: false, fireTrigger: false,
      }));
    });
    mintLedgerRef.current.add(occId, cancel);
  }, [occurrence, socket, dispatch]);

  // A doc that unmounts still holding an uncommitted block (panel closed, page
  // switched) drops it. Nothing was emitted, so this is local cleanup only —
  // without it the empty module + occurrence linger in client state until reload.
  useEffect(() => {
    const ledger = mintLedgerRef.current;
    return () => {
      // EVERY outstanding block, not just the last. A leaked registry entry
      // keeps `hasProvisionalTextblock` true, and Editor.persistContent returns
      // early while it is — so one leak silently stops this document saving.
      for (const id of ledger.drain()) discardProvisionalTextblock(id);
    };
  }, []);

  const handleToggleLock = (e) => {
    e.stopPropagation();
    if (!occurrence?.id) return;
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { ...occurrence, locked: !isLocked } });
  };
  if (!live) {
    return (
      <div
        ref={lazyRef}
        onPointerDown={goLive}
        className={`doc-container flex flex-col flex-1 min-h-0 relative ${LAZY_PLACEHOLDER_CLASS}`}
        style={{ cursor: "text" }}
        title="Click to edit"
      >
        {lazyBlocks.map((b, i) => (
          <div key={i} style={{ minHeight: "1.35em" }}>{b || " "}</div>
        ))}
      </div>
    );
  }

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
        // Same gate as auto-create: PRIMARY doc editors only, never a textblock
        // sub-editor (which is itself the thing being minted) or a table cell.
        onCaretMintTextblock={onExitBlock ? null : handleCaretMintTextblock}
        onEmptyBlur={onEmptyBlur}
        enableInsertGaps={!onExitBlock && !onDeleteBlock}
      />
    </div>
  );
});

// Named alias for backward compatibility with containerHelpers.jsx imports
export const DocEditorShell = DocContent;

export default DocContent;
