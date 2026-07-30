// User, 2026-07-30:
//   "we also dont need a nap occurance"
//   "make sure we arent duplicating anything like sleep vs nap or lift vs
//    excesise. we only need one"
//   "sleep shouldnt have a duration field. the operation should just count each
//    one as 30 min"
//
// The Routines catalog carried seven redundant entries. Two were near-duplicates
// the user named (Nap ≈ Sleep, Lift ≈ Exercise — Lift's bindings were IDENTICAL
// to Exercise's), four were the same LABEL in two dimensions, and one was a
// second placement of the same Check In module (the mood-wheel demo row).
//
// Which of each pair survives, and why:
//   Nap                  → dropped; Sleep covers it
//   Lift                 → dropped; Exercise has identical bindings
//   Meditate (Emotional) → dropped; Spiritual keeps it (sits with Pray/Worship/Mindfulness)
//   Reflect (Spiritual)  → dropped; Emotional keeps it (sits with Journal/Check In)
//   Write (Occupational) → dropped; Creative keeps it (richer bindings; Occupational
//                          still has Plan/Build/Code/Design)
//   Review (Financial)   → dropped; Reconcile already covers reviewing accounts,
//                          so Occupational keeps the single Review
//   Check In (2nd copy)  → dropped; one placement is enough
//
// Verified before writing this: none of the seven is referenced by any operation
// pipeline, trigger, or template textmap, and each removed module had exactly ONE
// occurrence (no Schedule copies), so nothing user-facing is orphaned. The module
// delete is still guarded per-module at run time.
export const id = "0007-dedupe-routines-and-sleep-duration";
export const describe =
  "DELETES 7 redundant Routines catalog entries (Nap, Lift, Emotional Meditate, Spiritual Reflect, " +
  "Occupational Write, Financial Review, and a duplicate Check In placement) plus their modules when " +
  "no other occurrence uses them, and removes the Duration binding + stored Duration values from " +
  "Sleep (a slot is 30 minutes, so sleep is counted per occurrence instead). Skips any entry that " +
  "has children or extra placements.";

// [dimension container label, action label]
const DROP = [
  ["Physical", "Nap"],
  ["Physical", "Lift"],
  ["Emotional", "Meditate"],
  ["Spiritual", "Reflect"],
  ["Occupational", "Write"],
  ["Financial", "Review"],
];

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Module, Occurrence } = models;

  const routinesMod = await Module.findOne({ gridId, role: "page", label: "Routines" }).select({ id: 1 }).lean();
  if (!routinesMod) { log("no Routines page on this grid — nothing to dedupe"); return; }
  const routines = await Occurrence.findOne({ gridId, moduleId: routinesMod.id }).select({ id: 1, occurrences: 1 }).lean();

  const labelOf = async (o) => o.label
    || (await Module.findOne({ gridId, id: o.moduleId }).select({ label: 1 }).lean())?.label || null;

  // Resolve the dimension containers once.
  const dims = {};
  for (const cid of routines.occurrences || []) {
    const c = await Occurrence.findOne({ gridId, id: cid }).select({ id: 1, occurrences: 1, moduleId: 1, label: 1 }).lean();
    if (c) dims[await labelOf(c)] = c;
  }

  // ── 1. The six duplicate/near-duplicate actions ───────────────────────────
  for (const [dimLabel, actionLabel] of DROP) {
    const dim = dims[dimLabel];
    if (!dim) { log(`no "${dimLabel}" container — skipping ${actionLabel}`); continue; }
    let hit = null;
    for (const kid of dim.occurrences || []) {
      const k = await Occurrence.findOne({ gridId, id: kid }).lean();
      if (k && (await labelOf(k)) === actionLabel) { hit = k; break; }
    }
    if (!hit) { log(`${dimLabel}/${actionLabel} already gone`); continue; }
    if ((hit.occurrences || []).length) {
      log(`REFUSING ${dimLabel}/${actionLabel} — it has ${hit.occurrences.length} child(ren)`);
      continue;
    }
    const siblings = await Occurrence.countDocuments({ gridId, moduleId: hit.moduleId });
    log(`delete ${dimLabel}/${actionLabel} (occ ${hit.id})` + (siblings > 1
      ? ` — module kept, ${siblings - 1} other placement(s)` : " + its module"));
    if (dryRun) continue;
    await Occurrence.deleteOne({ gridId, id: hit.id });
    await Occurrence.updateMany({ gridId, occurrences: hit.id }, { $pull: { occurrences: hit.id } });
    if (siblings <= 1) await Module.deleteOne({ gridId, id: hit.moduleId });
  }

  // ── 2. Duplicate Check In placement in Emotional ──────────────────────────
  const emo = dims["Emotional"];
  if (emo) {
    const checkIns = [];
    for (const kid of emo.occurrences || []) {
      const k = await Occurrence.findOne({ gridId, id: kid }).lean();
      if (k && (await labelOf(k)) === "Check In") checkIns.push(k);
    }
    if (checkIns.length <= 1) log(`Emotional lists ${checkIns.length} Check In — nothing to collapse`);
    else {
      // Keep the one with children if any (never drop content), else the first.
      const keep = checkIns.find(k => (k.occurrences || []).length) || checkIns[0];
      const extras = checkIns.filter(k => k.id !== keep.id && !(k.occurrences || []).length);
      log(`collapse ${checkIns.length} Check In placements → keep ${keep.id}, delete ${extras.length}`);
      if (!dryRun) {
        for (const e of extras) {
          await Occurrence.deleteOne({ gridId, id: e.id });
          await Occurrence.updateMany({ gridId, occurrences: e.id }, { $pull: { occurrences: e.id } });
        }
      }
    }
  }

  // ── 3. Sleep loses Duration ───────────────────────────────────────────────
  // A slot IS 30 minutes, so sleep is measured by how many half-hour slots it
  // fills — asking for a duration on top of that double-counts. The stored
  // values go too, so nothing reads a stale number later.
  const duration = await Field.findOne({ gridId, name: "Duration" }).select({ id: 1 }).lean();
  const sleep = await Module.findOne({ gridId, role: "instance", label: "Sleep" }).select({ id: 1, fieldBindings: 1 }).lean();
  if (!duration || !sleep) log("no Duration field or Sleep module — skipping the Sleep change");
  else if (!(sleep.fieldBindings || []).some(b => b.fieldId === duration.id)) log("Sleep already has no Duration binding");
  else {
    const valued = await Occurrence.countDocuments({ gridId, moduleId: sleep.id, [`fields.${duration.id}`]: { $exists: true } });
    log(`unbind Duration from Sleep + clear ${valued} stored value(s)`);
    if (!dryRun) {
      await Module.updateOne({ gridId, id: sleep.id }, { $pull: { fieldBindings: { fieldId: duration.id } } });
      await Occurrence.updateMany({ gridId, moduleId: sleep.id, [`fields.${duration.id}`]: { $exists: true } },
        { $unset: { [`fields.${duration.id}`]: "" } });
    }
  }
}
