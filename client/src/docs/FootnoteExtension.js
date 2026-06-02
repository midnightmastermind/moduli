// docs/FootnoteExtension.js
// ============================================================
// Tiptap Extension: Footnotes
// Inline atom node rendering as a superscript marker. Click to
// edit the footnote text inline. Numbering is derived from the
// node's position in the document so re-ordering / inserting /
// deleting footnotes auto-renumbers without any persisted state.
// ============================================================

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import FootnoteNode from "./pills/FootnoteNode";

export const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  selectable: true,
  atom: true,

  addAttributes() {
    return {
      text: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-text") || "",
        renderHTML: (attributes) => ({ "data-text": attributes.text || "" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'sup[data-type="footnote"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "sup",
      mergeAttributes(
        { "data-type": "footnote", class: "footnote-marker" },
        HTMLAttributes
      ),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FootnoteNode, {
      stopEvent: ({ event }) => {
        // Keep the inline editor's textarea/input events from reaching
        // ProseMirror so it doesn't try to select / replace the atom.
        const target = event.target;
        if (target?.tagName === "TEXTAREA" || target?.tagName === "INPUT") return true;
        return false;
      },
    });
  },

  addCommands() {
    return {
      insertFootnote:
        (attrs = {}) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { text: attrs.text || "" },
          });
        },
    };
  },

  // Markdown shortcut: [^N] — auto-insert empty footnote when the user
  // types the markdown-style footnote ref. Numbering is auto-derived;
  // the captured N is ignored (kept in the regex for familiarity).
  addInputRules() {
    return [
      {
        find: /\[\^(\d+)\]$/,
        handler: ({ state, range, commands }) => {
          commands.deleteRange(range);
          commands.insertFootnote({ text: "" });
        },
      },
    ];
  },
});

export default Footnote;
