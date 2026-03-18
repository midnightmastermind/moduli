// docs/ExprPillExtension.js
// ============================================================
// TipTap Extension: Expression Pills (S6)
// Inline formula evaluation: =fieldName or =fieldA + fieldB * 2
// ============================================================

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import ExprPillNode from "./pills/ExprPillNode";

export const ExprPill = Node.create({
  name: "exprPill",
  group: "inline",
  inline: true,
  selectable: true,
  atom: true,

  addAttributes() {
    return {
      expr: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-expr"),
        renderHTML: (attrs) => ({ "data-expr": attrs.expr }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="expr-pill"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ "data-type": "expr-pill", class: "expr-pill" }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ExprPillNode);
  },

  addCommands() {
    return {
      insertExprPill:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

export default ExprPill;
