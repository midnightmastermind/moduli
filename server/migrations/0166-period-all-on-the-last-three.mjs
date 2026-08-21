/**
 * 0166 — three trackers still fell back to TODAY when you cleared the date.
 *
 * `periodAllPolicy` (2026-07-10) established the rule the user restated today: an EMPTY period means
 * aggregate EVERYTHING, so clearing the date filter shows an all-time total rather than silently
 * showing today. It does that two ways — it wraps every `DATE_IN_PERIOD $goalPeriod` rule in
 * `(that) OR ($goalPeriod IS_EMPTY)`, and it REMOVES the fallback steps that would otherwise fill the
 * empty period in before the wrapper can matter.
 *
 * MEASURED ON THE LIVE GRID, and the split is the finding:
 * ```
 *   trackers                                     37
 *   carry the period-all OR wrapper              37   <- the wrapper is everywhere
 *   still carry "$goalPeriod = $today"            3
 *   still carry "$goalPeriod = $trigger.date"     3   <- the same three
 * ```
 * `Completed Tasks`, `Completed Habits` and `Sleep Time`. Having BOTH halves is not harmless: the
 * fallback runs first, so `$goalPeriod` is never empty by the time the wrapper is evaluated and the
 * wrapper is dead code on those three. Clearing the date showed today while 34 other tiles showed an
 * all-time total — the same page disagreeing with itself, with nothing erroring.
 *
 * WHY THOSE THREE AND NOT THE OTHER 34: they are the trackers a later pass rebuilt from
 * `makeTrackerOp` after the policy had already run. The policy is applied by the SEED to whatever
 * exists at that moment; an op re-emitted afterwards comes back with its fallbacks intact. Same class
 * as `0130` — "every X" in a pass means every X that exists WHEN IT RUNS.
 *
 * IT RE-RUNS THE EXISTING POLICY RATHER THAN REIMPLEMENTING IT. `applyPeriodAllPolicy` is idempotent
 * by construction (it skips an OR group that already carries the IS_EMPTY sibling), so running it
 * over all 37 is safe and the 34 already-correct ones are untouched. Writing a second "remove the
 * fallback" here is how the two would drift.
 */
import { applyPeriodAllPolicy } from "../utils/periodAllPolicy.js";

export const id = "0166-period-all-on-the-last-three";
export const describe =
  "Removes the $goalPeriod fallback from the three trackers that still had it, so clearing the date aggregates all-time everywhere.";

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const ops = await Operation.find({ gridId }).lean();
  const trackers = ops.filter((o) => /\$goalPeriod/.test(JSON.stringify(o.pipeline || {})));

  // Reported BEFORE the transform, so the log names what was wrong rather than
  // only how many things changed.
  const before = trackers.filter((o) => {
    const j = JSON.stringify(o.pipeline || {});
    return /"name":"\$goalPeriod","expr":"\$today"/.test(j)
        || /"name":"\$goalPeriod","expr":"\$trigger\.date"/.test(j);
  });
  log(`  trackers: ${trackers.length} · still falling back instead of staying empty: ${before.length}`);
  for (const o of before) log(`     ${o.name}`);

  const changed = applyPeriodAllPolicy(trackers);
  log(`  would patch ${changed.length} op(s)`);
  if (!changed.length) { log("  already converged"); return; }
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  for (const op of changed) await Operation.updateOne({ _id: op._id }, { $set: { pipeline: op.pipeline } });
  log(`  patched ${changed.length} — RESTART pm2 and reload.`);
}
