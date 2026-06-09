// docs/WrapGroupExtension.js
//
// Block-wrap container (project_block_wrap_l_shape). Holds EXACTLY two
// moduleEmbed children — child 0 = HOST (the bigger block that reflows), child 1
// = NEIGHBOR (the smaller block that sits in the host's notch). Both stay real,
// separately-draggable embeds; this node only gives them a shared positioning
// context so the neighbor can overlay the host's reserved notch while the host's
// own text/border bend into the L/C around it.
//
// attrs:
//   side   — "right" | "left": which edge the neighbor occupies.
//   anchor — "top" | "middle": where down the host the notch sits (L vs C).
//   wrap   — true (default): reflow + clip. false: plain side-by-side, no notch.
//
// The actual reflow + clip is driven by a wrapSpacer node the WrapGroupNode keeps
// sized inside the HOST's textmap (so the host's own editor flow reserves the
// notch) — see WrapGroupNode.jsx + TextblockCard's clip-path.
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import WrapGroupNode from "./WrapGroupNode.jsx";

export const WrapGroup = Node.create({
  name: "wrapGroup",
  group: "block",
  content: "moduleEmbed{2}",
  selectable: false,
  draggable: false,
  isolating: true,

  addAttributes() {
    return {
      side: {
        default: "right",
        parseHTML: (el) => el.getAttribute("data-side") || "right",
        renderHTML: (attrs) => ({ "data-side": attrs.side }),
      },
      anchor: {
        default: "top",
        parseHTML: (el) => el.getAttribute("data-anchor") || "top",
        renderHTML: (attrs) => ({ "data-anchor": attrs.anchor }),
      },
      wrap: {
        default: true,
        parseHTML: (el) => el.getAttribute("data-wrap") !== "off",
        renderHTML: (attrs) => ({ "data-wrap": attrs.wrap ? "on" : "off" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-wrap-group="true"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-wrap-group": "true" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(WrapGroupNode);
  },
});

export default WrapGroup;
