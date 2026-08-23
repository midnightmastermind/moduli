// 0213 — `Schedule: Fill Day` scanned 1347 containers 147 times a day to fill 13 slots.
//
// USER, repeatedly: *"the schedule is still taking way too long to be applied. it
// froze for a second."* Measured on prod, the op sweep names the cost itself:
//
//     [op-timing] NavigationOp total=1873ms  ops=46
//         766ms   0fx   Schedule: Fill Day     <- 40% of the sweep, emits NOTHING
//         424ms   3fx   Schedule: Build Schedule
//
// **WHY IT COSTS 766ms TO DO NOTHING.** The pipeline nests four loops, and inside
// the innermost one it FINDs the day column's slot for a given time — over
// `$allContainers`:
//
//     LOOP  $day                      the active period
//       FIND $dayCol over $allContainers
//       LOOP  $wdTplId                every layer on the Schedule Template page
//         LOOP  $tSlotId              over $wdTpl.occurrences — ALL 49 slots
//           IF   $tSlotTime IS_NOT_EMPTY          <- true for every one of the 49
//             FIND $daySlotId over $allContainers  <- 1347 records, to find ONE
//             LOOP $tItemId over $tSlot.occurrences
//               APPLY_TEMPLATE merge
//
// On any given day three layers match — `Routine` and `Meals` claim all seven
// weekdays, plus that day's workout — so:
//
//     3 layers x 49 slots x 1347 containers  =  198,009 predicate evaluations
//     template slots that actually HOLD anything:  13   (Meals 8 · Routine 4 · workout 1)
//
// **THE GUARD AND THE LOOP READ THE SAME EXPRESSION, WHICH IS WHAT MAKES THIS
// PROVABLY INERT.** The body under the FIND is `LOOP over $tSlot.occurrences`. If
// that is empty the loop runs zero times and no APPLY_TEMPLATE happens — so the
// FIND above it could not have led to any effect. Adding `$tSlot.occurrences
// IS_NOT_EMPTY` to the guard cannot skip a slot the loop would have filled,
// because the loop is reading the very same value. `IS_NOT_EMPTY` treats an empty
// ARRAY as empty (helpers/CLAUDE.md 2026-07-12), which is the behaviour this
// depends on.
//
//     FINDs per day   147 -> 13        evaluations   198,009 -> 17,511
//
// **IT ADDS A RULE RATHER THAN RESTRUCTURING, deliberately.** The obvious bigger
// win is to hoist the day's 49 slots into a var once per day and FIND over that
// instead of 1347 containers (~27x). It is expressible — but it depends on
// `$dayCol.occurrences` being populated in the overlay at that moment, and if it
// ever is not, `Fill Day` silently stops filling the schedule. This is the user's
// daily schedule; a one-rule change that cannot alter behaviour is worth more than
// a larger win that can. The hoist is filed, not built.
//
// **SCOPED BY THE EXACT RULE SHAPE, AND IT REPORTS WHAT IT MATCHED.** A single-rule
// `AND` whose one rule is `$tSlotTime IS_NOT_EMPTY`. Not `startsWith`, not a loose
// `includes` — the `0035` class is a selector that matches more than it names, and
// `Schedule: Place Weekday Tasks` is a real neighbouring op.
export const id = "0213-fill-day-stops-scanning-for-slots-it-has-nothing-to-put-in";
export const description =
  "Guard Fill Day's per-slot FIND on the template slot actually holding items — 147 scans of 1347 containers per day become 13";

const SLOT_TIME_VAR = "$tSlotTime";
const SLOT_CHILDREN = "$tSlot.occurrences";

/**
 * Pure planner, exported for tests. Walks a pipeline and adds the
 * `$tSlot.occurrences IS_NOT_EMPTY` rule to every IF whose condition is exactly
 * the single `$tSlotTime IS_NOT_EMPTY` rule. Returns { pipeline, added }.
 * Never mutates its input.
 */
export function planFillDayGuard(pipeline) {
  let added = 0;

  const isTarget = (cond) => {
    if (!cond || !Array.isArray(cond.rules) || cond.rules.length !== 1) return false;
    const r = cond.rules[0];
    return !!r && r.left === SLOT_TIME_VAR && r.comparator === "IS_NOT_EMPTY";
  };
  // NO separate already-guarded check: `isTarget` requires the condition to be
  // EXACTLY one rule, and this adds a second — so a re-run can never match an IF
  // it has already patched. A/B'd: adding that check back fails zero tests, and a
  // guard nobody has watched fire is one that gets trusted without earning it.

  const walk = (steps) => {
    if (!Array.isArray(steps)) return steps;
    return steps.map((step) => {
      if (!step || typeof step !== "object") return step;
      const next = { ...step };
      if (next.condition && isTarget(next.condition)) {
        added++;
        next.condition = {
          ...next.condition,
          rules: [
            ...next.condition.rules,
            // A stable id so a re-run recognises its own work rather than
            // appending a second copy.
            { id: "fillday-slot-has-items", left: SLOT_CHILDREN, comparator: "IS_NOT_EMPTY", right: "" },
          ],
        };
      }
      for (const key of ["steps", "body", "then", "else"]) {
        if (Array.isArray(next[key])) next[key] = walk(next[key]);
      }
      return next;
    });
  };

  const out = { ...(pipeline || {}) };
  if (Array.isArray(out.steps)) out.steps = walk(out.steps);
  return { pipeline: out, added };
}

const OP_NAME = "Schedule: Fill Day";

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const op = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  if (!op) {
    log(`  no operation named "${OP_NAME}" on this grid — nothing to do`);
    return { patched: 0 };
  }

  const { pipeline, added } = planFillDayGuard(op.pipeline);
  if (!added) {
    log("  guard already present (or the target IF was not found) — no change");
    return { patched: 0, alreadyDone: true };
  }
  // Named expectation: the op has exactly ONE such IF. More than that means the
  // pipeline is not the shape this migration was written against, and a selector
  // that matched more than it named is what damaged data in 0035.
  if (added !== 1) {
    log(`  expected exactly 1 guarded IF, matched ${added} — REFUSING`);
    return { patched: 0, refused: true };
  }

  log(`  ${OP_NAME}: guarded the per-slot FIND on "${SLOT_CHILDREN} IS_NOT_EMPTY"`);
  log(`${dryRun ? "[dry run] " : ""}1 operation patched`);
  if (!dryRun) {
    await Operation.updateOne({ id: op.id, gridId }, { $set: { pipeline } });
  }
  return { patched: 1 };
}
