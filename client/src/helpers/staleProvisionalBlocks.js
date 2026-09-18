// helpers/staleProvisionalBlocks.js
//
// ONE PROVISIONAL BLOCK AT A TIME.
//
// User, 2026-09-18: *"i click on a line, it creates a textblock (not focused), i
// click on another line and that creates a textblock. sometimes the first one
// disappears, sometimes it doesnt ... **each click should, negate the last empty
// textblock, and then focus on a new textblock. but when clicked off and empty,
// it should disappear**"*.
//
// The vanish path that was supposed to do this is `handleEmptyBlur`, and it can
// only run if the block's sub-editor FOCUSED and then BLURRED. A block that never
// took the caret never blurs, so it never vanishes — which is the same report seen
// from its other end ("not focused"). Rather than make the blur more reliable, the
// mint states the invariant directly: a provisional block is empty and unclaimed
// BY DEFINITION (typing commits it out of the registry), so at the moment a new
// one is minted every other one is garbage.
//
// This is a pure position-planner because `DocContent`'s mint cannot be mounted
// without the whole grid store, and the part that is easy to get wrong is the
// POSITIONS, not the policy.
//
// WHY POSITIONS ARE THE RISK: the caller has already put the new block into the
// transaction, so every stale block must be located in the UPDATED doc, and the
// replacements must run in DESCENDING order — replacing at position 12 shifts
// everything after it, so a plan applied top-down invalidates its own later
// entries. Descending, each edit only moves positions the caller has already
// dealt with.

/**
 * Plan the collapse of every provisional block EXCEPT the one just minted.
 *
 * @param {object}   doc        the transaction's CURRENT doc (after the new block was inserted)
 * @param {string}   keepId     occurrenceId of the block being minted — never collapsed
 * @param {function} isPending  id => boolean; the registry's `isProvisionalTextblock`
 * @returns {Array<{pos:number,size:number,id:string}>} descending by pos, safe to apply in order
 */
export function planStaleCollapses(doc, keepId, isPending) {
  const out = [];
  if (!doc || typeof doc.descendants !== "function" || typeof isPending !== "function") return out;

  doc.descendants((node, pos) => {
    if (node?.type?.name !== "instanceTextblock") return;
    const id = node.attrs?.occurrenceId;
    // No id at all is ProseMirror's own schema-repair filler (the `embed: missing`
    // class) — not ours to collapse here, and `isPending` would say no anyway.
    if (!id || id === keepId) return;
    // The ONLY test for "the user never claimed this block". A block that was
    // typed into has already been committed out of the registry by
    // `persistContent`, synchronously, on the first character.
    if (!isPending(id)) return;
    out.push({ pos, size: node.nodeSize, id });
  });

  return out.sort((a, b) => b.pos - a.pos);
}

/**
 * Where is this block RIGHT NOW?
 *
 * The node view captures `getPos` in a closure, and it goes stale the moment the
 * view is recreated — which the mint diagnostics show happening ~200ms after a
 * block mounts (user's logs, 2026-09-18). The vanish path runs on a
 * `setTimeout(..., 0)` after blur, so it can easily read a `getPos` belonging to
 * a destroyed view and get `undefined` back:
 *
 *     253  vanish:fire
 *     253  emptyBlur:skip   why=no-pos      <- and the block never disappears
 *
 * Asking the CURRENT doc where the node is cannot go stale. Identity is the
 * occurrenceId, which is what every other layer already keys on.
 *
 * @returns {{pos:number,size:number}|null}
 */
export function findBlockPos(doc, occurrenceId) {
  if (!doc || typeof doc.descendants !== "function" || !occurrenceId) return null;
  let found = null;
  doc.descendants((node, pos) => {
    if (found) return false;               // stop walking once located
    if (node?.type?.name !== "instanceTextblock") return;
    if (node.attrs?.occurrenceId !== occurrenceId) return;
    found = { pos, size: node.nodeSize };
    return false;
  });
  return found;
}
