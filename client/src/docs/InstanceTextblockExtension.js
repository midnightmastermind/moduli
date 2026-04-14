// docs/InstanceTextblockExtension.js
// TipTap block node for auto-created typing blocks.
// This is NOT a pill — it's a freestanding sub-editor linked to an instance occurrence.
// Created by handleAutoCreateTextblock in DocContent.jsx when the user starts typing
// on an empty paragraph in a doc page.
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import InstanceTextblockNode from "./pills/InstanceTextblockNode.jsx";

export const InstanceTextblock = Node.create({
  name: "instanceTextblock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      instanceId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-instance-id"),
        renderHTML: (attrs) => ({ "data-instance-id": attrs.instanceId }),
      },
      occurrenceId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-occurrence-id"),
        renderHTML: (attrs) => ({ "data-occurrence-id": attrs.occurrenceId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-instance-textblock="true"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-instance-textblock": "true" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(InstanceTextblockNode, {
      stopEvent: ({ event }) => {
        // Stop ALL events from inside the textblock so the outer ProseMirror
        // never sees them. Without this, clicks on padding/background reach the
        // outer editor → NodeSelection on the atom → steals focus → cursor resets to 0.
        if (event.target?.closest?.(".instance-textblock-block")) return true;
        return false;
      },
    });
  },

  addCommands() {
    return {
      insertInstanceTextblock:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

export default InstanceTextblock;
