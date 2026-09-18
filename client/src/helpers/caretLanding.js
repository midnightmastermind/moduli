// helpers/caretLanding.js
//
// WHERE A CARET MAY LAND WHEN A BLOCK GIVES IT UP.
//
// Backspacing an empty textblock, or arrowing off its left edge, hands the caret
// to the previous sibling — `setTextSelection(pos - 1)`, the last position inside
// that sibling. That is right for a paragraph or a heading and WRONG for a block
// that holds no inline content: ProseMirror refuses to build a TextSelection
// there and throws
//
//     TextSelection endpoint not pointing into a node with inline content (wrapGroup)
//
// which the user hit on the Alan Watts article (2026-09-17), where the first
// empty line sits directly under a wrap group. The throw is not cosmetic: it
// aborts the handler PART WAY THROUGH, after the node has been deleted from the
// document and before `dropOccurrenceData()` runs — so the occurrence is never
// discarded and the block leaks.
//
// The predicate is ProseMirror's own: a node type declares whether its content is
// inline (`content: "inline*"` → `node.inlineContent`). So this asks the schema
// rather than listing the block types that happen to fail today — a wrapGroup, an
// image, a table row and whatever is added next are all covered by construction.

/**
 * Can a text caret sit inside this node at all?
 *
 * ProseMirror exposes `inlineContent` on the NODE and on its TYPE (Node's is a
 * getter over the type's), so both are read — a caller holding only a resolved
 * type still gets a truthful answer.
 */
export function canHoldCaret(node) {
  if (!node) return false;
  return !!(node.inlineContent ?? node.type?.inlineContent);
}

/**
 * The position to put the caret at when leaving the block that STARTS at `pos`,
 * or null when the previous sibling cannot hold one (or there is none).
 *
 * `pos - 1` is the last position inside the previous sibling — valid only when
 * that sibling's content is inline.
 */
export function caretPosBeforeBlock(prevSibling, pos) {
  if (!canHoldCaret(prevSibling)) return null;
  if (typeof pos !== "number" || pos <= 0) return null;
  return pos - 1;
}

/**
 * Put the caret at the END of a doc, or as close as the schema allows.
 *
 * `focus("end")` asks for a TextSelection at `doc.content.size`, and a doc whose
 * LAST node is an ATOM has no inline position there — so it throws
 *
 *     TextSelection endpoint not pointing into a node with inline content (doc)
 *
 * which the user hit on 2026-09-18, alongside the [mint] tables. A textblock IS
 * an atom, so any doc ending in one — an import, an embed, a block minted before
 * the mint learned to leave a trailing paragraph — is in that state, and the
 * throw comes from CLICKING THE PADDING BELOW IT: an ordinary gesture on an
 * ordinary document.
 *
 * `Editor.jsx`'s padding-click already caught this; `DocContent.jsx`'s
 * padding-click, the same decision one file over, never did. Both call this now,
 * so there is one answer to "what does clicking the empty space below a document
 * do" rather than two that drift.
 *
 * Falls back to a plain `focus()` — the caret lands wherever the editor last had
 * it, which is strictly better than the click doing nothing.
 *
 * @returns {"end"|"fallback"|"failed"|"no-editor"} which branch ran — the caller
 *   logs it, so a document that can never take an end-caret is visible rather
 *   than silent.
 */
export function focusDocEnd(editor) {
  if (!editor || editor.isDestroyed) return "no-editor";
  try { editor.commands.focus("end"); return "end"; }
  catch (_) {
    try { editor.commands.focus(); return "fallback"; }
    catch (_) { return "failed"; }
  }
}

/**
 * What backspace on an EMPTY textblock should remove, and where the caret goes.
 *
 * User, 2026-09-18: *"can we delete the line too if i backspace delete a
 * textblock"*, *"have the line go up one on the first backspace. right now i
 * have to press it twice"*, *"like put it on the next line so it creates a
 * textblock there"*.
 *
 * ── WHY IT TOOK TWO PRESSES ────────────────────────────────────────────────
 *
 * The mint appends a trailing paragraph when it lands on the LAST line, because
 * a doc must not end with an atom (`trailingParagraphPos`). Backspace then
 * removed only the block:
 *
 *     click the last line   [para("hi"), para("")]
 *     mint                  [para("hi"), block, para("")]   <- tail added
 *     backspace             [para("hi"), para("")]          <- back where you started
 *
 * so the first press looked like it did nothing to the LINE, and the empty line
 * it left behind accumulates one per mint-then-backspace. **The artifact this
 * absorbs is the mint's own**, which is why absorbing it is not reaching into
 * the user's document.
 *
 * ── THE RULE, stated once ──────────────────────────────────────────────────
 *
 * Backspace on an empty textblock behaves like backspace on an empty LINE:
 * the line goes, and the caret lands at the end of the previous one. What
 * happens next is then the ordinary mint rule — if the line above is itself
 * empty, a textblock appears there, which is *"put it on the next line so it
 * creates a textblock there"*. This function does not decide that; it only
 * refuses to leave a line behind for it to be confused by.
 *
 * ── THE GUARD ──────────────────────────────────────────────────────────────
 *
 * The trailing line is absorbed only when the PREVIOUS sibling can hold a caret.
 * Otherwise the doc would end in an atom again — the exact state the tail
 * paragraph exists to prevent — and `focus("end")` throws
 * `TextSelection endpoint not pointing into a node with inline content (doc)`.
 * So the two rules cannot fight: one adds the line, this removes it, and both
 * answer to `canHoldCaret`.
 *
 * @returns {{ extra: number, keepParagraph: boolean }}
 *   `extra` — doc positions to add to the delete range (0, or the trailing
 *   empty paragraph's nodeSize).
 *   `keepParagraph` — the caller must insert a replacement paragraph, because
 *   nothing above and nothing usable below could hold the caret.
 */
export function planBlockBackspace({ doc, pos, nodeSize, prevSibling } = {}) {
  const none = { extra: 0, keepParagraph: !prevSibling };
  if (!doc || typeof pos !== "number" || typeof nodeSize !== "number") return none;

  const end = pos + nodeSize;
  let after = null;
  try { after = doc.resolve?.(end)?.nodeAfter ?? null; } catch (_) { after = null; }

  // Nothing above to join into. A doc whose only block is deleted leaves
  // ProseMirror with no valid cursor position — UNLESS something below can hold
  // one, in which case inserting another paragraph would leave TWO empty lines
  // (which is what a mint on the only line + backspace produced).
  if (!prevSibling) return { extra: 0, keepParagraph: !canHoldCaret(after) };

  if (!after || after.type?.name !== "paragraph") return none;
  if ((after.content?.size ?? 0) !== 0) return none;        // the user wrote there
  if (end + after.nodeSize !== doc.content?.size) return none;  // not the last line
  if (!canHoldCaret(prevSibling)) return none;              // would end in an atom

  return { extra: after.nodeSize, keepParagraph: false };
}
