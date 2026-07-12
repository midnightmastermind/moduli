// docs/WrapGroupExtension.js
//
// Block-wrap container (project_block_wrap_redesign). Holds ONE OR MORE NEIGHBOR
// embeds (children 0..N-1 — the smaller blocks in the notch) FOLLOWED BY the HOST
// (the LAST child — the bigger block whose prose reflows around them). All stay
// real, separately-draggable embeds; this node only gives them a shared flow so the
// neighbors `float` and the host's own text wraps around them natively (an L), with
// the host card's border clipped to the L and the neighbor keeping its own border.
//
// NEIGHBOR-FIRST ORDER IS LOAD-BEARING: CSS floats only wrap content that comes
// AFTER them in source order, so the neighbor float MUST precede the host. (Proven
// in the ~/.wraptest2 harness — host-second never wraps.) hostOccId = node.lastChild.
//
// attrs:
//   side          — "right" | "left": which edge the neighbor floats to.
//   anchor        — "top" | "middle": coarse notch position (L vs C). Back-compat;
//                   the precise position is anchorIndex.
//   anchorIndex   — the host block index the notch STARTS at. DYNAMIC shape: 0 → L,
//                   a mid block → C / hangman, side flip → J. WrapGroupNode turns this
//                   into the floated neighbor's margin-top so the prose wraps continuously.
//   neighborWidth — px width of the floated neighbor column (null → default). Set by
//                   dragging the seam splitter.
//   wrap          — true (default): float + reflow + clip. false: plain side-by-side.
//
// The reflow is a real CSS float (no ghost wrapSpacer); the host card's L border is
// clipped by measuring the float's box — see WrapGroupNode.jsx + wrapNotch.js.
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import WrapGroupNode from "./WrapGroupNode.jsx";

export const WrapGroup = Node.create({
  name: "wrapGroup",
  group: "block",
  content: "moduleEmbed{2,}",
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
      // Continuous notch position: the host block index the neighbor's notch sits
      // before. null → fall back to the coarse `anchor` (top→0 / middle→mid). Kept
      // drives the DYNAMIC notch position (margin-top of the float in WrapGroupNode).
      anchorIndex: {
        default: null,
        parseHTML: (el) => { const v = el.getAttribute("data-anchor-index"); return v == null ? null : Number(v); },
        renderHTML: (attrs) => (attrs.anchorIndex == null ? {} : { "data-anchor-index": attrs.anchorIndex }),
      },
      // Wrap on/off (RESTORED 2026-07-12, per user): true (default) = the
      // L-float morph; false = plain side-by-side COLUMNS (.wrap-group--off,
      // no morph, no auto-stack). The only honest mode for non-textmapped
      // hosts; toggled per-group from the neighbor's radial menu.
      wrap: {
        default: true,
        parseHTML: (el) => el.getAttribute("data-wrap-mode") !== "false",
        renderHTML: (attrs) => ({ "data-wrap-mode": String(attrs.wrap !== false) }),
      },
      // Line-level anchor: px offset from the host prose top → the float's margin-top.
      // Allows the neighbor to start at ANY visual line, not just a block boundary.
      // null → fall back to the legacy anchorIndex block math.
      anchorOffset: {
        default: null, // px from the host prose top → the float's margin-top (line-level anchor)
        parseHTML: (el) => {
          const v = el.getAttribute("data-anchor-offset");
          return v == null ? null : Number(v);
        },
        renderHTML: (attrs) =>
          attrs.anchorOffset == null ? {} : { "data-anchor-offset": String(attrs.anchorOffset) },
      },
      // Px width of the floated neighbor column. null → CSS default (--wrap-nw).
      // Written live by the seam splitter drag (WrapGroupNode).
      neighborWidth: {
        default: null,
        parseHTML: (el) => { const v = el.getAttribute("data-neighbor-width"); return v == null ? null : Number(v); },
        renderHTML: (attrs) => (attrs.neighborWidth == null ? {} : { "data-neighbor-width": attrs.neighborWidth }),
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
