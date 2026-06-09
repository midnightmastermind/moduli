// docs/WrapSpacerExtension.js
//
// Block-wrap primitive (project_block_wrap_l_shape). An invisible floated
// placeholder injected into a HOST block's editor flow so the host's own text
// vacates a B-sized notch — that's how the host reflows into an L (notch at top)
// or C (notch mid-block) around a SEPARATE neighbor occurrence that sits over the
// reserved hole. The neighbor is never inside this flow; this spacer only reserves
// the space (CSS Exclusions would do this without a ghost, but no modern browser
// ships it — see the memory note).
//
// attrs:
//   w / h  — the neighbor's measured footprint in px (kept in sync by the wrap
//            renderer via a ResizeObserver on the neighbor).
//   side   — "right" | "left": which edge the neighbor occupies (float side).
//
// The node is atom + non-selectable + non-draggable so it never grabs the cursor
// or shows a handle; it's pure layout. `shape-outside: inset(0)` makes the text
// hug the rectangle exactly (no library needed for a rectangular notch).
import { Node } from "@tiptap/core";

export const WrapSpacer = Node.create({
  name: "wrapSpacer",
  group: "block",
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      w: { default: 160 },
      h: { default: 120 },
      side: { default: "right" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-wrap-spacer="true"]' }];
  },

  renderHTML({ node }) {
    const w = Number(node.attrs.w) || 0;
    const h = Number(node.attrs.h) || 0;
    const side = node.attrs.side === "left" ? "left" : "right";
    const gap = 14;
    const style = [
      `float:${side}`,
      `width:${w}px`,
      `height:${h}px`,
      "shape-outside:inset(0)",
      side === "left" ? `margin-right:${gap}px` : `margin-left:${gap}px`,
      "margin-bottom:8px",
      "pointer-events:none",
    ].join(";");
    return ["div", {
      "data-wrap-spacer": "true",
      "aria-hidden": "true",
      class: "wrap-spacer",
      style,
    }];
  },
});

export default WrapSpacer;
