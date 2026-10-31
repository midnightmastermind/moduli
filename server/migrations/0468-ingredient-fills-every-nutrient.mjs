// 0468 — picking an Ingredient fills EVERY nutrient the Eat row carries (user, 2026-10-31: "I also need all the
// other supplements to update with adding"). 0042's Ingredient prefill summed the 4 macros and later the 13
// vitamins; the Eat row also binds Magnesium, Iron, Zinc, Calcium, Omega-3, Sodium and Potassium, which no map
// row named, so they never moved when an ingredient was picked. Adds a `sum` row for every NUMBER field the
// rows that bind Ingredient also bind and the map leaves out (display fields excluded — those are the tiles).
export const id = "0468-ingredient-fills-every-nutrient";
export const describe = "The Ingredient pick also sums the minerals the Eat row carries.";
export const touches = ["fields"];

const INGREDIENT = "Ingredient";

/** Pure. The map with a sum row added for each candidate it lacks (in candidate order). */
export function withNutrientRows(map, candidateIds) {
  const list = Array.isArray(map) ? [...map] : [];
  const have = new Set(list.map((m) => m?.to || m?.from));
  for (const fid of candidateIds) if (!have.has(fid)) { list.push({ from: fid, combine: "sum" }); have.add(fid); }
  return list;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Module } = models;
  const ing = await Field.findOne({ gridId, name: INGREDIENT, type: "occurrence" }).lean();
  if (!ing?.meta?.prefill?.map) { log("  no Ingredient prefill — nothing to do"); return; }
  const fields = await Field.find({ gridId }).lean();
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  const mods = await Module.find({ gridId, "fieldBindings.fieldId": ing.id }).lean();
  const mapped = new Set(ing.meta.prefill.map.map((m) => m.to || m.from));
  const cand = [];
  for (const m of mods) for (const b of m.fieldBindings || []) {
    const f = byId[b.fieldId];
    if (!f || f.type !== "number" || f.displayEnabled || mapped.has(f.id) || cand.includes(f.id)) continue;
    cand.push(f.id);
  }
  const map = withNutrientRows(ing.meta.prefill.map, cand);
  log(`  ${INGREDIENT}: +${map.length - ing.meta.prefill.map.length} (${cand.map((id) => byId[id].name).join(", ") || "none"})`);
  if (!dryRun && map.length !== ing.meta.prefill.map.length) {
    await Field.updateOne({ gridId, id: ing.id }, { $set: { "meta.prefill.map": map, updatedAt: new Date() } });
    log("  applied. RESTART pm2.");
  }
}
