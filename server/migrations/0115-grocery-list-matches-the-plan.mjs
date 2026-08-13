// server/migrations/0115-grocery-list-matches-the-plan.mjs
//
// User, 2026-08-13: "the grocery list isnt updated to match the new
// ingrediants."
//
// Measured: every one of the 16 rows tagged `grocery` was created 2026-07-28 by
// the original seed, and **not one of the plan's 14 ingredients carried the tag
// at all**. `0103` replaced the Ingredients board without ever touching the
// grocery list.
//
// IT WRITES THE TAG, NOT THE BOARD. The option boards are FEED-BACKED
// materialized views (2026-07-25): "the tag is the source of truth and the board
// is the materialized view — an option tagged anywhere gets pulled in". Pushing
// rows into the board's `occurrences[]` would fight feedSync, which re-mints its
// copies on every sync — the very mistake `0114` had to repair. Tagging the
// SOURCE is the durable write.
//
// THE INGREDIENTS ARE DERIVED FROM THE MEALS, not listed here. The grocery list
// is "what the plan requires", so it is computed by walking the six plan meals'
// own `Ingredient` values. Add a meal or change one and re-running this picks
// the change up; a hardcoded list would be stale the first time the plan moves.
//
// ── WHAT IT RETIRES, AND WHY SO LITTLE ──────────────────────────────────────
// The old rows are NOT swept wholesale. Only an exact **prefix duplicate** of a
// plan ingredient loses the tag — "Eggs" against "Eggs (1 large)" — because
// those two sitting side by side on one list is the confusing part. Measured,
// that is 4 rows: Eggs · Greek Yogurt · Chicken Thighs · Frozen Berries.
//
// The other 12 (Milk, Bananas, Coffee Beans, Paper Towels, Rice, Spinach, Oats,
// Salmon, Olive Oil, Sweet Potatoes, Black Beans, Chicken Breast) are KEPT and
// reported. **They are not duplicates — they are staples and household items the
// plan simply does not mention, and a shopping list is exactly the place where
// deleting something the user meant to buy is worse than leaving one row too
// many.** Paper Towels is the tell: nothing about a nutrition plan implies it
// should go.
export const id = "0115-grocery-list-matches-the-plan";
export const describe =
  "The plan's ingredients join the grocery list; only exact duplicates of them leave it.";

export const GROCERY_TAG = "grocery";
export const MEAL_TAG = "meal";

const norm = (s) => String(s ?? "").trim().toLowerCase();
// "Eggs" supersedes "Eggs (1 large)" — the old row is the same item without its
// unit. Compared on a word boundary so "Rice" never matches "Brown Rice".
const isPrefixDuplicate = (oldName, planName) => {
  const o = norm(oldName), p = norm(planName);
  return p === o || p.startsWith(`${o} (`);
};

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const byId = new Map(occs.map((o) => [o.id, o]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "?";
  const fid = (n) => fields.find((f) => f.name === n && !f.displayEnabled)?.id;
  const TAG = fields.find((f) => f.name === "Board Category")?.id;
  const ING = fid("Ingredient");
  if (!TAG || !ING) { log(`REFUSING: missing Board Category / Ingredient field.`); return; }

  const tagsOf = (o) => { const v = o.fields?.[TAG]?.value; return Array.isArray(v) ? v : v ? [v] : []; };
  const isSource = (o) => !o.meta?.feedSourceId && modById.get(o.moduleId)?.role === "instance";

  // The plan's requirement, derived from the meals themselves.
  const meals = occs.filter((o) => isSource(o) && tagsOf(o).includes(MEAL_TAG));
  const need = new Map();
  for (const m of meals) {
    const v = m.fields?.[ING]?.value;
    for (const i of (Array.isArray(v) ? v : v ? [v] : [])) {
      const t = byId.get(i);
      if (t) need.set(t.id, t);
    }
  }
  if (!need.size) { log(`REFUSING: the plan's meals name no ingredients.`); return; }

  const adds = [...need.values()].filter((t) => !tagsOf(t).includes(GROCERY_TAG));
  const current = occs.filter((o) => isSource(o) && tagsOf(o).includes(GROCERY_TAG));
  const planNames = [...need.values()].map(nameOf);
  const drops = current.filter((o) =>
    !need.has(o.id) && planNames.some((p) => isPrefixDuplicate(nameOf(o), p)));
  const kept = current.filter((o) => !need.has(o.id) && !drops.includes(o));

  log(`${meals.length} plan meal(s) require ${need.size} distinct ingredient(s)`);
  log(`+ joining the grocery list (${adds.length}): ${adds.map(nameOf).join(", ")}`.slice(0, 400));
  log(`- superseded duplicates leaving it (${drops.length}): ${drops.map(nameOf).join(", ")}`);
  log(`  KEPT, not duplicates of anything in the plan (${kept.length}): ${kept.map(nameOf).join(", ")}`.slice(0, 400));
  if (!adds.length && !drops.length) { log(`grocery list already matches the plan.`); return; }
  if (dryRun) { log(`WOULD tag ${adds.length} and untag ${drops.length}.`); return; }

  for (const t of adds) {
    // Union into the existing tags — an ingredient is still an ingredient.
    const next = [...new Set([...tagsOf(t), GROCERY_TAG])];
    await Occurrence.updateOne({ gridId, id: t.id },
      { $set: { [`fields.${TAG}`]: { value: next, flow: "in" } } });
  }
  for (const o of drops) {
    const next = tagsOf(o).filter((t) => t !== GROCERY_TAG);
    await Occurrence.updateOne({ gridId, id: o.id },
      { $set: { [`fields.${TAG}`]: { value: next, flow: "in" } } });
  }
  log(`tagged ${adds.length}, untagged ${drops.length}.`);

  const after = await Occurrence.find({ gridId }).lean();
  const list = after.filter((o) => {
    const v = o.fields?.[TAG]?.value; const a = Array.isArray(v) ? v : v ? [v] : [];
    return a.includes(GROCERY_TAG) && !o.meta?.feedSourceId &&
      modById.get(o.moduleId)?.role === "instance";
  });
  log(`grocery list now ${list.length} item(s): ${list.map(nameOf).join(", ")}`.slice(0, 500));
}
