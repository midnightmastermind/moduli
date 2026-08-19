/**
 * 0150 — park `Fitness: Today's Prescription` until it actually writes.
 *
 * `0149` created six `Workout N` display fields, bound them to the Workout Goals
 * tile, and created an op to fill them. **The op runs clean and writes nothing.**
 * It is disabled here and the six fields are unbound, because the alternative is
 * six permanently blank pills on the Trackers page — which is precisely the
 * defect `0147` removed from that same page an hour earlier. *Shipping the empty
 * promise I had just finished deleting would be the worst outcome available.*
 *
 * WHAT IS PROVEN, so the next attempt does not re-derive it:
 *   - the DATA is right: 6 exercise rows under today's column, each with a
 *     resolving Movement array, today's date, no `feedSourceId`; the slot's
 *     `parentId` IS the column and the column lists the slot
 *   - `$colId` BINDS correctly (read out of the op's own run log) and `$col` is a
 *     single object, not a multi-match array
 *   - the op reports NO error; the clear step runs, so the pipeline is executing
 *   - a FIND predicate's `left` is a bare record path (`fields.x.value`), not
 *     `$item.fields.x.value` — that was one real bug, fixed, and not the cause
 *
 * FOUR THINGS WERE TRIED AND NONE MADE IT WRITE:
 *   1. the FIND predicate path form (a genuine bug, fixed)
 *   2. scoping by `_ancestors HAS_ANCESTOR <the day column>`
 *   3. scoping by the SCHEDULE PAGE + the row's own date — the pattern
 *      `Total Workouts` uses and which demonstrably works on this grid
 *   4. looping `$allItems` rather than `$allInstances`
 *
 * SO THE FAULT IS NOT IN THE SCOPE RULES, and the next session should stop
 * varying them. The remaining suspects, in order: the six `UPDATE
 * $goalItem.fields.<id>.value` writes inside a nested IF inside a LOOP (every
 * working tracker writes ONCE, after its loop, not per-iteration); the
 * `$nTxt IS "1"` index comparison; and `JOIN_ARRAY` + `$allItemsById.${$mvId}`
 * inside a loop body. **The cheap next move is to add one `SHOW_VALUE` of `$n`
 * straight after the loop** — if it reads 6 the loop matched and the writes are
 * the problem; if it reads 0 the predicate never passed and the scope rules are
 * back in play. That single measurement splits the remaining space in half, and
 * is what I should have done before varying anything.
 */
export const id = "0150-park-the-prescription-op";
export const describe = "Disable the prescription op and unbind its six fields — it writes nothing, and blank pills are worse than none.";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [mods, fields, ops] = await Promise.all([
    Module.find({ gridId }).lean(), Field.find({ gridId }).lean(), Operation.find({ gridId }).lean(),
  ]);
  const op = ops.find(o => o.name === "Fitness: Today's Prescription");
  const wf = fields.filter(f => /^Workout [1-6]$/.test(f.name));
  const ids = new Set(wf.map(f => f.id));
  const tiles = mods.filter(m => (m.fieldBindings || []).some(b => ids.has(b.fieldId)));

  log(`  op: ${op ? (op.enabled === false ? "already disabled" : "to disable") : "not present"}`);
  log(`  fields: ${wf.length} · bound to ${tiles.length} module(s)`);
  if (!op && !tiles.length) { log("  nothing to do"); return; }
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  if (op && op.enabled !== false) await Operation.updateOne({ id: op.id, gridId }, { $set: { enabled: false } });
  for (const t of tiles) {
    await Module.updateOne({ id: t.id, gridId }, { $pull: { fieldBindings: { fieldId: { $in: [...ids] } } } });
    log(`  unbound ${wf.length} field(s) from "${t.label}"`);
  }
  // The FIELDS stay. They cost nothing, and re-creating them is the only part of
  // 0149 that worked; the next attempt should re-bind rather than re-mint.
  log("  done — fields kept, op disabled. Re-enable and re-bind once it writes.");
}
