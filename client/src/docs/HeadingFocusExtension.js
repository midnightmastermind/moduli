// docs/HeadingFocusExtension.js
// ============================================================
// Tiptap Extension: Heading Focus
// Adds a CSS class to the heading node containing the cursor
// Enables Obsidian-style live preview where # markers only
// show when the cursor is on that heading line
// ============================================================

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const headingFocusKey = new PluginKey("headingFocus");

export const HeadingFocus = Extension.create({
  name: "headingFocus",

  addProseMirrorPlugins() {
    const extension = this;
    return [
      new Plugin({
        key: headingFocusKey,
        props: {
          // Re-run decorations on focus/blur so the # marker appears/clears
          // immediately (a pure blur doesn't otherwise dispatch a tx).
          handleDOMEvents: {
            focus: (view) => { view.dispatch(view.state.tr.setMeta(headingFocusKey, true)); return false; },
            blur:  (view) => { view.dispatch(view.state.tr.setMeta(headingFocusKey, true)); return false; },
          },
          decorations(state) {
            const { doc, selection } = state;
            const decorations = [];

            // Only show the # marker while THIS editor is actually being
            // edited. Without the focus gate, an unfocused editor whose
            // default selection sits in its only heading (every textblock
            // sub-editor on load) renders a stray "#". editor.isFocused is
            // the live DOM-focus flag.
            if (!extension.editor?.isFocused) {
              return DecorationSet.empty;
            }

            // Find which heading (if any) contains the cursor
            const $pos = selection.$head;
            // Walk up from cursor to find the heading node
            for (let depth = $pos.depth; depth >= 0; depth--) {
              const node = $pos.node(depth);
              if (node.type.name === "heading") {
                const start = $pos.before(depth);
                decorations.push(
                  Decoration.node(start, start + node.nodeSize, {
                    class: "heading-focused",
                  })
                );
                break;
              }
            }

            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});

export default HeadingFocus;
