// server/migrations/0069-multiparented-tasks-show-their-date.mjs
//
// Finishes what `0065` started. That migration unhid the Date binding on the
// task modules so the Tasks board would show each task's date — and it worked
// for 5 of 7 placements. The other two stayed hidden, and the reason is
// structural rather than a mistake:
//
//   "Sign up for peer support mentor class" and "Talk to Angela about Vivance"
//   are ONE occurrence multi-parented into `Occupational` (the Tasks board)
//   AND `Due` (the Schedule).
//
// `getEffectiveFieldVisibilityForOccurrence` walks a reverse parent map that
// keeps exactly ONE parent per child, so the walk can resolve through the
// Schedule — whose page hides Date, because the day column already IS the date
// — and the field stays hidden on the Tasks board too.
//
// ── THE FIX IS TO STOP THE WALK AT THE OCCURRENCE ITSELF ────────────────────
//
// `fieldVisibility: { mode: "off" }` means "ignore any inherited setting here".
// The resolver returns null for it, which reads as "show all fields", and since
// 0065 made the Date binding visible the field then renders.
//
// ── AND IT SHOWS ON BOTH BOARDS. THAT IS NOT A BUG, IT IS THE SHAPE ────────
//
// It is the SAME occurrence in two places. Field visibility is per-occurrence,
// so it cannot show a date on the Tasks board and hide it on the Schedule —
// there is no per-placement layer to hang that on. Showing it in both is the
// honest reading of the user's ask ("the tasks should have a date field on them
// and shown"), and on the Schedule these two sit in the DUE container rather
// than a timed slot, where a due date is informative rather than redundant.
//
// The alternative — teaching the cascade to walk the RENDERED ancestor chain
// instead of a cached global map — is the principled fix and is far larger: it
// touches a memoised hot-path resolver that the 2026-08-07 attribution work cut
// from 202ms to 1ms precisely BY caching that map. Not worth it for two rows.
//
// ── SCOPE: ONLY GENUINELY MULTI-PARENTED TASKS ─────────────────────────────
//
// It touches an occurrence only when it is listed by MORE THAN ONE parent AND
// its module binds Date visibly. A singly-parented task already resolves
// correctly and is left alone — writing `mode: "off"` onto it would opt it out
// of every future visibility rule for no reason.

export const id = "0069-multiparented-tasks-show-their-date";
export const describe =
  "Multi-parented tasks stop inheriting the Schedule's hide rule, so the date "
  + "0065 revealed actually renders on the Tasks board. Only touches "
  + "occurrences with more than one parent whose module binds Date visibly.";

/** Resolve a field by name AND type — poms grid has two fields called "Due". */
export function resolveFieldByName(fields, name, type) {
  const hits = fields.filter(
    (f) => (f.name || "").toLowerCase() === name.toLowerCase() && (!type || f.type === type),
  );
  return hits.length === 1 ? hits[0] : null;
}

/** parentId list per child, from every parent's `occurrences[]`. */
export function buildParentLists(occurrences) {
  const out = new Map();
  for (const o of occurrences) {
    for (const childId of o.occurrences || []) {
      if (!out.has(childId)) out.set(childId, []);
      out.get(childId).push(o.id);
    }
  }
  return out;
}

/**
 * Which occurrences need the walk stopped at themselves.
 *
 * PURE — the selector is the whole risk of this migration.
 */
export function occurrencesNeedingOwnVisibility({ occurrences, modulesById, parentLists, dateFieldId }) {
  const out = [];
  for (const occ of occurrences) {
    // Already states something of its own → leave it alone. Overwriting a
    // deliberate rule is how a migration destroys intent, and it is also what
    // makes a re-run a no-op.
    if (occ.fieldVisibility && occ.fieldVisibility.mode) continue;
    // Singly-parented resolves correctly already — nothing to fix.
    const parents = parentLists.get(occ.id) || [];
    if (new Set(parents).size < 2) continue;
    const mod = modulesById.get(occ.moduleId);
    if (!mod || mod.role !== "instance") continue;
    // Only where a VISIBLE Date binding exists to reveal. A module that does
    // not bind Date, or binds it hidden, has nothing for this to show.
    const binding = (mod.fieldBindings || []).find((b) => b.fieldId === dateFieldId);
    if (!binding || binding.hidden === true) continue;
    out.push(occ);
  }
  return out;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [fields, mods, occs] = await Promise.all([
    Field.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Occurrence.find({ gridId }).select("-textmap").lean(),
  ]);

  const dateField = resolveFieldByName(fields, "Date", "date");
  if (!dateField) { log("  · no unambiguous Date field — REFUSING"); return; }

  const modulesById = new Map(mods.map((m) => [m.id, m]));
  const occById = new Map(occs.map((o) => [o.id, o]));
  const parentLists = buildParentLists(occs);
  const labelOf = (o) => o?.label || modulesById.get(o?.moduleId)?.label || o?.id;

  const targets = occurrencesNeedingOwnVisibility({
    occurrences: occs, modulesById, parentLists, dateFieldId: dateField.id,
  });

  log(`  · multi-parented tasks whose Date is being suppressed: ${targets.length}`);
  for (const t of targets) {
    const names = [...new Set(parentLists.get(t.id) || [])].map((p) => labelOf(occById.get(p)));
    log(`     "${labelOf(t)}" — parents: ${names.join(" | ")}`);
  }
  if (!targets.length) { log("  · nothing to fix"); return; }
  if (dryRun) { log("  · DRY RUN — nothing written"); return; }

  for (const t of targets) {
    await Occurrence.updateOne(
      { gridId, id: t.id },
      { $set: { fieldVisibility: { mode: "off" } } },
    );
  }
  log(`  ✓ ${targets.length} task(s) now show their own fields wherever they appear`);
}
