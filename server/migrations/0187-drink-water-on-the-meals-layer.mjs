/**
 * 0187 — a `Drink` with `Water` already picked, beside every meal on the `Meals` layer.
 *
 * USER, 2026-08-22: *"also drink should show up with water selected in the meals template"*, and
 * when asked where — one per meal slot, eight a day.
 *
 * ── WHICH `Water`, AND WHY THAT IS THE WHOLE RISK ───────────────────────────────────────────
 *
 * Three occurrences on this grid are labelled `Water`:
 *
 *     QYYO61oFcf33   under `Beverages`          <- the board row the dropdown offers
 *     AYYLDkB3Lx-4   under `Today's Physical`   <- a TRACKER TILE
 *     FUPj-giikvbm   under `Utilities`          <- a UTILITY BILL
 *
 * Matching on the label would have had a one-in-three chance of writing a water BILL into a
 * beverage picker, and every log line would have read correctly. That is the `0114` class exactly
 * — *"a reference to a feed copy is valid only until the next sync"*, and its wider lesson: resolve
 * a pick through the FIELD'S OWN PREDICATE, never by name.
 *
 * So `Water` is resolved by running the `Beverage` field's stored `optionsSource.predicate` —
 * `Board Category CONTAINS "beverage" AND meta.feedSourceId IS_EMPTY` — over the grid and taking
 * the one option labelled Water. It resolves to exactly one, and the migration REFUSES on zero or
 * several rather than picking. Nothing here hardcodes the tag, the field, or an id.
 *
 * ── THE ROWS BIND `Habit`, WHICH IS NOT COSMETIC ────────────────────────────────────────────
 *
 * The module is cloned from the CATALOG `Drink` under Routines > Nutrition — the one that binds
 * `Completed · Beverage · Liquid Amount · Date · Category · Habit`. Every Drink currently PLACED on
 * a schedule uses a clone that lost the Habit binding, so drinking has been landing in the TASKS
 * count rather than Completed Habits (2026-08-13: *"a routine minted without it lands silently in
 * the TASKS count instead"*). The eight `Eat` rows these sit beside all bind it. **Reported rather
 * than fixed here:** repairing the five existing Drink clones changes two tracker numbers, which is
 * the user's call, not a side effect of adding rows.
 *
 * ── `Liquid Amount` IS LEFT EMPTY, DELIBERATELY ─────────────────────────────────────────────
 *
 * How much you drink at 11am is a measurement, not a prescription. A plausible number here feeds
 * the `Daily Water` total and is indistinguishable from one the user entered — the rule `0052` set
 * for phone numbers and `0054` for addresses. The row is the SLOT; the amount is one tap.
 *
 * ── SIGNED `cycle:Water`, MATCHING THE MEALS BESIDE THEM ────────────────────────────────────
 *
 * A CONTENT signature rather than `auto:<sourceId>`, for the reason `0177` measured: a content
 * signature does not move when the row does, so consolidating or re-authoring the layer later
 * cannot double every drink. Eight rows share the string, and that is safe because merge matches
 * within ONE slot's sibling list — each of the eight lives in a different slot.
 *
 * ── REFUSALS ───────────────────────────────────────────────────────────────────────────────
 *
 * Refuses if the Meals layer cannot be found, if `Water` does not resolve to exactly one option, or
 * if the catalog `Drink` is ambiguous. Idempotent: a slot that already holds a Drink is skipped, so
 * a half-completed run tops up the rest.
 */
export const id = "0187-drink-water-on-the-meals-layer";
export const describe =
  "Add a `Drink` row with `Water` selected beside each of the 8 meals on the Meals layer. Creates 8 occurrences; deletes nothing.";

const uid = () => Math.random().toString(36).slice(2, 14);
const TS = "nSccAtADyUGW";

/** Run a field's own stored options predicate — never a label match. */
export function resolveOption(field, occs, wantLabel, nameOf) {
  const rules = field?.meta?.optionsSource?.predicate?.rules || [];
  if (!rules.length) return { hits: [], why: "the field carries no options predicate" };
  const hits = occs.filter((o) => rules.every((r) => {
    const path = String(r.left || "");
    if (path.startsWith("fields.")) {
      const v = o.fields?.[path.split(".")[1]]?.value;
      if (r.comparator === "CONTAINS") return Array.isArray(v) ? v.includes(r.right) : v === r.right;
      return v === r.right;
    }
    if (path === "meta.feedSourceId") return r.comparator === "IS_EMPTY" ? !o.meta?.feedSourceId : true;
    return true;
  })).filter((o) => nameOf(o) === wantLabel);
  return { hits, why: "" };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Field.find({ gridId }).lean(),
  ]);
  const occById = new Map(occs.map((o) => [o.id, o]));
  const modById = new Map(mods.map((m) => [m.id, m]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "(?)";

  const MEAL = fields.find((f) => f.name === "Meal")?.id;
  const BEV = fields.find((f) => f.name === "Beverage");
  if (!MEAL || !BEV) { log("  REFUSING: this grid has no `Meal` or `Beverage` field"); return; }

  // The Meals layer, found by CONTENT: the layer whose rows carry a Meal pick.
  const tplPage = occs.find((o) => /schedule template/i.test(nameOf(o)) && modById.get(o.moduleId)?.role === "page");
  if (!tplPage) { log("  REFUSING: no Schedule Template page"); return; }
  const layers = (tplPage.occurrences || []).map((i) => occById.get(i)).filter(Boolean);
  const meals = layers.find((l) => (l.occurrences || []).some((sid) =>
    (occById.get(sid)?.occurrences || []).some((rid) => occById.get(rid)?.fields?.[MEAL]?.value)));
  if (!meals) { log("  REFUSING: no layer on the Schedule Template page carries a Meal pick"); return; }
  log(`  meals layer: ${nameOf(meals)} (${meals.id})`);

  const { hits, why } = resolveOption(BEV, occs, "Water", nameOf);
  if (hits.length !== 1) {
    log(`  REFUSING: the Beverage predicate resolves ${hits.length} option(s) labelled "Water"${why ? " — " + why : ""}` +
        (hits.length ? `: ${hits.map((o) => o.id).join(", ")}` : ""));
    return;
  }
  const water = hits[0];
  log(`  Water resolves through the Beverage field's own predicate to exactly one: ${water.id}`);

  // The catalog Drink — the Habit-binding one, identified by its bindings, not its home.
  const HABIT = fields.find((f) => f.name === "Habit")?.id;
  const drinkMods = mods.filter((m) => m.label === "Drink" && m.role === "instance"
    && (m.fieldBindings || []).some((b) => b.fieldId === BEV.id));
  const catalog = drinkMods.filter((m) => (m.fieldBindings || []).some((b) => b.fieldId === HABIT));
  if (catalog.length !== 1) {
    log(`  REFUSING: ${catalog.length} Habit-binding \`Drink\` modules — cannot tell which is the catalog one`);
    return;
  }
  log(`  catalog Drink module ${catalog[0].id} binds: ${(catalog[0].fieldBindings || []).map((b) => fields.find((f) => f.id === b.fieldId)?.name).join(", ")}`);

  const targets = (meals.occurrences || []).map((i) => occById.get(i)).filter((s) =>
    s && (s.occurrences || []).some((rid) => occById.get(rid)?.fields?.[MEAL]?.value));
  const already = targets.filter((s) => (s.occurrences || []).some((rid) => nameOf(occById.get(rid)) === "Drink"));
  const todo = targets.filter((s) => !already.includes(s));
  log(`  ${targets.length} meal slot(s); ${already.length} already hold a Drink; adding ${todo.length}`);
  for (const s of todo) log(`    ${String(s.fields?.[TS]?.value ?? "?").padEnd(9)} + Drink [Water]`);
  if (!todo.length) { log("  nothing to add"); return; }

  if (dryRun) { log("  (dry run — nothing written)"); return; }

  // ONE module shared by the eight rows — a module is a template, and merge mints a fresh
  // one per clone anyway, so eight identical modules would be eight things to keep in step.
  const modId = uid();
  await Module.create({
    id: modId, userId: meals.userId, gridId, role: "instance", label: "Drink",
    meta: {}, iteration: catalog[0].iteration ?? { mode: "inherit", timeFilter: "daily" },
    fieldBindings: (catalog[0].fieldBindings || []).map((b) => ({
      fieldId: b.fieldId, order: b.order, hidden: b.hidden, role: b.role })),
  });

  for (const slot of todo) {
    const rid = uid();
    await Occurrence.create({
      id: rid, userId: meals.userId, gridId, moduleId: modId,
      label: null, parentId: slot.id, occurrences: [],
      identitySignature: "cycle:Water",
      fields: { [BEV.id]: { value: water.id, flow: "in" } }, meta: {},
    });
    await Occurrence.updateOne({ id: slot.id, gridId }, { $addToSet: { occurrences: rid } });
  }
  log(`  ${todo.length} Drink row(s) added, each with Water picked and Liquid Amount left empty`);
  log("  written — RESTART pm2 and reload.");
}
