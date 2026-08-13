// server/migrations/0094-mood-click-refreshes-the-tracker.mjs
//
// User, 2026-08-13: "the mood tracker doesnt get updated until i reload."
//
// THE SUPPRESSION IS DELIBERATE AND MUST STAY, which is what makes this the
// right fix rather than the obvious one. `CREATE_ITEM` in bindSocketToStore
// marks every op-created occurrence (`_markOpEmitted` + optimisticFiredSet) so
// neither the local create nor the server echo re-fires OccurrenceCreateOp —
// without it "the echo of every op-minted row re-triggers the rebuild op → it
// creates more → an unbounded async create loop (the create_occurrence server
// flood that froze the app)". So a Check In minted by the wheel fires NO
// trigger: no OccurrenceCreateOp, no per-field MeasureOp, and the Moods tracker
// never re-runs. Only the onLoad sweep updates it — exactly "not until I
// reload".
//
// AND ITS OTHER TRIGGERS CANNOT SAVE IT. The onAdd/onDelete triggerObjects are
// ancestor-scoped to "Schedule", and 0089 established that a Check In's
// single-parent ancestor walk resolves through the Day Page column and never
// reaches the Schedule page. The onChange trigger keys on the Mood FIELD, which
// nothing writes now that the journal is unbound.
//
// So the op invokes the tracker itself. That is this repo's established answer
// to precisely this shape — `Schedule: Build Day` ends with RUN_OPERATION steps
// for both trackers because "trackers' onFilterChange is ancestor-scoped to
// 'Daily Goals' — they don't naturally re-trigger" (2026-05-15). The executor's
// in-batch overlay means the tracker sees the Check In this pipeline just
// created, before any echo.
//
// SAFE AGAINST RECURSION BY CONSTRUCTION: RUN_OPERATION carries a depth cap of
// 4, and the Moods tracker only writes display fields on the goal tile — it
// invokes nothing, so there is no cycle to bound.
export const id = "0094-mood-click-refreshes-the-tracker";
export const describe =
  "Recording a mood re-runs the Moods tracker, instead of leaving it stale until the next reload.";

/** PURE — append the tracker invocation. Exported so a test drives what ships. */
export function appendTrackerRun(pipeline, { operationName = "Moods" } = {}) {
  const steps = pipeline?.steps || [];
  const already = JSON.stringify(steps).includes(`"${operationName}"`);
  if (already) return { pipeline: { ...pipeline, steps }, added: false };
  // Matches the shape THIS op uses (actionType/config). The grid carries both
  // spellings and the executor reads either, but mixing them inside one
  // pipeline is how a step silently stops being recognised.
  const step = {
    id: `runmoods-${Math.random().toString(36).slice(2, 10)}`,
    type: "action", actionType: "RUN_OPERATION",
    config: { operationName },
  };
  return { pipeline: { ...pipeline, steps: [...steps, step] }, added: true };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const op = await Operation.findOne({ gridId, name: "Mood: Record Selection" }).lean();
  const tracker = await Operation.findOne({ gridId, name: "Moods" }).lean();
  if (!op || !tracker) {
    log(`REFUSING: op=${!!op} tracker=${!!tracker} — nothing written.`);
    return;
  }
  const { pipeline, added } = appendTrackerRun(op.pipeline, { operationName: tracker.name });
  log(`"${op.name}" -> RUN_OPERATION "${tracker.name}" at the end: ${added ? "adding" : "already there"}`);
  if (dryRun) {
    log(`WOULD append the tracker invocation so a click updates the tile immediately.`);
    return;
  }
  if (added) await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
  log(`recording a mood now refreshes the tracker in the same pass.`);
}
