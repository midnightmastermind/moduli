// docs/pills/InstanceTextblockNode.jsx
// NodeView for the instanceTextblock TipTap node.
// Renders a DocContent sub-editor with a RadialMenu handle in the top-left.
import React, { useContext, useCallback, useEffect, useMemo, useRef } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { GridActionsContext, useGridActions } from "../../GridActionsContext";
import DocContent from "../../modules/DocContent.jsx";
import BoundBody from "../../modules/BoundBody.jsx";
import RadialMenu from "../../ui/RadialMenu.jsx";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import { embedDeleteRegistry } from "../../helpers/embedRegistry.js";
import { resolveEditorBinding } from "../../state/editorBindings.js";

export default function InstanceTextblockNode({ node, editor, getPos, deleteNode }) {
  const { occurrencesById, modulesById, dispatch, socket } = useGridActions() || {};

  const { instanceId, occurrenceId } = node.attrs;
  const occurrence = occurrencesById?.[occurrenceId] || null;
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
    return cleanup;
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
      const innerPM = editor.view.nodeDOM(nextChildStart)?.querySelector?.(".ProseMirror");
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

  // Radial menu delete — removes TipTap node + cleans up occurrence
  const handleDeleteBlock = useCallback(() => {
    if (!editor || !getPos) return;
    const pos = getPos();
    const nodeSize = node.nodeSize;
    editor.chain().focus().deleteRange({ from: pos, to: pos + nodeSize }).run();
    if (occurrenceId && dispatch && socket) {
      CommitHelpers.removeOccurrence({ dispatch, socket, occurrenceId, emit: true });
    }
  }, [editor, getPos, node.nodeSize, occurrenceId, dispatch, socket]);

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
      editor.chain().focus()
        .deleteRange({ from: pos, to: pos + nodeSize })
        .insertContentAt(pos, { type: "paragraph" })
        .setTextSelection(pos + 1)
        .run();
      // Clean up the occurrence from the data model
      if (occurrenceId && dispatch && socket) {
        CommitHelpers.removeOccurrence({ dispatch, socket, occurrenceId, emit: true });
      }
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
      const innerPM = domNode?.querySelector?.(".ProseMirror");
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
  }, [editor, getPos, node.nodeSize, occurrenceId, dispatch, socket]);

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
                onExitBlock={handleExitBlock}
                onDeleteBlock={handleNavigateBack}
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
              onExitBlock={handleExitBlock}
              onDeleteBlock={handleNavigateBack}
            />
          )
        ) : (
          <span style={{ opacity: 0.25, fontSize: 11, padding: "4px 8px", display: "block" }}>—</span>
        )}
      </div>
    </NodeViewWrapper>
  );
}
