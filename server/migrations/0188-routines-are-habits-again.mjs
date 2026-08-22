/**
 * 0188 — four daily routines stopped counting as HABITS the moment they were placed.
 *
 * USER, 2026-08-22, asked before writing: mark all six Routine rows as habits.
 *
 * ── THE CATALOG IS RIGHT AND THE PLACEMENTS ARE WRONG, which is what makes this a repair
 *
 * `Habit` is a hidden marker field. `Completed Habits` counts a completed row that BINDS it;
 * `Completed Tasks` counts a completed row that does not. So a routine minted without the binding
 * lands silently in the TASKS count — the failure 2026-08-13 records in one line: *"a routine
 * minted without it lands silently in the TASKS count instead."*
 *
 * Measured on the live grid, and the split is the whole diagnosis:
 *
 *     CATALOG module (Routines > …)     Drink · Hygiene · Walk · Journal    ALL FOUR bind Habit
 *     the Routine layer's row modules   the same four                        NONE bind it
 *     every clone descended from them   20 more modules                      none bind it
 *
 * So nothing was mis-authored: `APPLY_TEMPLATE` mints a FRESH module per clone, and somewhere in
 * that chain the binding was dropped. Hot Tub and Take Medication kept theirs, which is why two of
 * the six already counted correctly and four did not.
 *
 * ── IT PATCHES EVERY CLONE, NOT JUST THE TEMPLATE, and that is `0117`'s lesson verbatim ─────
 *
 * *"The binding goes on EVERY Exercise module, not just the catalog one: each placed row is a
 * CLONE with its own fieldBindings, so binding the catalog alone would give the field to future
 * rows and leave every existing row without the control."* Same shape here: 4 template modules +
 * 20 clone modules = 24.
 *
 * ── THE SET IS DERIVED FROM THE TEMPLATE, NEVER FROM A LIST OF NAMES ────────────────────────
 *
 * The four are not enumerated. The migration reads the `Routine` layer, takes the rows whose module
 * does not bind `Habit`, and follows `meta.appliedFromTemplateId` to everything cloned from them.
 * Add a fifth routine tomorrow and re-running covers it; rename one and nothing breaks. A name list
 * would have been correct today and wrong on the next edit — the rule `0109` had to reach for when
 * matching on the label would have deleted the catalog.
 *
 * ── THE BINDING'S SHAPE IS COPIED FROM AN EXEMPLAR AT RUN TIME ──────────────────────────────
 *
 * `order` and `hidden` are read off a module that already carries the binding rather than written
 * as literals, so the pill renders where it does everywhere else. Reading the exemplar at USE time
 * is `0054`'s own defect avoided — it copied a shape captured before an earlier step had changed it.
 *
 * ── WHAT THIS CHANGES ON SCREEN, said plainly ──────────────────────────────────────────────
 *
 * `Completed Habits` goes UP and `Completed Tasks` goes DOWN by the same amount, for every day
 * these rows are ticked. That is a visible number moving, which is why it was asked rather than
 * folded into `0187`.
 */
export const id = "0188-routines-are-habits-again";
export const describe =
  "Bind the hidden `Habit` marker on the Routine layer's rows that lost it, and on every module cloned from them (24 modules). Changes Completed Habits / Completed Tasks counts.";

/** The rows on a layer whose module does not bind `habitId`, plus everything cloned from them. */
export function modulesNeedingHabit({ layer, occs, modById, habitId }) {
  const binds = (m) => (m?.fieldBindings || []).some((b) => b.fieldId === habitId);
  const rows = (layer?.occurrences || [])
    .flatMap((sid) => (occs.find((o) => o.id === sid)?.occurrences || []))
    .map((rid) => occs.find((o) => o.id === rid))
    .filter(Boolean);
  const needy = rows.filter((r) => !binds(modById.get(r.moduleId)));
  const needyIds = new Set(needy.map((r) => r.id));
  const cloneMods = occs.filter((o) => needyIds.has(o.meta?.appliedFromTemplateId)).map((o) => o.moduleId);
  const all = new Set([...needy.map((r) => r.moduleId), ...cloneMods].filter(Boolean));
  return { rows: needy, moduleIds: [...all].filter((id) => !binds(modById.get(id))) };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "(?)";

  const HABIT = fields.find((f) => f.name === "Habit")?.id;
  if (!HABIT) { log("  REFUSING: no `Habit` field on this grid"); return; }

  const tplPage = occs.find((o) => /schedule template/i.test(nameOf(o))
    && modById.get(o.moduleId)?.role === "page");
  const layer = (tplPage?.occurrences || []).map((i) => occs.find((o) => o.id === i))
    .find((o) => nameOf(o) === "Routine");
  if (!layer) { log("  REFUSING: no `Routine` layer on the Schedule Template page"); return; }

  const { rows, moduleIds } = modulesNeedingHabit({ layer, occs, modById, habitId: HABIT });
  if (!rows.length) { log("  every Routine row already binds Habit — nothing to do"); return; }
  log(`  Routine rows missing the marker: ${rows.map((r) => nameOf(r)).join(", ")}`);
  log(`  modules to patch (template + every clone): ${moduleIds.length}`);

  // The binding's SHAPE, read off a module that already carries it — never written as literals.
  const exemplar = mods.map((m) => (m.fieldBindings || []).find((b) => b.fieldId === HABIT)).find(Boolean);
  if (!exemplar) { log("  REFUSING: no module on this grid binds Habit — no shape to copy"); return; }
  const shape = { fieldId: HABIT, order: exemplar.order, hidden: exemplar.hidden, role: exemplar.role };
  log(`  copying the binding's shape from an existing carrier: ${JSON.stringify(shape)}`);

  if (dryRun) { log("  (dry run — nothing written)"); return; }
  for (const id of moduleIds) {
    await Module.updateOne({ id, gridId }, { $push: { fieldBindings: shape } });
  }
  log(`  ${moduleIds.length} module(s) patched — Completed Habits will rise and Completed Tasks fall`);
  log("  written — RESTART pm2 and reload.");
}
