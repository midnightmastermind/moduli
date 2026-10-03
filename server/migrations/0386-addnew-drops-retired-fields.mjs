// server/migrations/0386-addnew-drops-retired-fields.mjs
//
// 0385 deleted Next Due / Cadence / Every N Days / Anchor Date after checking
// operations, modules, occurrences and the grid for references — and not the
// FIELDS collection itself. Two occurrence fields (Bill, Subscription) still list
// Cadence in `meta.optionsSource.addNew.fieldIds`, so adding a new bill from
// their dropdown would bind a field that no longer exists. Every field's addNew
// list now drops ids that name no field on this grid.

export const id = "0386-addnew-drops-retired-fields";
export const describe = "Drops field ids that no longer exist from every field's addNew.fieldIds (Bill and Subscription still listed Cadence).";
export const touches = ["fields"];

/** PURE. The addNew list without ids not in `existing`; null when unchanged. */
export function prunedAddNew(field, existing) {
  const ids = field?.meta?.optionsSource?.addNew?.fieldIds;
  if (!Array.isArray(ids)) return null;
  const kept = ids.filter((x) => existing.has(x));
  return kept.length === ids.length ? null : kept;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Field } = models;
  const fields = await Field.find({ gridId }).lean();
  const existing = new Set(fields.map((f) => f.id));
  const changes = fields.map((f) => [f, prunedAddNew(f, existing)]).filter(([, kept]) => kept);
  for (const [f, kept] of changes) log(`"${f.name}": addNew.fieldIds ${f.meta.optionsSource.addNew.fieldIds.length} -> ${kept.length}`);
  if (!changes.length) log("nothing to prune");
  if (dryRun) return;
  for (const [f, kept] of changes) await Field.updateOne({ gridId, id: f.id }, { $set: { "meta.optionsSource.addNew.fieldIds": kept } });
  log("done. Restart the server (pm2).");
}
