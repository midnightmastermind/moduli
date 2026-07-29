// Remove the superseded "Mark Passed Timeslots" operation.
//
// It and "Schedule: Mark Passed Slots" both wrote `$slot.ownStyle.bg` on the
// same slot containers — one every 30 minutes, the other every 5 — so whichever
// fired last won and the newer op's green current-slot tint got stomped twice an
// hour. The newer op does everything the old one did and more.
//
// Removed from the seed on 2026-07-29, but `poms grid` is frozen live data that
// the seed can no longer touch: this is how a structural fix reaches it.
export const id = "0002-drop-duplicate-slot-painter";
export const describe =
  'Deletes the operation "Mark Passed Timeslots" (superseded by "Schedule: Mark Passed Slots", ' +
  "which paints the same target on a tighter cadence). Deletes NO user content.";

const DOOMED = "Mark Passed Timeslots";
const KEEPER = "Schedule: Mark Passed Slots";

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;

  // Refuse to remove the duplicate unless the replacement is actually present —
  // otherwise a partially-migrated grid ends up with NO slot painter at all.
  const keeper = await Operation.findOne({ gridId, name: KEEPER }).lean();
  if (!keeper) {
    throw new Error(`"${KEEPER}" is not on this grid — refusing to drop "${DOOMED}" and leave no painter.`);
  }

  const doomed = await Operation.find({ gridId, name: DOOMED }).lean();
  if (!doomed.length) { log(`"${DOOMED}" is already gone — nothing to do`); return; }

  log(`found ${doomed.length} × "${DOOMED}" (keeper "${KEEPER}" present)`);
  if (dryRun) { log("dry run — would delete"); return; }

  const { deletedCount } = await Operation.deleteMany({ gridId, name: DOOMED });
  log(`deleted ${deletedCount} operation(s)`);
}
