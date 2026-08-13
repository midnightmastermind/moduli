// server/migrations/0120-grocery-list-is-the-plan-only.mjs
//
// User, 2026-08-13: "why are the old ingredients in the grocery list and why
// dont the new ones have price quantity and pictures" … "price, quantity, and
// pictures".
//
// ── THE OLD INGREDIENTS ARE THERE BECAUSE I LEFT THEM ────────────────────────
// `0115` retired only EXACT prefix duplicates ("Eggs" vs "Eggs (1 large)") and
// deliberately kept eleven more as "staples the plan does not mention". That was
// my call and it was the wrong one: the grocery list is meant to be the plan's
// shopping list, and Chicken Breast · Rice · Spinach · Oats · Salmon · Olive Oil
// · Sweet Potatoes · Black Beans · Milk · Bananas · Coffee Beans are the OLD
// seed's ingredient set, superseded wholesale by the plan's.
//
// **`Paper Towels` STAYS**, and that is not an oversight: it is the one row
// tagged `grocery` and NOT `ingredient`. The user objected to "the old
// ingredients"; a household item is not one, and it is the only thing on the
// list that could not be re-derived if it were wrong to remove.
//
// ── WHY THE NEW ONES HAD NO PRICE / QUANTITY ────────────────────────────────
// The fields exist — `Quantity` and `Price` were added to every ingredient by an
// earlier commit — but that work bound them to the modules that existed THEN
// (the 2026-07-28 seed's). `0103` minted the plan's ingredients afterwards from
// the health docs, binding only Board Category, the macros and the vitamins. So
// the fields were real and the new rows simply had no control for them. Same for
// `Poster`/`Files`, which is what a picture is.
//
// ── QUANTITY IS DERIVED, PRICE IS DELIBERATELY LEFT EMPTY ───────────────────
// Quantity = **how many servings of that ingredient the plan eats per day**,
// computed by walking `MEALS_BY_SLOT` (which meal at which time) against each
// meal's own ingredient list. Peanuts & Apple is eaten twice a day, so Peanuts
// is 2; Pecans appear in two different meals, so it is 2 as well. That is a fact
// about the plan, not a guess.
//
// **Price is left EMPTY on purpose.** Nothing on this grid or in the plan docs
// knows what anything costs, and a plausible-looking price in a shopping list is
// indistinguishable from one the user entered and will be trusted — the rule
// `0052` set for phone numbers and `0054` for addresses. The field is BOUND so
// there is somewhere to type it; the number is the user's to supply.
import { MEALS_BY_SLOT } from "./0104-four-day-cycle-templates.mjs";

export const id = "0120-grocery-list-is-the-plan-only";
export const describe =
  "The grocery list is the plan's ingredients; they gain Poster, Files, Quantity and a derived Quantity value.";

export const KEEP_NON_INGREDIENT = true;
const norm = (s) => String(s ?? "").trim().toLowerCase();

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
  const ING = fid("Ingredient"), QTY = fid("Quantity"), PRICE = fid("Price");
  const POSTER = fid("Poster"), FILES = fid("Files");
  for (const [n, v] of [["Board Category", TAG], ["Ingredient", ING], ["Quantity", QTY],
    ["Price", PRICE], ["Poster", POSTER], ["Files", FILES]]) {
    if (!v) { log(`REFUSING: no field "${n}".`); return; }
  }

  const tagsOf = (o) => { const v = o.fields?.[TAG]?.value; return Array.isArray(v) ? v : v ? [v] : []; };
  const isSource = (o) => !o.meta?.feedSourceId && modById.get(o.moduleId)?.role === "instance";

  // What the plan requires, and how often per day, from the meals themselves.
  const meals = occs.filter((o) => isSource(o) && tagsOf(o).includes("meal"));
  const mealByName = new Map(meals.map((m) => [norm(nameOf(m)), m]));
  const perDay = new Map();      // ingredient occ id -> servings/day
  for (const [, mealName] of MEALS_BY_SLOT) {
    const meal = mealByName.get(norm(mealName));
    if (!meal) { log(`  REFUSING meal "${mealName}" — not a source meal`); continue; }
    const v = meal.fields?.[ING]?.value;
    for (const i of (Array.isArray(v) ? v : v ? [v] : [])) {
      if (byId.get(i)) perDay.set(i, (perDay.get(i) || 0) + 1);
    }
  }
  if (!perDay.size) { log(`REFUSING: the plan's meals name no ingredients.`); return; }

  // The list as it stands.
  const current = occs.filter((o) => isSource(o) && tagsOf(o).includes("grocery"));
  const drops = current.filter((o) => !perDay.has(o.id) && tagsOf(o).includes("ingredient"));
  const kept = current.filter((o) => !perDay.has(o.id) && !drops.includes(o));

  // The plan's ingredients: what they are missing.
  const plan = [...perDay.keys()].map((i) => byId.get(i)).filter(Boolean);
  const bindNeeded = [], qtyNeeded = [];
  for (const p of plan) {
    const m = modById.get(p.moduleId);
    const has = (f) => (m?.fieldBindings || []).some((b) => b.fieldId === f);
    const missing = [POSTER, FILES, QTY, PRICE].filter((f) => !has(f));
    if (missing.length) bindNeeded.push({ occ: p, mod: m, missing });
    const want = perDay.get(p.id);
    const cur = p.fields?.[QTY]?.value;
    if (cur === null || cur === undefined || cur === "") qtyNeeded.push({ occ: p, value: want });
  }

  log(`plan needs ${plan.length} ingredient(s)`);
  log(`- old ingredient rows leaving the grocery list (${drops.length}): ${drops.map(nameOf).join(", ")}`);
  log(`  KEPT, tagged grocery but not an ingredient (${kept.length}): ${kept.map(nameOf).join(", ")}`);
  log(`+ modules gaining Poster/Files/Quantity/Price: ${bindNeeded.length}`);
  log(`+ Quantity (servings per day, derived from the meal plan):`);
  for (const q of qtyNeeded) log(`     ${nameOf(q.occ).padEnd(30)} ${q.value}/day`);
  log(`  Price is left EMPTY — nothing here knows a price, and inventing one is worse than a blank.`);
  if (dryRun) { log(`WOULD untag ${drops.length}, bind ${bindNeeded.length}, set ${qtyNeeded.length} quantities.`); return; }

  for (const o of drops) {
    await Occurrence.updateOne({ gridId, id: o.id },
      { $set: { [`fields.${TAG}`]: { value: tagsOf(o).filter((t) => t !== "grocery"), flow: "in" } } });
  }
  for (const b of bindNeeded) {
    const next = [...(b.mod?.fieldBindings || [])];
    // Poster and Files first — a picture reads before the numbers.
    const order = [POSTER, FILES, QTY, PRICE].filter((f) => b.missing.includes(f));
    for (const f of order) next.push({ fieldId: f, role: "input", hidden: false });
    await Module.updateOne({ gridId, id: b.mod.id }, { $set: { fieldBindings: next } });
  }
  for (const q of qtyNeeded) {
    await Occurrence.updateOne({ gridId, id: q.occ.id },
      { $set: { [`fields.${QTY}`]: { value: q.value, flow: "in" } } });
  }
  log(`untagged ${drops.length}, bound ${bindNeeded.length} module(s), set ${qtyNeeded.length} quantity value(s).`);
}
