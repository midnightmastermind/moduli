// server/migrations/0358-people-photo-beside-fields.mjs
//
// User, 2026-09-25: "the image needs to be on the left side of fields, not
// underneath it". That layout already exists — `meta.mediaInline` puts the
// picture top-left beside the handle with the label over the fields (2026-07-25,
// sized for faces 2026-07-31). The people 0352 imported were created without
// it, so their 0355 photos rendered as the full-width block below the fields.
// This sets `meta.mediaInline: true` on every imported person's MODULE (merged
// into meta, never replacing it). Idempotent. Restart pm2 after --apply.

export const id = "0358-people-photo-beside-fields";
export const describe = "Shows each imported person's photo on the left beside their name and fields (meta.mediaInline) instead of as a block underneath.";
export const touches = ["modules"];

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence } = models;
  const occs = await Occurrence.find({ gridId, "meta.source": "social-import" }).select({ moduleId: 1 }).lean();
  const ids = [...new Set(occs.map(o => o.moduleId).filter(Boolean))];
  const todo = await Module.countDocuments({ gridId, id: { $in: ids }, "meta.mediaInline": { $ne: true } });
  log(`${ids.length} imported people · ${todo} to switch to the photo-beside-fields layout`);
  if (dryRun || !todo) { if (dryRun) log("DRY RUN — nothing written"); return; }
  const r = await Module.updateMany({ gridId, id: { $in: ids }, "meta.mediaInline": { $ne: true } }, { $set: { "meta.mediaInline": true } });
  log(`updated ${r.modifiedCount}. Restart the server (pm2) so the warm cache serves it.`);
}
