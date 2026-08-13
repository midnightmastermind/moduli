// server/migrations/0103-seed-boards-from-health-docs.mjs
//
// User, 2026-08-13: "take those new docs and use the info to replace the
// ingrediants, meals, and workouts in our boards. dont worry if that effects
// past schedules by making this migration."
//
// EVERY NUMBER HERE COMES OUT OF THE DOCS — nothing is invented, which matters
// because this is a nutrition plan someone will actually eat from.
//
// INGREDIENT MACROS ARE PER UNIT, DERIVED FROM THE SHOPPING TABLE. The doc lists
// a shopping AMOUNT and the macros for that whole amount (33 oz of chicken =
// 1,815 kcal), so storing those verbatim would make a meal that picks chicken
// inherit three days of it — the Ingredient field SUMS its picks onto the meal.
// Each row is therefore divided down to one sensible unit, and the unit is named
// in the label so the number is never ambiguous.
//
// MEALS CARRY NO MACROS, BY DESIGN. They bind Ingredient, and 0042's prefill
// already sums the picked ingredients' macros (and now vitamins) onto whatever
// logs them. Writing the doc's per-meal macros as well would create a second
// source of truth that silently disagrees the moment an ingredient changes.
//
// VITAMIN FIELDS ARE LEFT EMPTY. The docs list nutrients qualitatively ("Iron,
// Zinc, B Vitamins") with no amounts, and a plausible-looking vitamin number on
// a food you are tracking is indistinguishable from one you measured. Same rule
// 0052 applied to phone numbers and 0054 to addresses.
//
// REPLACE MEANS THE CATALOG ROW, NOT THE MODULE. Old board children have their
// OCCURRENCE removed and are unlinked from the board; their modules are left for
// `sweepOrphans` (which has its own age floor and refusals). Deleting a module
// outright would break any schedule copy still pointing at it — the user said not
// to worry about past schedules, and this is the version of "don't worry" that
// does not corrupt them.
import { randomUUID } from "node:crypto";

export const id = "0103-seed-boards-from-health-docs";
export const describe =
  "Replaces the Ingredients, Meals and Movements boards with the contents of the health plan docs.";

// ── from Nutrition Plan.md, shopping table divided to one unit ───────────────
export const INGREDIENTS = [
  { name: "Chicken Thighs (1 oz)",          cal: 55,  p: 6.9, c: 0,    f: 3.1 },
  { name: "Eggs (1 large)",                 cal: 70,  p: 6,   c: 0.5,  f: 5 },
  { name: "Greek Yogurt (1 cup)",           cal: 150, p: 20,  c: 10,   f: 3 },
  { name: "Whole Grain Tortilla (1)",       cal: 140, p: 4,   c: 20,   f: 3 },
  { name: "Granola (1/4 cup)",              cal: 120, p: 3,   c: 15,   f: 4 },
  { name: "Frozen Berries (1/2 cup)",       cal: 35,  p: 0,   c: 10,   f: 0 },
  { name: "Brown Rice (1/2 cup)",           cal: 150, p: 3,   c: 33,   f: 0.5 },
  { name: "Hummus (2 tbsp)",                cal: 60,  p: 2,   c: 6,    f: 4 },
  { name: "Peanuts (1/4 cup)",              cal: 213, p: 8,   c: 6,    f: 18 },
  { name: "Pecans (1/4 cup)",               cal: 250, p: 3,   c: 4,    f: 26 },
  { name: "Lettuce (1 cup)",                cal: 10,  p: 1,   c: 2,    f: 0 },
  { name: "Frozen Mixed Veggies (1/2 cup)", cal: 17,  p: 1,   c: 3.5,  f: 0 },
  { name: "Zucchini Peppers Onions (1/2 cup)", cal: 15, p: 0.5, c: 3.5, f: 0 },
  { name: "Apple (1 medium)",               cal: 95,  p: 1,   c: 25,   f: 0 },
  { name: "Protein Powder (1 scoop)",       cal: 150, p: 32,  c: 2,    f: 2 },
];

// ── the plan's own meals, each naming ingredients by the labels above ────────
export const MEALS = [
  { name: "Greek Yogurt Bowl", uses: ["Greek Yogurt (1 cup)", "Frozen Berries (1/2 cup)", "Granola (1/4 cup)"] },
  { name: "Peanuts & Apple", uses: ["Peanuts (1/4 cup)", "Apple (1 medium)"] },
  { name: "Mediterranean Chicken Wrap", uses: ["Whole Grain Tortilla (1)", "Chicken Thighs (1 oz)", "Lettuce (1 cup)", "Hummus (2 tbsp)", "Pecans (1/4 cup)"] },
  { name: "Hard-Boiled Eggs & Pecans", uses: ["Eggs (1 large)", "Pecans (1/4 cup)"] },
  { name: "Protein Shake", uses: ["Protein Powder (1 scoop)"] },
  { name: "Grilled Chicken & Roasted Veggies", uses: ["Chicken Thighs (1 oz)", "Frozen Mixed Veggies (1/2 cup)", "Brown Rice (1/2 cup)"] },
];

// ── from Fitness Plan.md: 3-day push / legs / pull, reps = the low end ───────
export const MOVEMENTS = [
  ["Barbell Bench Press", "chest", 6], ["Dumbbell Shoulder Press", "shoulders", 8],
  ["Incline Dumbbell Press", "chest", 8], ["Lateral Raises", "shoulders", 12],
  ["Tricep Dips", "arms", 8], ["Tricep Pushdowns", "arms", 12],
  ["Planks", "core", 1], ["Russian Twists", "core", 15],
  ["Barbell Squats", "legs", 6], ["Romanian Deadlifts", "legs", 8],
  ["Leg Press", "legs", 8], ["Walking Lunges", "legs", 12],
  ["Leg Curls", "legs", 12], ["Calf Raises", "legs", 15],
  ["Leg Raises", "core", 15], ["Bicycle Crunches", "core", 20],
  ["Deadlifts", "back", 5], ["Pull-Ups", "back", 6],
  ["Bent-Over Rows", "back", 8], ["Single-Arm Dumbbell Rows", "back", 8],
  ["Bicep Curls", "arms", 10], ["Hammer Curls", "arms", 12],
  ["Ab Rollouts", "core", 12], ["Side Planks", "core", 1],
];

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "?";
  const fid = (n, t) => fields.find((f) => f.name === n && (!t || f.type === t))?.id;

  const F = {
    boardCat: fid("Board Category"), cal: fid("Calories"), p: fid("Protein"),
    c: fid("Carbs"), f: fid("Fats"), ing: fid("Ingredient"), mg: fid("Muscle Group"),
    s1: fid("Set 1"), s2: fid("Set 2"), s3: fid("Set 3"),
  };
  const missing = Object.entries(F).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) { log(`REFUSING: missing field(s) ${missing.join(", ")}`); return; }

  const board = (label) => occs.find((o) => nameOf(o) === label);
  const boards = { Ingredients: board("Ingredients"), Meals: board("Meals"), Movements: board("Movements") };
  for (const [k, b] of Object.entries(boards)) {
    if (!b) { log(`REFUSING: no "${k}" board — nothing written.`); return; }
  }

  for (const [k, b] of Object.entries(boards)) {
    log(`${k}: ${(b.occurrences || []).length} existing -> ` +
      `${k === "Ingredients" ? INGREDIENTS.length : k === "Meals" ? MEALS.length : MOVEMENTS.length} from the docs`);
  }
  log(`vitamin fields are left EMPTY — the docs name nutrients but give no amounts`);

  if (dryRun) {
    log(`WOULD remove ${Object.values(boards).reduce((n, b) => n + (b.occurrences || []).length, 0)} ` +
      `catalog row(s) (modules left for sweepOrphans) and mint ` +
      `${INGREDIENTS.length + MEALS.length + MOVEMENTS.length} new one(s).`);
    return;
  }

  // 1. clear the catalogs — occurrence only, module left behind
  for (const b of Object.values(boards)) {
    for (const cid of b.occurrences || []) await Occurrence.deleteOne({ gridId, id: cid });
    await Occurrence.updateOne({ gridId, id: b.id }, { $set: { occurrences: [] } });
  }

  const userId = boards.Ingredients.userId;
  const mint = async (label, boardOcc, tag, bindings, values) => {
    const mId = randomUUID(), oId = randomUUID();
    await Module.create({ id: mId, gridId, userId, label, role: "instance",
      fieldBindings: bindings.map((f, i) => ({ fieldId: f, role: "input", hidden: false, order: i })) });
    await Occurrence.create({ id: oId, gridId, userId, moduleId: mId, targetId: mId,
      parentId: boardOcc.id, occurrences: [],
      fields: { [F.boardCat]: { value: [tag], flow: "in" }, ...values } });
    await Occurrence.updateOne({ gridId, id: boardOcc.id }, { $push: { occurrences: oId } });
    return oId;
  };

  // 2. ingredients first — meals reference them by id
  const ingId = new Map();
  const vitamins = fields.filter((f) => /^(Vitamin |Thiamin|Riboflavin|Niacin|Pantothenic|Biotin|Folate)/.test(f.name || ""));
  for (const i of INGREDIENTS) {
    const id = await mint(i.name, boards.Ingredients, "ingredient",
      [F.boardCat, F.cal, F.p, F.c, F.f, ...vitamins.map((v) => v.id)],
      { [F.cal]: { value: i.cal, flow: "in" }, [F.p]: { value: i.p, flow: "in" },
        [F.c]: { value: i.c, flow: "in" }, [F.f]: { value: i.f, flow: "in" } });
    ingId.set(i.name, id);
  }
  // 3. meals — Ingredient picks only; macros come from the prefill
  for (const m of MEALS) {
    const picks = m.uses.map((u) => ingId.get(u)).filter(Boolean);
    if (picks.length !== m.uses.length) log(`  NOTE: "${m.name}" references an unknown ingredient — kept the ones that resolved`);
    await mint(m.name, boards.Meals, "meal", [F.boardCat, F.ing],
      { [F.ing]: { value: picks, flow: "in" } });
  }
  // 4. movements
  for (const [name, group, reps] of MOVEMENTS) {
    await mint(name, boards.Movements, "movement", [F.boardCat, F.mg, F.s1, F.s2, F.s3],
      { [F.mg]: { value: group, flow: "replace" },
        [F.s1]: { value: reps, flow: "in" }, [F.s2]: { value: reps, flow: "in" },
        [F.s3]: { value: reps, flow: "in" } });
  }
  log(`seeded ${INGREDIENTS.length} ingredient(s), ${MEALS.length} meal(s), ${MOVEMENTS.length} movement(s).`);
}
