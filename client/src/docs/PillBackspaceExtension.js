// docs/PillBackspaceExtension.js
// ============================================================
// Tiptap Extension: Custom backspace + arrow key behavior for pills and modules
//
// Inline pills (fieldPill, instancePill, docLink, exprPill):
//   Backspace converts them to their text representation.
//
// Block modules (moduleEmbed, instanceTextblock):
//   Backspace NEVER deletes them — always moves cursor before the node.
//   Applies whether the current block is empty or has content.
//   Use the radial menu to remove modules.
//
// Arrow keys into/out of instanceTextblock sub-editors:
//   ArrowLeft/Right at block boundary → enter sub-editor at end/start.
//   ArrowUp/Down at visual first/last line → enter sub-editor at bottom/top.
// ============================================================

import { Extension } from "@tiptap/core";

// ── DOM helpers ────────────────────────────────────────────────────────────────

function getInnerPM(domNode) {
  return domNode?.querySelector?.(".ProseMirror") ?? null;
}

// Focus innerPM and collapse selection to start (atStart=true) or end (atStart=false).
function focusInnerAt(innerPM, atStart) {
  if (!innerPM) return false;
  innerPM.focus();
  const range = document.createRange();
  range.selectNodeContents(innerPM);
  range.collapse(atStart);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  return true;
}

// Focus innerPM at top or bottom, trying to match x position via caretRangeFromPoint.
// Falls back to start/end if the hit test misses the inner editor.
function focusInnerAtXY(innerPM, x, fromTop) {
  if (!innerPM) return false;
  if (document.caretRangeFromPoint) {
    const rect = innerPM.getBoundingClientRect();
    const cx = Math.min(Math.max(x, rect.left + 1), rect.right - 1);
    const cy = fromTop ? rect.top + 1 : rect.bottom - 1;
    const range = document.caretRangeFromPoint(cx, cy);
    if (range && innerPM.contains(range.startContainer)) {
      innerPM.focus();
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      return true;
    }
  }
  // Fallback: collapse to start (entering from top) or end (entering from bottom)
  return focusInnerAt(innerPM, fromTop);
}

// ── Extension ─────────────────────────────────────────────────────────────────

export const PillBackspace = Extension.create({
  name: "pillBackspace",

  addKeyboardShortcuts() {
    return {

      // ── Backspace ──────────────────────────────────────────────────────────

      Backspace: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;

        // Only handle collapsed cursor (no text selection)
        if (!selection.empty) return false;

        const pos = selection.$anchor.pos;
        if (pos < 1) return false;

        // Block-level check runs FIRST — before nodeBefore null check.
        // When cursor is at the start of a block, nodeBefore is null (nothing before
        // the cursor within the paragraph), so we must check the previous sibling block.
        if (selection.$anchor.parentOffset === 0 && selection.$anchor.depth >= 1) {
          const blockStart = selection.$anchor.before(1);
          const prevSibling = state.doc.resolve(blockStart).nodeBefore;

          if (prevSibling?.type.name === "instanceTextblock") {
            // Reverse of the Enter/exit behavior — enter the sub-editor at its end.
            const textblockFrom = blockStart - prevSibling.nodeSize;
            const innerPM = getInnerPM(editor.view.nodeDOM(textblockFrom));
            return focusInnerAt(innerPM, false);
          }

          if (prevSibling?.type.name === "moduleEmbed") {
            // Embeds are not editable — just move outer cursor before the node.
            editor.commands.setTextSelection(blockStart - prevSibling.nodeSize);
            return true;
          }
        }

        const nodeBefore = state.doc.resolve(pos).nodeBefore;
        if (!nodeBefore) return false;

        const nodeType = nodeBefore.type.name;
        const from = pos - nodeBefore.nodeSize;

        switch (nodeType) {
          case "fieldPill": {
            const name = nodeBefore.attrs.fieldName || nodeBefore.attrs.fieldId || "field";
            editor.chain().deleteRange({ from, to: pos }).insertContentAt(from, `#${name}`).run();
            return true;
          }
          case "instancePill": {
            const label = nodeBefore.attrs.instanceLabel || "";
            editor.chain().deleteRange({ from, to: pos }).insertContentAt(from, label).run();
            return true;
          }
          case "docLink": {
            const linkLabel = nodeBefore.attrs.label || nodeBefore.attrs.targetId || "";
            editor.chain().deleteRange({ from, to: pos }).insertContentAt(from, linkLabel).run();
            return true;
          }
          case "exprPill": {
            const expr = nodeBefore.attrs.expr || "";
            editor.chain().deleteRange({ from, to: pos }).insertContentAt(from, `=${expr}`).run();
            return true;
          }
          default:
            return false;
        }
      },

      // ── ArrowLeft — enter textblock at its end ────────────────────────────

      ArrowLeft: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        if (!selection.empty) return false;
        const { $anchor } = selection;
        if ($anchor.parentOffset !== 0 || $anchor.depth < 1) return false;
        const blockStart = $anchor.before(1);
        const prev = state.doc.resolve(blockStart).nodeBefore;
        if (prev?.type.name !== "instanceTextblock") return false;
        const textblockPos = blockStart - prev.nodeSize;
        requestAnimationFrame(() => {
          const innerPM = getInnerPM(editor.view.nodeDOM(textblockPos));
          focusInnerAt(innerPM, false);
        });
        return true;
      },

      // ── ArrowRight — enter textblock at its start ─────────────────────────

      ArrowRight: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        if (!selection.empty) return false;
        const { $anchor } = selection;
        if ($anchor.parentOffset !== $anchor.parent.content.size || $anchor.depth < 1) return false;
        const blockEnd = $anchor.after(1);
        const next = state.doc.resolve(blockEnd).nodeAfter;
        if (next?.type.name !== "instanceTextblock") return false;
        requestAnimationFrame(() => {
          const innerPM = getInnerPM(editor.view.nodeDOM(blockEnd));
          focusInnerAt(innerPM, true);
        });
        return true;
      },

      // ── ArrowUp — enter textblock at bottom when on first visual line ─────

      ArrowUp: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        if (!selection.empty) return false;
        if (!editor.view.endOfTextblock("up")) return false;
        const { $anchor } = selection;
        if ($anchor.depth < 1) return false;
        const blockStart = $anchor.before(1);
        const prev = state.doc.resolve(blockStart).nodeBefore;
        if (prev?.type.name !== "instanceTextblock") return false;
        const textblockPos = blockStart - prev.nodeSize;
        const coords = editor.view.coordsAtPos(selection.anchor);
        // Defer focus until after ProseMirror finishes processing the keydown
        requestAnimationFrame(() => {
          const innerPM = getInnerPM(editor.view.nodeDOM(textblockPos));
          focusInnerAtXY(innerPM, coords.left, false);
        });
        return true;
      },

      // ── ArrowDown — enter textblock at top when on last visual line ───────

      ArrowDown: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        if (!selection.empty) return false;
        if (!editor.view.endOfTextblock("down")) return false;
        const { $anchor } = selection;
        if ($anchor.depth < 1) return false;
        const blockEnd = $anchor.after(1);
        const next = state.doc.resolve(blockEnd).nodeAfter;
        if (next?.type.name !== "instanceTextblock") return false;
        const coords = editor.view.coordsAtPos(selection.anchor);
        // Defer focus until after ProseMirror finishes processing the keydown
        requestAnimationFrame(() => {
          const innerPM = getInnerPM(editor.view.nodeDOM(blockEnd));
          focusInnerAtXY(innerPM, coords.left, true);
        });
        return true;
      },

    };
  },
});

export default PillBackspace;
