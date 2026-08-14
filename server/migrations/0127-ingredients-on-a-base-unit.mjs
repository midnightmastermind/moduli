// server/migrations/0127-ingredients-on-a-base-unit.mjs
//
// User, 2026-08-14: "could we base the ingrediants on the quanity that matches
// the protein carbs and fats. and make it the lowest amount with quantity. so 2
// eggs become 1 egg and has the macros to match 1 egg. also give those vitamins
// and macros the postfix dropdown too."
//
// ── ONE UNIT, AND THE NUMBERS DESCRIBE IT ───────────────────────────────────
// Every ingredient becomes **quantity 1** of its own unit, with macros and
// vitamins scaled to that unit. `0125` had put the per-MEAL amount here (2 eggs,
// 6 oz chicken), which made the row's numbers meal-sized; an ingredient reads
// better as "what one of these is", and a meal-sized figure belongs to the meal.
//
//     Eggs      2 large → 1 large   140 cal → 70
//     Chicken   6 oz    → 1 oz      330 cal → 55
//     Peanuts   ¼ cup   → 1 cup     213 cal → 852
//
// The unit is singular now ("1 cup", not "1 cups") — the plural read as a typo
// at quantity 1, which is the only quantity these rows carry.
//
// ── THE RATIO IS COMPUTED FROM WHAT IS STORED, NOT ASSUMED ──────────────────
// Each row's scale factor is `1 / currentQuantity`, read live. So the migration
// is correct whatever basis a row is currently on, and **idempotent by
// construction**: a row already at quantity 1 has a ratio of 1 and is skipped.
// Hard-coding "divide eggs by 2" would silently halve them on a second run.
//
// ── THE COST, STATED PLAINLY ────────────────────────────────────────────────
// `0125` moved to per-meal servings partly because `0042`'s prefill sums each of
// a meal's ingredients ONCE — so with per-UNIT rows the Mediterranean Chicken
// Wrap sums ~16g protein against the plan's ~45g again. **That is a real
// regression in the meal totals and it is not fixed here**, because fixing it
// needs an amount on the MEAL's reference to each ingredient (a per-meal
// quantity), which does not exist yet. The user asked for the base unit
// explicitly; this records what it costs.
//
// ── THE DROPDOWNS ───────────────────────────────────────────────────────────
// Macros and vitamins get `postfixOptions` so a row can pick its unit, the same
// mechanism `Quantity` uses. The field's own fixed postfix is TRIMMED first —
// it was stored as " mcg" with a leading space, and an untrimmed default sits
// beside a trimmed option in the menu as two entries that look identical.
export const id = "0127-ingredients-on-a-base-unit";
export const describe =
  "Every ingredient is 1 of its unit with matching macros; macros and vitamins gain unit dropdowns.";

// The unit each ingredient is measured in, singular. Quantity becomes 1 of it.
export const BASE_UNIT = {
  "Chicken Thighs": "oz", "Eggs": "large", "Greek Yogurt": "cup",
  "Whole Grain Tortilla": "count", "Granola": "cup", "Frozen Berries": "cup",
  "Brown Rice": "cup", "Hummus": "tbsp", "Peanuts": "cup", "Pecans": "cup",
  "Lettuce": "cup", "Frozen Mixed Veggies": "cup", "Apple": "medium",
  "Protein Powder": "scoop",
};

export const SCALED_FIELDS = ["Calories", "Protein", "Carbs", "Fats",
  "Vitamin A", "Vitamin C", "Vitamin D", "Vitamin E", "Vitamin K", "Thiamin",
  "Riboflavin", "Niacin", "Pantothenic Acid", "Vitamin B6", "Biotin", "Folate",
  "Vitamin B12"];

// What each field OFFERS. The row's own pick wins; this is the menu.
export const AFFIX_OPTIONS = {
  "Calories": ["cal", "kcal"],
  "Protein": ["g", "mg", "oz"], "Carbs": ["g", "mg", "oz"], "Fats": ["g", "mg", "oz"],
  "Vitamin A": ["mcg", "mg", "IU"], "Vitamin D": ["mcg", "mg", "IU"],
  "Vitamin K": ["mcg", "mg", "IU"], "Biotin": ["mcg", "mg", "IU"],
  "Folate": ["mcg", "mg", "IU"], "Vitamin B12": ["mcg", "mg", "IU"],
  "Vitamin C": ["mg", "mcg", "IU"], "Vitamin E": ["mg", "mcg", "IU"],
  "Thiamin": ["mg", "mcg"], "Riboflavin": ["mg", "mcg"], "Niacin": ["mg", "mcg"],
  "Pantothenic Acid": ["mg", "mcg"], "Vitamin B6": ["mg", "mcg"],
};

// Singular forms so "1 cup" is expressible at all.
export const ADD_QTY_OPTIONS = ["cup", "scoop", "each"];

const norm = (s) => String(s ?? "").trim().toLowerCase();
const round = (n) => {
  const r = Math.abs(n) >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
};

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
  if (!TAG || !QTY) { log(`REFUSING: missing Board Category / Quantity.`); return; }

  const tagsOf = (o) => { const v = o.fields?.[TAG]?.value; return Array.isArray(v) ? v : v ? [v] : []; };
  const isSource = (o) => !o.meta?.feedSourceId && modById.get(o.moduleId)?.role === "instance";
  const targets = occs.filter((o) => isSource(o) && tagsOf(o).includes("ingredient") &&
    tagsOf(o).includes("grocery") && BASE_UNIT[Object.keys(BASE_UNIT)
      .find((k) => norm(k) === norm(nameOf(o)))]);

  const plan = [];
  for (const t of targets) {
    const key = Object.keys(BASE_UNIT).find((k) => norm(k) === norm(nameOf(t)));
    const unit = BASE_UNIT[key];
    const cur = Number(t.fields?.[QTY]?.value);
    if (!Number.isFinite(cur) || cur <= 0) { log(`  REFUSING ${key} — quantity is ${t.fields?.[QTY]?.value}`); continue; }
    // Read the ratio from what is STORED, so a re-run is a no-op.
    const ratio = 1 / cur;
    const unitChanged = (t.fields?.[QTY]?.postfix ?? "") !== unit;
    const scaled = [];
    if (ratio !== 1) {
      for (const fname of SCALED_FIELDS) {
        const f = fid(fname);
        const v = f && t.fields?.[f]?.value;
        if (f && typeof v === "number") scaled.push({ f, name: fname, from: v, to: round(v * ratio) });
      }
    }
    if (ratio === 1 && !unitChanged) continue;
    plan.push({ occ: t, key, unit, cur, ratio, scaled });
  }

  const affixPlan = [];
  for (const [fname, options] of Object.entries(AFFIX_OPTIONS)) {
    const f = fields.find((x) => x.name === fname && !x.displayEnabled);
    if (!f) { log(`  REFUSING affixes for "${fname}" — no such input field`); continue; }
    const trimmed = String(f.meta?.postfix ?? "").trim();
    const already = Array.isArray(f.meta?.postfixOptions) &&
      f.meta.postfixOptions.join("|") === options.join("|") &&
      f.meta?.postfix === trimmed;
    if (already) continue;
    affixPlan.push({ f, options, trimmed, was: f.meta?.postfix });
  }

  const qtyField = fields.find((x) => x.id === QTY);
  const qtyOptions = [...new Set([...(qtyField?.meta?.postfixOptions || []), ...ADD_QTY_OPTIONS])];
  const qtyNeedsOptions = qtyOptions.length !== (qtyField?.meta?.postfixOptions || []).length;

  for (const p of plan) {
    log(`  ${p.key.padEnd(22)} ${p.cur} ${p.occ.fields?.[QTY]?.postfix || ""} -> 1 ${p.unit}` +
      (p.ratio !== 1 ? `   ×${round(p.ratio)}  ${p.scaled.length} value(s)` : "   (unit only)"));
    const cal = p.scaled.find((s) => s.name === "Calories");
    if (cal) log(`        Calories ${cal.from} -> ${cal.to}`);
  }
  log(`ingredients to re-base: ${plan.length}/${targets.length}`);
  log(`fields gaining a unit dropdown: ${affixPlan.length} (${affixPlan.map((a) => a.f.name).join(", ")})`.slice(0, 220));
  if (qtyNeedsOptions) log(`Quantity gains singular units: ${ADD_QTY_OPTIONS.join(", ")}`);
  if (!plan.length && !affixPlan.length && !qtyNeedsOptions) { log(`already on a base unit.`); return; }
  if (dryRun) { log(`WOULD re-base ${plan.length} and add ${affixPlan.length} dropdown(s).`); return; }

  for (const p of plan) {
    const set = { [`fields.${QTY}`]: { value: 1, flow: "in", postfix: p.unit } };
    for (const s of p.scaled) set[`fields.${s.f}`] = { value: s.to, flow: "in" };
    await Occurrence.updateOne({ gridId, id: p.occ.id }, { $set: set });
    await Module.updateOne({ gridId, id: p.occ.moduleId },
      { $set: { "meta.servingSize": `1 ${p.unit}` } });
  }
  for (const a of affixPlan) {
    await Field.updateOne({ gridId, id: a.f.id },
      { $set: { "meta.postfix": a.trimmed, "meta.postfixOptions": a.options } });
  }
  if (qtyNeedsOptions) {
    await Field.updateOne({ gridId, id: QTY }, { $set: { "meta.postfixOptions": qtyOptions } });
  }
  log(`re-based ${plan.length}, ${affixPlan.length} field(s) now offer units.`);

  const after = await Occurrence.find({ gridId, id: { $in: plan.map((p) => p.occ.id) } }).lean();
  for (const o of after.slice(0, 5)) {
    log(`  check ${nameOf(o).padEnd(22)} ${o.fields[QTY].value} ${o.fields[QTY].postfix}` +
      ` · ${o.fields[fid("Calories")]?.value} cal · ${o.fields[fid("Protein")]?.value} protein`);
  }
}
