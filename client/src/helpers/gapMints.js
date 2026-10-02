// helpers/gapMints.js
//
// Textblocks made by clicking the gap under a wrap's short text side
// (docs/WrapGroupNode, wrapRoles.textSideGap). Unlike the doc mint, that block
// is a real row the moment it appears — it has to be, it becomes the host the
// wrap flows around — so it never had the doc mint's "empty and clicked away
// from → gone". Marked here, it gets that: its editor removes it on an empty
// blur, the same way its own Delete does. The mark is dropped the first time
// the block holds text, so a block the user wrote in and later emptied stays.
const marked = new Set();

export function markGapMint(occurrenceId) { if (occurrenceId) marked.add(occurrenceId); }
export function isGapMint(occurrenceId) { return !!occurrenceId && marked.has(occurrenceId); }
export function forgetGapMint(occurrenceId) { marked.delete(occurrenceId); }
