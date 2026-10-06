// server/migrations/0392-micronutrients-rerun-on-what-they-read.mjs
//
// "Nutrition: Today's Micronutrients" counts COMPLETED Schedule meals by their
// INGREDIENTS within the tile's DATE period, and was triggered on Fats / Carbs /
// Protein / Calories / Meal — none of which it reads. Ticking a meal, picking an
// ingredient or re-dating it left Vitamins & Minerals and Meal Count unchanged
// until the next load or date change. Found building the op on the rebuild by
// clicking (2026-10-05), where onChange Completed / Ingredient / Date move the tile
// live. This adds those three at the op's own priority; the existing ones stay.

export const id = "0392-micronutrients-rerun-on-what-they-read";
export const describe = "Nutrition: Today's Micronutrients re-runs when a meal's Completed, Ingredient or Date changes.";
export const touches = ["operations"];

export const OP_NAME = "Nutrition: Today's Micronutrients";
export const FIELD_NAMES = ["Completed", "Ingredient", "Date"];

/** PURE. The triggers plus an onChange per field id not already present; null if none is missing. */
export function withFieldTriggers(triggers, fieldIds) {
  const list = triggers || [];
  const missing = fieldIds.filter((fid) => !list.some((t) => t.eventType === "onChange" && t.targetId === fid));
  if (!missing.length) return null;
  const priority = list.find((t) => t.eventType === "onChange")?.priority ?? list[0]?.priority ?? 3;
  return [...list, ...missing.map((fid) => ({ eventType: "onChange", subjectType: "field", targetId: fid, priority }))];
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation, Field } = models;
  const ids = [];
  for (const name of FIELD_NAMES) {
    const fs = await Field.find({ gridId, name }).lean();
    if (fs.length !== 1) throw new Error(`0392: expected one "${name}" field on this grid, found ${fs.length}`);
    ids.push(fs[0].id);
  }
  const ops = await Operation.find({ gridId, name: OP_NAME }).lean();
  if (ops.length !== 1) { log(`${ops.length} "${OP_NAME}" ops — nothing to do`); return; }
  const op = ops[0];
  const next = withFieldTriggers(op.triggerObjects, ids);
  if (!next) { log("already triggered on all three"); return; }
  log(`+ ${next.length - (op.triggerObjects || []).length} onChange trigger(s) on "${OP_NAME}"`);
  if (dryRun) return;
  await Operation.updateOne({ gridId, id: op.id }, { $set: { triggerObjects: next, triggerTypes: [...new Set([...(op.triggerTypes || []), "onChange"])] } });
  log("done. Restart the server (pm2).");
}
