/**
 * 0146 — the Nutrition and Workout containers get their tiles, and the goals get targets.
 *
 * USER, 2026-08-19: *"make an intake tile for meals, meal count goal, and water goal, a vitamin
 * tile, a macros tile also for goals"*, *"the nutrition side should be the amount i need in a day"*,
 * *"for cals macros and vitamins"*, *"i want goals to hit each of those"*, *"and the correct amount
 * of water"*, *"and meal count"*, *"workouts and last workouts should be a thing still, last meal
 * should be a thing. we have a tile for workouts too thats the goals."*
 *
 * WHAT THE CENSUS CHANGED ABOUT THE JOB. `Workout` and `Nutrition` under `Today's Physical` are
 * not empty TILES — they are empty `role:container kind:board` CONTAINERS, which is why they bind
 * nothing and render nothing. Tiles go INSIDE them, which is the shape every other tracker already
 * uses. And the numbers are mostly computed already:
 *
 *     Total Calories / Protein / Carbs / Fats   written by `Meal Nutrition`   target: NONE
 *     Daily Water                               written by `Water`            target: NONE
 *     Meals / Last Meal                         written by `Meal History`     bound by NOTHING
 *     Workouts / Last Workout                   written by `Workout History`  bound by NOTHING
 *     every vitamin                             written by NOBODY
 *
 * **So this is mostly a BINDING and TARGET job, not a computation one** — six fields are being
 * calculated every load and displayed nowhere. That is the whole reason the goals read as missing.
 *
 * THE TARGETS ARE QUOTED FROM THE USER'S OWN DOCUMENTS, never derived.
 * `Nutrition Plan.md` -> *Daily Macros*: 2,900 kcal · 185-200 g protein · 150-180 g carbs ·
 * 100-120 g fats. `Basic Nutrition Guide.md` -> *Daily Nutrient & Hydration Needs*: 3-4 L water.
 *
 * TWO DECISIONS ARE STATED RATHER THAN HIDDEN:
 *
 *   1. **The two documents disagree** — the guide says 150-180 g protein and 70-120 g fats against
 *      the plan's 185-200 and 100-120. The PLAN's numbers are used, because the user asked for
 *      goals "set up with my meal plan" and the plan is the programme being followed.
 *   2. **A range is not a target.** A goal field holds one number, so the LOW end is used: hitting
 *      185 g satisfies "185-200". Over-range is not flagged; that would be a second rule.
 *
 * WATER IS CONVERTED, AND THE CONVERSION IS STATED. The guide says 3-4 LITRES; the grid records
 * `Daily Water` in OUNCES. 3 L = 101.4 oz, so the target is 101. Leaving it at "3" would have read
 * as three ounces and quietly made the goal trivial.
 *
 * NOT IN THIS MIGRATION, and deliberately — each needs an OPERATION that does not exist yet, and a
 * tile bound to a field nobody writes is worse than no tile:
 *   - **Meal count** (no field, nothing counts today's meals)
 *   - **Vitamin totals** (per-ingredient values exist; nothing sums a day of them)
 *   - **Per-workout completion**, `Workout 1..6` against the day's cycle template
 * They are specified in `docs/superpowers/plans/2026-08-19-tracker-overhaul.md`.
 */
export const id = "0146-nutrition-and-workout-goal-tiles";
export const describe = "Tiles inside the Nutrition and Workout containers, and daily targets on the goals.";

const NUTRITION_CONTAINER = "Tx30JDgxPwhU";
const WORKOUT_CONTAINER   = "x1UetCPiDPch";

// name -> target, quoted from the documents (see the header for which and why).
export const TARGETS = {
  "Total Calories": 2900,   // Nutrition Plan: ~2,900 kcal
  "Total Protein":  185,    // Nutrition Plan: ~185-200 g  (low end)
  "Total Carbs":    150,    // Nutrition Plan: ~150-180 g  (low end)
  "Total Fats":     100,    // Nutrition Plan: ~100-120 g  (low end)
  "Daily Water":    101,    // Basic Nutrition Guide: 3-4 L -> 3 L = 101.4 oz
};

const TILES = [
  { key: "macros", parent: NUTRITION_CONTAINER, label: "Macros",
    fields: ["Total Calories", "Total Protein", "Total Carbs", "Total Fats"] },
  { key: "intake", parent: NUTRITION_CONTAINER, label: "Intake",
    fields: ["Daily Water", "Meals", "Last Meal"] },
  { key: "workoutgoals", parent: WORKOUT_CONTAINER, label: "Workout Goals",
    fields: ["Total Workouts", "Workouts", "Last Workout"] },
];

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Field.find({ gridId }).lean(),
  ]);
  const byId = new Map(occs.map(o => [o.id, o]));
  const modById = new Map(mods.map(m => [m.id, m]));

  // A DISPLAY field, resolved by name — this grid carries duplicate field NAMES
  // across the input/display split, and binding the input twin would show a
  // control where a computed number belongs.
  const disp = (n) => fields.find(f => f.name === n && f.displayEnabled);
  const missing = [...new Set([...Object.keys(TARGETS), ...TILES.flatMap(t => t.fields)])]
    .filter(n => !disp(n));
  if (missing.length) { log(`  REFUSING: no display field named ${missing.join(", ")}`); return; }

  for (const c of [NUTRITION_CONTAINER, WORKOUT_CONTAINER]) {
    if (!byId.get(c)) { log(`  REFUSING: container ${c} is not on this grid`); return; }
  }

  // ---- targets -----------------------------------------------------------
  const targetPlan = [];
  for (const [name, value] of Object.entries(TARGETS)) {
    const f = disp(name);
    const now = f.displayConfig?.targetValue ?? null;
    if (Number(now) === value) continue;                 // already converged
    targetPlan.push({ f, name, from: now, value });
  }
  targetPlan.forEach(t => log(`  target  ${t.name.padEnd(16)} ${t.from ?? "none"} -> ${t.value}`));

  // ---- tiles -------------------------------------------------------------
  const tilePlan = [];
  for (const t of TILES) {
    const parent = byId.get(t.parent);
    const existing = (parent.occurrences || [])
      .map(id => byId.get(id)).filter(Boolean)
      .find(o => modById.get(o.moduleId)?.label === t.label);
    if (existing) { log(`  tile "${t.label}" already in "${modById.get(parent.moduleId)?.label}" — skipping`); continue; }
    tilePlan.push({ ...t, parentOcc: parent });
    log(`  tile    "${t.label}" -> "${modById.get(parent.moduleId)?.label}"  binds ${t.fields.join(", ")}`);
  }

  if (!targetPlan.length && !tilePlan.length) { log("  nothing to do — already converged"); return; }
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  for (const t of targetPlan) {
    await Field.updateOne({ id: t.f.id, gridId },
      { $set: { "displayConfig.targetValue": t.value } });
  }

  const uid = () => Math.random().toString(36).slice(2, 14);
  for (const t of tilePlan) {
    const moduleId = uid(), occId = uid();
    await Module.create({
      id: moduleId, gridId, userId: t.parentOcc.userId, label: t.label, role: "instance",
      // Bound in the order listed: binding order IS render order (2026-08-13).
      fieldBindings: t.fields.map((n, i) => ({ fieldId: disp(n).id, order: i, role: "display" })),
      meta: {},
    });
    await Occurrence.create({
      id: occId, gridId, userId: t.parentOcc.userId, moduleId,
      parentId: t.parentOcc.id, fields: {}, occurrences: [],
    });
    // LIST it as well as parent it — a parent renders `occurrences[]`, and a
    // child that is only parented is the listed-but-not-embedded class this
    // repo has repaired from five directions.
    await Occurrence.updateOne({ id: t.parentOcc.id, gridId },
      { $push: { occurrences: occId } });
    log(`  created "${t.label}"  module=${moduleId} occurrence=${occId}`);
  }
  log(`  done — ${targetPlan.length} target(s), ${tilePlan.length} tile(s)`);
  log("  RESTART pm2 and reload the tab before judging it (warm cache).");
}
