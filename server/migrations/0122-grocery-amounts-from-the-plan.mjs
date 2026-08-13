// server/migrations/0122-grocery-amounts-from-the-plan.mjs
//
// User, 2026-08-13: "take the amounts out of the title for the grocery list. add
// the total amount needed in the quantity field with the proper postfix (cups,
// tbsp, whatever), but the full amount needed, not just one meals worth. hide
// poster and file fields from them … keep ingrediants at the quantity of what it
// needs for a meal. so half cup for brown rice."
//
// ── THE TOTALS ARE THE PLAN'S OWN, NOT DERIVED ──────────────────────────────
// `0120` computed "servings per day" by counting meal placements. That was a
// derivation; **Nutrition Plan.md carries an actual "Shopping List (With
// Measurements)" for the full three days**, which is what "the full amount
// needed" means and is authoritative where my arithmetic was inference:
//
//     Chicken thighs 33 oz · Eggs 6 large · Greek yogurt 3 cups · Tortillas 3
//     Granola ¾ cup · Frozen berries 1.5 cups · Brown rice 1.5 cups
//     Hummus 6 tbsp · Peanuts 1.5 cups · Pecans 1.5 cups · Lettuce 1 head
//     Frozen mixed veggies 1.5 cups · Apples 6 medium
//
// **Protein powder is the one exception and the doc says so**: "Excludes spices,
// olive oil, and protein powder, but they remain in the meal plan." Its total is
// therefore DERIVED (2 shakes a day × 3 days = 6 scoops) and flagged as such
// rather than quietly presented as if the plan had stated it.
//
// ── SERVING SIZE IS PRESERVED, NOT DISCARDED ────────────────────────────────
// Stripping "(1/2 cup)" from the title removes the only record of what the
// macros on that row DESCRIBE — 150 cal is 150 cal *per half cup of brown rice*.
// So the parenthetical moves to `meta.servingSize` rather than being deleted,
// and the macros are left ALONE: "keep ingrediants at the quantity of what it
// needs for a meal" — brown rice stays a ½-cup serving, which is what its
// numbers already mean.
//
// ── THE POSTFIX IS PER ROW, WHICH IS WHY IT WORKS AT ALL ────────────────────
// One `Quantity` field serves oz, cups, tbsp, head and count. `field.meta.
// postfixOptions` says what the field OFFERS and `occurrence.fields[fid].postfix`
// holds what the row PICKED (2026-08-08). The existing options are
// g/kg/ml/L/oz/lb/count — cooking units are added rather than replacing them, so
// nothing that already picked one loses its choice.
export const id = "0122-grocery-amounts-from-the-plan";
export const describe =
  "Grocery titles lose their serving size; Quantity carries the plan's 3-day total with a per-row unit.";

// label (after the serving is stripped) -> the plan's shopping-list amount.
export const SHOPPING_LIST = {
  "Chicken Thighs":       { qty: 33,   postfix: "oz" },
  "Eggs":                 { qty: 6,    postfix: "large" },
  "Greek Yogurt":         { qty: 3,    postfix: "cups" },
  "Whole Grain Tortilla": { qty: 3,    postfix: "count" },
  "Granola":              { qty: 0.75, postfix: "cups" },
  "Frozen Berries":       { qty: 1.5,  postfix: "cups" },
  "Brown Rice":           { qty: 1.5,  postfix: "cups" },
  "Hummus":               { qty: 6,    postfix: "tbsp" },
  "Peanuts":              { qty: 1.5,  postfix: "cups" },
  "Pecans":               { qty: 1.5,  postfix: "cups" },
  "Lettuce":              { qty: 1,    postfix: "head" },
  "Frozen Mixed Veggies": { qty: 1.5,  postfix: "cups" },
  "Apple":                { qty: 6,    postfix: "medium" },
  // Excluded from the plan's own shopping list — 2 shakes/day × 3 days.
  "Protein Powder":       { qty: 6,    postfix: "scoops", derived: true },
};

export const ADD_POSTFIX_OPTIONS = ["cups", "tbsp", "tsp", "head", "medium", "large", "scoops"];
export const HIDE_ON_GROCERY = ["Poster", "Files"];

export const stripServing = (s) => {
  const m = String(s ?? "").match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  return m ? { label: m[1].trim(), serving: m[2].trim() } : { label: String(s ?? "").trim(), serving: null };
};
const norm = (s) => String(s ?? "").trim().toLowerCase();

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "?";
  const fid = (n) => fields.find((f) => f.name === n && !f.displayEnabled)?.id;
  const TAG = fields.find((f) => f.name === "Board Category")?.id;
  const QTY = fid("Quantity");
  const hideIds = HIDE_ON_GROCERY.map(fid);
  if (!TAG || !QTY || hideIds.some((x) => !x)) { log(`REFUSING: a required field is missing.`); return; }
  const qtyField = fields.find((f) => f.id === QTY);

  const tagsOf = (o) => { const v = o.fields?.[TAG]?.value; return Array.isArray(v) ? v : v ? [v] : []; };
  const targets = occs.filter((o) => !o.meta?.feedSourceId &&
    modById.get(o.moduleId)?.role === "instance" &&
    tagsOf(o).includes("grocery") && tagsOf(o).includes("ingredient"));

  const plan = [], unmatched = [];
  for (const t of targets) {
    const { label, serving } = stripServing(nameOf(t));
    const key = Object.keys(SHOPPING_LIST).find((k) => norm(k) === norm(label));
    if (!key) { unmatched.push(label); continue; }
    plan.push({ occ: t, mod: modById.get(t.moduleId), label, serving, ...SHOPPING_LIST[key] });
  }
  const missing = Object.keys(SHOPPING_LIST).filter((k) =>
    !plan.some((p) => norm(p.label) === norm(k)));

  const newOptions = [...new Set([...(qtyField?.meta?.postfixOptions || []), ...ADD_POSTFIX_OPTIONS])];
  log(`Quantity postfix options: ${(qtyField?.meta?.postfixOptions || []).join(", ")} -> ${newOptions.join(", ")}`);
  log(`grocery ingredients matched to the plan's shopping list: ${plan.length}/${targets.length}`);
  for (const p of plan) {
    log(`   ${String(nameOf(p.occ)).padEnd(31)} -> "${p.label}"  qty=${p.qty} ${p.postfix}` +
      `${p.derived ? "  (DERIVED — the doc excludes it)" : ""}  serving kept as "${p.serving ?? "-"}"`);
  }
  if (unmatched.length) log(`  REFUSING (not in the plan's shopping list): ${unmatched.join(", ")}`);
  if (missing.length) log(`  in the shopping list but not on the grid: ${missing.join(", ")}`);
  log(`hiding ${HIDE_ON_GROCERY.join(" / ")} on ${plan.length} module(s)`);
  if (!plan.length) { log(`nothing matched — no change.`); return; }
  if (dryRun) { log(`WOULD rename ${plan.length}, set quantities, and hide the two fields.`); return; }

  await Field.updateOne({ gridId, id: QTY }, { $set: { "meta.postfixOptions": newOptions } });

  for (const p of plan) {
    // The title loses the serving; meta keeps it, because the macros on this row
    // are per THAT serving and would otherwise mean nothing.
    await Module.updateOne({ gridId, id: p.mod.id }, {
      $set: {
        label: p.label,
        ...(p.serving ? { "meta.servingSize": p.serving } : {}),
        fieldBindings: (p.mod.fieldBindings || []).map((b) =>
          hideIds.includes(b.fieldId) ? { ...b, hidden: true } : b),
      },
    });
    // An occurrence-level label override would win over the module's — clear it
    // so the rename is actually what renders.
    const patch = { [`fields.${QTY}`]: { value: p.qty, flow: "in", postfix: p.postfix } };
    if (p.occ.label) patch.label = null;
    await Occurrence.updateOne({ gridId, id: p.occ.id }, { $set: patch });
  }
  log(`renamed ${plan.length}, set quantity + postfix, hid ${HIDE_ON_GROCERY.join("/")}.`);

  const after = await Occurrence.find({ gridId }).lean();
  const afterMods = await Module.find({ gridId }).lean();
  const amById = new Map(afterMods.map((m) => [m.id, m]));
  for (const p of plan.slice(0, 4)) {
    const o = after.find((x) => x.id === p.occ.id);
    const m = amById.get(o.moduleId);
    log(`  check "${m.label}" qty=${o.fields?.[QTY]?.value}${o.fields?.[QTY]?.postfix ? " " + o.fields[QTY].postfix : ""}` +
      ` serving="${m.meta?.servingSize}" posterHidden=${(m.fieldBindings || []).find((b) => b.fieldId === hideIds[0])?.hidden}`);
  }
}
