// 0442 — two display settings (user, 2026-10-26).
// 1. "the streak counter … says current streak 0/1 with a longest streak being 2 … turn off the target for that":
//    Current Streak carried a daily target of 1, drawn as "0/1". Its target is cleared; the number stays.
// 2. "what does last seen even do? lets hide that everywhere cause its confusing": Last Seen is a date
//    "Schedule: Stamp Date & Time Slot" writes when an item lands on the Schedule; nothing else reads it. Every
//    binding of it is hidden and the grid's default field visibility hides it too (so a row that binds it later
//    starts hidden). The values and the operation are kept; the eye in Settings › Fields shows it again.
export const id = "0442-streak-no-target-hide-last-seen";
export const describe = "Clears Current Streak's target (no more '0/1'); hides the Last Seen field on every module binding it and in the grid's default field visibility. Values kept.";
export const touches = ["fields", "modules", "grids"];

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Module, Grid } = models;
  const streak = await Field.findOne({ gridId, name: "Current Streak" }).lean();
  const seen = await Field.findOne({ gridId, name: "Last Seen", type: "date" }).lean();
  if (!streak || !seen) throw new Error("missing Current Streak or Last Seen");
  const mods = await Module.find({ gridId, fieldBindings: { $elemMatch: { fieldId: seen.id, hidden: { $ne: true } } } }).select("id").lean();
  const grid = await Grid.findById(gridId).lean();
  const fv = grid.meta?.fieldVisibility;
  const inRoot = fv?.mode === "hide" && (fv.fieldIds || []).includes(seen.id);
  log(`  Current Streak target: ${JSON.stringify(streak.displayConfig?.targetValue ?? null)} -> none`);
  log(`  Last Seen hidden on ${mods.length} module(s); grid default ${inRoot ? "already hides it" : fv?.mode === "hide" ? "adds it to its hide list" : `is ${fv?.mode || "none"} — left alone`}`);
  if (dryRun) return;
  await Field.updateOne({ gridId, id: streak.id }, { $unset: { "displayConfig.targetValue": "", "displayConfig.targetOp": "", "displayConfig.targetPeriod": "" } });
  await Module.updateMany({ gridId, "fieldBindings.fieldId": seen.id }, { $set: { "fieldBindings.$[b].hidden": true } }, { arrayFilters: [{ "b.fieldId": seen.id }] });
  if (fv?.mode === "hide" && !inRoot) await Grid.updateOne({ _id: grid._id }, { $addToSet: { "meta.fieldVisibility.fieldIds": seen.id } });
  const left = await Module.countDocuments({ gridId, fieldBindings: { $elemMatch: { fieldId: seen.id, hidden: { $ne: true } } } });
  if (left) throw new Error(`${left} module(s) still show Last Seen`);
  log("  applied. RESTART pm2.");
}
