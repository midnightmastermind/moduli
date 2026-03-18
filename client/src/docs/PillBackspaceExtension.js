// docs/PillBackspaceExtension.js
// ============================================================
// Tiptap Extension: Custom backspace behavior for pills
//
// Inline pills (fieldPill, instancePill, docLink, exprPill):
//   Backspace converts them to their text representation.
//
// Block embeds (moduleEmbed):
//   Backspace moves the cursor BEFORE the node — skip over it,
//   never delete or convert. Use the radial menu to remove embeds.
// ============================================================

import { Extension } from "@tiptap/core";

export const PillBackspace = Extension.create({
  name: "pillBackspace",

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;

        // Only handle collapsed cursor (no text selection)
        if (!selection.empty) return false;

        const pos = selection.$anchor.pos;
        if (pos < 1) return false;

        const nodeBefore = state.doc.resolve(pos).nodeBefore;
        if (!nodeBefore) return false;

        const nodeType = nodeBefore.type.name;
        const from = pos - nodeBefore.nodeSize;

        switch (nodeType) {
          case "fieldPill": {
            // Convert to #FieldName text
            const name = nodeBefore.attrs.fieldName || nodeBefore.attrs.fieldId || "field";
            editor.chain().deleteRange({ from, to: pos }).insertContentAt(from, `#${name}`).run();
            return true;
          }

          case "instancePill": {
            // Convert to label text regardless of whether it has fields
            const label = nodeBefore.attrs.instanceLabel || "";
            editor.chain().deleteRange({ from, to: pos }).insertContentAt(from, label).run();
            return true;
          }

          case "docLink": {
            // Convert to link label text
            const linkLabel = nodeBefore.attrs.label || nodeBefore.attrs.targetId || "";
            editor.chain().deleteRange({ from, to: pos }).insertContentAt(from, linkLabel).run();
            return true;
          }

          case "exprPill": {
            // Convert back to =expr text
            const expr = nodeBefore.attrs.expr || "";
            editor.chain().deleteRange({ from, to: pos }).insertContentAt(from, `=${expr}`).run();
            return true;
          }

          case "moduleEmbed": {
            // Block embed — move cursor to just before the node, do NOT delete
            editor.commands.setTextSelection(from);
            return true;
          }

          default:
            return false;
        }
      },
    };
  },
});

export default PillBackspace;
