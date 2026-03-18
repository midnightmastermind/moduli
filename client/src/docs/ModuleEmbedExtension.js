// docs/ModuleEmbedExtension.js
// TipTap block node for @:(occurrenceId) embeds.
// Renders an embedded <Container> card inline inside the parent doc editor.
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import ModuleEmbedNode from "./ModuleEmbedNode.jsx";

export const ModuleEmbed = Node.create({
  name: "moduleEmbed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      occurrenceId: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-occ-id"),
        renderHTML: (attrs) => ({ "data-occ-id": attrs.occurrenceId }),
      },
      align: {
        default: "full",
        parseHTML: (el) => el.getAttribute("data-align") || "full",
        renderHTML: (attrs) => ({ "data-align": attrs.align }),
      },
      width: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-width") ? Number(el.getAttribute("data-width")) : null,
        renderHTML: (attrs) => attrs.width ? { "data-width": attrs.width } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-module-embed="true"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-module-embed": "true" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ModuleEmbedNode, {
      stopEvent: () => true, // Container handles all its own events
    });
  },

  addCommands() {
    return {
      insertModuleEmbed:
        (occurrenceId) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { occurrenceId } }),
    };
  },
});

export default ModuleEmbed;
