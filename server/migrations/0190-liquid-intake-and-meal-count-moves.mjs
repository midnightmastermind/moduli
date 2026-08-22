/**
 * 0190 — `Intake` becomes `Liquid Intake`, and `Meal Count` moves to the tile that shows meals.
 *
 * USER, 2026-08-22: *"change Intake to Liquid Intake in trackers and remove meals, last meals, and
 * meal count from there and add Meal Count with a goal of 3 to Meal Log. also remove Last Meal from
 * the meal log as well."*
 *
 * ── TWO OF THE THREE REMOVALS WERE ALREADY INERT, and measuring is how that is known ────────
 *
 * `Intake` binds four fields. Only ONE of them is written onto that occurrence:
 *
 *     Daily Water    written by `Water`                        onto Intake        LIVE
 *     Meal Count     written by `Nutrition: Today's Micro…`     onto Intake        LIVE
 *     Meals          written by `Meal History`                  onto MEAL LOG      inert here
 *     Last Meal      written by `Meal History`                  onto MEAL LOG      inert here
 *
 * A field value lives on an OCCURRENCE, so binding `Meals` on Intake never showed anything —
 * exactly the class `0184` retired the `Macros` tile for, found again two tiles over. The user
 * asked for them to go for their own reasons; they were never doing anything.
 *
 * ── THE ONE THAT IS NOT A BINDING CHANGE IS `Meal Count`, AND GETTING IT WRONG WOULD REPEAT `0184`
 *
 * Moving a BINDING without moving the WRITE produces precisely the tile this repo just deleted: one
 * that displays a field nothing writes on it. So the op's own seam moves with it —
 *
 *     INIT_VAR $countTile = $allItemsById.<Intake>     ->  $allItemsById.<Meal Log>
 *     UPDATE   $countTile.fields.<Meal Count>.value        unchanged
 *
 * one line, and the value lands where the pill now renders. The migration REFUSES if that
 * `INIT_VAR` is not found, rather than silently moving a binding to a tile nothing feeds.
 *
 * ── THE GOAL OF 3 IS A FIELD-LEVEL TARGET, and that is worth stating ────────────────────────
 *
 * `displayConfig.targetValue` lives on the FIELD, not on the placement, so "3 meals" applies
 * wherever `Meal Count` is displayed. It is displayed in exactly one place, so this is precise
 * today — and it is the same limitation `Monthly Bills` is filed under (a frozen literal), noted
 * here so the next person is not surprised by it.
 *
 * `targetOp` is left at its default `>=`: three meals is a floor to reach, not a ceiling. `0165`
 * had to make sodium a `<=` for the opposite reason, and the two are easy to confuse.
 *
 * ── WHAT THIS LEAVES BEHIND, reported rather than tidied ───────────────────────────────────
 *
 * After this, **`Last Meal` is bound by nothing** while `Meal History` still computes it — a write
 * with no reader, which is the inert class from the other direction. It is left alone because
 * removing an op's output is a wider change than the user asked for, and `Last Meal` is one binding
 * away from being useful again. It will start appearing in `checkGrid`'s `unused-field` warning.
 */
export const id = "0190-liquid-intake-and-meal-count-moves";
export const describe =
  "Rename Intake to Liquid Intake and leave it only Daily Water; move Meal Count (goal 3) to Meal Log and repoint the op that writes it; drop Last Meal from Meal Log. Deletes no data.";

/** Repoint the INIT_VAR that binds the tile `Meal Count` is written onto. */
export function repointCountTile(pipeline, { fromOccId, toOccId }) {
  let changed = 0;
  const visit = (steps) => {
    for (const s of steps || []) {
      const c = s?.config;
      if (c?.type === "INIT_VAR" && typeof c.expr === "string" && c.expr.includes(fromOccId)) {
        c.expr = c.expr.split(fromOccId).join(toOccId);
        changed++;
      }
      visit(s?.then); visit(s?.else); visit(s?.body);
    }
  };
  visit(pipeline?.steps);
  return changed;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields, ops] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(), Operation.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "(?)";
  const fid = (n) => fields.find((f) => f.name === n)?.id;

  const intake = occs.find((o) => nameOf(o) === "Intake" && modById.get(o.moduleId)?.role === "instance");
  const mealLog = occs.find((o) => nameOf(o) === "Meal Log" && modById.get(o.moduleId)?.role === "instance");
  if (!intake || !mealLog) { log("  nothing to do — no `Intake` / `Meal Log` tile (already renamed?)"); return; }

  const WATER = fid("Daily Water"), MEALS = fid("Meals"), LAST = fid("Last Meal"), COUNT = fid("Meal Count");
  if (!WATER || !COUNT) { log("  REFUSING: missing `Daily Water` or `Meal Count` field"); return; }

  // ── the op seam must move WITH the binding, or this repeats `0184` ──────────────────────
  const op = ops.find((o) => JSON.stringify(o.pipeline || {}).includes(intake.id)
                          && JSON.stringify(o.pipeline || {}).includes(`.fields.${COUNT}.value`));
  if (!op) { log(`  REFUSING: no operation writes Meal Count onto the Intake tile — nothing to repoint`); return; }
  const pipeline = JSON.parse(JSON.stringify(op.pipeline));
  const moved = repointCountTile(pipeline, { fromOccId: intake.id, toOccId: mealLog.id });
  if (!moved) { log(`  REFUSING: \`${op.name}\` names the Intake tile but not in an INIT_VAR expr — cannot repoint safely`); return; }
  log(`  ${op.name}: repointing ${moved} INIT_VAR(s) ${intake.id} -> ${mealLog.id}`);

  const intakeMod = modById.get(intake.moduleId), logMod = modById.get(mealLog.moduleId);
  const keep = (m, ids) => (m.fieldBindings || []).filter((b) => ids.includes(b.fieldId));
  const drop = (m, ids) => (m.fieldBindings || []).filter((b) => !ids.includes(b.fieldId));
  const fn = (id) => fields.find((f) => f.id === id)?.name || id;

  const intakeNext = keep(intakeMod, [WATER]);
  log(`  Liquid Intake keeps: ${intakeNext.map((b) => fn(b.fieldId)).join(", ")}`);
  log(`  Liquid Intake drops: ${drop(intakeMod, [WATER]).map((b) => fn(b.fieldId)).join(", ")}`);

  const countShape = (intakeMod.fieldBindings || []).find((b) => b.fieldId === COUNT);
  const logDropped = drop(logMod, [LAST]);
  const logNext = logDropped.some((b) => b.fieldId === COUNT) ? logDropped
    : [...logDropped, { fieldId: COUNT, order: countShape?.order ?? 4, hidden: false, role: countShape?.role ?? "input" }];
  log(`  Meal Log becomes: ${logNext.map((b) => fn(b.fieldId)).join(", ")}`);

  const countField = fields.find((f) => f.id === COUNT);
  const targetNow = countField?.displayConfig?.targetValue;
  log(`  Meal Count target: ${JSON.stringify(targetNow)} -> 3 (targetOp left default \`>=\`, a floor to reach)`);

  if (dryRun) { log("  (dry run — nothing written)"); return; }
  await Operation.updateOne({ id: op.id, gridId }, { $set: { pipeline } });
  await Module.updateOne({ id: intakeMod.id, gridId },
    { $set: { label: "Liquid Intake", fieldBindings: intakeNext } });
  await Module.updateOne({ id: logMod.id, gridId }, { $set: { fieldBindings: logNext } });
  await Field.updateOne({ id: COUNT, gridId },
    { $set: { displayConfig: { ...(countField.displayConfig || {}), targetValue: 3 } } });
  log("  written — RESTART pm2 and reload.");
  log("  NOTE: `Last Meal` is now bound by nothing while `Meal History` still writes it — it will show in checkGrid's unused-field warning.");
}
