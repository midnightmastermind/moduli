// helpers/provisionalTextblock.js
// A textblock that exists ONLY on this client until the user types into it.
//
// User direction 2026-08-05: "we should just have all new lines be textblocks if
// im on it. so empty line and then i click on it, then empty textblock. if i move
// away from it with it still empty, it disappears."
//
// Clicking an empty line mints the textblock BEFORE any keystroke, so the first
// character types into a node that already exists — that is what removes the
// first-save lag (the create is no longer racing the keypress). The cost is that
// most of those blocks are abandoned empty, and deleting a row the server has
// only just been told about is exactly the create/delete asymmetry that produced
// the recurring `dangling-child-ref` class: `create_occurrence` is QUEUED
// server-side, `delete_occurrence` is not, so the delete can overtake the create
// and the parent is left listing a child that was written afterwards.
//
// So a provisional block is NEVER emitted. It lives in local state (dispatch
// only) until it earns a server row by holding content; abandoning it is a
// purely local removal that cannot race anything. This registry holds the two
// closures for that decision — `commit` (publish for real) and `discard` (drop
// it) — keyed by occurrence id, which every layer already has.
const pending = new Map();

// ms — after a deliberate collapse of a textblock back to an empty line
// (backspace in an empty block, blur-discard), the caret LANDS in that empty
// line. Without a suppression window the caret-entry mint fires immediately and
// re-creates the block the user just dismissed — backspace becomes a no-op loop.
const MINT_SUPPRESS_MS = 600;
let suppressUntil = 0;
// …but it must be suppressed AT THAT LINE ONLY. A blanket time window also ate
// the mint at a DIFFERENT line, which is exactly the reported bug (2026-08-06,
// user): "if i click on a diff empty line it should create it there as well.
// right now, it just makes the first one disappear" — clicking away abandons the
// first block (correct) and the same gesture arms the window, so the new line's
// mint was skipped (`[mint] skip why:suppressed`, measured). Scoped by position,
// backspace still cannot re-mint the block it just collapsed, and a click
// anywhere else mints immediately.
let suppressPos = null;

export function registerProvisionalTextblock(occurrenceId, handlers) {
  if (!occurrenceId || !handlers) return;
  pending.set(occurrenceId, handlers);
}

export function isProvisionalTextblock(occurrenceId) {
  return !!occurrenceId && pending.has(occurrenceId);
}

// The block earned a server row. Runs the create for real, with whatever the
// user has typed so far folded in, and forgets it. Idempotent — the inner
// editor's save path can call this on every keystroke.
export function commitProvisionalTextblock(occurrenceId, textmap) {
  const handlers = pending.get(occurrenceId);
  if (!handlers) return false;
  pending.delete(occurrenceId);
  handlers.commit?.(textmap);
  return true;
}

// The block was abandoned empty. Local removal only — nothing was ever emitted.
export function discardProvisionalTextblock(occurrenceId) {
  const handlers = pending.get(occurrenceId);
  if (!handlers) return false;
  pending.delete(occurrenceId);
  handlers.discard?.();
  return true;
}

// Drop the entry WITHOUT running either side (an unmount that is not a user
// decision — the doc scrolled out of view, the panel closed).
export function forgetProvisionalTextblock(occurrenceId) {
  return pending.delete(occurrenceId);
}

/**
 * @param {number|null} pos  the doc position of the line being restored. Null
 *                           suppresses everywhere (the old blanket behaviour),
 *                           kept for callers that genuinely cannot say where.
 */
export function suppressTextblockMint(pos = null, ms = MINT_SUPPRESS_MS) {
  suppressUntil = Date.now() + ms;
  suppressPos = pos;
}

export function isTextblockMintSuppressed(pos = null, now = Date.now()) {
  if (now >= suppressUntil) return false;
  if (suppressPos == null) return true;      // blanket window
  return pos == null || pos === suppressPos; // only the line we just collapsed
}

// TEST ONLY — the registry is module state shared by every doc editor.
export function _resetProvisionalTextblocks() {
  pending.clear();
  suppressUntil = 0;
  suppressPos = null;
}

// A TipTap doc holding nothing the user would miss: no text, no non-paragraph
// nodes. This is the "still empty" test for the vanish-on-blur rule, so it has
// to treat a doc carrying an image / embed / list as NOT empty even when it has
// no characters.
export function isEmptyTextblockDoc(json) {
  const content = json?.content;
  if (!Array.isArray(content) || content.length === 0) return true;
  return content.every(
    (node) => node?.type === "paragraph" && !(node.content?.length)
  );
}

// Does this doc EMBED a textblock that has no server row yet? The parent doc's
// own textmap must not be persisted while it does: a tab closed in that window
// would leave the parent embedding an occurrence that will never exist, which
// renders as a bare "—" forever (the 2026-08-01 (19) listed-but-not-embedded
// failure, from the other direction).
export function hasProvisionalTextblock(json) {
  if (pending.size === 0) return false;
  let found = false;
  const walk = (node) => {
    if (found || !node || typeof node !== "object") return;
    if (node.type === "instanceTextblock" && pending.has(node.attrs?.occurrenceId)) {
      found = true;
      return;
    }
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(json);
  return found;
}
