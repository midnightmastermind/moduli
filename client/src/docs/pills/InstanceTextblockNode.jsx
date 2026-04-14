// docs/pills/InstanceTextblockNode.jsx
// NodeView for the instanceTextblock TipTap node.
// Renders a DocContent sub-editor with a RadialMenu handle in the top-left.
import React, { useContext, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { GridActionsContext } from "../../GridActionsContext";
import DocContent from "../../modules/DocContent.jsx";
import RadialMenu from "../../ui/RadialMenu.jsx";
import * as CommitHelpers from "../../helpers/CommitHelpers";

export default function InstanceTextblockNode({ node, editor, getPos, deleteNode }) {
  const { occurrencesById, dispatch, socket } = useContext(GridActionsContext) || {};

  const { instanceId, occurrenceId } = node.attrs;
  const occurrence = occurrencesById?.[occurrenceId] || null;

  // Plain Enter at end of content → move parent editor cursor into the next block.
  // pos + nodeSize is the gap after the textblock (between nodes). We need to step
  // inside the next paragraph (+1), or insert one if none exists.
  const handleExitBlock = useCallback(() => {
    if (!editor || !getPos) return;
    const pos = getPos();
    const nodeSize = node.nodeSize;
    const afterPos = pos + nodeSize;
    const docSize = editor.state.doc.content.size;

    if (afterPos < docSize) {
      // There's a node after this textblock — step inside it.
      editor.chain().setTextSelection(afterPos + 1).focus().run();
    } else {
      // End of doc — insert a new paragraph and move cursor into it.
      editor
        .chain()
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

  // Backspace at start of sub-editor → move parent cursor to end of previous sibling.
  // Never deletes the textblock (use radial menu for that).
  const handleNavigateBack = useCallback(() => {
    if (!editor || !getPos) return;
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
  }, [editor, getPos]);

  return (
    <NodeViewWrapper as="div" contentEditable={false}>
      <div
        className="instance-textblock-block"
        data-instance-id={instanceId}
        data-occurrence-id={occurrenceId}
        draggable={false}
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
        {/* RadialMenu handle — always visible, top-left */}
        <div
          className="module-drag-handle"
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
            onDelete={handleDeleteBlock}
          />
        </div>

        {occurrence ? (
          <div style={{ marginTop: 10 }}>
            <DocContent
              occurrence={occurrence}
              dispatch={dispatch}
              socket={socket}
              hideToolbar={true}
              onExitBlock={handleExitBlock}
              onDeleteBlock={handleNavigateBack}
            />
          </div>
        ) : (
          <span style={{ opacity: 0.25, fontSize: 11, padding: "4px 8px", display: "block" }}>—</span>
        )}
      </div>
    </NodeViewWrapper>
  );
}
