// 0231 — the grocery macros get a basis, and it is IN THE FIELD NAME.
//
// User's call, 2026-08-24, asked rather than guessed: *"Add per-100g fields"*.
//
// ── WHY THIS COULD NOT JUST BE MAPPED ONTO `Calories` ──────────────────────
//
// Open Food Facts answers **per 100g**. The Ingredients board's `Calories` /
// `Protein` / `Carbs` / `Fats` describe **A SERVING** — 2026-08-13 (7) settled
// that in the user's own words: *"keep ingrediants at the quantity of what it
// needs for a meal. so half cup for brown rice."*
//
// Mapping one onto the other is the vitamin-D mistake again, and that one is
// worth restating because it survived for months precisely by looking fine:
// a target written in IU while every stored value was mcg meant a fully-met
// day read as 2.5% of goal, and **nothing errored and no number looked absurd**.
// A grocery whose per-100g calories were written into a per-serving field would
// read exactly the same way.
//
// So the basis is in the NAME, which is the rule `0123` already set for this
// board. Four new fields, beside the four that exist.
//
// ── THE EXISTING 28 INGREDIENT ROWS ARE NOT BOUND TO THEM, DELIBERATELY ────
//
// Binding would put four EMPTY pills on every ingredient the user already
// curated, to hold values nothing has fetched. A row picked from the provider
// binds them on the way in — `createOptionUnderParent` binds what it writes,
//*"a value with no binding is stored and renders nowhere"* — so the fields
// appear exactly where there is something to show.
//
// ── AND `Purchase Item` IS LEFT UNMAPPED, though it shares the provider ────
//
// A purchase is a thing you bought; its per-100g protein is not a fact anyone
// wants on a receipt. Same provider, different question.

const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

export const id = "0231-per-100g-macros";
export const description = "Four per-100g macro fields, and the Ingredient map that fills them";

/** our field name -> [type, unit]. The BASIS is in the name on purpose. */
export const NEW_FIELDS = [
  ["Calories per 100g", "number", "kcal"],
  ["Protein per 100g", "number", "g"],
  ["Carbs per 100g", "number", "g"],
  ["Fats per 100g", "number", "g"],
];

/** provider key -> our field name.
 *  `Fat per 100g` is SINGULAR on the provider and plural on this grid; the map
 *  is what absorbs that, which is the whole reason a map is authored per field
 *  rather than matched by name. */
export const KEY_TO_FIELD = {
  "Calories per 100g": "Calories per 100g",
  "Protein per 100g": "Protein per 100g",
  "Carbs per 100g": "Carbs per 100g",
  "Fat per 100g": "Fats per 100g",
};

/** PURE. What is missing on a grid that already has `have` (a Set of names). */
export function fieldsToMint(have) {
  return NEW_FIELDS.filter(([name]) => !have.has(name));
}

/** PURE. provider key -> field id, given the resolved fields by name. */
export function buildFieldMap(fieldsByName) {
  const map = {}, missing = [];
  for (const [key, name] of Object.entries(KEY_TO_FIELD)) {
    const f = fieldsByName.get(name);
    if (!f) { missing.push(name); continue; }
    map[key] = f.id;
  }
  return { map, missing };
}

export async function up({ models, gridId, dryRun, log }) {
  const { Field } = models;
  const gid = String(gridId);
  const fields = await Field.find({ gridId: gid }).lean();
  const byName = new Map(fields.map((f) => [f.name, f]));

  const target = byName.get("Ingredient");
  if (!target) { log("no \"Ingredient\" field on this grid — nothing to do"); return { minted: 0 }; }
  const cfg = target.meta?.optionsSource?.searchProvider;
  if (cfg?.provider !== "openfoodfacts") {
    log(`  "Ingredient" carries ${cfg?.provider || "no provider"}, not openfoodfacts — skipped`);
    return { minted: 0 };
  }

  const mint = fieldsToMint(new Set(fields.map((f) => f.name)));
  log(`fields to mint: ${mint.map((f) => f[0]).join(", ") || "(none — all present)"}`);
  if (Object.keys(cfg.fieldMap || {}).length) log("  ! \"Ingredient\" already carries a map — it will be REPLACED");

  if (dryRun) {
    // Report the map it WOULD write, resolving what exists and naming what does
    // not — a plan whose targets are all "(new)" says nothing about a re-run.
    const preview = Object.entries(KEY_TO_FIELD)
      .map(([k, n]) => `${k}->${byName.get(n)?.id || "(new)"}`).join(", ");
    log(`  would author "Ingredient": ${preview}`);
    return { minted: mint.length };
  }

  const userId = fields[0]?.userId;
  for (const [name, type, unit] of mint) {
    await Field.create({ id: uid(), userId, gridId: gid, name, type,
      role: "input", inputEnabled: true, meta: { unit } });
    log(`  minted field "${name}" [${type}] unit=${unit}`);
  }

  const fresh = await Field.find({ gridId: gid }).lean();
  const { map, missing } = buildFieldMap(new Map(fresh.map((f) => [f.name, f])));
  if (missing.length) throw new Error(`0231: fields missing after mint: ${missing.join(", ")}`);
  await Field.updateOne({ id: target.id, gridId: gid },
    { $set: { "meta.optionsSource.searchProvider.fieldMap": map } });
  log(`authored "Ingredient": ${Object.entries(map).map(([k, v]) => `${k}->${v}`).join(", ")}`);
  return { minted: mint.length, mapped: Object.keys(map).length };
}
