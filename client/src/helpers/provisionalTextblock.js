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
// A POSITIONAL hold is not on a clock — see suppressTextblockMint. This is only a
// FAIL-SAFE, and it fails OPEN: when it expires minting resumes, i.e. the worst
// case is the behaviour that shipped before. It exists because positions are bare
// numbers shared by every doc editor, so a hold must not be able to wedge minting
// in a document the user never went back to.
const MINT_SUPPRESS_CAP_MS = 10000;
let suppressUntil = 0;
let positionsUntil = 0;
// Each hold is a (scope, position) pair. The SCOPE is the editor the line lives
// in (user, 2026-09-30: clicking the day page's Notes, then Highlights, left
// Highlights refusing with `mint:skip suppressed` — Notes' collapsed block held
// position 0, and Highlights' empty line is ALSO position 0 of its own editor).
// A hold with no scope still matches every editor, as it always did.
const suppressedPositions = new Set();   // entries: `${scopeId}|${pos}` or `*|${pos}`
const scopeIds = new WeakMap();
let nextScopeId = 1;
const scopeKey = (scope) => {
  if (scope == null || typeof scope !== "object") return "*";
  if (!scopeIds.has(scope)) scopeIds.set(scope, String(nextScopeId++));
  return scopeIds.get(scope);
};
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

/**
 * The occurrence OBJECT for a block that has been minted but whose store write
 * has not landed yet.
 *
 * The mint deliberately inserts the node BEFORE writing to the store — the
 * insert costs 10ms and the write provokes an app-wide re-render that costs a
 * second (measured 2026-08-07). Without this the node view would have nothing
 * to render for that whole second and the block would sit there un-editable.
 * With it, the block renders from the same object the write will carry, so it
 * is typeable in the frame it appears and the store write becomes invisible.
 */
export function getProvisionalOccurrence(occurrenceId) {
  return pending.get(occurrenceId)?.occurrence || null;
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
 * @param {number|null} ms
 * @param {object|null} scope  the editor that line lives in. A hold in one
 *                           editor must not block the same position in another.
 */
export function suppressTextblockMint(pos = null, ms = null, scope = null) {
  if (pos == null) {                       // blanket window, still a clock
    suppressUntil = Date.now() + (ms ?? MINT_SUPPRESS_MS);
    suppressPos = null;
    return;
  }
  // A SET, because callers legitimately hold BOTH ends of a collapse — the
  // vacated line and the one the caret joins into. A single slot made the second
  // call silently overwrite the first, so the comment at that call site
  // ("SUPPRESS AT BOTH ENDS") described something the store could not do.
  suppressedPositions.add(`${scopeKey(scope)}|${pos}`);
  positionsUntil = Date.now() + (ms ?? MINT_SUPPRESS_CAP_MS);
}

/**
 * A positional hold is released when the caret is demonstrably SOMEWHERE ELSE,
 * not when a timer expires.
 *
 * User, 2026-09-18: *"it deletes the textblock, but stays on the same line so it
 * creates a new textblock right away. **unless im quick with it**, that gets me
 * stuck in a loop."* That last clause is the diagnosis: a 600ms window only
 * DEFERS the re-mint, so whether backspace works depended on how fast you were.
 * The line a removal vacated stays un-mintable until you actually leave it.
 */
export function releaseTextblockMintSuppression() {
  suppressedPositions.clear();
  positionsUntil = 0;
}

export function isTextblockMintSuppressed(pos = null, now = Date.now(), scope = null) {
  if (now < suppressUntil) return true;                 // blanket window
  if (suppressedPositions.size === 0) return false;
  if (now >= positionsUntil) {                          // fail-safe, fails OPEN
    suppressedPositions.clear();
    return false;
  }
  if (pos == null) return true;                         // caller cannot say where
  // An unscoped hold covers every editor; a scoped one only its own.
  return suppressedPositions.has(`*|${pos}`) || (scope != null && suppressedPositions.has(`${scopeKey(scope)}|${pos}`))
    || (scope == null && [...suppressedPositions].some((k) => k.endsWith(`|${pos}`)));
}

// TEST ONLY — the registry is module state shared by every doc editor.
export function _resetProvisionalTextblocks() {
  pending.clear();
  suppressUntil = 0;
  suppressPos = null;
  positionsUntil = 0;
  suppressedPositions.clear();
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
/**
 * The doc as it may be SAVED while a provisional block sits in it: every node
 * for a block with no server row yet becomes the empty line it was minted from.
 *
 * The hosting doc used to hold its WHOLE save while one existed (so it never
 * persisted an embed of an occurrence nobody created) — and that held every
 * other edit too. Found 2026-10-01: a wrap edit ("Continue wrap into next
 * block", a side swap) made beside one never reached the server, and closing
 * the tab lost it. This keeps the rule — the provisional block is never in a
 * saved doc — without holding anything else. The block's own first keystroke
 * still writes the parent with it in (commitProvisionalTextblock).
 */
export function withoutProvisionalTextblocks(json) {
  if (pending.size === 0 || !json || typeof json !== "object") return json;
  const walk = (node) => {
    if (!node || typeof node !== "object") return node;
    if (node.type === "instanceTextblock" && pending.has(node.attrs?.occurrenceId)) return { type: "paragraph" };
    return Array.isArray(node.content) ? { ...node, content: node.content.map(walk) } : node;
  };
  return walk(json);
}

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
