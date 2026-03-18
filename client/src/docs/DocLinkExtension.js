// docs/DocLinkExtension.js
// ============================================================
// Tiptap Extension: Document Links [[brackets]]
// Obsidian-style internal document linking
// ============================================================

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import DocLinkNode from "./pills/DocLinkNode";

/**
 * DocLink Extension for Tiptap
 *
 * Creates inline document link nodes using [[bracket]] syntax:
 * - [[Document Name]] links to a document
 * - [[2024-01-15]] links to a day page
 * - Click to navigate to the linked document
 */
export const DocLink = Node.create({
  name: "docLink",
  group: "inline",
  inline: true,
  selectable: true,
  atom: true,

  addAttributes() {
    return {
      // Target document/container ID
      targetId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-target-id"),
        renderHTML: (attributes) => ({
          "data-target-id": attributes.targetId,
        }),
      },
      // Display label (what shows in [[brackets]])
      label: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-label"),
        renderHTML: (attributes) => ({
          "data-label": attributes.label,
        }),
      },
      // Link type: "doc" | "dayPage" | "container"
      linkType: {
        default: "doc",
        parseHTML: (element) => element.getAttribute("data-link-type"),
        renderHTML: (attributes) => ({
          "data-link-type": attributes.linkType,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="doc-link"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(
        { "data-type": "doc-link", class: "doc-link" },
        HTMLAttributes
      ),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DocLinkNode);
  },

  addCommands() {
    return {
      insertDocLink:
        (attributes) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: attributes,
          });
        },
    };
  },

  // Input rule: [[ triggers doc link creation
  addInputRules() {
    return [];
    // Note: We handle [[ detection in the editor's handleTextInput
    // because we need to show a suggestion popup
  },
});

export default DocLink;
