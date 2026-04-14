// docs/InstancePillExtension.js
// ============================================================
// TipTap Extension: inline instance pill.
// Displays an instance reference as a small colored badge (@mention).
//
// NOT for block textblocks — those use InstanceTextblockExtension.js.
// ============================================================

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import InstancePillNode from "./pills/InstancePillNode";

export const InstancePill = Node.create({
  name: "instancePill",
  group: "inline",
  inline: true,
  selectable: true,
  atom: true,

  addAttributes() {
    return {
      instanceId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-instance-id"),
        renderHTML: (attributes) => ({ "data-instance-id": attributes.instanceId }),
      },
      instanceLabel: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-instance-label"),
        renderHTML: (attributes) => ({ "data-instance-label": attributes.instanceLabel }),
      },
      occurrenceId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-occurrence-id"),
        renderHTML: (attributes) => ({ "data-occurrence-id": attributes.occurrenceId }),
      },
      containerId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-container-id"),
        renderHTML: (attributes) => ({ "data-container-id": attributes.containerId }),
      },
      showIcon: {
        default: true,
        parseHTML: (element) => element.getAttribute("data-show-icon") === "true",
        renderHTML: (attributes) => ({ "data-show-icon": String(attributes.showIcon) }),
      },
      // Legacy: pillDisplay was used to distinguish inline vs block mode before
      // instanceTextblock existed. Kept for parseHTML only so old DB docs can be
      // read and migrated by Editor.jsx onCreate. Not rendered or written by new code.
      pillDisplay: {
        default: "inline",
        parseHTML: (element) => element.getAttribute("data-pill-display") || "inline",
        renderHTML: () => ({}), // never written to HTML by new saves
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="instance-pill"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes({ "data-type": "instance-pill", class: "instance-pill" }, HTMLAttributes),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(InstancePillNode);
    // No stopEvent override needed — inline pills are atom:true, ProseMirror
    // already treats them as single units via standard atom handling.
  },

  addCommands() {
    return {
      insertInstancePill:
        (attributes) =>
        ({ commands }) => {
          return commands.insertContent({ type: this.name, attrs: attributes });
        },
    };
  },
});

export default InstancePill;
