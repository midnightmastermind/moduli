// helpers/pendingTextblockFocus.js
// One-shot pub/sub so a JUST-AUTO-CREATED textblock takes the caret the moment
// its editor exists — instead of the creator polling the DOM for it.
//
// Typing in an empty doc container converts the paragraph into a textblock
// occurrence, and the caret has to move from the outer editor into the new
// sub-editor. That sub-editor is mounted by React + TipTap some frames later,
// so the create site used to rAF-poll for `[data-occurrence-id] .ProseMirror`
// up to 60 times. Measured on prod: focus landed ~580-1000ms after the
// keystroke, and when the poll missed entirely, every following keystroke
// spawned ANOTHER textblock (the live Journal had three).
//
// Inverting it removes the race: the creator registers the id, and the sub-
// editor claims the caret in its own onCreate — the earliest moment focus is
// physically possible, and it cannot be missed. Keyed by occurrence id, which
// the create site knows synchronously.
//
// Same shape as pendingLabelEdit.js (which does this for inline label editing).
const pending = new Set();

export function requestTextblockFocus(occurrenceId) {
  if (occurrenceId) pending.add(occurrenceId);
}

// Is a claim outstanding? PEEKS — it must not consume, or asking the question
// would answer it. Used only to report "this block asked for the caret and never
// got it", which is the shape of *"it creates a textblock (not focused)"*.
export function hasTextblockFocus(occurrenceId) {
  return !!occurrenceId && pending.has(occurrenceId);
}

/**
 * Does this block still want the caret?
 *
 * IT DOES NOT CLEAR THE CLAIM — `releaseTextblockFocus` does, from the editor's
 * own `onFocus`, i.e. when the caret has DEMONSTRABLY landed. Clearing here
 * instead meant a single failed attempt spent the claim forever, and the node
 * view is recreated ~200ms after a mint (user's `[mint]` table, 2026-09-18):
 *
 *     focus:claimed  27ef6c59  content-sync   <- claim spent, focus() called
 *     editor:destroy 27ef6c59                 <- the view is recreated
 *     editor:create  27ef6c59
 *     focus:none     27ef6c59  onCreate       <- nothing left to claim
 *
 * which is *"empty textblocks losing focus and having it on the next line after
 * (the typing cursor) with no textblock created there"* — the mint replaces the
 * line with an ATOM, so the caret sits AFTER it until the block pulls it in, and
 * a spent claim never pulls.
 *
 * The original contract ("once, so a re-mount cannot steal the caret again") is
 * PRESERVED, just keyed on the right event: once the caret has landed the claim
 * is released, so a block scrolled back into view later claims nothing.
 */
export function claimTextblockFocus(occurrenceId) {
  return !!occurrenceId && pending.has(occurrenceId);
}

// The caret LANDED. Only now is the claim spent.
export function releaseTextblockFocus(occurrenceId) {
  if (occurrenceId) pending.delete(occurrenceId);
}

// A create that never mounts (undo, a failed save) would otherwise leave its id
// pending forever and steal the caret if that id ever mounted later.
export function cancelTextblockFocus(occurrenceId) {
  if (occurrenceId) pending.delete(occurrenceId);
}
