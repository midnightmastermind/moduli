// Moving to a new day deleted the day you just had.
//
// User, 2026-09-08: *"so currently the occurances that get added to the schedule
// are deleted everytime? that shouldnt happen"*
//
// MEASURED against a pre-rollover snapshot rather than inferred — **137
// occurrences gone, 31 of them COMPLETED**: a psych appointment, twelve Sleep
// records, the `Track` rows carrying the account balances, 18 Drinks, 16 Eats.
//
// `Schedule: Build Schedule` PHASE C deletes every day-col under the Schedule
// page whose date is not in the filtered period — the column and, by cascade,
// everything on it. That teardown is deliberate: a day-col is a column plus 49
// slots of scaffolding, and keeping every one of them would add ~50 occurrences
// a day to a grid whose load time this file has spent weeks on.
//
// ── WHAT IS LOST IS THE RECORD, NOT THE SOURCE — and both halves matter ────
//
// The originals survive: the appointment lives on the Tasks page, Eat and Sleep
// in the Routines catalog (38 and 63 copies still on the grid). So this is not
// the catalog being deleted. What goes is **the record that you did it that
// day** — and the tracker history arrays cannot stand in for it, because they
// are date-scoped: `Meal Log.Meals`, `Workout Log.Workouts`, `Spent.Purchases`
// and `Pomodoro History` all read **0 rows** right now. Gone from both places.
//
// ── THE DISCRIMINATOR IS THE ONE THIS GRID ALREADY USES ───────────────────
//
// A day-col is spared when anything beneath it is COMPLETED — "the row is the
// USER's if `Completed` was ticked" (2026-08-20), the same test `0038`'s
// writing-guard settled on after twice mistaking the app's own footprint for
// the user's. An untouched day is still torn down, so empty scaffolding does
// not accumulate: the cleanup keeps doing its job for the days you did nothing.
//
// FAIL-OPEN in the builder: `completedFieldId` is optional there, so a caller
// that does not pass it produces the byte-identical pipeline. The seed passes
// it, and this carries it to the live grid — twins, in one pass.
//
// Idempotent.
import Field from "../models/Field.js";
import Operation from "../models/Operation.js";

export const id = "0322-a-day-you-did-something-on-is-not-torn-down";
export const description = "A schedule day you completed something on survives the next day's rebuild.";
export const touches = ["fields", "operations"];

const rid = () => "k" + Math.random().toString(36).slice(2, 11);

const walk = (n, fn) => {
  if (Array.isArray(n)) return n.forEach((x) => walk(x, fn));
  if (n && typeof n === "object") { fn(n); Object.values(n).forEach((v) => walk(v, fn)); }
};

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const done = fields.filter((f) => f.name === "Completed" && f.type === "boolean");
  if (done.length !== 1) throw new Error(`expected exactly 1 boolean "Completed" field, found ${done.length} - refusing`);
  const completedFieldId = done[0].id;

  const op = await Operation.findOne({ gridId: gid, name: "Schedule: Build Schedule" }).lean();
  if (!op) throw new Error(`no "Schedule: Build Schedule" operation - refusing`);

  // The teardown branch, found by WHAT IT DOES: an `if` whose ELSE is a bare
  // DELETE of `$cont.id`. Never by position — this pipeline has three DELETEs.
  const targets = [];
  walk(op.pipeline, (n) => {
    if (n.type !== "if" || !Array.isArray(n.else) || n.else.length !== 1) return;
    const only = n.else[0];
    if (only?.config?.type === "DELETE" && only.config.itemIdExpr === "$cont.id") targets.push(n);
  });

  if (!targets.length) {
    // Already converted, or the shape moved — tell them apart rather than
    // reporting success for a pipeline this never touched.
    const already = JSON.stringify(op.pipeline || {}).includes("$dcKeep");
    if (already) { log("  already spares a day you completed something on."); return; }
    throw new Error(`could not find the day-col teardown branch - refusing`);
  }
  if (targets.length !== 1)
    throw new Error(`${targets.length} branches delete $cont.id - refusing to guess which is the teardown`);

  const gate = targets[0];
  gate.else = [
    { id: rid(), type: "action", config: { type: "FIND", over: "$allInstances",
      predicate: { operator: "AND", rules: [
        { id: rid(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$cont.id" },
        { id: rid(), left: `fields.${completedFieldId}.value`, comparator: "IS", right: true },
      ] }, itemIdVar: "$dcKeep" } },
    { id: rid(), type: "if",
      condition: { operator: "AND", rules: [
        { id: rid(), left: "$dcKeep", comparator: "IS_EMPTY", right: "" },
      ] },
      then: [{ id: rid(), type: "action", config: { type: "DELETE", itemIdExpr: "$cont.id" } }],
      else: [] },
  ];

  log(`  Schedule: Build Schedule — a day-col is torn down only when nothing beneath it is Completed`);

  // THE CONTROL: the teardown must still EXIST. A guard that removes the delete
  // entirely would also stop the empty scaffolding being cleaned up, and would
  // read as success here.
  const after = JSON.stringify(op.pipeline);
  const deletes = (after.match(/"itemIdExpr":"\$cont\.id"/g) || []).length;
  if (deletes !== 1) throw new Error(`expected exactly 1 day-col DELETE after the change, found ${deletes} - refusing`);
  if (!after.includes("$dcKeep")) throw new Error(`the keep-guard did not land - refusing`);

  if (apply) await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { pipeline: op.pipeline } });
  log(`  1 op ${apply ? "updated" : "would be updated"} (teardown kept, now guarded).`);
  if (!apply) log("  DRY RUN - pass --apply to write.");
}
