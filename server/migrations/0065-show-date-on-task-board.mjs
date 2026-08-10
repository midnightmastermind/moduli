// server/migrations/0065-show-date-on-task-board.mjs
//
// User, 2026-08-10: *"you also need the tasks to have a date field on them and
// shown"* → *"in the tasks board"*.
//
// ── WHAT WAS ACTUALLY WRONG (measured first) ───────────────────────────────
//
// The tasks already HAVE the field. All four task modules on the board bind
// `Date` — and all four bind it HIDDEN, so it never rendered:
//
//   Therapy with Keith        Completed, Appointment Type, Location, People,
//                             Duration, Date(hidden), Habit(hidden), Time Slot
//   Sign up for peer support  Completed, Due, Completed On(hidden), Date(hidden)
//   Talk to Angela            Completed, Due, Completed On(hidden), Date(hidden), People
//   Work on Paul's website    Completed, Due, Completed On(hidden), Date(hidden)
//
// So this unhides an existing binding. It does NOT add one, and it does not
// invent a value — 4 of the 7 placements already carry a date.
//
// ── WHY NOT THE PAGE'S fieldVisibility, which is the obvious lever ─────────
//
// Show-mode is the only thing that force-shows a hidden binding
// (`resolveOccurrenceFields`: `const forced = showSet?.has(binding.fieldId)`),
// but show-mode is a WHITELIST — it hides everything not listed AND
// force-shows everything listed. Setting `{mode:"show", fieldIds:[Date]}` on
// the Tasks page would blank Completed, Due, Location, People and the rest;
// listing the full union instead would force-show `Completed On` and `Habit`,
// which are deliberately hidden. Either way it breaks something, and a new
// task carrying a new field would be invisible until someone edited the list.
//
// Unhiding the module's own binding has none of those failure modes.
//
// ── IT DOES NOT LEAK ONTO THE SCHEDULE, and that was checked ───────────────
//
// Three of these modules are also placed outside the Tasks board (on the
// Schedule). The Schedule page carries `fieldVisibility {mode:"hide"}` listing
// the Date field, and a hide-mode ancestor still suppresses it there — the day
// column IS the date, so repeating it on every row is noise. The layered
// design already covers this; nothing extra is needed.
//
// ── SCOPE: the TASKS BOARD ONLY ────────────────────────────────────────────
//
// The user named the board. Modules are collected by walking the Tasks page's
// own subtree rather than by matching a label or a field shape, so this cannot
// reach a task-like module that lives somewhere else.

export const id = "0065-show-date-on-task-board";
export const describe =
  "Unhides the existing (hidden) Date binding on the instance modules placed on "
  + "the Tasks board, so a task shows the date it already carries. Adds no "
  + "binding and writes no value; the Schedule's own hide-cascade still "
  + "suppresses Date there.";

/** Resolve a field by name AND type — poms grid has two fields called "Due". */
export function resolveFieldByName(fields, name, type) {
  const hits = fields.filter(
    (f) => (f.name || "").toLowerCase() === name.toLowerCase() && (!type || f.type === type),
  );
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Every occurrence beneath `rootId`, via `occurrences[]` (what the renderer
 * reads), depth-capped so a cycle cannot hang a migration.
 *
 * PURE — the whole risk of this migration is which modules it selects.
 */
export function collectSubtree(rootId, occById, maxDepth = 8) {
  const out = [];
  const seen = new Set([rootId]);
  const stack = [[rootId, 0]];
  while (stack.length) {
    const [id, depth] = stack.pop();
    if (depth >= maxDepth) continue;
    const occ = occById.get(id);
    if (!occ) continue;
    for (const childId of occ.occurrences || []) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      const child = occById.get(childId);
      if (!child) continue;
      out.push(child);
      stack.push([childId, depth + 1]);
    }
  }
  return out;
}

/**
 * Which modules should have their Date binding unhidden.
 * Only INSTANCE-role modules that already bind the field HIDDEN qualify:
 *  - a module that does not bind Date is left alone (adding a binding is a
 *    different, larger change than revealing one);
 *  - a module already showing it is a no-op, which is what makes a re-run safe.
 *
 * @returns Map<moduleId, module>
 */
export function modulesToReveal({ subtree, modulesById, dateFieldId }) {
  const out = new Map();
  for (const occ of subtree) {
    const mod = modulesById.get(occ.moduleId);
    if (!mod || mod.role !== "instance") continue;
    if (out.has(mod.id)) continue;
    const binding = (mod.fieldBindings || []).find((b) => b.fieldId === dateFieldId);
    if (!binding || binding.hidden !== true) continue;
    out.set(mod.id, mod);
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
  // FAIL CLOSED. Guessing which field is "the date one" is how a migration
  // reveals the wrong column on live data.
  if (!dateField) { log("  · no unambiguous Date field — REFUSING, nothing written"); return; }

  const modulesById = new Map(mods.map((m) => [m.id, m]));
  const occById = new Map(occs.map((o) => [o.id, o]));
  const labelOf = (o) => o.label || modulesById.get(o.moduleId)?.label || "(unlabelled)";

  const tasksPage = occs.find(
    (o) => modulesById.get(o.moduleId)?.role === "page" && labelOf(o) === "Tasks",
  );
  if (!tasksPage) { log("  · no Tasks page on this grid — nothing to do"); return; }

  const subtree = collectSubtree(tasksPage.id, occById);
  const targets = modulesToReveal({ subtree, modulesById, dateFieldId: dateField.id });

  log(`  · Tasks page ${tasksPage.id} — ${subtree.length} occurrence(s) in its subtree`);
  log(`  · modules whose Date binding is hidden: ${targets.size}`);
  for (const mod of targets.values()) log(`     ${mod.label || mod.id}`);
  if (!targets.size) { log("  · nothing to reveal (already shown, or none bind Date)"); return; }
  if (dryRun) { log("  · DRY RUN — nothing written"); return; }

  let wrote = 0;
  for (const mod of targets.values()) {
    // Rewrite only the ONE binding's hidden flag; every other binding, and
    // every other key on the module, is carried through untouched.
    const next = (mod.fieldBindings || []).map((b) =>
      b.fieldId === dateField.id ? { ...b, hidden: false } : b,
    );
    await Module.updateOne({ gridId, id: mod.id }, { $set: { fieldBindings: next } });
    wrote++;
  }
  log(`  ✓ revealed Date on ${wrote} task module(s)`);
}
