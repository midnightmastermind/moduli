// 0209 — ticking a `Pay Bill` row now ticks the BILL it names.
//
// User, 2026-08-23: ***"make sure when i pay a bill with the pay occurance, that
// that gets set to complete."***
//
// `0208` gave all eleven bills a Completed checkbox, so there is now something to
// tick. This closes the loop: paying is an action you log on the schedule, and
// the bill it settles should not need a second, separate tick.
//
// ── IT IS `Pay Bill`, NOT `Pay`, AND THAT IS FORCED BY THE DATA ────────────
//
//   Pay        binds Completed · Account · Amount · Date · Category · Habit
//   Pay Bill   binds Completed · **Bill** · Account · Amount · Due · …
//
// Only `Pay Bill` carries a `Bill` occurrence picker, so only `Pay Bill` can say
// WHICH bill was paid. `Pay` has no way to name one, and inferring a bill from an
// amount would be a guess printed onto a financial record — the class `0052`
// refused for phone numbers.
//
// ── ONE WAY ONLY, deliberately ─────────────────────────────────────────────
//
// Ticking sets the bill Completed. UN-ticking does NOT clear it, and the reason
// is that bills recur: two `Pay Bill` rows can name the same bill across months,
// so "this row is no longer complete" does not mean "this bill is unpaid". A
// mirror would let correcting an old row silently un-pay a bill settled since.
// The checkbox `0208` added is right there if a bill needs clearing by hand.
//
// ── A DELETED BILL NEEDS NO GUARD, and the A/B is what established that ────
//
// The first draft declared `$billId` and gated the write on it, reasoning that a
// FIND binding nothing would make the UPDATE throw. Removing that guard changed
// no test: the executor emits no effect and throws nothing. **A guard nobody has
// watched fail is a guess**, so the pipeline is two steps shorter and the
// behaviour is pinned by a test instead of asserted by a comment.
//
// Priority 2 so it runs BEFORE the priority-3 trackers: the tick and the
// `Bills: Paid This Month` recount then happen in the same batch, and the
// executor's in-batch overlay means the tracker sees this write.

import { randomUUID as uid } from "crypto";

export const id = "0209-paying-a-bill-ticks-it";
export const description =
  "Ticking a `Pay Bill` row marks the Bill it names Completed — the other half of 0208";

export const OP_NAME = "Bills: Mark Paid";

/**
 * The pipeline, built from field ids. Exported so a test drives THIS, not a
 * restatement of it.
 */
export function buildMarkPaidPipeline({ billFieldId, completedFieldId }) {
  const r = (left, comparator, right) => ({ id: uid().slice(0, 12), left, comparator, right });
  return {
    sources: [],
    steps: [
      // The row the user just ticked.
      { id: uid().slice(0, 12), type: "action",
        config: { type: "FIND", predicate: { operator: "AND", rules: [r("id", "IS", "$trigger.occurrenceId")] },
                  itemVar: "$src" } },
      {
        id: uid().slice(0, 12), type: "if",
        // `Completed IS true` is the CORRECTNESS rule — without it, un-ticking a
        // row marks the bill paid. A/B'd: deleting it fails exactly the test
        // that starts from an unpaid bill.
        //
        // `Bill IS_NOT_EMPTY` is a COST rule and is honestly labelled as one:
        // the A/B shows correctness does not depend on it (an empty picker makes
        // the FIND bind nothing and the UPDATE emit nothing). It earns its place
        // because this op fires on EVERY `Completed` change anywhere in the app —
        // every habit, every task — and without it each one runs a full FIND scan
        // to conclude there is no bill.
        condition: { operator: "AND", rules: [
          r(`$src.fields.${billFieldId}.value`, "IS_NOT_EMPTY", ""),
          r(`$src.fields.${completedFieldId}.value`, "IS", true),
        ] },
        then: [
          { id: uid().slice(0, 12), type: "action",
            config: { type: "FIND",
                      predicate: { operator: "AND", rules: [r("id", "IS", `$src.fields.${billFieldId}.value`)] },
                      itemVar: "$bill", itemIdVar: "$billId" } },
          // A DELETED BILL NEEDS NO GUARD HERE, and that was measured rather
          // than assumed. The first draft wrapped this in
          // `IF $billId IS_NOT_EMPTY`; the A/B showed removing it changed
          // nothing — a FIND that binds nothing leaves the UPDATE emitting no
          // effect and throwing nothing. A guard nobody has watched fail is a
          // guess, so it is gone and the behaviour is pinned by a test instead.
          { id: uid().slice(0, 12), type: "action",
            config: { type: "UPDATE", path: `$bill.fields.${completedFieldId}.value`, value: true } },
        ],
        else: [],
      },
    ],
  };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Operation, Grid } = models;
  const grid = await Grid.findById(gridId).lean();
  const userId = grid?.userId;

  const bill = await Field.findOne({ gridId, name: "Bill", type: "occurrence" }).lean();
  const completed = await Field.findOne({ gridId, name: "Completed", type: "boolean" }).lean();
  if (!bill || !completed) {
    log(`  missing field — Bill:${!!bill} Completed:${!!completed} — REFUSING`);
    return { created: 0, refused: true };
  }

  const pipeline = buildMarkPaidPipeline({ billFieldId: bill.id, completedFieldId: completed.id });
  const shape = {
    name: OP_NAME,
    description: "When a Pay Bill row is completed, mark the Bill it names Completed too",
    enabled: true,
    priority: 2,
    triggerTypes: ["onChange"],
    // Scoped to the Completed FIELD, the same shape every other onChange op on
    // this grid uses. Unscoped, this would evaluate on every field edit.
    triggerObjects: [{ eventType: "onChange", subjectType: "field", targetId: completed.id, priority: 2 }],
    pipeline,
  };

  const existing = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  // PATCHES rather than skipping. An earlier run that shipped a wrong pipeline
  // has to be repairable by re-running, or it needs a follow-up nobody writes.
  log(`  ${existing ? "updating" : "creating"} \`${OP_NAME}\` (Bill=${bill.id}, Completed=${completed.id})`);
  if (!dryRun) {
    if (existing) await Operation.updateOne({ id: existing.id, gridId }, { $set: shape });
    else await Operation.create({ id: uid(), userId, gridId, ...shape });
  }
  log(`${dryRun ? "[dry run] " : ""}${existing ? "1 operation updated" : "1 operation created"}`);
  return { created: existing ? 0 : 1, updated: existing ? 1 : 0 };
}
