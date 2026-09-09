// A day you EDITED is not torn down either.
//
// User, 2026-09-09: *"i just dont want it to delete anything i edit"* — and,
// about the field-level version I proposed: *"i feel like its going to miss
// some things i put in"*. They were right, and measuring is what settled it.
//
// `0322` spares a day column when something beneath it is COMPLETED. That
// covers what you DID and says nothing about what you WROTE or PICKED. Over
// the live grid's 40 day columns / 526 rows, every field-level candidate for
// "anything I edited" failed in one of two directions:
//
//   Completed ticked                        4 of 40   <- 0322, already spared
//   holds prose                             1 of 40
//   holds a field no op writes              2 of 40   <- DROPS real edits
//   excluding fields ops UPDATE            30 of 40   <- ops PREFILL Meal, Mood
//                                                        and the macros, so this
//                                                        loses your own picks
//   excluding the build's own stamps       30 of 40   <- kept by `Daily
//                                                        Question`, which the
//                                                        APP writes, not you
//   holds any value at all                 40 of 40   <- spares everything
//
// The same fields are written by both sides, so no rule reading VALUES can tell
// them apart after the fact.
//
// ── SO THE FACT IS RECORDED WHERE IT IS KNOWN ─────────────────────────────
//
// The write path already distinguishes them: `txRecorder` marks a write
// `derived` on exactly `!actionId`, which is how UNDO tells your step from an
// op's. `update_occurrence` now stamps `meta.userTouched` when a write carries
// an `__actionId`, and the teardown reads that instead of guessing.
//
// Over `$allOccurrences`, not `$allInstances`: a journal entry is a TEXTBLOCK
// and a note is a CONTAINER, and both are things you can edit.
//
// ── WHAT THIS DOES NOT DO, stated plainly ────────────────────────────────
//
// The stamp only exists from the moment it ships, so this protects days you
// edit FROM NOW ON. A day you edited last week and never ticked anything on is
// still torn down — nothing in the data records that you touched it.
//
// AND ONE ROW PER COLUMN IS OUT OF REACH, measured rather than assumed.
// `_ancestors` is walked from `buildParentMap`, which keys child -> ONE parent,
// LAST WRITER WINS — and the schedule multi-parents slots across day columns by
// design. On the fixture's day column, 48 of 49 children resolve their ancestry
// back to it and 1 does not: it is listed by two columns and the map gave it the
// other one. Editing THAT row spares the other column, not this one. `0322` has
// the identical exposure through the same walk, so this is pre-existing and is
// reported rather than papered over here — closing it means giving the ancestor
// walk every parent, which is a change to a shared read path.
//
// Idempotent. Imports `0322`'s own `up` first so a grid that has seen neither
// gets the spare and then the widening, in order.
import Field from "../models/Field.js";
import Operation from "../models/Operation.js";
import { up as up0322 } from "./0322-a-day-you-did-something-on-is-not-torn-down.mjs";

export const id = "0329-a-day-you-edited-is-not-torn-down";
export const description = "The schedule teardown spares a day carrying an edit, not only a completion.";
export const touches = ["fields", "operations"];

const rid = () => "k" + Math.random().toString(36).slice(2, 11);

const walk = (n, fn) => {
  if (Array.isArray(n)) return n.forEach((x) => walk(x, fn));
  if (n && typeof n === "object") { fn(n); Object.values(n).forEach((v) => walk(v, fn)); }
};

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  // A grid that never ran 0322 has no keep-probe to widen. Delegate rather
  // than restate its remedy — one definition of what the spare looks like.
  const op0 = await Operation.findOne({ gridId: gid, name: "Schedule: Build Schedule" }).lean();
  if (op0 && !JSON.stringify(op0.pipeline || {}).includes("$dcKeep")) {
    log("  no keep-probe yet — running 0322 first.");
    await up0322({ gridId, dryRun, log });
  }

  const fields = await Field.find({ gridId: gid }).lean();
  const done = fields.filter((f) => f.name === "Completed" && f.type === "boolean");
  if (done.length !== 1) throw new Error(`expected exactly 1 boolean "Completed" field, found ${done.length} - refusing`);
  const completedFieldId = done[0].id;

  const op = await Operation.findOne({ gridId: gid, name: "Schedule: Build Schedule" }).lean();
  if (!op) throw new Error(`no "Schedule: Build Schedule" operation - refusing`);

  // The keep-probe, found by WHAT IT BINDS. Never by position.
  const probes = [];
  walk(op.pipeline, (n) => {
    if (n?.type === "FIND" && n?.itemIdVar === "$dcKeep") probes.push(n);
  });

  if (!probes.length) throw new Error(`could not find the teardown keep-probe ($dcKeep) - refusing`);
  if (probes.length !== 1) throw new Error(`${probes.length} keep-probes - refusing to guess which is the teardown`);

  const probe = probes[0];
  if (JSON.stringify(probe).includes("meta.userTouched")) {
    log("  already spares a day you edited.");
    return;
  }

  // The completion rule 0322 wrote, identified by what it READS rather than by
  // where it sits — a rule list is not an ordering contract.
  const rules = probe.predicate?.rules || [];
  const ci = rules.findIndex((r) => r.left === `fields.${completedFieldId}.value` && r.comparator === "IS" && r.right === true);
  if (ci < 0) throw new Error(`the keep-probe does not gate on Completed - refusing`);

  // The two questions become one OR *in place*, so the ancestor rule beside it
  // is untouched. Replacing the whole predicate would drop that scope and the
  // probe would match an edit anywhere on the grid.
  rules[ci] = { id: rid(), operator: "OR", rules: [
    { id: rid(), left: `fields.${completedFieldId}.value`, comparator: "IS", right: true },
    { id: rid(), left: "meta.userTouched", comparator: "IS", right: true },
  ] };
  probe.over = "$allOccurrences";

  log(`  Schedule: Build Schedule — a day-col survives if anything beneath it is Completed OR userTouched`);

  // THREE CONTROLS, each guarding a way this could read as success and be
  // wrong: the teardown must still EXIST (or nothing is ever cleaned up), the
  // ancestor scope must SURVIVE (or one edit anywhere spares every past day),
  // and the completion arm must survive too (or 0322 is silently undone).
  const after = JSON.stringify(op.pipeline);
  const deletes = (after.match(/"itemIdExpr":"\$cont\.id"/g) || []).length;
  if (deletes !== 1) throw new Error(`expected exactly 1 day-col DELETE after the change, found ${deletes} - refusing`);
  if (!probe.predicate.rules.some((r) => r.left === "_ancestors" && r.right === "$cont.id"))
    throw new Error(`the keep-probe lost its ancestor scope - refusing`);
  if (!after.includes("meta.userTouched")) throw new Error(`the edit arm did not land - refusing`);
  if (!after.includes(`fields.${completedFieldId}.value`)) throw new Error(`the completion arm was lost - refusing`);

  if (apply) await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { pipeline: op.pipeline } });
  log(`  1 op ${apply ? "updated" : "would be updated"} (teardown kept, now spares edits too).`);
  if (!apply) log("  DRY RUN - pass --apply to write.");
}
