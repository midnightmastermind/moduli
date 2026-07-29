// User-directed cleanup, 2026-07-29:
//   • "since i have Meal Nutrition tracker, i dont need the individual protein
//      carbs and fats"          → drop those three tiles and their tracker ops
//   • "the ones in meal nutrition should not have Total in the name"
//                               → Total Protein/Calories/Carbs/Fats → the bare
//                                 macro names. Safe because duplicate field
//                                 LABELS are allowed ("we can have duplicate
//                                 field labels but not the actual variable
//                                 name") — identity is the id.
//   • "we should get rid of workout program all together"
//   • "just call it Due"        → the "Due This Week" display field
//
// The seed stopped producing all of this in the same commit; this reaches the
// frozen grids.
export const id = "0004-nutrition-tiles-and-workout-program";
export const describe =
  "Renames the macro + Due display fields, deletes the standalone Protein/Carbs/Fats tiles and " +
  "their tracker ops, and removes Workout Program (field, board, bindings). DELETES the three " +
  "macro tiles and the Workout Programs board occurrences — their values are already summed on " +
  "Meal Nutrition, and no operation reads Workout Program.";

const RENAMES = [
  ["Total Protein", "Protein"],
  ["Total Calories", "Calories"],
  ["Total Carbs", "Carbs"],
  ["Total Fats", "Fats"],
  ["Due This Week", "Due"],
];

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Module, Occurrence, Operation } = models;

  // ── 1. Display-field renames ──────────────────────────────────────────────
  for (const [from, to] of RENAMES) {
    const f = await Field.findOne({ gridId, name: from }).lean();
    if (!f) { log(`"${from}" already renamed or absent`); continue; }
    log(`rename field "${from}" → "${to}"`);
    if (!dryRun) await Field.updateOne({ _id: f._id }, { $set: { name: to } });
  }

  // ── 2. The three per-macro tracker OPS ────────────────────────────────────
  // Meal Nutrition writes all four macros in one pass, so these wrote a second
  // copy of the same numbers onto a second set of tiles.
  const macroOps = await Operation.find({ gridId, name: { $in: ["Protein", "Carbs", "Fats"] } })
    .select({ id: 1, name: 1 }).lean();
  if (macroOps.length) {
    log(`delete ${macroOps.length} per-macro tracker op(s): ${macroOps.map(o => o.name).join(", ")}`);
    if (!dryRun) await Operation.deleteMany({ gridId, name: { $in: ["Protein", "Carbs", "Fats"] } });
  }

  // ── 3. The three standalone macro TILES ───────────────────────────────────
  // Matched by module label AND instance role so a container or board page of
  // the same name can never be caught.
  const tileMods = await Module.find({
    gridId, role: "instance", label: { $in: ["Protein", "Carbs", "Fats"] },
  }).select({ id: 1, label: 1 }).lean();
  const tileModIds = tileMods.map(m => m.id);
  if (tileModIds.length) {
    const tileOccs = await Occurrence.find({ gridId, moduleId: { $in: tileModIds } }).select({ id: 1 }).lean();
    const tileOccIds = tileOccs.map(o => o.id);
    log(`delete ${tileMods.length} macro tile module(s) + ${tileOccIds.length} occurrence(s)`);
    if (!dryRun) {
      await Occurrence.deleteMany({ gridId, id: { $in: tileOccIds } });
      await Module.deleteMany({ gridId, id: { $in: tileModIds } });
      // Unlink them from whatever container listed them.
      await Occurrence.updateMany({ gridId, occurrences: { $in: tileOccIds } },
        { $pull: { occurrences: { $in: tileOccIds } } });
    }
  }

  // ── 4. Workout Program — field, its board, and every binding ──────────────
  const wp = await Field.findOne({ gridId, name: "Workout Program" }).lean();
  if (!wp) { log("Workout Program field already gone"); }
  else {
    const bound = await Module.countDocuments({ gridId, "fieldBindings.fieldId": wp.id });
    const valued = await Occurrence.countDocuments({ gridId, [`fields.${wp.id}`]: { $exists: true } });
    log(`Workout Program: ${bound} module binding(s), ${valued} occurrence value(s)`);
    if (!dryRun) {
      await Module.updateMany({ gridId, "fieldBindings.fieldId": wp.id },
        { $pull: { fieldBindings: { fieldId: wp.id } } });
      await Occurrence.updateMany({ gridId, [`fields.${wp.id}`]: { $exists: true } },
        { $unset: { [`fields.${wp.id}`]: "" } });
      await Field.deleteOne({ _id: wp._id });
    }
  }

  // The Workout Programs BOARD page + its option occurrences.
  const boardMods = await Module.find({ gridId, label: "Workout Programs" }).select({ id: 1, role: 1 }).lean();
  if (boardMods.length) {
    const ids = boardMods.map(m => m.id);
    const occs = await Occurrence.find({ gridId, moduleId: { $in: ids } }).select({ id: 1 }).lean();
    const occIds = occs.map(o => o.id);
    // Everything parented under those occurrences (the program options).
    const kids = await Occurrence.find({ gridId, parentId: { $in: occIds } }).select({ id: 1 }).lean();
    const kidIds = kids.map(o => o.id);
    log(`delete Workout Programs board: ${ids.length} module(s), ${occIds.length} occurrence(s), ${kidIds.length} option(s)`);
    if (!dryRun) {
      await Occurrence.deleteMany({ gridId, id: { $in: [...occIds, ...kidIds] } });
      await Module.deleteMany({ gridId, id: { $in: ids } });
      await Occurrence.updateMany({ gridId, occurrences: { $in: [...occIds, ...kidIds] } },
        { $pull: { occurrences: { $in: [...occIds, ...kidIds] } } });
    }
  }
}
