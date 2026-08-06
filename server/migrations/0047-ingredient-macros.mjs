// server/migrations/0047-ingredient-macros.mjs
//
// Give the ingredients their nutrition, so the prefill wired by 0042 has
// something to carry.
//
// 0042 configured `Ingredient → the four macros (sum)` and `Meal → Ingredient
// (union, chain 1)`. Both hops work. Measured on poms grid, they fill NOTHING:
//
//   15 real ingredients · 0 carrying a protein value · 6 meals all naming
//   ingredients
//
// …because prefill never overwrites with empty, by design. The missing piece was
// never code — it is the data.
//
// TWO PROBLEMS, and only one of them is obvious. The values are the visible
// half. The other is that **an ingredient module does not BIND the macro fields
// at all** (measured: "Chicken Breast" binds boardCategory and two others, none
// of them a macro), so there is no control to type a calorie count into. Stamping
// values without binding would leave numbers that only an operation could see.
// This does both.
//
// THE MACROS WRITTEN ARE THE INPUT FIELDS, NEVER THEIR DISPLAY TWINS. This grid
// has two fields called "Protein" — one you type into, one a tracker sums into.
// They share a name and mean opposite things, so the discriminator is
// `displayEnabled`, exactly as 0042 does. Matching by name alone would write a
// day's total onto an ingredient.
//
// FEED COPIES ARE NEVER TOUCHED. Every ingredient is mirrored onto boards as a
// copy carrying `meta.feedSourceId`; feedSync re-mints those from the source, so
// writing to one is writing to something that will be overwritten. Same rule the
// board dropdowns use.
//
// NEVER OVERWRITES. A macro already present on an ingredient is the user's, and
// this refuses to replace it — the migration can be re-run after new ingredients
// are added and it will only fill the blanks.
export const id = "0047-ingredient-macros";
export const describe =
  "Bind the four macro INPUT fields on every ingredient module and stamp standard per-serving " +
  "nutrition on ingredients that have none. Overwrites nothing, touches no feed copies.";

const TAG = "ingredient";

// Standard per-serving values. Serving sizes are the ones the labels imply — a
// medium banana, a large egg, a cup of cooked rice — because a meal that names
// "Eggs" means eggs, not 100g of egg.
export const MACROS = {
  "Chicken Breast":  { serving: "100g cooked",  calories: 165, protein: 31,   carbs: 0,  fats: 3.6 },
  "Chicken Thighs":  { serving: "100g cooked",  calories: 209, protein: 26,   carbs: 0,  fats: 10.9 },
  "Salmon":          { serving: "100g cooked",  calories: 208, protein: 20,   carbs: 0,  fats: 13 },
  "Eggs":            { serving: "1 large",      calories: 72,  protein: 6.3,  carbs: 0.4, fats: 4.8 },
  "Greek Yogurt":    { serving: "170g nonfat",  calories: 100, protein: 17,   carbs: 6,  fats: 0.7 },
  "Milk":            { serving: "1 cup, 2%",    calories: 122, protein: 8,    carbs: 12, fats: 4.8 },
  "Rice":            { serving: "1 cup cooked", calories: 206, protein: 4.3,  carbs: 45, fats: 0.4 },
  "Oats":            { serving: "40g dry",      calories: 150, protein: 5,    carbs: 27, fats: 3 },
  "Sweet Potatoes":  { serving: "130g baked",   calories: 112, protein: 2,    carbs: 26, fats: 0.1 },
  "Black Beans":     { serving: "1/2 cup",      calories: 114, protein: 7.6,  carbs: 20, fats: 0.5 },
  "Spinach":         { serving: "100g raw",     calories: 23,  protein: 2.9,  carbs: 3.6, fats: 0.4 },
  "Bananas":         { serving: "1 medium",     calories: 105, protein: 1.3,  carbs: 27, fats: 0.4 },
  "Frozen Berries":  { serving: "100g",         calories: 50,  protein: 0.7,  carbs: 12, fats: 0.3 },
  "Olive Oil":       { serving: "1 tbsp",       calories: 119, protein: 0,    carbs: 0,  fats: 13.5 },
  "Coffee Beans":    { serving: "1 cup brewed", calories: 2,   protein: 0.3,  carbs: 0,  fats: 0 },
};

const KEYS = ["calories", "protein", "carbs", "fats"];

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;

  // The INPUT half of each macro pair. `displayEnabled` is the discriminator —
  // see the header.
  const fieldIds = {};
  for (const key of KEYS) {
    const all = await Field.find({ gridId, name: new RegExp(`^${key}$`, "i") }).lean();
    const input = all.find((f) => !f.displayEnabled);
    if (!input) { log(`no INPUT field named "${key}" (${all.length} named that) — refusing to guess`); return; }
    fieldIds[key] = input.id;
  }
  log(`macro INPUT fields: ${KEYS.map((k) => `${k}=${fieldIds[k]}`).join(" ")}`);

  const boardCategory = await Field.findOne({ gridId, name: /^board category$/i }).lean();
  if (!boardCategory) { log("no 'Board Category' field — this grid does not use the board pattern"); return; }

  const tagged = await Occurrence.find({ gridId, [`fields.${boardCategory.id}.value`]: TAG }).lean();
  const mods = await Module.find({ gridId, id: { $in: tagged.map((o) => o.moduleId) } }).lean();
  const modById = new Map(mods.map((m) => [m.id, m]));

  const real = tagged.filter((o) => modById.get(o.moduleId)?.role === "instance" && !o.meta?.feedSourceId);
  const copies = tagged.filter((o) => o.meta?.feedSourceId);
  log(`ingredients: ${real.length} real, ${copies.length} feed copies (never touched)`);

  // Report against a NAMED expectation, not a count — the rule 0035 was written
  // in blood for. An ingredient this migration has no data for is named, not
  // silently skipped.
  const unknown = real.filter((o) => !MACROS[modById.get(o.moduleId)?.label]);
  if (unknown.length) {
    log(`NO nutrition data for ${unknown.length}: ${unknown.map((o) => modById.get(o.moduleId)?.label).join(", ")}`);
  }

  const plan = [];
  for (const occ of real) {
    const label = modById.get(occ.moduleId)?.label;
    const data = MACROS[label];
    if (!data) continue;
    const missing = KEYS.filter((k) => occ.fields?.[fieldIds[k]]?.value == null);
    const needsBinding = KEYS.filter((k) =>
      !(modById.get(occ.moduleId)?.fieldBindings || []).some((b) => b.fieldId === fieldIds[k]));
    if (missing.length || needsBinding.length) {
      plan.push({ occ, label, data, missing, needsBinding, moduleId: occ.moduleId });
    }
  }

  log(`will bind macros on ${plan.filter((p) => p.needsBinding.length).length} module(s)`);
  log(`will stamp values on ${plan.filter((p) => p.missing.length).length} ingredient(s)`);
  for (const p of plan.slice(0, 4)) {
    log(`  ${p.label} (${p.data.serving}): ${p.data.calories}cal ${p.data.protein}p ${p.data.carbs}c ${p.data.fats}f` +
        `${p.missing.length < KEYS.length ? `  [only ${p.missing.join("/")} — the rest are already set]` : ""}`);
  }
  if (plan.length > 4) log(`  … +${plan.length - 4} more`);
  if (!plan.length) { log("every ingredient already has its macros — nothing to do"); return; }

  if (dryRun) { log("dry run — no writes"); return; }

  let bound = 0, stamped = 0;
  for (const p of plan) {
    if (p.needsBinding.length) {
      const mod = modById.get(p.moduleId);
      const order = (mod.fieldBindings || []).length;
      const add = p.needsBinding.map((k, i) => ({ fieldId: fieldIds[k], role: "input", order: order + i }));
      await Module.updateOne({ gridId, id: p.moduleId }, { $push: { fieldBindings: { $each: add } } });
      bound++;
    }
    if (p.missing.length) {
      const $set = {};
      // Only the MISSING ones — a macro already there is the user's.
      for (const k of p.missing) $set[`fields.${fieldIds[k]}`] = { value: p.data[k], flow: "in" };
      await Occurrence.updateOne({ gridId, id: p.occ.id }, { $set });
      stamped++;
    }
  }
  log(`bound macros on ${bound} module(s), stamped ${stamped} ingredient(s)`);
  log("Eat now prefills from an ingredient directly, and from a meal one hop further");
}
