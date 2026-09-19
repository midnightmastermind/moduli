// 0348 — a mood Check In is not a completed TASK.
//
// `0347` lists each Check In in the Schedule's current timeslot, and a Check In
// is stamped Completed. Two trackers count ANY completed row under the Schedule:
//   Completion Rate  — `$item.fields.<Completed> IS true` under the scope page
//   Current Streak   — a day counts when it has a completed, dated row
// so every mood pick would have raised the completion rate and kept the streak
// alive. In just those two, a row carrying a Mood is not counted: the rule
// `fields.<Mood>.value IS_EMPTY` is appended to each group that tests
// Completed. Nothing else about either tracker changes. (`Moods` is meant to
// see them and is untouched.)

export const id = "0348-a-mood-check-in-is-not-a-completed-task";
export const describe = "Completion Rate and Current Streak stop counting mood Check Ins (now listed on the Schedule by 0347) as completed tasks.";
export const touches = ["operations"];

const OPS = ["Completion Rate", "Current Streak"];

/** PURE — append the no-Mood rule to every group that tests Completed IS true. */
export function excludeMoodRows(pipeline, { completedFieldId, moodFieldId }) {
  let groups = 0;
  const tag = `fields.${moodFieldId}.value`;
  const patch = (cond) => {
    if (!Array.isArray(cond?.rules)) return cond;
    const hit = cond.rules.find((r) => typeof r?.left === "string"
      && r.left.endsWith(`fields.${completedFieldId}.value`) && r.comparator === "IS" && String(r.right) === "true");
    if (!hit) return cond;
    const prefix = hit.left.slice(0, hit.left.length - `fields.${completedFieldId}.value`.length);
    if (cond.rules.some((r) => r?.left === `${prefix}${tag}`)) return cond;   // already applied
    groups++;
    return { ...cond, rules: [...cond.rules, { id: `noMood-${groups}`, left: `${prefix}${tag}`, comparator: "IS_EMPTY", right: "" }] };
  };
  const walk = (steps) => (steps || []).map((s) => ({
    ...s,
    ...(s.condition ? { condition: patch(s.condition) } : {}),
    ...(s.predicate ? { predicate: patch(s.predicate) } : {}),
    ...(s.then ? { then: walk(s.then) } : {}),
    ...(s.else ? { else: walk(s.else) } : {}),
    ...(s.body ? { body: walk(s.body) } : {}),
  }));
  return { pipeline: { ...pipeline, steps: walk(pipeline?.steps || []) }, groups };
}

export async function up({ gridId, models, log = console.log, dryRun = true }) {
  const { Operation, Field } = models;
  const gid = String(gridId);
  const fields = await Field.find({ gridId: gid }).lean();
  const mood = fields.filter((f) => f.name === "Mood");
  const done = fields.filter((f) => f.name === "Completed" && f.type === "boolean");
  if (mood.length !== 1 || done.length !== 1) {
    log(`  REFUSING: Mood fields=${mood.length} Completed fields=${done.length} — nothing written.`);
    return { changed: 0 };
  }
  const ids = { completedFieldId: done[0].id, moodFieldId: mood[0].id };
  const plans = [];
  for (const name of OPS) {
    const op = await Operation.findOne({ gridId: gid, name }).lean();
    if (!op) { log(`  ${name}: absent — skipped`); continue; }
    const plan = excludeMoodRows(op.pipeline, ids);
    log(`  ${name}: ${plan.groups ? `${plan.groups} group(s) get the no-Mood rule` : "already excludes moods"}`);
    if (plan.groups) plans.push({ op, plan });
  }
  if (dryRun || !plans.length) { if (dryRun) log("  Dry run — nothing written."); return { changed: 0 }; }
  for (const { op, plan } of plans) await Operation.updateOne({ gridId: gid, id: op.id }, { $set: { pipeline: plan.pipeline } });
  for (const { op } of plans) {
    const after = await Operation.findOne({ gridId: gid, id: op.id }).lean();
    if (excludeMoodRows(after.pipeline, ids).groups) throw new Error(`0348: ${op.name} did not take the edit`);
  }
  return { changed: plans.length };
}
