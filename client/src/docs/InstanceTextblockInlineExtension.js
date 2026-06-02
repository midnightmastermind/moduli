// docs/InstanceTextblockInlineExtension.js
// Inline TipTap node for textblock-inline occurrences (role:"textblock", kind:"inline").
// Behaves like a pill — atom inline node — but its body is a short rich-text
// snippet sourced from `occurrence.textmap`. Visually blends with paragraph
// flow (no extra margin, no border chrome). Distinct from `instanceTextblock`
// which is a freestanding block.
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import InstanceTextblockInlineNode from "./pills/InstanceTextblockInlineNode.jsx";

export const InstanceTextblockInline = Node.create({
  name: "instanceTextblockInline",
  group: "inline",
  inline: true,
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
    return [{ tag: 'span[data-instance-textblock-inline="true"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-instance-textblock-inline": "true" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(InstanceTextblockInlineNode);
  },

  addCommands() {
    return {
      insertInstanceTextblockInline:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

export default InstanceTextblockInline;
