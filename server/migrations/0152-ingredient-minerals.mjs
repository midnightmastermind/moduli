/**
 * 0152 — the seven minerals the nutrition guide targets but the grid could not record.
 *
 * USER, 2026-08-19, asked which of the guide's targets to track: **all of them.**
 *
 * `Basic Nutrition Guide.md` gives a daily target for eleven nutrients. Four —
 * Vitamin A, C, D and B12 — already have fields and per-ingredient values from
 * `0123`. The other seven had a TARGET and nowhere to put a reading:
 * Magnesium · Iron · Zinc · Calcium · Omega-3 · Sodium · Potassium.
 *
 * ── WHERE THESE NUMBERS COME FROM, STATED PLAINLY ───────────────────────────
 * **Not from the user's documents**, exactly as `0123` records for the vitamins.
 * `Nutrition Plan.md` lists "Key Vitamins & Nutrients" per item QUALITATIVELY
 * ("Iron, Zinc, B Vitamins"); the guide gives daily targets, not per-ingredient
 * content. These are **standard reference values for the stated serving**, of
 * the kind a nutrition database publishes — accurate to the magnitude a food log
 * needs, and not a substitute for reading a label.
 *
 * That is the same line `0120` drew at **Price** and refused to cross: a food's
 * mineral content is a property OF THE FOOD, stable and public, whereas a price
 * is a fact about a shop on a day. One can be looked up; the other would have
 * been invented.
 *
 * ── PER SERVING, MATCHING THE MACROS AND THE VITAMINS ───────────────────────
 * Every value is for the serving in `meta.servingSize` (`0122`) — the same basis
 * the Calories/Protein/Carbs/Fats and the `0123` vitamins on that row already
 * use. A row whose serving changes needs all of them rescaled together.
 *
 * ── ZERO MEANS ZERO; EMPTY WOULD MEAN UNKNOWN ───────────────────────────────
 * Pecans carry no sodium, so that is written as `0` rather than left blank —
 * `0123`'s rule, for the same reason: a day's total has to distinguish "contains
 * none" from "never measured", and a blank reads as nothing-to-add for both.
 *
 * ── SCOPE ───────────────────────────────────────────────────────────────────
 * The FOURTEEN ingredients the meal plan uses — identified structurally as the
 * rows that already carry `0123`'s vitamin data, so this cannot drift from that
 * set. The older seed staples (Milk, Bananas, Coffee Beans …) carry no vitamin
 * data either and are left alone rather than half-filled.
 */
export const id = "0152-ingredient-minerals";
export const describe = "Seven mineral fields the guide targets, with per-serving reference values on the plan's 14 ingredients.";

export const MINERALS = [
  { name: "Magnesium", unit: "mg" },
  { name: "Iron",      unit: "mg" },
  { name: "Zinc",      unit: "mg" },
  { name: "Calcium",   unit: "mg" },
  { name: "Omega-3",   unit: "mg" },
  { name: "Sodium",    unit: "mg" },
  { name: "Potassium", unit: "mg" },
];

// name -> [Magnesium, Iron, Zinc, Calcium, Omega-3, Sodium, Potassium], per the
// serving each row stores. Reference values; see the header.
export const PER_SERVING = {
  "Chicken Thighs":        [  7, 0.3, 0.5,   3,   10,  25,   65],   // 1 oz
  "Eggs":                  [  6, 0.9, 0.6,  28,   37,  71,   69],   // 1 large
  "Greek Yogurt":          [ 22, 0.2, 1.5, 250,    0,  85,  290],   // 1 cup
  "Whole Grain Tortilla":  [ 24, 1.4, 0.6,  45,    0, 300,   90],   // 1 count
  "Granola":               [100, 2.6, 2.4,  60,   90,  30,  330],   // 1 cup
  "Frozen Berries":        [ 18, 0.8, 0.4,  20,   60,   2,  115],   // 1 cup
  "Brown Rice":            [ 84, 1.0, 1.2,  20,   27,  10,  174],   // 1 cup
  "Hummus":                [  6, 0.2, 0.2,   6,   15,  57,   27],   // 1 tbsp
  "Peanuts":               [245, 2.6, 4.8, 130,    4,   8, 1030],   // 1 cup
  "Pecans":                [132, 2.7, 4.9,  76, 1100,   0,  446],   // 1 cup
  "Lettuce":               [  5, 0.3, 0.1,  13,   32,   5,   78],   // 1 cup
  "Frozen Mixed Veggies":  [ 26, 1.1, 0.5,  42,   30,  50,  250],   // 1 cup
  "Apple":                 [  9, 0.2, 0.1,  11,   12,   2,  195],   // 1 medium
  "Protein Powder":        [ 25, 0.5, 1.0, 120,    0,  60,  180],   // 1 scoop
};

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map(m => [m.id, m]));
  const nameOf = (o) => o.label || modById.get(o.moduleId)?.label || "?";

  const VITA = fields.find(f => f.name === "Vitamin A" && !f.displayEnabled);
  if (!VITA) { log("  REFUSING: no Vitamin A field — 0123 has not run"); return; }
  // The plan's ingredients ARE the rows 0123 filled. Deriving the set that way
  // means this can never cover a different fourteen than the vitamins do.
  // FEED COPIES ARE EXCLUDED. The Ingredients board is a materialized view, so
  // its children are `feedSync` copies that are re-minted on the next sync —
  // "a tag written on a copy is a write to something about to be overwritten"
  // (CLAUDE.md 2026-08-10). The first run of this counted 24 rows where the
  // plan has 14; the difference was exactly those copies.
  const all = occs.filter(o => o.fields?.[VITA.id]?.value !== undefined);
  const targets = all.filter(o => !o.meta?.feedSourceId);
  log(`  rows carrying 0123's vitamin data: ${all.length} · sources (not feed copies): ${targets.length}`);
  const unknown = [...new Set(targets.map(nameOf))].filter(n => !PER_SERVING[n]);
  if (unknown.length) {
    log(`  REFUSING: no reference values for ${unknown.join(", ")} — half-filling a food log is worse than not filling it`);
    return;
  }

  const missingFields = MINERALS.filter(m => !fields.find(f => f.name === m.name));
  log(`  fields: ${MINERALS.length - missingFields.length} present, ${missingFields.length} to create`);
  let writes = 0;
  for (const o of targets) for (const m of MINERALS) {
    const f = fields.find(x => x.name === m.name);
    if (f && o.fields?.[f.id]?.value !== undefined) continue;  // already filled
    writes++;
  }
  log(`  values to write: ${writes} (${targets.length} ingredients x ${MINERALS.length} minerals, minus any already set)`);
  if (!missingFields.length && !writes) { log("  already converged"); return; }
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  const uid = () => Math.random().toString(36).slice(2, 14);
  const fid = {};
  for (const m of MINERALS) {
    const have = fields.find(f => f.name === m.name);
    if (have) { fid[m.name] = have.id; continue; }
    const id2 = uid();
    await Field.create({ id: id2, gridId, userId: targets[0].userId, name: m.name, type: "number",
      unit: m.unit, inputEnabled: true, displayEnabled: false, meta: {} });
    fid[m.name] = id2;
    log(`  created field "${m.name}" (${m.unit})`);
  }

  // Bind them wherever Vitamin A is bound, so a mineral appears on exactly the
  // rows a vitamin does rather than on a set chosen separately.
  const binders = mods.filter(m => (m.fieldBindings || []).some(b => b.fieldId === VITA.id));
  for (const mod of binders) {
    const bound = new Set((mod.fieldBindings || []).map(b => b.fieldId));
    const add = MINERALS.filter(m => !bound.has(fid[m.name]));
    if (!add.length) continue;
    let order = (mod.fieldBindings || []).length;
    await Module.updateOne({ id: mod.id, gridId }, { $push: { fieldBindings: {
      $each: add.map(m => ({ fieldId: fid[m.name], order: order++, role: "input", hidden: true })) } } });
  }
  log(`  bound the minerals on ${binders.length} module(s) that already bind Vitamin A`);

  let n = 0;
  for (const o of targets) {
    const row = PER_SERVING[nameOf(o)];
    const set = {};
    MINERALS.forEach((m, i) => {
      if (o.fields?.[fid[m.name]]?.value !== undefined) return;
      set[`fields.${fid[m.name]}`] = { value: row[i], flow: "in" };
      n++;
    });
    if (Object.keys(set).length) await Occurrence.updateOne({ id: o.id, gridId }, { $set: set });
  }
  log(`  wrote ${n} mineral value(s) across ${targets.length} ingredient(s)`);
}
