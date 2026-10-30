// helpers/typedChip.js
// TYPING MAKES A DOC CHIP (user, 2026-10-30): the first character typed into an empty table cell or an empty bullet
// becomes a mini textblock chip holding it — the doc's own `instanceTextblockInline` node — and the caret moves into
// the chip, so the rest of the word lands there. The chip is draggable like any doc chip.
import * as CommitHelpers from "./CommitHelpers";
import { requestTextblockFocus } from "./pendingTextblockFocus";
import { withAction } from "./actionScope";

/** Where a typed character should start a chip in a doc: an empty paragraph directly inside a list item. PURE. */
export function isEmptyListItemLine(selection) {
  if (!selection?.empty) return false;
  const $f = selection.$from;
  if (!$f || $f.parent?.type?.name !== "paragraph" || $f.parent.content.size !== 0) return false;
  return $f.depth >= 2 && $f.node($f.depth - 1)?.type?.name === "listItem";
}

/** Mint a chip holding `text`, owned by `owner`, and insert it at `pos` in `view`. One undo step. */
export function mintTypedChip({ view, pos, text, owner, dispatch, socket }) {
  const node = view?.state?.schema?.nodes?.instanceTextblockInline;
  if (!node || !owner?.id || !dispatch || !socket) return false;
  withAction("Made a chip", () => {
    const attrs = CommitHelpers.createInlineTextblock({
      dispatch, socket, userId: owner.userId, gridId: owner.gridId, parentId: owner.id, text,
    });
    requestTextblockFocus(attrs.occurrenceId);
    view.dispatch(view.state.tr.insert(pos, node.create(attrs)));
  });
  return true;
}
