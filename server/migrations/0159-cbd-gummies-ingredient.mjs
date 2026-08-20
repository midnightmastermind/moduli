/**
 * 0159 — CBD Gummies, on the ingredients board and the grocery list.
 *
 * USER, 2026-08-20: *"and a grocery list item/ingrediant for CBD Gummies. 1 gummy is 10mg, 33 cal
 * and fat 2g and sodium 15mg, carbs 8g"*.
 *
 * THE ROW IS SHAPED BY COPYING A PLAN INGREDIENT, not by listing fields here. An ingredient on this
 * grid binds 30 fields — four macros, thirteen vitamins, seven minerals, Quantity, Total Needed,
 * Price, Poster and Files — and `0120`/`0123` are the record of what happens when a new row is
 * minted with a smaller set: *"'every X' in a migration means every X THAT EXISTS WHEN IT RUNS"*,
 * and the user's own question was **"why dont the new ones have price quantity and pictures"**.
 * Copying an existing row's module means this one cannot arrive short.
 *
 * TAGGED BOTH WAYS, because the ask names both: `["ingredient","grocery"]` is what puts it on the
 * Ingredients board AND the Grocery List, which are two feeds over the same tag field.
 *
 * WHAT THE USER GAVE IS WRITTEN VERBATIM: 33 kcal · 2g fat · 8g carbs · 15mg sodium, per ONE gummy,
 * and the serving size records exactly that — `1 gummy (10 mg CBD)`. **The 10mg is the CBD dose, not
 * a nutrient**, so it belongs in the serving size rather than in a nutrient field where the
 * micronutrient trackers would sum it into something meaningless.
 *
 * ONE VALUE IS DERIVED AND SAYS SO: **Protein 0**. The user listed calories, fat, carbs and sodium
 * and omitted protein, which on a gummy means none. It is written as a zero rather than left blank
 * for the reason `0123` gives — `Meal Nutrition` SUMS these, and a blank reads identically to "not
 * measured" for both the absent and the unknown case.
 *
 * EVERY OTHER VITAMIN AND MINERAL IS LEFT BLANK, deliberately. `0123` could write reference values
 * for whole foods because a food's content is a public, lookupable property. A CBD gummy is a
 * manufactured product that varies by brand, so those numbers would be invented — the trade `0120`
 * refused for Price and `0052` refused for phone numbers.
 *
 * NO PRICE, for the same reason, and the field is BOUND so there is somewhere to type it.
 * NO PICTURE HERE: `0121` already attaches one to any grocery+ingredient row whose Poster is empty,
 * probing the image route first and refusing if it is unreachable. Re-run that rather than write a
 * second copy of it.
 */
export const id = "0159-cbd-gummies-ingredient";
export const describe = "CBD Gummies as an ingredient and grocery-list item, with the user's own per-gummy nutrition.";

const LABEL = "CBD Gummies";
const SERVING = "1 gummy (10 mg CBD)";
// The user's own numbers, per ONE gummy. Protein is the single derived value.
const NUTRITION = { Calories: 33, Fats: 2, Carbs: 8, Protein: 0, Sodium: 15 };

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Field.find({ gridId }).lean(),
  ]);
  const mById = new Map(mods.map(m => [m.id, m]));
  const oById = new Map(occs.map(o => [o.id, o]));
  const lbl = (o) => o.label || mById.get(o.moduleId)?.label || "";
  const inp = (n) => fields.find(f => f.name === n && !f.displayEnabled);

  const bc = fields.find(f => f.name === "Board Category");
  if (!bc) { log("  REFUSING: no Board Category field"); return; }
  const tagsOf = (o) => { const v = o.fields?.[bc.id]?.value; return Array.isArray(v) ? v : v ? [v] : []; };
  const isSource = (o) => !o.meta?.feedSourceId && mById.get(o.moduleId)?.role === "instance";

  // THE HOME IS THE INGREDIENTS BOARD, RESOLVED BY ITS FEED, and the dry run is
  // why that is stated rather than taken from the exemplar's parent: picking the
  // widest-bound ingredient anywhere on the grid chose "Milk", which is one of
  // five ingredient-tagged rows homed under the GROCERY LIST rather than under
  // Ingredients. Following its parent would have filed CBD Gummies in the wrong
  // board while every log line still read correctly — the `0035` class, caught by
  // checking the dry run against a NAMED expectation instead of a count.
  //
  // Being tagged `grocery` is what puts it on the grocery list; that board is a
  // materialized feed, not a home.
  const board = occs.find(o => o.feed?.enabled &&
    (o.feed.conditions || []).some(c => c.fieldId === bc.id && c.value === "ingredient"));
  if (!board) { log("  REFUSING: no board feeding on the \"ingredient\" tag"); return; }

  // Among the rows homed THERE, copy the widest binding set, so a row minted from
  // it cannot be short of a field the others carry. The board holds both the
  // 2026-07-28 seed's 9-binding rows and the plan's 30-binding ones.
  const exemplar = occs
    .filter(o => isSource(o) && o.parentId === board.id && tagsOf(o).includes("ingredient"))
    .map(o => ({ o, n: (mById.get(o.moduleId)?.fieldBindings || []).length }))
    .sort((a, b) => b.n - a.n)[0]?.o;
  if (!exemplar) { log(`  REFUSING: no ingredient homed on "${lbl(board)}" to copy the shape from`); return; }
  const exMod = mById.get(exemplar.moduleId);

  const already = occs.find(o => isSource(o) && lbl(o) === LABEL);
  const missingFields = Object.keys(NUTRITION).filter(n => !inp(n));
  if (missingFields.length) { log(`  REFUSING: no input field named ${missingFields.join(", ")}`); return; }

  log(`  shape copied from "${lbl(exemplar)}" (${(exMod.fieldBindings || []).length} bindings) under "${lbl(board)}"`);
  log(`  "${LABEL}": ${already ? "already present" : "to create"}`);
  log(`  values: ${Object.entries(NUTRITION).map(([k, v]) => `${k}=${v}`).join(" · ")} · serving "${SERVING}"`);
  if (already) { log("  already converged"); return; }
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  const uid = () => Math.random().toString(36).slice(2, 14);
  const modId = uid(), occId = uid();
  const { _id, __v, createdAt, updatedAt, ...modShape } = exMod;
  await Module.create({
    ...modShape, id: modId, label: LABEL,
    fieldBindings: (exMod.fieldBindings || []).map(({ _id: _d, ...b }) => b),
    // `priceEstimated` belongs to the row it was copied from — this one has no
    // price at all, and carrying the flag would claim a number that is not there.
    meta: { ...(exMod.meta || {}), servingSize: SERVING, priceEstimated: undefined },
  });

  const qty = inp("Quantity");
  const flds = { [bc.id]: { value: ["ingredient", "grocery"], flow: "in" } };
  for (const [name, value] of Object.entries(NUTRITION)) flds[inp(name).id] = { value, flow: "in" };
  if (qty) flds[qty.id] = { value: 1, flow: "in", postfix: "count" };

  await Occurrence.create({
    id: occId, userId: exemplar.userId, gridId, moduleId: modId,
    parentId: board.id, occurrences: [], fields: flds,
    sortOrder: (exemplar.sortOrder ?? 0) + 1,
  });
  await Occurrence.updateOne({ id: board.id, gridId }, { $addToSet: { occurrences: occId } });
  log(`  created "${LABEL}" on "${lbl(board)}", tagged ingredient + grocery`);
  log("  next: re-run 0121 to attach a picture, then RESTART pm2 and reload.");
}
