// User, 2026-08-01: "the question itself says # heading when it should be ####
// and actually look it. right now it doesnt even look like the # heading. also
// it should be bigger than the text that says answer."
//
// The inner question container carried no headingLevel, so it fell to the
// level-1 default and printed a single "#" four levels deep. It is #### —
// column # › Journal ## › Daily Question ### › the question.
//
// The "doesn't LOOK like a heading" half is a CSS fix in the same commit: a
// <select> does not inherit font, so the bound header rendered at the UA's
// 11px no matter which level it declared. With `font: inherit` the level 4
// size (12px) applies, which also puts it above the 9px "Answer" text.

export const id = "0030-question-heading-level";
export const describe =
  "Sets the Daily Question's inner question container to heading level 4 (it printed a single # four " +
  "levels deep). The matching CSS fix makes the bound <select> inherit the heading font.";

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence } = models;

  // The question container is the child of a "Daily Question" section — found
  // structurally, since it deliberately carries no label (its header renders
  // the selected question instead).
  const dqMods = await Module.find({ gridId, role: "container", label: "Daily Question" })
    .select({ id: 1 }).lean();
  const dqOccs = await Occurrence.find({ gridId, moduleId: { $in: dqMods.map(m => m.id) } })
    .select({ id: 1, occurrences: 1 }).lean();

  let set = 0;
  const seen = new Set();
  for (const dq of dqOccs) {
    for (const kid of dq.occurrences || []) {
      const o = await Occurrence.findOne({ gridId, id: kid }).select({ moduleId: 1 }).lean();
      if (!o || seen.has(o.moduleId)) continue;
      const m = await Module.findOne({ gridId, id: o.moduleId }).select({ id: 1, role: 1, meta: 1 }).lean();
      if (!m || m.role !== "container") continue;
      seen.add(m.id);
      if (m.meta?.headingLevel === 4) continue;
      log(`  question container ${m.id} → heading level 4`);
      set++;
      if (!dryRun) await Module.updateOne({ gridId, id: m.id }, { $set: { "meta.headingLevel": 4 } });
    }
  }
  log(`${set} question container(s) set to level 4`);
}
