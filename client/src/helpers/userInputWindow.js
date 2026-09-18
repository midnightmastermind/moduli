// helpers/userInputWindow.js
//
// "WAS THERE A REAL GESTURE BEHIND THIS, AND HAS IT ALREADY BEEN SPENT?"
//
// The caret-entry mint may only fire for a caret the USER placed — every other
// path that moves a selection (a server echo's setContent, the content-sync
// effect, a drop's setTextSelection) would otherwise mint a textblock nobody
// asked for. A 1000ms window after the last pointerdown/keydown answered the
// first half. It never answered the second, and that is the bug:
//
//     t=11.1  mint:go                  <- the click's block
//     t=28.3  editor:create            <- its editor
//     t=28.9  mint:check-scheduled     <- the mint's OWN transaction
//     t=46.2  mint:go                  <- a SECOND block, same click
//
// (measured on prod 2026-09-18; user: *"ones will randomly create it on two
// lines"*, *"rapidly being created weirdly"*.) Replacing the empty line with an
// atom moves the caret to the NEXT empty line, that selection update schedules
// another check, and the click is still 17ms old — so the window says yes again.
// On a doc with a run of empty lines it walks down them.
//
// So a gesture is CONSUMED by the mint it caused. One click is one block; a
// second block needs a second gesture, which is what the user means by clicking
// an empty line. Consuming rather than widening a time window matters — a
// blanket window is what `provisionalTextblock` already records going wrong in
// the other direction ("it also ate the mint at a DIFFERENT line").

const WINDOW_MS = 1000;
let lastAt = 0;

/** A real pointerdown / keydown happened. */
export function stampUserInput(at = Date.now()) {
  lastAt = at;
}

/**
 * Was there a gesture behind this, still unspent?
 *
 * `at` is WHEN THE QUESTION WAS ASKED, not when it is answered: the check is
 * deferred and coalesced, and minting can block the thread for ~1s, so a check
 * scheduled by a real click could otherwise be answered after its own window
 * had closed.
 */
export function userInputRecently(at = Date.now()) {
  return lastAt !== 0 && at - lastAt < WINDOW_MS;
}

/**
 * This gesture has produced its block. Anything the mint's own transaction
 * schedules afterwards is not a new intent and must not mint again.
 */
export function consumeUserInput() {
  lastAt = 0;
}

/** Test-only. */
export function __resetUserInputWindow() {
  lastAt = 0;
}
