// server/migrations/0125-per-meal-quantity-total-and-price.mjs
//
// User, 2026-08-14: "how is it 3 tortillas from the ingrediants? is that per
// day? i need it per meal" … "or close too if its a diff amount per meal, just
// pick one" … "why wouldnnt thinks like quantity get filled or a price
// estimate … just give me a rough estimate for each" … "you can turn off all
// the vitamins and stuff on the grocery list side of the ingrediants but fill
// the price there."
//
// ── ONE FIELD CANNOT MEAN TWO THINGS ────────────────────────────────────────
// `0122` put the 3-day SHOPPING total in `Quantity`, which is right on a
// shopping list and wrong everywhere else: read from the ingredient it says
// "3 tortillas" for a meal that uses one. The two numbers are different facts,
// so they get different fields:
//     Quantity      what ONE MEAL uses    1 tortilla · ½ cup brown rice
//     Total Needed  the 3-day shop        3 tortillas · 1.5 cups
//
// ── THIS ALSO FIXES THE MACRO MATH, WHICH WAS QUIETLY WRONG ─────────────────
// `0042`'s prefill sums each ingredient of a meal ONCE, at whatever serving the
// ingredient itself carries. Chicken thighs were stored per **1 oz**, so the
// Mediterranean Chicken Wrap summed ~16g protein against the plan's stated
// ~45g. Re-basing each ingredient onto its per-meal serving makes the same sum
// land at ~50g. **So the macros and vitamins are SCALED by the same ratio** —
// leaving them per-1-oz while the quantity says 6 would have been two different
// servings on one row.
//     Chicken Thighs ×6 · Eggs ×2 · Frozen Mixed Veggies ×2 · everything else ×1
//
// Where a meal disagrees with another (chicken is 5 oz at lunch, 6 oz at
// dinner) the user said to pick one: **6 oz**, the larger, so a day's shopping
// is never short.
//
// ── PRICE IS AN ESTIMATE AND IS LABELLED ONE ────────────────────────────────
// `0120` left Price empty on the grounds that a plausible number is
// indistinguishable from a real one. The user has now asked for rough figures
// and said they will correct them, which changes the trade: a wrong number they
// EXPECT to be rough beats an empty column. So these are ballpark US grocery
// prices **for the 3-day Total Needed**, not per meal, because that is the
// number you hand over at a till. They are marked in `meta.priceEstimated` so
// nothing downstream can mistake them for measured.
//
// ── THE GROCERY LIST SHOWS FOUR FIELDS ──────────────────────────────────────
// Via `fieldVisibility` on the board container — the existing cascade, not a
// new mechanism — so the same ingredient row reads as a shopping line there and
// keeps its full nutrition everywhere else. Vitamins and macros are simply not
// in the show-list; nothing is deleted.
import { randomUUID } from "node:crypto";

export const id = "0125-per-meal-quantity-total-and-price";
export const describe =
  "Quantity is per meal, Total Needed is the 3-day shop, Price is a rough estimate, grocery shows four fields.";

// perMeal: what ONE serving in the plan's recipes uses.
// total:   the plan's own 3-day shopping list (0122).
// price:   rough US grocery cost of the TOTAL. Estimated, not measured.
export const INGREDIENTS = {
  "Chicken Thighs":       { perMeal: 6,    unit: "oz",     total: 33,   price: 7.00 },
  "Eggs":                 { perMeal: 2,    unit: "large",  total: 6,    price: 2.50 },
  "Greek Yogurt":         { perMeal: 1,    unit: "cups",   total: 3,    price: 5.50 },
  "Whole Grain Tortilla": { perMeal: 1,    unit: "count",  total: 3,    price: 1.50 },
  "Granola":              { perMeal: 0.25, unit: "cups",   total: 0.75, price: 2.00 },
  "Frozen Berries":       { perMeal: 0.5,  unit: "cups",   total: 1.5,  price: 3.00 },
  "Brown Rice":           { perMeal: 0.5,  unit: "cups",   total: 1.5,  price: 1.00 },
  "Hummus":               { perMeal: 2,    unit: "tbsp",   total: 6,    price: 2.00 },
  "Peanuts":              { perMeal: 0.25, unit: "cups",   total: 1.5,  price: 3.50 },
  "Pecans":               { perMeal: 0.25, unit: "cups",   total: 1.5,  price: 7.00 },
  "Lettuce":              { perMeal: 1,    unit: "cups",   total: 1,    price: 2.00, totalUnit: "head" },
  "Frozen Mixed Veggies": { perMeal: 1,    unit: "cups",   total: 1.5,  price: 1.50 },
  "Apple":                { perMeal: 1,    unit: "medium", total: 6,    price: 4.50 },
  "Protein Powder":       { perMeal: 1,    unit: "scoops", total: 6,    price: 6.00 },
};

// What the ingredient's stored numbers were based on before this migration —
// the serving `0122` preserved. The ratio re-bases them onto the per-meal one.
export const OLD_SERVING_MULTIPLE = {
  "Chicken Thighs": 1, "Eggs": 1, "Greek Yogurt": 1, "Whole Grain Tortilla": 1,
  "Granola": 0.25, "Frozen Berries": 0.5, "Brown Rice": 0.5, "Hummus": 2,
  "Peanuts": 0.25, "Pecans": 0.25, "Lettuce": 1, "Frozen Mixed Veggies": 0.5,
  "Apple": 1, "Protein Powder": 1,
};

export const SCALED_FIELDS = ["Calories", "Protein", "Carbs", "Fats",
  "Vitamin A", "Vitamin C", "Vitamin D", "Vitamin E", "Vitamin K", "Thiamin",
  "Riboflavin", "Niacin", "Pantothenic Acid", "Vitamin B6", "Biotin", "Folate",
  "Vitamin B12"];

export const GROCERY_SHOWS = ["Quantity", "Total Needed", "Price", "Poster"];
const norm = (s) => String(s ?? "").trim().toLowerCase();
const round = (n) => Math.round(n * 100) / 100;

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
  const QTY = fid("Quantity"), PRICE = fid("Price");
  if (!TAG || !QTY || !PRICE) { log(`REFUSING: missing Board Category / Quantity / Price.`); return; }
  const qtyField = fields.find((f) => f.id === QTY);
  let TOTAL = fid("Total Needed");

  const tagsOf = (o) => { const v = o.fields?.[TAG]?.value; return Array.isArray(v) ? v : v ? [v] : []; };
  const isSource = (o) => !o.meta?.feedSourceId && modById.get(o.moduleId)?.role === "instance";
  // SCOPED TO THE PLAN SET — `ingredient` ALONE IS AMBIGUOUS NOW. `0122` stripped
  // "(1 cup)" from the titles, so the plan's "Greek Yogurt" collides by name with
  // the 2026-07-28 seed's. The plan's are the ones still tagged `grocery` (0115
  // untagged the superseded ones), which is the only structural discriminator
  // between two rows that now share a label. The dry run caught this: it matched
  // 18 rows for 14 ingredients.
  const named = (o) => Object.keys(INGREDIENTS).find((k) => norm(k) === norm(nameOf(o)));
  const targets = occs.filter((o) => isSource(o) && tagsOf(o).includes("ingredient") &&
    tagsOf(o).includes("grocery") && named(o));
  const collisions = occs.filter((o) => isSource(o) && tagsOf(o).includes("ingredient") &&
    !tagsOf(o).includes("grocery") && named(o));

  const plan = [];
  for (const t of targets) {
    const key = Object.keys(INGREDIENTS).find((k) => norm(k) === norm(nameOf(t)));
    const spec = INGREDIENTS[key];
    const ratio = spec.perMeal / (OLD_SERVING_MULTIPLE[key] ?? 1);
    const scaled = [];
    for (const fname of SCALED_FIELDS) {
      const f = fid(fname);
      const cur = f && t.fields?.[f]?.value;
      if (f && typeof cur === "number" && ratio !== 1) {
        scaled.push({ f, name: fname, from: cur, to: round(cur * ratio) });
      }
    }
    plan.push({ occ: t, key, spec, ratio, scaled });
  }

  const board = occs.find((o) => nameOf(o) === "Grocery List" &&
    modById.get(o.moduleId)?.role === "container");
  const showIds = GROCERY_SHOWS.map(fid).filter(Boolean);

  log(`ingredients: ${plan.length}/${Object.keys(INGREDIENTS).length}`);
  for (const p of plan) {
    log(`  ${p.key.padEnd(22)} per meal ${String(p.spec.perMeal).padEnd(5)}${p.spec.unit.padEnd(7)}` +
      ` · total ${String(p.spec.total).padEnd(5)}${(p.spec.totalUnit || p.spec.unit).padEnd(7)}` +
      ` · ~$${p.spec.price.toFixed(2)}` +
      (p.ratio !== 1 ? `  SCALING ×${p.ratio} (${p.scaled.length} value(s))` : ""));
  }
  log(`"Total Needed" field: ${TOTAL ? "exists" : "WILL CREATE"}`);
  log(`grocery board ${board ? board.id : "NOT FOUND"} shows: ${GROCERY_SHOWS.join(", ")}`);
  const missing = Object.keys(INGREDIENTS).filter((k) => !plan.some((p) => p.key === k));
  if (missing.length) log(`  REFUSING (not on the grid): ${missing.join(", ")}`);
  if (collisions.length) {
    log(`  NAME COLLISION, reported not changed (${collisions.length}): ` +
      `${collisions.map(nameOf).join(", ")} — the 07-28 seed's rows, off the grocery list since 0115.`);
    log(`  They still carry the "ingredient" tag, so the Ingredient dropdown offers each name TWICE.`);
  }
  if (!plan.length) { log(`nothing matched.`); return; }
  if (dryRun) { log(`WOULD re-base ${plan.length} ingredient(s), add Total Needed + Price, scope the board.`); return; }

  const userId = targets[0].userId;
  if (!TOTAL) {
    TOTAL = randomUUID();
    await Field.create({
      id: TOTAL, gridId, userId, name: "Total Needed", type: "number",
      inputEnabled: true, displayEnabled: false,
      meta: {
        postfixOptions: [...(qtyField?.meta?.postfixOptions || [])],
        note: "How much to buy for the whole plan — Quantity is one meal's worth.",
      },
    });
  }
  // A price is money; without the prefix the column reads as a bare number.
  if (!fields.find((f) => f.id === PRICE)?.meta?.prefix) {
    await Field.updateOne({ gridId, id: PRICE }, { $set: { "meta.prefix": "$" } });
  }

  for (const p of plan) {
    const set = {
      [`fields.${QTY}`]: { value: p.spec.perMeal, flow: "in", postfix: p.spec.unit },
      [`fields.${TOTAL}`]: { value: p.spec.total, flow: "in", postfix: p.spec.totalUnit || p.spec.unit },
      [`fields.${PRICE}`]: { value: p.spec.price, flow: "in" },
    };
    for (const s of p.scaled) set[`fields.${s.f}`] = { value: s.to, flow: "in" };
    await Occurrence.updateOne({ gridId, id: p.occ.id }, { $set: set });
    // The serving the macros now describe, and a flag so an estimated price is
    // never mistaken for a measured one.
    await Module.updateOne({ gridId, id: p.occ.moduleId }, { $set: {
      "meta.servingSize": `${p.spec.perMeal} ${p.spec.unit}`,
      "meta.priceEstimated": true,
    } });
    // Total Needed has to be BOUND or the row has no control for it.
    const m = modById.get(p.occ.moduleId);
    if (m && !(m.fieldBindings || []).some((b) => b.fieldId === TOTAL)) {
      const next = [];
      for (const b of m.fieldBindings || []) {
        next.push(b);
        if (b.fieldId === QTY) next.push({ fieldId: TOTAL, role: "input", hidden: false });
      }
      if (!next.some((b) => b.fieldId === TOTAL)) next.push({ fieldId: TOTAL, role: "input", hidden: false });
      await Module.updateOne({ gridId, id: m.id }, { $set: { fieldBindings: next } });
    }
  }

  if (board && showIds.length) {
    await Occurrence.updateOne({ gridId, id: board.id },
      { $set: { fieldVisibility: { mode: "show", fieldIds: showIds } } });
  }

  log(`re-based ${plan.length} ingredient(s); Total Needed ${TOTAL}; board scoped to ${showIds.length} field(s).`);
  const after = await Occurrence.find({ gridId, id: { $in: plan.map((p) => p.occ.id) } }).lean();
  for (const o of after.slice(0, 4)) {
    log(`  check ${nameOf(o).padEnd(22)} qty=${o.fields[QTY].value}${o.fields[QTY].postfix}` +
      ` total=${o.fields[TOTAL].value}${o.fields[TOTAL].postfix} price=$${o.fields[PRICE].value}` +
      ` cal=${o.fields[fid("Calories")]?.value}`);
  }
}
