// docs/pills/InstanceTextblockNode.jsx
// NodeView for the instanceTextblock TipTap node.
// Renders a DocContent sub-editor with a RadialMenu handle in the top-left.
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { disarmDraggableUntilHandle } from "../../helpers/dragSystem";
import { useGridActions } from "../../GridActionsContext";
import DocContent from "../../modules/DocContent.jsx";
import BoundBody from "../../modules/BoundBody.jsx";
import RadialMenu from "../../ui/RadialMenu.jsx";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import { embedDeleteRegistry } from "../../helpers/embedRegistry.js";
import { resolveEditorBinding } from "../../state/editorBindings.js";
import {
  isProvisionalTextblock, discardProvisionalTextblock, suppressTextblockMint,
  getProvisionalOccurrence,
} from "../../helpers/provisionalTextblock.js";
import { forceLiveNow } from "../../helpers/lazyEditor.js";

// The caret hand-off below focuses the NEIGHBOUR's inner editor directly. Now that
// the block body mounts lazily, a neighbour off screen renders a placeholder and
// has NO `.ProseMirror` — the `if (innerPM)` guards would swallow the focus and the
// caret would silently stop moving between blocks, with nothing in the console.
//
// So: look, and if it is missing, force that occurrence live and look again. A
// neighbour that is genuinely absent (not merely lazy) returns false from
// forceLiveNow and we fall through to the outer-cursor placement as before.
function innerProseMirror(domNode) {
  if (!domNode) return null;
  const found = domNode.querySelector?.(".ProseMirror");
  if (found) return found;
  const occId = domNode.getAttribute?.("data-occurrence-id")
    || domNode.querySelector?.("[data-occurrence-id]")?.getAttribute("data-occurrence-id");
  if (occId && forceLiveNow(occId)) return domNode.querySelector?.(".ProseMirror") || null;
  return null;
}

export default function InstanceTextblockNode({ node, editor, getPos, deleteNode }) {
  const { occurrencesById, modulesById, dispatch, socket } = useGridActions() || {};

  const { instanceId, occurrenceId } = node.attrs;
  // The store first, then the provisional registry: a block minted a moment ago
  // is renderable from the object its own store write will carry, so it is
  // typeable in the frame it appears instead of a second later.
  const occurrence = occurrencesById?.[occurrenceId] || getProvisionalOccurrence(occurrenceId) || null;
  const instance = modulesById?.[instanceId] || null;
  const wrapperRef = useRef(null);
  const handleRef = useRef(null);

  // Editor↔field body binding: when set, the inner DocContent is replaced by
  // a BoundBody render that reads (and in Task 4, writes back to) a linked
  // occurrence's target field instead of this textblock's own textmap.
  const bodyBinding = useMemo(
    () => resolveEditorBinding({ occurrence, module: instance, slot: "body" }),
    [occurrence, instance]
  );

  // Per-occurrence drag mode (move / copy / copylink). Mirrors ModuleInstance —
  // defaults to occurrence.dragMode → instance.defaultDragMode → "move". Stored
  // on the occurrence so the RadialMenu toggle persists.
  const entityDragMode = occurrence?.dragMode ?? instance?.defaultDragMode ?? "move";
  const toggleEntityDragMode = useCallback(() => {
    if (!occurrenceId || !dispatch || !socket) return;
    const nextMode = entityDragMode === "move" ? "copy" : "move";
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: occurrenceId, dragMode: nextMode },
      emit: true,
    });
  }, [occurrenceId, entityDragMode, dispatch, socket]);

  // Register deleteNode with embedDeleteRegistry so handleDocEmbedDrop can
  // remove this TipTap node from the parent doc on a move-mode drop. Same
  // pattern as ModuleEmbedNode (Apr 15). Without it, dropping the textblock
  // into a container would create a duplicate and leave the source in the doc.
  useEffect(() => {
    if (!occurrenceId) return;
    embedDeleteRegistry.set(occurrenceId, deleteNode);
    return () => { embedDeleteRegistry.delete(occurrenceId); };
  }, [occurrenceId, deleteNode]);

  // Pragmatic DnD — drag the textblock OUT of the doc to a container/grid cell.
  // Scoped to the .module-drag-handle pill so clicks inside the inner DocContent
  // editor keep going to the editor (text-selection, cursor placement) instead
  // of starting a drag.
  //
  // `sourceType: "doc-embed"` routes through `handleDocEmbedDrop`, which moves
  // the EXISTING occurrence into the destination (preserving its textmap and
  // fields) and calls `embedDeleteRegistry.get(occurrenceId)?.()` to remove
  // the source TipTap node. Using `"doc"` instead would route through
  // `handleModuleDrop`, which copies the module template (no textmap) into a
  // fresh occurrence — the "empty duplicate" bug.
  //
  // `context.occurrenceId` is required so the drop handler can locate the
  // moving occurrence (it reads `payload.context?.occurrenceId`).
  // Latest occurrence/instance refs — `getInitialData` reads these fresh at
  // drag-start time, so we don't need to re-attach pragmatic on every textmap
  // keystroke (which would happen if `occurrence` were in the deps array).
  const latestRef = useRef({ occurrence, instance, entityDragMode });
  latestRef.current = { occurrence, instance, entityDragMode };

  useEffect(() => {
    const el = wrapperRef.current;
    const handleEl = handleRef.current;
    if (!el || !handleEl) return;
    const cleanup = draggable({
      element: el,
      dragHandle: handleEl,
      getInitialData: () => {
        const { occurrence: o, instance: i, entityDragMode: m } = latestRef.current;
        return {
          type: "module",
          sourceType: "doc-embed",
          // role:"textblock" lets Editor.jsx's drop handler route into the
          // textblock branch (inserts an `instanceTextblock` TipTap node)
          // instead of falling through to the generic `moduleEmbed` path —
          // which renders an empty ModuleInstance row at the destination.
          role: "textblock",
          kind: "doc",
          id: instanceId,
          data: i || { id: instanceId, role: "textblock", kind: "doc", label: "", defaultDragMode: m },
          occurrence: o,
          defaultDragMode: m,
          occurrenceId,
          context: { occurrenceId, sourceType: "doc-embed" },
        };
      },
    });
    // Pragmatic just stamped draggable="true" on the wrapper, and Firefox will
    // not let the user SELECT any text inside a draggable subtree — which is
    // the whole body of this textblock (user 2026-08-01: "i cant highlight text
    // at all inside textblocks so i couldnt copy and paste it"). Disarm at rest;
    // the radial handle re-arms for real drags. This node calls Pragmatic
    // DIRECTLY rather than through useDragDrop, which is exactly why it never
    // inherited the disarm that handle-dragged rows already had.
    const armCleanup = disarmDraggableUntilHandle(el, handleEl);
    return () => { cleanup(); armCleanup(); };
  }, [instanceId, occurrenceId]);

  // Plain Enter at end of content → move parent editor cursor into the next block.
  // pos + nodeSize is the gap after the textblock (between nodes). We need to step
  // inside the next paragraph (+1), or insert one if none exists.
  const handleExitBlock = useCallback(() => {
    if (!editor || !getPos) return;
    const pos = getPos();
    const nodeSize = node.nodeSize;
    const afterPos = pos + nodeSize;
    const docSize = editor.state.doc.content.size;

    // Index-based lookup is more reliable than `nodeAt(afterPos)` for the
    // gap right after an atom node — nodeAt can hand back the wrong node
    // (or null) at atom boundaries. Walk top-level children and pick the
    // one immediately following this textblock.
    let nextChild = null;
    let nextChildStart = null;
    if (afterPos < docSize) {
      let runningOffset = 0;
      editor.state.doc.forEach((child) => {
        if (nextChild) return;
        if (runningOffset === afterPos) {
          nextChild = child;
          nextChildStart = runningOffset;
        }
        runningOffset += child.nodeSize;
      });
    }

    if (nextChild?.type.name === "instanceTextblock") {
      // The next sibling is another textblock — focus ITS inner editor at
      // the start so the user keeps typing in the next textblock instead
      // of leaving the textblock chain entirely.
      const innerPM = innerProseMirror(editor.view.nodeDOM(nextChildStart));
      if (innerPM) {
        innerPM.focus();
        const range = document.createRange();
        range.selectNodeContents(innerPM);
        range.collapse(true);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        return;
      }
      // innerPM not yet mounted — fall through to outer-cursor placement
    }

    // `textblockExit` meta tells the outer editor's onUpdate that this is
    // a deliberate exit gesture — it should slam the recentAutoCreateRef
    // merge window shut so the next keystroke spawns a fresh textblock
    // instead of getting folded into the one we just left.
    if (nextChild) {
      editor.chain()
        .command(({ tr }) => { tr.setMeta("textblockExit", true); return true; })
        .setTextSelection(afterPos + 1)
        .focus()
        .run();
    } else {
      editor.chain()
        .command(({ tr }) => { tr.setMeta("textblockExit", true); return true; })
        .insertContentAt(afterPos, { type: "paragraph" })
        .setTextSelection(afterPos + 1)
        .focus()
        .run();
    }
  }, [editor, getPos, node.nodeSize]);

  // Drop this textblock's data. A block minted by clicking an empty line and
  // never typed into has no server row (see helpers/provisionalTextblock), so
  // its removal is local — emitting a delete for an id the server has never
  // seen is exactly the race that mints dangling child refs.
  const dropOccurrenceData = useCallback(() => {
    if (!occurrenceId || !dispatch || !socket) return;
    if (discardProvisionalTextblock(occurrenceId)) return;
    CommitHelpers.removeOccurrence({ dispatch, socket, occurrenceId, emit: true });
  }, [occurrenceId, dispatch, socket]);

  // The sub-editor lost focus while still empty. Only a PROVISIONAL block
  // vanishes: a textblock the user deliberately created (the + menu, a drop)
  // and left empty is theirs to keep.
  const handleEmptyBlur = useCallback(() => {
    if (!editor || !getPos || !occurrenceId) return;
    if (!isProvisionalTextblock(occurrenceId)) return;
    let pos;
    try { pos = getPos(); } catch { return; }
    if (typeof pos !== "number") return;
    const paragraph = editor.state.schema.nodes.paragraph?.create();
    if (!paragraph) return;
    // The caret may land back on the restored line; without this the mint
    // fires again on the next selection update and the block never dies. Scoped
    // to THIS line so clicking a different empty line still mints there.
    suppressTextblockMint(pos);
    const tr = editor.state.tr;
    tr.setMeta("skipAutoCreate", true);
    tr.replaceWith(pos, pos + node.nodeSize, paragraph);
    // NO .focus() — the user moved away on purpose.
    editor.view.dispatch(tr);
    discardProvisionalTextblock(occurrenceId);
  }, [editor, getPos, node.nodeSize, occurrenceId]);

  // Radial menu delete — removes TipTap node + cleans up occurrence
  const handleDeleteBlock = useCallback(() => {
    if (!editor || !getPos) return;
    const pos = getPos();
    const nodeSize = node.nodeSize;
    editor.chain().focus().deleteRange({ from: pos, to: pos + nodeSize }).run();
    dropOccurrenceData();
  }, [editor, getPos, node.nodeSize, dropOccurrenceData]);

  // Backspace/ArrowLeft/ArrowUp at start of sub-editor.
  // deleteIfEmpty=true (only from Backspace or Shift+Enter): replace textblock with empty paragraph.
  // CALLER CONTRACT: only pass deleteIfEmpty=true when the sub-editor's doc is empty
  // (Editor.jsx checks docIsEmpty before calling). This function cannot re-verify emptiness
  // because it has no ref to the inner ProseMirror view.
  const handleNavigateBack = useCallback((deleteIfEmpty = false) => {
    if (!editor || !getPos) return;

    if (deleteIfEmpty) {
      // Replace textblock with an empty paragraph and place cursor inside it.
      // Gives the user an intermediate "empty line" step before the next backspace.
      const pos = getPos();
      const nodeSize = node.nodeSize;
      // The caret lands ON that empty line, which is precisely what the
      // caret-entry mint watches for — without the suppression window
      // backspace would immediately re-create the block it just collapsed.
      suppressTextblockMint(pos);
      editor.chain().focus()
        .deleteRange({ from: pos, to: pos + nodeSize })
        .insertContentAt(pos, { type: "paragraph" })
        .setTextSelection(pos + 1)
        .run();
      // Clean up the occurrence from the data model
      dropOccurrenceData();
      return;
    }

    const pos = getPos(); // start of this textblock node in the parent doc
    if (pos <= 0) return;

    // pos - 1 is the last position of the previous sibling
    const prevSibling = editor.state.doc.resolve(pos).nodeBefore;
    if (!prevSibling) return;

    if (prevSibling.type.name === "instanceTextblock") {
      // Previous sibling is also a textblock — focus its sub-editor at end
      const prevFrom = pos - prevSibling.nodeSize;
      const domNode = editor.view.nodeDOM(prevFrom);
      const innerPM = innerProseMirror(domNode);
      if (innerPM) {
        innerPM.focus();
        const range = document.createRange();
        range.selectNodeContents(innerPM);
        range.collapse(false); // collapse to end
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    } else {
      // Regular block (paragraph, heading, etc.) — move outer cursor to its end
      editor.chain().setTextSelection(pos - 1).focus().run();
    }
  }, [editor, getPos, node.nodeSize, dropOccurrenceData]);

  return (
    <NodeViewWrapper as="div" contentEditable={false}>
      <div
        ref={wrapperRef}
        className="instance-textblock-block"
        data-instance-id={instanceId}
        data-occurrence-id={occurrenceId}
        style={{
          margin: "3px 0",
          background: "rgba(134,239,172,0.04)",
          borderRadius: 6,
          position: "relative",
          paddingLeft: 22,
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* RadialMenu handle — always visible, top-left.
            Doubles as the Pragmatic DnD drag handle (see useEffect above). */}
        <div
          ref={handleRef}
          className="module-drag-handle"
          data-dnd-handle="true"
          style={{
            position: "absolute",
            top: 4,
            left: 2,
            zIndex: 10,
          }}
        >
          <RadialMenu
            size="sm"
            forceDirection="down"
            dragMode={entityDragMode}
            onToggleDragMode={toggleEntityDragMode}
            onDelete={handleDeleteBlock}
          />
        </div>

        {occurrence ? (
          bodyBinding ? (
            <BoundBody hostOccurrence={occurrence} binding={bodyBinding}>
              <DocContent
                occurrence={occurrence}
                dispatch={dispatch}
                socket={socket}
                hideToolbar={true}
                // A block minted a frame ago must mount its real editor NOW: 2026-08-07
                // records that deferring alone left a new block un-editable for 1223ms —
                // "the original wait, moved."
                lazy={!isProvisionalTextblock(occurrenceId)}
                onExitBlock={handleExitBlock}
                onDeleteBlock={handleNavigateBack}
                onEmptyBlur={handleEmptyBlur}
              />
            </BoundBody>
          ) : (
            // Inner DocContent sits flush at the top of the card. The
            // floating RadialMenu handle is absolute-positioned at top:4 /
            // left:2 and the wrapper's paddingLeft:22 already reserves the
            // horizontal column for it, so the text doesn't overlap the
            // handle and we don't need a top spacer that pushes content
            // down the box.
            <DocContent
              occurrence={occurrence}
              dispatch={dispatch}
              socket={socket}
              hideToolbar={true}
              // A block minted a frame ago must mount its real editor NOW: 2026-08-07
              // records that deferring alone left a new block un-editable for 1223ms —
              // "the original wait, moved."
              lazy={!isProvisionalTextblock(occurrenceId)}
              onExitBlock={handleExitBlock}
              onDeleteBlock={handleNavigateBack}
              onEmptyBlur={handleEmptyBlur}
            />
          )
        ) : isProvisionalTextblock(occurrenceId) ? (
          // Minted a frame ago; its occurrence has not reached the store yet.
          // The insert is deliberately ahead of the store writes so the block
          // paints where the click was (10ms vs 1121ms — measured), which means
          // this state exists for about one frame. It must be an empty box the
          // right height, NOT the "—" below: a dash that appears and vanishes
          // reads as a glitch, and a box that grows reads as the layout moving
          // under the pointer.
          <div style={{ minHeight: 22, padding: "4px 8px" }} aria-hidden="true" />
        ) : (
          <span style={{ opacity: 0.25, fontSize: 11, padding: "4px 8px", display: "block" }}>—</span>
        )}
      </div>
    </NodeViewWrapper>
  );
}
