// `Tasks Left` counted routines, so ticking a habit moved it.
//
// User, 2026-09-06: *"tasks left display field is updating when i complete a
// routine. it should just be for tasks, not habit occurances"*.
//
// Measured on the live grid: of 55 completed rows, **46 are habit-bound
// routines** (Eat, Sleep, Check In, Cook...) and 9 are real tasks. The tile
// read **-2** - a countdown driven past zero by rows it was never meant to
// count, which is the visible symptom.
//
// ── THE DISCRIMINATOR ALREADY EXISTS AND ONE OP WAS MISSING IT ─────────────
//
// 2026-07-30 (3) established it: every Routines action module binds a hidden
// `Habit` marker, and the two counts are separated by the module BINDING -
// never by a stored value, which a copy would carry along.
//
//     Completed Tasks   $item._boundFieldIds ARRAY_NOT_INCLUDES <Habit>
//     Task Countdown    (nothing)
//
// Every other gate is already identical between the two - completed, in
// period, under the Schedule, not a feed copy, matching the category. This is
// the single rule that was dropped.
//
// ── THE RULE IS COPIED FROM THE EXEMPLAR, NOT AUTHORED ─────────────────────
//
// `Completed Tasks` carries the working form; re-typing it here is how the
// field id or the comparator drifts. The migration READS that op, extracts the
// rule, and REFUSES if it cannot find exactly one - so the two ops cannot end
// up disagreeing about what a habit is.
//
// ── AND IT WRAPS RATHER THAN APPENDS ───────────────────────────────────────
//
// Same reason as `0290`/`0298`: a per-item condition carries an `operator`, and
// some are OR groups, so pushing a rule in would WIDEN the match - the
// countdown would count MORE while looking like a plausible number. Wrapping in
// an explicit AND is correct whatever the original operator was.
import Field from "../models/Field.js";
import Operation from "../models/Operation.js";

export const id = "0306-tasks-left-counts-tasks-not-habits";
export const description = "Task Countdown excludes habit-bound rows, the way Completed Tasks already does.";
export const touches = ["fields", "operations"];

const rid = () => "h" + Math.random().toString(36).slice(2, 12);
const TARGET = "Task Countdown";
const EXEMPLAR = "Completed Tasks";

// Every rule on `_boundFieldIds`, at any depth.
function habitRules(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((x) => habitRules(x, out)); return out; }
  if (String(node.left || "") === "$item._boundFieldIds" && node.comparator === "ARRAY_NOT_INCLUDES") out.push(node);
  Object.values(node).forEach((v) => habitRules(v, out));
  return out;
}

const touchesItem = (grp) => Array.isArray(grp?.rules) && grp.rules.some(
  (r) => (Array.isArray(r?.rules) ? touchesItem(r) : String(r?.left || "").startsWith("$item.")));

// Wrap every per-item condition in an AND with the extra rule.
function gateEveryItem(node, rule, count = { n: 0 }) {
  if (!node || typeof node !== "object") return count;
  if (Array.isArray(node)) { node.forEach((x) => gateEveryItem(x, rule, count)); return count; }
  for (const key of ["condition", "predicate"]) {
    const grp = node[key];
    if (grp && Array.isArray(grp.rules) && touchesItem(grp)) {
      node[key] = { id: rid(), operator: "AND", rules: [grp, JSON.parse(JSON.stringify(rule))] };
      count.n++;
    }
  }
  Object.values(node).forEach((v) => gateEveryItem(v, rule, count));
  return count;
}

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const habits = fields.filter((f) => f.name === "Habit");
  if (habits.length !== 1) throw new Error(`field "Habit": ${habits.length} matches - refusing`);

  const src = await Operation.findOne({ gridId: gid, name: EXEMPLAR }).lean();
  if (!src) throw new Error(`no "${EXEMPLAR}" to copy the rule from - refusing`);
  const found = habitRules(src.pipeline);
  const exemplar = [...new Map(found.map((r) => [JSON.stringify({ l: r.left, c: r.comparator, r: r.right }), r])).values()];
  if (exemplar.length !== 1) throw new Error(`"${EXEMPLAR}" carries ${exemplar.length} distinct habit rules - refusing to guess`);
  if (exemplar[0].right !== habits[0].id)
    throw new Error(`"${EXEMPLAR}" excludes ${exemplar[0].right}, which is not the Habit field - refusing`);

  const op = await Operation.findOne({ gridId: gid, name: TARGET }).lean();
  if (!op) throw new Error(`no "${TARGET}" - refusing`);
  if (habitRules(op.pipeline).length) { log(`  ${TARGET}: already excludes habits - left alone`); return; }

  const pipeline = JSON.parse(JSON.stringify(op.pipeline));
  const rule = { ...exemplar[0], id: rid() };
  const n = gateEveryItem(pipeline, rule);
  if (!n.n) throw new Error(`"${TARGET}": no per-item gate to narrow - refusing`);

  log(`  ${TARGET}: ${n.n} per-item gate(s) -> _boundFieldIds ARRAY_NOT_INCLUDES <Habit>  (rule copied from "${EXEMPLAR}")`);
  if (apply) await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { pipeline } });
  if (!apply) log("  DRY RUN - pass --apply to write.");
}
