/**
 * 0169 — the meals move INSIDE "Day 1-3", which was an empty box above them.
 *
 * User, with a screenshot: *"there is an empty container up top that says day 1-3. i assume the meals
 * should be in this container"* — and, asked whether to re-parent, re-level the source and re-import,
 * or delete it: ***"relevel"***.
 *
 * **WHY IT WAS EMPTY, and the importer was not wrong.** `Day 1-3 (Same Meals for Simplicity)` is an
 * **H3** while the eight meals after it are **H2** — the meals are SHALLOWER, so by ordinary markdown
 * nesting each one CLOSES the day section and becomes its sibling. The importer nested a
 * strangely-levelled source faithfully. That is why this is a re-levelling rather than a bug fix, and
 * why it needed the user's call rather than a guess.
 * ```
 *   Meal Plan with Recipes & Macros   (doc)
 *      Day 1-3 …          H3   0 children   <- the empty box
 *      Breakfast (7 AM) … H2   1 child
 *      … seven more meals H2
 * ```
 *
 * **A DOC RENDERS ITS TEXTMAP, NOT ITS CHILD LIST — so moving the children is only half of it.**
 * `Meal Plan`'s textmap is nine `moduleEmbed` nodes; the meals appear on screen because they are
 * EMBEDDED there, not because they are listed. Re-parenting alone would leave eight sections present
 * in the data and invisible on screen — the listed-but-not-embedded class this repo has repaired from
 * five directions (2026-08-01 (19) is the sharpest, where scrubbing a "dangling" embed removed the
 * only thing rendering a surviving sibling). So the EMBEDS move too, and `Day 1-3`'s own empty
 * paragraph is replaced by them.
 *
 * **`Dinner (5 PM)` IS NOT A SECOND INSTANCE, and checking that is why it is named here.** It reports
 * zero children, which looked like the same defect — but its content lives in its OWN textmap, which
 * a raw Mongo read returns COMPRESSED (a base64 string), so a naive scan reads it as empty. Nothing
 * to fix. *A count of children is not a measure of whether a doc has content.*
 *
 * **TEXTMAPS ARE WRITTEN BACK COMPRESSED**, the way `update_occurrence` stores them, and read through
 * `decompressTextmap` because this grid holds BOTH shapes — `Meal Plan`'s came back as an object and
 * `Dinner`'s as a string. Assuming either one would have corrupted the other.
 */
import { compressTextmap, decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0169-relevel-the-meal-plan";
export const describe =
  "Nests the eight meal sections inside 'Day 1-3' — heading levels AND the textmap embeds, not just the child list.";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean() ]);
  const mById = new Map(mods.map((m) => [m.id, m]));
  const oById = new Map(occs.map((o) => [o.id, o]));
  const lbl = (o) => o?.label || mById.get(o?.moduleId)?.label || "(untitled)";

  const parent = occs.find((o) => String(lbl(o)) === "Meal Plan with Recipes & Macros");
  const day = occs.find((o) => /^Day 1-3/.test(String(lbl(o))));
  if (!parent || !day) { log("  REFUSING: could not find the Meal Plan section or the Day 1-3 container"); return; }

  const tm = decompressTextmap(parent.textmap) || { type: "doc", content: [] };
  const nodes = tm.content || [];
  const dayNode = nodes.find((n) => n.type === "moduleEmbed" && n.attrs?.occurrenceId === day.id);
  const mealNodes = nodes.filter((n) => n.type === "moduleEmbed" && n.attrs?.occurrenceId !== day.id);
  const others = nodes.filter((n) => n.type !== "moduleEmbed");

  if (!dayNode) { log("  REFUSING: Day 1-3 is not embedded in the Meal Plan — nothing to nest into"); return; }
  if (!mealNodes.length) { log("  already converged (no sibling meals left to move)"); return; }

  const mealIds = mealNodes.map((n) => n.attrs.occurrenceId).filter((id) => oById.has(id));
  log(`  "${lbl(parent)}" holds ${nodes.length} embed(s): Day 1-3 + ${mealNodes.length} meal(s)`);
  for (const id of mealIds) log(`     ${lbl(oById.get(id))}  H${mById.get(oById.get(id).moduleId)?.meta?.headingLevel ?? "-"} -> H3`);
  log(`  "${lbl(day)}" H${mById.get(day.moduleId)?.meta?.headingLevel ?? "-"} -> H2, and gains all ${mealIds.length} as children AND embeds`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  // 1. levels — the day becomes the SHALLOWER heading so the meals read as its sections
  await Module.updateOne({ id: day.moduleId, gridId }, { $set: { "meta.headingLevel": 2 } });
  for (const id of mealIds) {
    const m = oById.get(id);
    if (m?.moduleId) await Module.updateOne({ id: m.moduleId, gridId }, { $set: { "meta.headingLevel": 3 } });
  }

  // 2. the embeds move — this is what actually puts them on screen
  await Occurrence.updateOne({ id: parent.id, gridId }, {
    $set: { textmap: compressTextmap({ ...tm, content: [...others, dayNode] }) },
  });
  await Occurrence.updateOne({ id: day.id, gridId }, {
    $set: { textmap: compressTextmap({ type: "doc", content: mealNodes }) },
  });

  // 3. and the structure follows, so ancestry/cascade/delete agree with the render
  await Occurrence.updateOne({ id: day.id, gridId }, { $set: { occurrences: mealIds } });
  await Occurrence.updateOne({ id: parent.id, gridId },
    { $pull: { occurrences: { $in: mealIds } } });
  await Occurrence.updateMany({ gridId, id: { $in: mealIds } }, { $set: { parentId: day.id } });

  log(`  nested ${mealIds.length} meal(s) under "${lbl(day)}" — RESTART pm2 and reload.`);
}
