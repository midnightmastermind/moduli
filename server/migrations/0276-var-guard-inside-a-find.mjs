/**
 * 0276 — a `$var` guard INSIDE a FIND predicate emptied the FIND, silently.
 *
 * `0274` regenerated the two project pipelines from the seed's builders and was
 * correct about everything it set out to fix. Then the ops were DRIVEN through
 * the real executor for the first time in their lives — they had never fired,
 * because nothing bound `Status` until `0275` — and two of the three things
 * `Project: Sync To Todo List` claims to do did not happen:
 *
 *     Docket task    → mirror minted into `Occupational`, the FALLBACK,
 *                      even though its project's own container existed
 *     Status advances → the mirror was NOT deleted
 *
 * ── THE CAUSE, ISOLATED WITH A THREE-ARM PROBE ──────────────────────────────
 * A FIND rule's `left` is a RECORD PATH; it is not evaluated against `$vars`.
 * Driving the real executor over live data with only the rule set changing:
 *
 *     A  [_ancestors HAS_ANCESTOR <tasks>, fields.<proj>.value IS $projKey]     MATCHED
 *     B  A + [$projKey IS_NOT_EMPTY]                                            NO MATCH
 *     C  [fields.<proj>.value IS "<literal>", _ancestors HAS_ANCESTOR <tasks>]  MATCHED
 *
 * B is A plus one guard rule. `$projKey` on the LEFT looks for a record key
 * literally named `$projKey`, finds none on any record, and `IS_NOT_EMPTY` is
 * false for every candidate — so the whole FIND matches nothing. A `$var` on the
 * RIGHT resolves fine, which is what makes this so easy to write: the same
 * `$projKey` two rules apart behaves completely differently.
 *
 * ── THE GUARDS ARE REAL AND ARE KEPT, JUST MOVED ────────────────────────────
 * They are not decoration. Without `$lgId IS_NOT_EMPTY`, `linkedGroupId IS
 * $lgId` with a null `$lgId` matches EVERY unlinked occurrence on the grid. So
 * each moves into an `if` wrapper, where `left` IS evaluated against `$vars`,
 * and the bound var is seeded empty first so the `IS_EMPTY` branches downstream
 * still read correctly on the path where the FIND is skipped.
 *
 * ── ONE OF THE TWO IS PRE-EXISTING, AND THAT IS THE POINT ───────────────────
 * The `$lgId` guard was in the seed's own inline pipeline from the day it was
 * written. It has been emptying that FIND ever since — which is why the mirror
 * was never found and never deleted. **Nobody knew because the op could not
 * fire**: no module bound `Status`, so the trigger was unreachable. A pipeline
 * that has never run is not a pipeline that works; it is one nobody has checked.
 * *This is what driving the real executor buys that reading cannot.*
 *
 * ── WHY A SECOND MIGRATION RATHER THAN AN EDIT TO 0274 ──────────────────────
 * `0274` has executed, and a ledger entry has to describe what ran (2026-08-07
 * (4)). This delegates to its `up` — the regeneration is idempotent and compares
 * SHAPE, so it rewrites only the pipeline the builder actually changed and
 * reports "already converged" otherwise.
 */

export const id = "0276-var-guard-inside-a-find";
export const describe = "Re-regenerate the project pipelines: the $var guards inside two FIND predicates were emptying the FINDs, so the Todo mirror always fell back and was never deleted. Rewrites operation pipelines; deletes nothing.";
export const touches = ["operations"];

export async function up(args) {
  const { up: regenerate } = await import("./0274-project-ops-that-could-never-fire.mjs");
  return regenerate(args);
}
