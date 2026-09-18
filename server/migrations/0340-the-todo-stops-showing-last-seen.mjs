// 0340 — the Todo container stops showing its Last Seen chip.
//
// User, 2026-09-18: *"id like the daypage todo to have the last seen field
// hidden."*
//
// `0067` established the rule and the mechanism: a CONTAINER's own field chips
// are bookkeeping, so its bindings are marked `hidden: true` while the VALUE is
// left exactly as it is — slots and feeds FIND containers by those values, and
// a migration that clears one breaks the thing it was tidying.
//
// The Todo binds Last Seen visibly and its occurrence carries a value
// (`2026-09-06`), which is why this one chip renders while the Time Slot chips
// on the schedule containers — bound just as visibly, but empty — do not.
// `autoAppliedFields` drops a `hidden` binding from the rendered set, so hiding
// the binding is exactly and only a display change.
//
// ONE MODULE, THIRTEEN PLACEMENTS. The Todo is a single shared container listed
// into the day columns and the schedule pages, so this quietens the chip
// everywhere it appears — which is the same container, not thirteen of them.
//
// Scoped by ROLE and by the field, the way `0067` is: an INSTANCE that binds
// Last Seen is left alone, because an instance's chips are the data you came to
// read.

export const id = "0340-the-todo-stops-showing-last-seen";
export const describe =
  "Hides the Todo container's Last Seen chip. Marks the binding hidden; the stored value is "
  + "untouched and nothing is deleted.";

const FIELD_NAME = "Last Seen";
const TODO_LABEL = /^todo$/i;

/**
 * PURE — the containers whose Last Seen binding is still visible.
 *
 * Returns `{ module, nextBindings }` per module, so the caller writes the whole
 * array back with every other key on every other binding intact.
 */
export function todosShowingLastSeen(modules, fieldId) {
  if (!fieldId) return [];
  const out = [];
  for (const m of modules || []) {
    if (m.role !== "container" || !TODO_LABEL.test(m.label || "")) continue;
    const bindings = m.fieldBindings || [];
    if (!bindings.some((b) => b.fieldId === fieldId && b.hidden !== true)) continue;
    out.push({
      module: m,
      nextBindings: bindings.map((b) => (b.fieldId === fieldId ? { ...b, hidden: true } : b)),
    });
  }
  return out;
}

export async function up({ gridId, models, log = console.log, dryRun = true }) {
  const { Module, Field, Occurrence } = models;
  const gid = String(gridId);

  const [mods, fields] = await Promise.all([
    Module.find({ gridId: gid }).lean(),
    Field.find({ gridId: gid }).lean(),
  ]);
  const named = fields.filter((f) => f.name === FIELD_NAME);
  if (named.length !== 1) {
    log(`  REFUSING: ${named.length} field(s) named "${FIELD_NAME}" — nothing written.`);
    return { changed: 0 };
  }
  const fieldId = named[0].id;
  const targets = todosShowingLastSeen(mods, fieldId);

  for (const t of targets) {
    const placements = await Occurrence.countDocuments({ gridId: gid, moduleId: t.module.id });
    log(`  ${t.module.label} [${t.module.id}] · ${placements} placement(s) · hiding ${FIELD_NAME}`);
  }
  if (!targets.length) { log(`  no Todo container shows ${FIELD_NAME} — nothing to do.`); return { changed: 0 }; }
  if (dryRun) { log("  Dry run — nothing written."); return { changed: 0 }; }

  for (const t of targets) {
    await Module.updateOne({ gridId: gid, id: t.module.id }, { $set: { fieldBindings: t.nextBindings } });
  }

  // Read the RESULT back, and assert the VALUES were not what changed.
  const after = await Module.find({ gridId: gid }).lean();
  const left = todosShowingLastSeen(after, fieldId);
  if (left.length) throw new Error(`0340: ${left.length} Todo(s) still show ${FIELD_NAME}`);
  for (const t of targets) {
    const now = after.find((m) => m.id === t.module.id);
    if ((now.fieldBindings || []).length !== (t.module.fieldBindings || []).length) {
      throw new Error(`0340: ${t.module.id} lost a binding`);
    }
  }
  log(`  ${targets.length} Todo container(s) quietened; values untouched.`);
  return { changed: targets.length };
}
