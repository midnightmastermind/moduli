/**
 * 0195 — untag the four superseded ingredient TWINS that nothing points at.
 *
 * Filed as *"base the ingrediants on the quanity that matches the protein carbs and fats. and make
 * it the lowest amount with quantity. so 2 eggs become 1 egg and has the macros to match 1 egg"*
 * (2026-08-14). **Measuring retires the ask and finds a different thing.**
 *
 * ── THE ASK IS ALREADY SATISFIED ────────────────────────────────────────────────────────────
 *
 * Every one of the plan's 15 ingredients is already stated at a SINGLE unit and its macros match
 * that unit — `Eggs 1 large 70/6/0.5/5`, `Chicken Thighs 1 oz 55/6.9/0/3.1`, `Hummus 1 tbsp`,
 * `Apple 1 medium`. `0122` moved the amounts out of the titles into `meta.servingSize` and `0123`
 * wrote the per-unit values. The user's own example — two eggs becoming one — is the state on the
 * grid today.
 *
 * ── WHAT MEASURING FOUND INSTEAD ────────────────────────────────────────────────────────────
 *
 * 32 rows carry the `ingredient` tag and only 15 have a serving size. The other 17 are the
 * 2026-07-28 seed's set, superseded by `0103`, and **four of them are exact-name TWINS** of a plan
 * ingredient with DIFFERENT macros:
 *
 *     Eggs            no serving  72/6.3/0.4/4.8   vs  1 large  70/6/0.5/5
 *     Greek Yogurt    no serving  100/17/6/0.7     vs  1 cup    150/20/10/3
 *     Chicken Thighs  no serving  209/26/0/10.9    vs  1 oz     55/6.9/0/3.1
 *     Frozen Berries  no serving  50/0.7/12/0.3    vs  1 cup    70/0/20/0
 *
 * **No meal points at any of them** — all 27 meal references resolve to the serving-bearing twin,
 * so nothing is mis-costed today. What they are is a dropdown showing "Eggs" twice, which is the
 * `0114` wrong-pointer trap waiting to be picked by hand.
 *
 * ── IT UNTAGS, IT DOES NOT DELETE ───────────────────────────────────────────────────────────
 *
 * The board is a materialized view of the `ingredient` tag (2026-07-25), so removing the tag takes
 * the row off the board and out of every dropdown while leaving the occurrence intact. That is
 * reversible with one field edit; a delete is not. Same instrument `0115` used on the grocery list.
 *
 * ── AND THE OTHER 12 ARE LEFT ALONE, DELIBERATELY ───────────────────────────────────────────
 *
 * Chicken Breast · Rice · Spinach · Oats · Salmon · Olive Oil · Sweet Potatoes · Black Beans ·
 * Milk · Bananas · Coffee Beans · Zucchini Peppers Onions are not duplicates of anything — they are
 * foods the current plan does not use. The Ingredients board is a CATALOG of what you can put in a
 * meal, not this week's shopping list, so "the plan does not mention it" is not a reason to remove
 * it. `0115` made the opposite call for the GROCERY list and was right there for the opposite
 * reason. Reported, not acted on.
 *
 * A row is only touched when ALL of: it carries the tag, it has NO serving size, a row with the
 * SAME name AND a serving size exists, and no occurrence anywhere references its id.
 */
export const id = "0195-the-superseded-ingredient-twins";
export const describe =
  "Untag the superseded ingredient twins — same name as a serving-bearing ingredient, no serving size, referenced by nothing (4 on poms grid). Removes the tag, never the row.";

/** Occurrence ids named by ANY field value anywhere on the grid. */
export function referencedIds(occs) {
  const out = new Set();
  for (const o of occs || []) {
    for (const v of Object.values(o.fields || {})) {
      const val = v?.value;
      for (const x of Array.isArray(val) ? val : [val]) if (typeof x === "string") out.add(x);
    }
  }
  return out;
}

/** The twins safe to untag. Pure, so every refusal is testable. */
export function supersededTwins({ occs, mods, tagFieldId, tag = "ingredient" }) {
  const modById = new Map((mods || []).map((m) => [m.id, m]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? null;
  const tagged = (occs || []).filter((o) => {
    if (o?.meta?.feedSourceId) return false;                       // a feed COPY, never a source
    if (modById.get(o.moduleId)?.role !== "instance") return false; // the board CONTAINER carries the
    const v = o.fields?.[tagFieldId]?.value;                        // tag by design (2026-07-25)
    return (Array.isArray(v) ? v : [v]).includes(tag);
  });
  const servingOf = (o) => modById.get(o.moduleId)?.meta?.servingSize;
  const refs = referencedIds(occs);
  const out = [];
  for (const o of tagged) {
    if (servingOf(o) !== undefined) continue;                      // it IS the canonical one
    const name = nameOf(o);
    if (!name) continue;
    const twin = tagged.find((t) => t.id !== o.id && nameOf(t) === name && servingOf(t) !== undefined);
    if (!twin) continue;                                           // not a duplicate — a catalog food
    if (refs.has(o.id)) continue;                                  // something points at it
    out.push({ id: o.id, name, twinId: twin.id, twinServing: servingOf(twin) });
  }
  return out;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Field.find({ gridId }).lean(),
  ]);
  const tagFieldId = fields.find((f) => f.name === "Board Category")?.id;
  if (!tagFieldId) { log("  REFUSING: no `Board Category` field"); return; }

  const twins = supersededTwins({ occs, mods, tagFieldId });
  if (!twins.length) { log("  nothing to do — no superseded ingredient twins"); return; }
  for (const t of twins) log(`  ${t.name}: untagging ${t.id} (the twin ${t.twinId} keeps it, serving "${t.twinServing}")`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  for (const t of twins) {
    const occ = occs.find((o) => o.id === t.id);
    const v = occ.fields[tagFieldId].value;
    const next = (Array.isArray(v) ? v : [v]).filter((x) => x !== "ingredient");
    // The value SHAPE is preserved: a scalar stays a scalar when one tag is left,
    // because CONTAINS matches both and the wrong shape resolves fine in a
    // dropdown while reading wrong to anything treating it as a list (0159).
    await Occurrence.updateOne({ id: t.id, gridId },
      { $set: { [`fields.${tagFieldId}.value`]: Array.isArray(v) ? next : (next[0] ?? null) } });
  }
  log(`  done — ${twins.length} row(s) off the Ingredients board; the occurrences are untouched`);
}
