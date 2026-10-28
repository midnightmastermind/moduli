// 0455 — op-made copy-links take their source row's own name (user, 2026-10-28: "you copylinked the module label
// btw and not occassion (clean hotel room and clean)"). COPY_LINK sent no label, so a copy of a renamed row showed
// the shared module's name. The client now sends it; this names the copies already made by 0453's passes
// (meta.todoCopy / meta.occasion) and 0447's (meta.datedWork) when the copy has no name and its source has one.
export const id = "0455-copies-take-source-name";
export const describe = "Op-made copy-links without a name take their source row's own name.";
export const touches = ["occurrences"];

/** Pure: [{ id, label }] for each copy to name. */
export function planNames(occurrences) {
  const byId = new Map(occurrences.map((o) => [o.id, o]));
  const out = [];
  for (const o of occurrences) {
    const m = o.meta || {};
    if (!(m.todoCopy || m.occasion || m.datedWork) || o.label) continue;
    const src = byId.get(m.copyLinkSource);
    if (src?.label) out.push({ id: o.id, label: src.label });
  }
  return out;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence } = models;
  const occs = await Occurrence.find({ gridId }, { id: 1, label: 1, meta: 1 }).lean();
  const plan = planNames(occs);
  log(`  ${plan.length} copy(ies) to name: ${[...new Set(plan.map((p) => p.label))].join(", ")}`);
  if (dryRun) return;
  for (const p of plan) await Occurrence.updateOne({ gridId, id: p.id, label: { $in: [null, ""] } }, { $set: { label: p.label, updatedAt: new Date() } });
  log("  applied. RESTART pm2.");
}
