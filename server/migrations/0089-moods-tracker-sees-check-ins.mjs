// server/migrations/0089-moods-tracker-sees-check-ins.mjs
//
// User, 2026-08-12: "moods tracker in todays emotional is still not updating".
//
// THE FOURTH APPEARANCE OF THE SAME TRAP, and driving the tracker through the
// REAL executor is what named it. The tracker computed `Moods=[]` even on the
// load path — it was not failing to fire, it was finding nothing. Every gate
// passes on the row when parents are walked properly:
//
//   Check In 06224368   Mood=Distracted  Date=2026-08-12  Completed=true
//                       feedCopy=false   under Schedule (walking ALL parents): YES
//
// But the executor does not walk all parents. `buildParentMap` keys each child
// to ONE parent, LAST WRITER WINS, and the Todo holding these rows is
// multi-parented into BOTH the Schedule day-col and the Day Page column:
//
//   chain = [Todo < Wednesday, August 12 < Day Page < Panel D]   -> never Schedule
//
// So `$inst._ancestors HAS_ANCESTOR $schedPageId` excluded every Check In. This
// is the ambiguity CLAUDE.md has recorded three times already (0068 created it,
// 0080/0081 chased it, 0079 worked around it by reporting the render context) —
// here it silently emptied a tracker.
//
// THE ANCESTOR RULE IS DROPPED RATHER THAN REPAIRED. Making the walk
// multi-parent aware means changing `buildParentMap`, which the filter cascade,
// the style cascade, field visibility and every ancestor-scoped dropdown all
// read — an enormous blast radius for one tracker, and the cached-identity
// contract added on 2026-08-07 depends on its current shape.
//
// AND THE RULE WAS NEVER THE ONE DOING THE WORK. What the tracker means is "a
// completed row carrying a mood, dated in the period", and the surviving gates
// say exactly that:
//
//   fields.Mood IS_NOT_EMPTY
//   AND (fields.Date DATE_IN_PERIOD $goalPeriod OR $goalPeriod IS_EMPTY)
//   AND meta.feedSourceId IS_EMPTY          <- a feed copy is never counted
//   AND (Completed IS true OR the module does not bind Completed)
//
// Measured before removing it: the only other occurrences whose module binds
// Mood are the Routines catalog Check In, Express and Vent — and ALL of them
// carry no Mood value and no Date, so rule 1 already excludes them. Nothing new
// starts counting.
export const id = "0089-moods-tracker-sees-check-ins";
export const describe =
  "The Moods tracker stops scoping by an ancestor walk a multi-parented row can never satisfy.";

/**
 * PURE — strip the Schedule-ancestor rule from a tracker's loop predicate.
 * Exported so a test drives exactly what ships.
 *
 * THROWS when the rule it means to remove is not there.
 */
export function dropAncestorScope(pipeline, { ancestorVar = "$schedPageId" } = {}) {
  let removed = 0;
  const scrub = (group) => {
    if (!group || !Array.isArray(group.rules)) return group;
    const rules = group.rules
      .map((r) => (r && Array.isArray(r.rules) ? scrub(r) : r))
      .filter((r) => {
        const hit = r && r.comparator === "HAS_ANCESTOR" && r.right === ancestorVar;
        if (hit) removed++;
        return !hit;
      });
    return { ...group, rules };
  };
  const walk = (steps) => (steps || []).map((step) => {
    if (step?.type === "if") {
      return { ...step, condition: scrub(step.condition),
        then: walk(step.then), else: walk(step.else) };
    }
    if (step?.type === "loop") {
      const body = step.body ? { body: walk(step.body) } : {};
      const cfgBody = step.config?.body ? { config: { ...step.config, body: walk(step.config.body) } } : {};
      return { ...step, ...body, ...cfgBody };
    }
    return step;
  });

  const steps = walk(pipeline?.steps || []);
  if (removed !== 1) {
    throw new Error(`0089: expected exactly 1 ancestor rule to drop, found ${removed}`);
  }
  return { ...pipeline, steps };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation, Occurrence, Module, Field } = models;
  const op = await Operation.findOne({ gridId, name: "Moods" }).lean();
  if (!op) { log(`REFUSING: no "Moods" operation — nothing written.`); return; }

  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const moodField = fields.find((f) => f.name === "Mood");
  const dateField = fields.find((f) => f.name === "Date" && f.type === "date");
  if (!moodField || !dateField) { log(`REFUSING: Mood/Date field missing.`); return; }

  // WHO STARTS COUNTING — the check that makes dropping a scope rule safe rather
  // than hopeful. Anything whose MODULE binds Mood is a candidate; only rows
  // that also carry a value and a date can survive the remaining gates.
  const binders = occs.filter((o) =>
    (modById.get(o.moduleId)?.fieldBindings || []).some((b) => b.fieldId === moodField.id));
  const eligible = binders.filter((o) => {
    const v = o.fields?.[moodField.id]?.value;
    return Array.isArray(v) ? v.length : v != null && v !== "";
  });
  log(`occurrences whose module binds Mood: ${binders.length} · carrying a value: ${eligible.length}`);
  for (const o of eligible) {
    log(`   ${o.id.slice(0, 8)} ${String(modById.get(o.moduleId)?.label).padEnd(10)} ` +
      `date=${String(o.fields?.[dateField.id]?.value || "—").slice(0, 10)} ` +
      `feedCopy=${!!o.meta?.feedSourceId}`);
  }
  const noDate = eligible.filter((o) => !o.fields?.[dateField.id]?.value);
  log(`  of those, ${noDate.length} carry NO date and stay excluded by the period rule`);

  const already = !JSON.stringify(op.pipeline?.steps || []).includes('"$schedPageId"');
  if (already) { log(`the ancestor rule is already gone — no change.`); if (dryRun) return; }

  if (dryRun) {
    log(`WOULD drop \`_ancestors HAS_ANCESTOR $schedPageId\` from the Moods loop, ` +
      `leaving the mood / date-period / feed-copy / completion gates in place.`);
    return;
  }

  if (!already) {
    const pipeline = dropAncestorScope(op.pipeline);
    await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
  }
  log(`the Moods tracker now counts a completed, dated, mood-carrying row wherever it is parented.`);
}
