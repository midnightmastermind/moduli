// DON'T SEND WHAT IS NOT THERE.
//
// ── MEASURED ON THE LIVE GRID'S OWN PAYLOAD ────────────────────────────────
//
// A quarter of the artifact catalogue is keys that are null on EVERY row:
//
//     identitySignature  fieldVisibility  linkedGroupId  filterNavConfig
//     filterOverride     dragMode         ownStyle       placement
//     viewId             filters          feed
//
//     artifact rows            15.33 MB
//     ...spent on all-null keys 3.48 MB   (23%)
//
// Across the whole payload, dropping null and undefined is:
//
//     occurrences   19.32 MB -> 16.47 MB   (-15%)
//     modules        7.10 MB ->  6.35 MB   (-11%)
//
// ~3.6 MB the device receives, inflates and JSON.parses on its main thread for
// nothing. The device's load line puts `ops:start` at 9,667ms, most of it
// waiting on this payload.
//
// ── IT NAMES NO ROLE, NO KIND AND NO FIELD ─────────────────────────────────
//
// The rule is "the value is absent", which is a fact about the VALUE. Nothing
// here knows what an artifact is, what a board is, or which keys a media row
// happens to carry — a list of key names would be one schema change away from
// silently shipping them again. `noDomainKnowledge.test.js` exists because this
// codebase has twice had domain concepts leak into generic layers.
//
// ── NULL AND UNDEFINED ONLY, NEVER `[]` OR `{}` ────────────────────────────
//
// Dropping empty arrays would save another ~2.5 MB and is NOT SAFE: absent and
// empty are the same thing only where every reader guards. They do not —
// measured, with a positive control on the grep so the zero meant something:
//
//     dragHitTesting.js:576   targetOcc.occurrences.length
//     dragHitTesting.js:579   parentOcc.occurrences.indexOf(targetOcc.id)
//
// Those throw on an absent array, and they sit in the drop path. `null` has no
// such hazard: every reader of these keys already defaults or optional-chains
// (checked the same way). The extra 2.5 MB is available to whoever guards those
// call sites first; it is not available for free.

/**
 * A shallow copy without keys whose value is null or undefined.
 * Top level only — a nested null is part of a value someone chose to store.
 */
export function omitNullKeys(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return doc;
  const out = {};
  for (const k in doc) {
    const v = doc[k];
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

/** `omitNullKeys` over a list, tolerant of a non-array (returns it unchanged). */
export function omitNullKeysAll(rows) {
  return Array.isArray(rows) ? rows.map(omitNullKeys) : rows;
}
