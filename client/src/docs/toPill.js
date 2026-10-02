// docs/toPill.js
//
// WHAT A BLOCK BECOMES WHEN IT IS TURNED INTO A PILL ("To pill" on an embed).
//
// A pill names its occurrence; it does not carry a copy of the words. For an
// instance that name is the placement's label. A TEXTBLOCK has no label at all —
// its words are its body — so an `instancePill` of one read "Item" (2026-10-02).
// A textblock becomes the inline textblock chip instead, which renders the body.
//
// The chip edits its body as ONE plain line (it writes the textmap back as a
// single text paragraph), so only a textblock that already is one plain line is
// offered: converting a formatted or multi-paragraph block would lose that the
// first time the chip was edited.
import { occurrenceDisplayLabel } from "../helpers/occurrenceLabel.js";

/** True when the textmap is one paragraph of unmarked text (or empty). */
export function isPlainOneLiner(textmap) {
  const blocks = Array.isArray(textmap?.content) ? textmap.content : [];
  if (blocks.length > 1) return false;
  const para = blocks[0];
  if (!para) return true;
  if (para.type !== "paragraph") return false;
  return (para.content || []).every((n) => n.type === "text" && !(n.marks && n.marks.length));
}

/**
 * The inline node (TipTap JSON) this embed turns into, or null when it cannot
 * be a pill.
 */
export function pillNodeFor({ mod, occurrence, occurrenceId }) {
  if (!mod || !occurrenceId) return null;
  if (mod.role === "textblock") {
    if (!isPlainOneLiner(occurrence?.textmap)) return null;
    return { type: "instanceTextblockInline", attrs: { instanceId: mod.id, occurrenceId } };
  }
  return {
    type: "instancePill",
    attrs: { instanceId: mod.id, instanceLabel: occurrenceDisplayLabel(occurrence, mod, "Item"), occurrenceId },
  };
}

/**
 * THE WAY BACK: lift the inline atom at `pos` out of its line as `blockNode`.
 *
 * Alone on its line (other than whitespace) the line IS the pill, so the block
 * replaces it. Inside a sentence the block goes after the line and only the
 * atom leaves it — the instance pill's "Convert to Embed" used to replace the
 * WHOLE paragraph, deleting the sentence around the pill (2026-10-02).
 *
 * Returns false (and leaves `tr` untouched) when the position holds no atom or
 * the line's parent cannot hold a block there (a table cell, a list item).
 */
export function liftInlineToBlock(tr, pos, blockNode) {
  if (!tr || typeof pos !== "number" || !blockNode) return false;
  let $pos;
  try { $pos = tr.doc.resolve(pos); } catch (_) { return false; }
  const atom = $pos.nodeAfter;
  const line = $pos.parent;
  if (!atom || !atom.isInline || $pos.depth < 1) return false;
  const lineStart = $pos.before($pos.depth);
  const lineEnd = lineStart + line.nodeSize;
  const holder = $pos.node($pos.depth - 1);
  const lineIndex = $pos.index($pos.depth - 1);
  let alone = true;
  line.forEach((child) => { if (child !== atom && !(child.isText && !child.text.trim())) alone = false; });
  if (alone) {
    if (!holder.canReplaceWith(lineIndex, lineIndex + 1, blockNode.type)) return false;
    tr.replaceWith(lineStart, lineEnd, blockNode);
    return true;
  }
  if (!holder.canReplaceWith(lineIndex + 1, lineIndex + 1, blockNode.type)) return false;
  tr.insert(lineEnd, blockNode);
  tr.delete(pos, pos + atom.nodeSize);
  return true;
}
