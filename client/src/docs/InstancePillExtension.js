// docs/InstancePillExtension.js
// ============================================================
// Tiptap Extension: Instance Pills
// Embeddable instance references that display as clickable pills
// ============================================================

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import InstancePillNode from "./pills/InstancePillNode";

/**
 * InstancePill Extension for Tiptap
 *
 * Creates inline instance reference nodes that:
 * - Display instance label as a colored pill
 * - Support click to navigate/open instance
 * - Can be inserted via drag from list or tree drop
 */
export const InstancePill = Node.create({
  name: "instancePill",
  group: "inline",
  inline: true,
  selectable: true,
  atom: true, // Treat as a single unit (can't cursor into it)

  addAttributes() {
    return {
      // Instance reference
      instanceId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-instance-id"),
        renderHTML: (attributes) => ({
          "data-instance-id": attributes.instanceId,
        }),
      },
      instanceLabel: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-instance-label"),
        renderHTML: (attributes) => ({
          "data-instance-label": attributes.instanceLabel,
        }),
      },
      // Occurrence reference - links to specific placement with field values
      occurrenceId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-occurrence-id"),
        renderHTML: (attributes) => ({
          "data-occurrence-id": attributes.occurrenceId,
        }),
      },
      // Optional: container context
      containerId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-container-id"),
        renderHTML: (attributes) => ({
          "data-container-id": attributes.containerId,
        }),
      },
      // Display options
      showIcon: {
        default: true,
        parseHTML: (element) => element.getAttribute("data-show-icon") === "true",
        renderHTML: (attributes) => ({
          "data-show-icon": String(attributes.showIcon),
        }),
      },
      // Block pill: body content (plain text with \n line breaks)
      bodyContent: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-body-content"),
        renderHTML: (attributes) => ({
          "data-body-content": attributes.bodyContent,
        }),
      },
      // Block pill: display mode ("inline" or "block")
      pillDisplay: {
        default: "inline",
        parseHTML: (element) => element.getAttribute("data-pill-display") || "inline",
        renderHTML: (attributes) => ({
          "data-pill-display": attributes.pillDisplay,
        }),
      },
      // Block pill: heading level (1-6, maps to # count)
      headerLevel: {
        default: 1,
        parseHTML: (element) => parseInt(element.getAttribute("data-header-level") || "1", 10),
        renderHTML: (attributes) => ({
          "data-header-level": String(attributes.headerLevel || 1),
        }),
      },
      // Block pill: show label header row (toggled via radial menu)
      showHeader: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-show-header") === "true",
        renderHTML: (attributes) => ({
          "data-show-header": String(attributes.showHeader),
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="instance-pill"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(
        { "data-type": "instance-pill", class: "instance-pill" },
        HTMLAttributes
      ),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(InstancePillNode, {
      stopEvent: ({ event }) => {
        if (event.type === "dblclick") return true;
        const target = event.target;
        // Stop ALL events when target is or is inside an input/textarea
        if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return true;
        if (target?.closest?.("input, textarea")) return true;
        // Stop mouse events inside a pill that's in edit mode (has a visible textarea)
        const pill = target?.closest?.(".block-pill");
        if (pill?.querySelector("textarea, input")) return true;
        return false;
      },
    });
  },

  addCommands() {
    return {
      insertInstancePill:
        (attributes) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: attributes,
          });
        },
    };
  },
});

export default InstancePill;
