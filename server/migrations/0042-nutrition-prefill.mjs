// server/migrations/0042-nutrition-prefill.mjs
//
// Turns on the first real prefill (helpers/prefillFromPick, 2026-08-06):
//
//   pick an INGREDIENT on Eat  → its macros land on Eat (summed over the picks)
//   pick a MEAL on Eat         → the meal's ingredients land in the Ingredient
//                                dropdown, and one hop further their macros sum
//
// Both are configured as DATA on the two dropdown fields; nothing in the code
// knows what "nutrition" means.
//
// Measured on poms grid before writing:
//   - `Ingredient` (occurrence, multi) and `Meal` (occurrence) both exist
//   - Eat binds Meal, Ingredient, Calories, Protein, Carbs, Fats — and prefill
//     only fills fields the target ALREADY binds, so all four macros qualify
//   - 6 meals already name their ingredients (Chicken and Rice → Chicken Breast,
//     Rice), so the Meal → Ingredient hop works on day one
//   - **0 ingredient occurrences carry macro values yet.** Until nutrition is
//     entered on an ingredient once, the macro half fills nothing — by design:
//     prefill never overwrites with empty.
//
// The macros written are the INPUT fields, never their display twins. A tracker
// summing the day's protein and a prefill summing a meal's protein are different
// numbers; the unique-name rule keeps them apart and this must not undo it.
export const id = "0042-nutrition-prefill";
export const describe =
  "Configure prefill: picking an Ingredient brings its macros onto Eat; picking a Meal brings its " +
  "ingredients and, one hop further, their summed macros.";

const MACROS = ["Protein", "Calories", "Carbs", "Fats"];

/** Pure: the prefill config for the ingredient dropdown. Exported for tests. */
export function ingredientPrefill(macroIds) {
  return {
    enabled: true,
    chain: 0,
    map: macroIds.map((fid) => ({ from: fid, combine: "sum" })),
  };
}

/** Pure: the meal dropdown fills the ingredient dropdown, then lets IT keep going. */
export function mealPrefill(ingredientFieldId) {
  return {
    enabled: true,
    chain: 1,
    map: [{ from: ingredientFieldId, combine: "union" }],
  };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Field } = models;

  const all = await Field.find({ gridId }).lean();
  const pick = (name, pred = () => true) =>
    all.find((f) => (f.name || "").toLowerCase() === name.toLowerCase() && pred(f));

  // The INPUT macro fields — the display twins carry the same names, so
  // discriminate on `displayEnabled` rather than trusting the first match.
  const macroIds = [];
  for (const name of MACROS) {
    const f = pick(name, (x) => x.type === "number" && !x.displayEnabled);
    if (!f) { log(`no INPUT field named "${name}" — refusing to guess`); return; }
    macroIds.push(f.id);
  }
  const ingredient = pick("Ingredient", (f) => f.type === "occurrence");
  const meal = pick("Meal", (f) => f.type === "occurrence");
  if (!ingredient) { log("no Ingredient occurrence field — nothing to configure"); return; }

  log(`macros: ${macroIds.join(", ")}`);
  log(`ingredient field: ${ingredient.id}${meal ? `, meal field: ${meal.id}` : " (no Meal field)"}`);

  const write = async (field, prefill, what) => {
    const current = JSON.stringify(field.meta?.prefill || null);
    if (current === JSON.stringify(prefill)) { log(`${what}: already configured`); return; }
    log(`${what}: ${prefill.map.length} field(s), chain ${prefill.chain}`);
    if (!dryRun) {
      await Field.updateOne({ gridId, id: field.id }, { $set: { "meta.prefill": prefill } });
    }
  };

  await write(ingredient, ingredientPrefill(macroIds), "Ingredient → macros");
  if (meal) await write(meal, mealPrefill(ingredient.id), "Meal → ingredients (+1 hop)");

  log(dryRun ? "(dry run — no writes)" : "done");
}
