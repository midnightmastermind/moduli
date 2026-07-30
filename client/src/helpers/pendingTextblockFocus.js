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

// True exactly once per requested id, then clears it.
export function consumeTextblockFocus(occurrenceId) {
  if (occurrenceId && pending.has(occurrenceId)) {
    pending.delete(occurrenceId);
    return true;
  }
  return false;
}

// A create that never mounts (undo, a failed save) would otherwise leave its id
// pending forever and steal the caret if that id ever mounted later.
export function cancelTextblockFocus(occurrenceId) {
  if (occurrenceId) pending.delete(occurrenceId);
}
