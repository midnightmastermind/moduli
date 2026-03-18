// docs/FieldPillExtension.js
// ============================================================
// Tiptap Extension: Field Pills
// Embeddable field references that display live values
// ============================================================

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import FieldPillNode from "./pills/FieldPillNode";

/**
 * FieldPill Extension for Tiptap
 *
 * Creates inline field reference nodes that:
 * - Display field name as a colored pill
 * - Show live calculated values
 * - Support click to view/edit field
 * - Can be inserted via @ mention or drag from palette
 */
export const FieldPill = Node.create({
  name: "fieldPill",
  group: "inline",
  inline: true,
  selectable: true,
  atom: true, // Treat as a single unit (can't cursor into it)

  addAttributes() {
    return {
      // Field reference
      fieldId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-field-id"),
        renderHTML: (attributes) => ({
          "data-field-id": attributes.fieldId,
        }),
      },
      fieldName: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-field-name"),
        renderHTML: (attributes) => ({
          "data-field-name": attributes.fieldName,
        }),
      },
      fieldType: {
        default: "text",
        parseHTML: (element) => element.getAttribute("data-field-type"),
        renderHTML: (attributes) => ({
          "data-field-type": attributes.fieldType,
        }),
      },
      fieldMode: {
        default: "input",
        parseHTML: (element) => element.getAttribute("data-field-mode"),
        renderHTML: (attributes) => ({
          "data-field-mode": attributes.fieldMode,
        }),
      },
      // Display options
      showValue: {
        default: true,
        parseHTML: (element) => element.getAttribute("data-show-value") === "true",
        renderHTML: (attributes) => ({
          "data-show-value": String(attributes.showValue),
        }),
      },
      showLabel: {
        default: true,
        parseHTML: (element) => element.getAttribute("data-show-label") === "true",
        renderHTML: (attributes) => ({
          "data-show-label": String(attributes.showLabel),
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="field-pill"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(
        { "data-type": "field-pill", class: "field-pill" },
        HTMLAttributes
      ),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FieldPillNode, {
      stopEvent: ({ event }) => {
        // Stop double-click from selecting/deleting the atom node
        if (event.type === "dblclick") return true;
        // Stop all events when an input inside the pill is focused (editing mode)
        const target = event.target;
        if (target?.tagName === "INPUT") return true;
        return false;
      },
    });
  },

  addCommands() {
    return {
      insertFieldPill:
        (attributes) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: attributes,
          });
        },
    };
  },

  // Keyboard shortcut: @ to trigger field mention
  addKeyboardShortcuts() {
    return {
      // Could add shortcuts here if needed
    };
  },
});

export default FieldPill;
