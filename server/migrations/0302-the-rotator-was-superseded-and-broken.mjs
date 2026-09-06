// `Daily Question Rotator` fires on every load and every filter change, writes
// `null`, and nothing has needed it since 2026-08-05.
//
// Found while auditing the trackers (user, 2026-09-05: *"alot of them arent
// updating"*). Driven through the real executor it emits exactly one effect:
//
//     Daily Question = null
//
// ── THREE INDEPENDENT REASONS, AND ANY ONE OF THEM IS ENOUGH ───────────────
//
// 1. **ITS FIND BINDS AN ARRAY.** The predicate is `fields.<Library>.value IS
//    "question"` over `$allInstances`, and the library holds **117** of them.
//    FIND auto-detects: one match binds the record, several bind an ARRAY. So
//    `$firstQuestion.label` is `undefined`, the `fallback` to `.moduleLabel`
//    is undefined too, and `$questionText` resolves to nothing. The op is
//    named for picking one and never picks.
//
// 2. **IT TARGETS THE CATALOG ACTION, NOT A DAY.** `$journalingInst` is
//    picker-direct at `RWo6EN_ubw0R`, which is `Journal < Reflection <
//    Emotional` - the Routines catalog entry every day column is cloned FROM.
//    A question stamped there is not on anybody's day. It carries no Daily
//    Question value and its `updatedAt` is 2026-08-22, so the null write has
//    been silently swallowed by the no-op guard rather than damaging anything.
//
// 3. **`Day Page: Build` ALREADY DOES THE JOB, CORRECTLY.** It writes
//    `$dq.fields.<Daily Question>.value` per day column, at build time and only
//    when the field is empty (2026-08-05) - which is what keeps the answer
//    written underneath attached to the question it was answering. 29 day
//    columns hold real questions today. Those are its.
//
// ── AND THE 🎲 BUTTON DOES NOT RUN THIS OP ─────────────────────────────────
//
// Checked before disabling, because a re-roll control that quietly stopped
// working would be worse than a dead op. `FieldRenderer.handleRandomizeDisplay`
// picks from the field's own resolved options and writes through
// `CommitHelpers.updateOccurrence` - entirely client-side. No operation
// references this one by id or by name either.
//
// ── DISABLED, NOT DELETED ──────────────────────────────────────────────────
//
// Nothing here is certain enough about intent to throw the pipeline away: if
// the rotation is wanted back it should pick ONE question deterministically per
// day and target the day's Journal, and that pipeline is the starting point.
// Disabling is reversible, shows in the Operations tab, and takes it out of the
// sweep - which is the only cost it was imposing.
import Field from "../models/Field.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0302-the-rotator-was-superseded-and-broken";
export const description = "Disable Daily Question Rotator: its FIND binds an array, it targets the catalog action, and Day Page: Build supersedes it.";
export const touches = ["fields", "occurrences", "operations"];

const NAME = "Daily Question Rotator";

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const op = await Operation.findOne({ gridId: gid, name: NAME }).lean();
  if (!op) { log(`  ${NAME}: no such operation - nothing to do`); return; }
  if (op.enabled === false) { log(`  ${NAME}: already disabled - left alone`); return; }

  // Re-verify each reason against the data rather than trusting the header.
  const fields = await Field.find({ gridId: gid }).lean();
  const one = (n) => {
    const hits = fields.filter((f) => f.name === n);
    if (hits.length !== 1) throw new Error(`field "${n}": ${hits.length} matches - refusing`);
    return hits[0];
  };
  const library = one("Library");
  const dq = one("Daily Question");

  const occs = await Occurrence.find({ gridId: gid }).lean();
  const pool = occs.filter((o) => o.fields?.[library.id]?.value === "question");
  if (pool.length < 2) throw new Error(`the question pool has ${pool.length} entries - the FIND would NOT bind an array, so reason 1 is wrong; refusing`);

  const supersedes = await Operation.findOne({ gridId: gid, name: "Day Page: Build" }).lean();
  if (!supersedes || !JSON.stringify(supersedes.pipeline).includes(dq.id))
    throw new Error("Day Page: Build does not write Daily Question - nothing supersedes this; refusing");

  const filled = occs.filter((o) => o.fields?.[dq.id]?.value).length;
  if (!filled) throw new Error("no occurrence holds a Daily Question value - the superseding op has never produced one; refusing");

  log(`  ${NAME}: pool of ${pool.length} (FIND binds an array), superseded by "Day Page: Build" which has filled ${filled} - disabling`);
  if (apply) await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { enabled: false } });
  if (!apply) log("  DRY RUN - pass --apply to write.");
}
