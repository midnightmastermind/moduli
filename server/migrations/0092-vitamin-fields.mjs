// server/migrations/0092-vitamin-fields.mjs
//
// User, 2026-08-12: "could you also add in fields for all the necessary vitamins
// before i forget. and add those to the ingrediants field."
//
// THE THIRTEEN ESSENTIAL VITAMINS — the ones a human body cannot make in
// sufficient quantity and must take in. Not a curated favourites list: the four
// fat-soluble (A, D, E, K) and the nine water-soluble (C and the eight B
// vitamins). Units and increments follow nutrition labelling, so a value typed
// here matches what is printed on a packet.
//
// THE SHAPE IS COPIED FROM THE MACROS RATHER THAN INVENTED. Calories/Protein/
// Carbs/Fats are `type:"number"`, input-enabled, display OFF, with
// `meta.{postfix,increment,flow:"in"}` and a nutrition category folder — so the
// vitamins are the same in every respect except their units. Reading the
// exemplar at use time is how 0054's copied-shape defect was avoided.
//
// "ADD THOSE TO THE INGREDIENT FIELD" IS THREE WIRINGS, NOT ONE, and missing any
// one of them leaves the feature looking done and doing nothing:
//
//   1. every INGREDIENT binds them   — or there is nowhere to type a value;
//   2. every EAT target binds them   — `planPrefill` fills ONLY fields the
//      target module ALREADY binds (helpers/prefillFromPick), so without this
//      the sum is computed and then dropped on the floor;
//   3. the Ingredient field's `prefill.map` gains one `sum` row per vitamin —
//      the same shape 0042 used for the macros.
//
// The Meal field already chains one hop to Ingredient (`chain: 1`), so picking a
// meal fills its ingredients and, through them, the vitamins — no change needed
// there, and that is exactly the composition 0042 designed for.
//
// NOTHING IS OVERWRITTEN and every step is skip-if-present, so a re-run is a
// no-op and a half-applied run heals itself.

import { randomUUID } from "node:crypto";

/** The 13 essential vitamins, with labelling units. */
export const VITAMINS = [
  { name: "Vitamin A",         postfix: " mcg", increment: 50 },
  { name: "Vitamin C",         postfix: " mg",  increment: 5 },
  { name: "Vitamin D",         postfix: " mcg", increment: 1 },
  { name: "Vitamin E",         postfix: " mg",  increment: 1 },
  { name: "Vitamin K",         postfix: " mcg", increment: 5 },
  { name: "Thiamin",           postfix: " mg",  increment: 0.1 },
  { name: "Riboflavin",        postfix: " mg",  increment: 0.1 },
  { name: "Niacin",            postfix: " mg",  increment: 1 },
  { name: "Pantothenic Acid",  postfix: " mg",  increment: 0.5 },
  { name: "Vitamin B6",        postfix: " mg",  increment: 0.1 },
  { name: "Biotin",            postfix: " mcg", increment: 5 },
  { name: "Folate",            postfix: " mcg", increment: 20 },
  { name: "Vitamin B12",       postfix: " mcg", increment: 0.5 },
];

export const id = "0092-vitamin-fields";
export const describe =
  "The 13 essential vitamins as fields on every ingredient, summed onto a meal through the Ingredient picker.";

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Module, Occurrence } = models;
  const [fields, mods, occs] = await Promise.all([
    Field.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Occurrence.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const byName = new Map(fields.map((f) => [String(f.name).toLowerCase(), f]));

  // The exemplar decides the shape — read at use time, never hardcoded.
  const exemplar = fields.find((f) => f.name === "Protein" && f.type === "number" && !f.displayEnabled);
  const ingredientField = fields.find((f) => f.name === "Ingredient" && f.type === "occurrence");
  if (!exemplar || !ingredientField) {
    log(`REFUSING: exemplar(Protein)=${!!exemplar} Ingredient=${!!ingredientField} — nothing written.`);
    return;
  }
  log(`shape copied from "${exemplar.name}": folder=${exemplar.folderId || "—"} ` +
    `input=${exemplar.inputEnabled} display=${exemplar.displayEnabled}`);

  // Who must carry them.
  const board = occs.find((o) => (o.label ?? modById.get(o.moduleId)?.label) === "Ingredients");
  const ingredientMods = [...new Set((board?.occurrences || [])
    .map((cid) => occs.find((o) => o.id === cid)?.moduleId).filter(Boolean))]
    .map((mid) => modById.get(mid)).filter(Boolean);
  // An Eat target is any module already binding BOTH the picker and the macros —
  // derived, so a renamed or duplicated Eat is covered without naming it.
  const macroIds = ["Calories", "Protein", "Carbs", "Fats"]
    .map((n) => byName.get(n.toLowerCase())?.id).filter(Boolean);
  const eatMods = mods.filter((m) => {
    const ids = (m.fieldBindings || []).map((b) => b.fieldId);
    return ids.includes(ingredientField.id) && macroIds.every((mid) => ids.includes(mid));
  });

  const missing = VITAMINS.filter((v) => !byName.has(v.name.toLowerCase()));
  const existing = VITAMINS.length - missing.length;
  log(`vitamins: ${missing.length} to create, ${existing} already present`);
  log(`ingredient modules to bind: ${ingredientMods.length} (${ingredientMods.map((m) => m.label).join(", ")})`);
  log(`meal-log targets to bind  : ${eatMods.length} (${[...new Set(eatMods.map((m) => m.label))].join(", ")})`);
  log(`prefill rows on "Ingredient": ${(ingredientField.meta?.prefill?.map || []).length} -> ` +
    `${(ingredientField.meta?.prefill?.map || []).length + missing.length + existing}`);

  if (!ingredientMods.length || !eatMods.length) {
    log(`REFUSING: nothing to bind to (ingredients=${ingredientMods.length} targets=${eatMods.length}).`);
    return;
  }

  if (dryRun) {
    log(`WOULD create ${missing.length} field(s), bind all 13 to ${ingredientMods.length} ingredient(s) ` +
      `and ${eatMods.length} target(s), and add a sum row per vitamin to the Ingredient prefill.`);
    return;
  }

  // 1. the fields
  const idOf = new Map();
  for (const v of VITAMINS) {
    const found = byName.get(v.name.toLowerCase());
    if (found) { idOf.set(v.name, found.id); continue; }
    // The schema requires the app's OWN id — Mongo's _id is not it, and
    // omitting it fails validation on the first create (it did).
    const doc = await Field.create({
      id: randomUUID(), gridId, userId: exemplar.userId, name: v.name, type: "number",
      inputEnabled: true, displayEnabled: false,
      folderId: exemplar.folderId || null,
      meta: { postfix: v.postfix, increment: v.increment, flow: "in" },
    });
    idOf.set(v.name, doc.id);
  }

  // 2. the bindings — appended, never replacing what a module already declares
  // VISIBLE ON AN INGREDIENT, HIDDEN ON THE LOG — the one judgement call here.
  // An ingredient is where a value is TYPED, so hiding it there would leave the
  // field unreachable (the macros are `hidden: false` on Milk for exactly that
  // reason, and the shape is copied from them). On an Eat row the value is
  // COMPUTED by prefill and read by trackers, and 13 extra pills would swamp a
  // row that already shows four — so they are bound hidden there. Both are one
  // toggle to reverse, per module or via the fieldVisibility cascade.
  const bindTo = async (m, hidden) => {
    const have = new Set((m.fieldBindings || []).map((b) => b.fieldId));
    const add = VITAMINS.map((v) => idOf.get(v.name)).filter((fid) => fid && !have.has(fid));
    if (!add.length) return 0;
    const order0 = (m.fieldBindings || []).length;
    const next = [...(m.fieldBindings || []),
      ...add.map((fid, i) => ({ fieldId: fid, role: "input", hidden, order: order0 + i }))];
    await Module.updateOne({ gridId, id: m.id }, { $set: { fieldBindings: next } });
    return add.length;
  };
  let bound = 0;
  for (const m of ingredientMods) bound += await bindTo(m, false);
  for (const m of eatMods) bound += await bindTo(m, true);

  // 3. the prefill rows
  const prefill = ingredientField.meta?.prefill || { enabled: true, chain: 0, map: [] };
  const have = new Set((prefill.map || []).map((r) => r.from));
  const rows = VITAMINS.map((v) => idOf.get(v.name))
    .filter((fid) => fid && !have.has(fid))
    .map((fid) => ({ from: fid, combine: "sum" }));
  await Field.updateOne({ gridId, id: ingredientField.id }, {
    $set: { "meta.prefill": { ...prefill, enabled: true, map: [...(prefill.map || []), ...rows] } },
  });

  log(`created ${missing.length} vitamin field(s), added ${bound} binding(s), ${rows.length} prefill row(s).`);
}
