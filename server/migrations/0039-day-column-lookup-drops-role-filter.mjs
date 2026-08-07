// server/migrations/0039-day-column-lookup-drops-role-filter.mjs
//
// `Day Page: Build` minted a SECOND day column for a date that already had one.
// Measured on poms grid 2026-08-05: two columns for 2026-08-04, same label, same
// parent, same date value — minted 14 HOURS apart (08-04T11:56Z and
// 08-05T02:04Z), so it was not two clients racing. The op had successfully
// updated the first column 79 seconds before it minted the second.
//
// The predicate was never wrong. `parentId IS <board>` + `date SAME_DAY $day`
// describes the existing column exactly, and it still does. What failed is the
// COLLECTION it searched: `$allContainers` is `allItems.filter(i => i.role ===
// "container")`, and an item's role is read as `occ.role ?? module.role` — an
// occurrence carries no role of its own. So a column whose MODULE is absent from
// the client store resolves to role null and drops out of `$allContainers` while
// the occurrence itself is present and correct. Each column gets its own cloned
// module, and this grid demonstrably loses modules (the `missing-module`
// integrity class); the prod log for that window also shows a `cache COLD`
// reload and a burst of reconnects. The FIND then reports "no column for this
// date" and the mint branch runs.
//
// `$allOccurrences` is the same list without the role filter. `parentId IS
// <board>` is already an exact test — only day columns are parented to the board
// — so the role filter bought nothing and cost idempotency.
//
// Patches the two column lookups in the stored op: the existence check and the
// re-bind that follows a mint. The builder carries the same change, so a reseed
// produces this shape directly. DATA IS NOT TOUCHED — the duplicate columns that
// already exist are 0038's business, and the two it refused to merge both hold
// writing, which is a human decision.
//
// ── CORRECTION, recorded 2026-08-07: THIS MIGRATION PATCHED THREE, NOT TWO ───
// `isRebind` tests `pred.includes('"right":"$colId"')`, and the Daily Question
// lookup ALSO carries `$colId` — as an ANCESTOR SCOPE (`_ancestors HAS_ANCESTOR
// $colId`), not as an id lookup. So it matched, and poms grid's stored DQ FIND
// reads `$allOccurrences` while the same FIND on a freshly seeded grid read
// `$allContainers`. Measured 2026-08-07: poms grid 3 FINDs on $allOccurrences,
// test grid 2 only 2.
//
// The over-match was BENIGN — in fact correct, for the same reason the two
// intended ones were: that predicate is an identitySignature scoped to one
// column, so the role filter bought nothing and cost the question fill. The
// BUILDER has been brought in line (2026-08-07) rather than this selector
// tightened, so a fresh seed now emits $allOccurrences there directly and this
// migration is a no-op on that FIND. THIS FILE IS DELIBERATELY LEFT AS IT RAN:
// a migration's ledger has to describe what actually executed, and 0039 has
// been applied to poms grid.
//
// The lesson is the 0035 one from a new direction: a selector that matches "the
// thing that mentions $colId" matches every USE of $colId, not just the one the
// author had in mind. `dayColumnLookup.test.js` asserted "and nothing else"
// while its fixture omitted the only FIND that over-matches — which is how this
// stayed invisible. That case is in the fixture now.
export const id = "0039-day-column-lookup-drops-role-filter";
export const describe =
  "Day Page: Build looks for an existing day column in $allOccurrences instead of $allContainers, so a " +
  "column whose module is missing from the store is still found instead of being minted a second time.";

/**
 * Pure: rewrite the two day-column lookups off the role-filtered collection.
 * Returns the number of FIND steps changed. Exported for tests.
 *
 * Identified by what they MATCH, not by position: the existence check is the
 * FIND whose predicate names the board and compares the date SAME_DAY; the
 * re-bind is the FIND that resolves `$colId` by id. Anything else is left alone.
 */
export function patchColumnLookups(pipeline, boardOccId) {
  let changed = 0;
  const walk = (steps) => {
    for (const step of steps || []) {
      const cfg = step?.config;
      if (cfg?.type === "FIND" && cfg.over === "$allContainers") {
        const pred = JSON.stringify(cfg.predicate || {});
        const isExistence = pred.includes(boardOccId) && pred.includes("SAME_DAY");
        const isRebind = pred.includes('"right":"$colId"');
        if (isExistence || isRebind) { cfg.over = "$allOccurrences"; changed += 1; }
      }
      if (Array.isArray(step?.body)) walk(step.body);
      if (Array.isArray(step?.then)) walk(step.then);
      if (Array.isArray(step?.else)) walk(step.else);
    }
  };
  walk(pipeline?.steps);
  return changed;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;

  const op = await Operation.findOne({ gridId, name: "Day Page: Build" }).lean();
  if (!op) { log("no Day Page: Build op on this grid — nothing to do"); return; }

  const boardOccId = op.targetOccurrenceId;
  if (!boardOccId) { log("op has no targetOccurrenceId (the board) — refusing to guess"); return; }

  const pipeline = JSON.parse(JSON.stringify(op.pipeline || {}));
  const changed = patchColumnLookups(pipeline, boardOccId);
  if (!changed) { log("column lookups already off the role filter — no patch needed"); return; }

  log(`patching ${changed} column lookup(s) from $allContainers to $allOccurrences (board ${boardOccId})`);
  if (!dryRun) await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });

  log(dryRun ? "(dry run — no writes)" : "done");
}
