// helpers/boardOption.js
//
// "Dropping a film link on the Movies board should produce a MOVIE" — tagged,
// poster-fetchable, immediately pickable from every Media dropdown — instead of
// a card no dropdown can see. The intake plan calls this the shape it would
// fight for, and the reason is that the grid has 34 option boards whose whole
// purpose is to be the pool behind a dropdown; landing an untagged card on one
// produces something that LOOKS right and is invisible to the system.
//
// ── WHAT MAKES A BOARD AN "OPTION BOARD", DERIVED NOT HARDCODED ─────────────
//
// Measured on poms grid 2026-08-07 — 37 occurrences carry a feed, and every
// option board has the same shape:
//
//   feed:       { enabled: true, conditions: [{ fieldId, comparator, value }], … }
//   own fields: { <that same fieldId>: { value: ["ingredient"], flow: "in" } }
//
// So the board declares what it collects (the feed condition) AND carries that
// value itself. A new option belongs on the board exactly when it carries the
// same value — which means the BOARD OCCURRENCE is the source of truth and
// nothing here needs to know the word "boardCategory", or "movie", or which
// field is the tag. Same rule `addNewOption.buildStampFields` uses from the
// other direction (it reads the dropdown's predicate; this reads the board's
// feed), and the same no-domain-knowledge line the rest of the renderer holds.
//
// ── WHY THE BOARD'S OWN VALUE, NOT THE CONDITION'S ─────────────────────────
//
// The condition is `CONTAINS "ingredient"` (a scalar) while the board carries
// `["ingredient"]` (an array) — the field is multi-select. Stamping the board's
// OWN value is what every existing option on the grid carries, so a minted
// option is indistinguishable from a seeded one. Copying the condition's scalar
// would produce a value of a different SHAPE that the feed's CONTAINS would
// still match, which is the worst kind of wrong: it works until something reads
// the field expecting an array.
//
// Pure: no React, no store, no writes.

/**
 * The identity fields a new option on this board must carry, or null when the
 * container is not an option board.
 *
 * Null rather than `{}` on purpose: the caller uses it as the "is this an option
 * board?" test, and an empty object is truthy.
 */
export function optionBoardStampFields(containerOcc) {
  const feed = containerOcc?.feed;
  if (!feed?.enabled) return null;
  const conditions = Array.isArray(feed.conditions) ? feed.conditions : [];
  if (!conditions.length) return null;

  const stamp = {};
  for (const cond of conditions) {
    const fid = cond?.fieldId;
    if (!fid) continue;
    const own = containerOcc?.fields?.[fid];
    // The board must carry the value ITSELF. A feed that filters on something
    // the board does not hold describes a view, not an identity — minting into
    // it would produce a row the feed cannot see, which is the exact failure
    // this helper exists to prevent.
    if (own?.value === undefined || own?.value === null || own?.value === "") continue;
    if (Array.isArray(own.value) && !own.value.length) continue;
    stamp[fid] = { value: own.value, flow: own.flow || "in" };
  }
  return Object.keys(stamp).length ? stamp : null;
}

/** Is this container a board whose dropdowns would see a new option? */
export function isOptionBoard(containerOcc) {
  return !!optionBoardStampFields(containerOcc);
}
