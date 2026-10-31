// 0469 — ingredients take their nutrition from USDA, scale by Grams, and toggle onto the Grocery List
// (user, 2026-10-31). Decisions, all the user's:
//   - the search fills BOTH sets: "<Nutrient> per 100g" (reference) and the plain nutrient fields Eat adds up
//     ("id like both. prefill 100g but if i change it, it scales"), scaled by a NEW Grams field (Quantity is a
//     count — 26 of its 27 values are 1 — and stays one). Empty Grams = 100.
//   - the source is USDA FoodData Central (Open Food Facts answered "spinach" with a creamed-spinach brand and
//     zeros nobody entered).
//   - "ingredients to have an operation to add to grocery list": the Grocery List is a FEED of rows whose
//     Board Category contains `grocery`, so a button toggles that tag on the row.
//   - onCreate and onAdd are one event; the one stray onCreate trigger becomes onAdd.
// Writes: fields (per-100g micronutrients, Grams, a button), module bindings on ingredient rows, the Ingredient
// field's search, three operations.
import { randomUUID } from "node:crypto";
export const id = "0469-ingredients-usda-grams-grocery";
export const describe = "Ingredients: USDA search fills per-100g + scaled values, Grams field, grocery-list toggle.";
export const touches = ["fields", "modules", "operations"];

const BOARD_CATEGORY = "uew6sn6WWXin";
const INGREDIENT_FIELD = "Ingredient";
const INGREDIENTS_BOARD = "0JBLJFaWRmAc";
const GROCERY_BOARD = "R3JMi7J7omzO";
// USDA key label (minus " per 100g") -> the plain field's name, when they differ.
const BASE_NAME = { Fat: "Fats" };
const PER100_NAME = { Fat: "Fats per 100g" }; // the field 0042's era already made under this name
const USDA_LABELS = ["Calories", "Protein", "Carbs", "Fat", "Vitamin A", "Vitamin C", "Vitamin D", "Vitamin E",
  "Vitamin K", "Thiamin", "Riboflavin", "Niacin", "Pantothenic Acid", "Vitamin B6", "Biotin", "Folate", "Vitamin B12",
  "Calcium", "Iron", "Magnesium", "Potassium", "Sodium", "Zinc", "Omega-3"];
const USDA_UNIT = { Calories: "kcal", Protein: "g", Carbs: "g", Fat: "g", "Vitamin A": "mcg", "Vitamin D": "mcg",
  "Vitamin K": "mcg", Biotin: "mcg", Folate: "mcg", "Vitamin B12": "mcg" }; // the rest: mg

let n = 0;
const sid = (p) => `${p}${++n}`;
const step = (config) => ({ id: sid("ig"), type: "action", config });
const ifStep = (rules, then, els = []) => ({ id: sid("ig"), type: "if", condition: { operator: "AND", rules: rules.map((r) => ({ id: sid("r"), ...r })) }, then, else: els });

/** Pure: the scaling pipeline for [{ per, base }] pairs and the Grams field. */
export function scalePipeline(pairs, gramsId) {
  const steps = [
    step({ type: "FIND", predicate: { operator: "AND", rules: [{ id: sid("r"), left: "id", comparator: "IS", right: "$trigger.occurrenceId" }] }, itemVar: "$item" }),
    step({ type: "INIT_VAR", name: "$g", expr: `$item.fields.${gramsId}.value` }),
    ifStep([{ left: "$g", comparator: "IS_EMPTY", right: "" }], [step({ type: "SET_VAR", name: "$g", expr: "100" })]),
    step({ type: "INIT_VAR", name: "$v", value: 0 }),
  ];
  for (const { per, base } of pairs) {
    steps.push(ifStep([{ left: `$item.fields.${per}.value`, comparator: "IS_NOT_EMPTY", right: "" }], [
      step({ type: "SET_VAR", name: "$v", expr: `$item.fields.${per}.value` }),
      step({ type: "MULTIPLY_VAR", name: "$v", expr: "$g" }),
      step({ type: "DIV_VAR", name: "$v", by: "100" }),
      step({ type: "UPDATE", path: `$item.fields.${base}.value`, value: "$v" }),
    ]));
  }
  return { sources: [], steps };
}

/** Pure: the grocery toggle pipeline. */
export function groceryTogglePipeline() {
  return { sources: [], steps: [
    step({ type: "FIND", predicate: { operator: "AND", rules: [{ id: sid("r"), left: "id", comparator: "IS", right: "$trigger.occurrenceId" }] }, itemVar: "$item" }),
    step({ type: "INIT_VAR", name: "$tags", expr: `$item.fields.${BOARD_CATEGORY}.value` }),
    ifStep([{ left: "$tags", comparator: "ARRAY_INCLUDES", right: "grocery" }],
      [step({ type: "REMOVE_FROM_VAR", name: "$tags", value: "literal:grocery" })],
      [step({ type: "PUSH_TO_VAR", name: "$tags", expr: "literal:grocery" })]),
    step({ type: "UPDATE", path: `$item.fields.${BOARD_CATEGORY}.value`, value: "$tags" }),
  ] };
}

const tagsOf = (o) => { const c = o.fields?.[BOARD_CATEGORY]; const v = c && typeof c === "object" && "value" in c ? c.value : c; return Array.isArray(v) ? v : v ? [v] : []; };

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Module, Occurrence, Operation, Grid } = models;
  const grid = await Grid.findById(gridId).lean();
  const userId = String(grid.userId);
  const fields = await Field.find({ gridId }).lean();
  const byName = (name) => fields.find((f) => f.name === name && !f.displayEnabled && !f.trashed);
  const ing = fields.find((f) => f.name === INGREDIENT_FIELD && f.type === "occurrence");
  if (!ing) throw new Error("no Ingredient field");
  const nutrientCat = byName("Calories")?.folderId || null;

  // 1. fields
  const created = [];
  const mint = (doc) => { const f = { id: randomUUID(), userId, gridId, inputEnabled: true, displayEnabled: false, ...doc }; created.push(f); fields.push(f); return f; };
  const pairs = [], fieldMap = {};
  for (const label of USDA_LABELS) {
    const base = byName(BASE_NAME[label] || label);
    if (!base) { log(`  skip ${label}: no "${BASE_NAME[label] || label}" field`); continue; }
    const unit = USDA_UNIT[label] || "mg";
    if (base.meta?.unit && base.meta.unit !== unit) throw new Error(`${base.name} is in ${base.meta.unit}, USDA gives ${unit}`);
    const perName = PER100_NAME[label] || `${label} per 100g`;
    const per = byName(perName) || mint({ name: perName, type: "number", folderId: base.folderId || nutrientCat, meta: { unit } });
    pairs.push({ per: per.id, base: base.id });
    fieldMap[`${label} per 100g`] = per.id;
  }
  const grams = byName("Grams") || mint({ name: "Grams", type: "number", folderId: nutrientCat, meta: { unit: "g", placeholder: "100" } });
  const button = fields.find((f) => f.type === "button" && f.name === "Grocery List")
    || mint({ name: "Grocery List", type: "button", folderId: nutrientCat, meta: { buttonLabel: "Grocery list" } });

  // 2. bindings on ingredient rows (tagged `ingredient`, not feed copies)
  const occs = await Occurrence.find({ gridId, [`fields.${BOARD_CATEGORY}`]: { $exists: true }, "meta.feedSourceId": { $exists: false } }).lean();
  const ingRows = occs.filter((o) => tagsOf(o).includes("ingredient"));
  const modIds = [...new Set(ingRows.map((o) => o.moduleId))];
  const mods = await Module.find({ gridId, id: { $in: modIds } }).lean();
  const bindPlan = [];
  for (const m of mods) {
    const have = new Set((m.fieldBindings || []).map((b) => b.fieldId));
    const add = [];
    const push = (fieldId, hidden) => { if (!have.has(fieldId)) { add.push({ fieldId, role: "input", hidden }); have.add(fieldId); } };
    push(grams.id, false);
    push(button.id, false);
    for (const p of pairs) { push(p.per, true); push(p.base, true); }
    if (add.length) bindPlan.push({ m, add });
  }

  // 3. operations
  const ops = await Operation.find({ gridId }).lean();
  const opCat = ops.find((o) => o.name === "Meal Nutrition")?.folderId || null;
  const scaleName = "Ingredients: Scale to Grams", toggleName = "Ingredients: Toggle Grocery List";
  const scaleTriggers = [
    { eventType: "onChange", subjectType: "field", targetId: grams.id, priority: 3 },
    ...pairs.map((p) => ({ eventType: "onChange", subjectType: "field", targetId: p.per, priority: 3 })),
    { eventType: "onAdd", subjectType: "module", subjectRole: "instance", targetId: "", ancestorId: INGREDIENTS_BOARD, priority: 3 },
    { eventType: "onAdd", subjectType: "module", subjectRole: "instance", targetId: "", ancestorId: GROCERY_BOARD, priority: 3 },
  ];
  const onCreateOps = ops.filter((o) => (o.triggerObjects || []).some((t) => t.eventType === "onCreate"));

  log(`  fields new: ${created.map((f) => f.name).join(", ") || "none"}`);
  log(`  pairs: ${pairs.length} · ingredient rows ${ingRows.length} on ${mods.length} modules · bindings to add on ${bindPlan.length} modules`);
  log(`  Ingredient search: ${ing.meta?.optionsSource?.searchProvider?.provider} -> usda (${Object.keys(fieldMap).length} keys)`);
  log(`  ops: ${scaleName} (${scaleTriggers.length} triggers), ${toggleName}; onCreate -> onAdd on ${onCreateOps.map((o) => o.name).join(", ") || "none"}`);
  if (dryRun) return;

  const now = new Date();
  if (created.length) await Field.insertMany(created.map((f) => ({ ...f, createdAt: now, updatedAt: now })));
  for (const { m, add } of bindPlan) {
    const base = m.fieldBindings || [];
    const next = [...base, ...add.map((b, i) => ({ ...b, order: base.length + i }))];
    await Module.updateOne({ gridId, id: m.id }, { $set: { fieldBindings: next, updatedAt: now } });
  }
  await Field.updateOne({ gridId, id: ing.id }, { $set: {
    "meta.optionsSource.searchProvider": { ...(ing.meta?.optionsSource?.searchProvider || {}), enabled: true, provider: "usda", fieldMap },
    updatedAt: now } });
  const upsertOp = async (name, description, pipeline, triggerObjects) => {
    const types = [...new Set(triggerObjects.map((t) => t.eventType))];
    const hit = ops.find((o) => o.name === name);
    const doc = { name, description, pipeline, triggerObjects, triggerTypes: types, triggerType: types[0], enabled: true, folderId: opCat, updatedAt: now };
    if (hit) await Operation.updateOne({ gridId, id: hit.id }, { $set: doc });
    else await Operation.create({ id: randomUUID(), userId, gridId, ...doc });
  };
  await upsertOp(scaleName, "Each nutrient = its per-100g value × Grams ÷ 100 (Grams empty = 100). Runs when Grams or a per-100g value changes, and when an ingredient is added.",
    scalePipeline(pairs, grams.id), scaleTriggers);
  await upsertOp(toggleName, "The Grocery list button: adds `grocery` to the ingredient's Board Category (so the Grocery List feed shows it), or takes it off.",
    groceryTogglePipeline(), [{ eventType: "onButton", subjectType: "field", targetId: button.id, priority: 5 }]);
  for (const o of onCreateOps) {
    const t = o.triggerObjects.map((x) => (x.eventType === "onCreate" ? { ...x, eventType: "onAdd" } : x));
    await Operation.updateOne({ gridId, id: o.id }, { $set: { triggerObjects: t, triggerTypes: [...new Set(t.map((x) => x.eventType))], updatedAt: now } });
  }
  log("  applied. RESTART pm2.");
}
