// server/migrations/0067-hide-container-fields-and-routines-noise.mjs
//
// User, 2026-08-11: *"no container should show fields right now, hide each field
// on them"* … *"but hide them on our grid"* … *"and timeslot shouldnt be shown
// in Routines"* … *"or Last Seen"*.
//
// ── MEASURED FIRST, and it named exactly what is showing ───────────────────
//
//   container modules             397
//   with a VISIBLE binding         48   → Time Slot ×48, Date ×1
//                                        and they are the SCHEDULE SLOTS
//                                        ("12:00am", "12:30am", …)
//   show-mode occurrences           0   → nothing is being FORCED on
//
//   Routines page subtree         137   → 4 bind Time Slot VISIBLY,
//                                        and 0 of them carry a value
//
// So a slot container was displaying a Time Slot pill reading "12:00am" inside
// a container already labelled "12:00am", and four Routines actions were
// showing an empty Time Slot control.
//
// ── IT HIDES THE DISPLAY, NEVER THE VALUE — the load-bearing distinction ───
//
// A slot's Time Slot value is its IDENTITY MARKER: `Schedule: Build Schedule`,
// the Alarm op and `Pomodoro: Start` all FIND a slot by
// `fields.<timeslot>.value IS "5:00pm"`, and migration `0006` records the
// damage done by clearing those values. This sets `hidden: true` on the
// BINDING — the value is untouched, so every one of those FINDs still resolves.
// Hiding a binding is a rendering decision; clearing a value is data loss.
//
// ── TWO MECHANISMS, ON PURPOSE ─────────────────────────────────────────────
//
// Containers → the binding's own `hidden` flag, because the container should
//   never show these anywhere it appears.
// Routines   → the PAGE's `fieldVisibility {mode:"hide"}`, because those four
//   modules are COPY_LINKed into the Schedule and the field may legitimately
//   matter there. A page-level hide is scoped to this page and cascades to all
//   137 descendants in one write; hiding the binding would reach further than
//   asked. It is also exactly what the Schedule page already does — it hides
//   Date + Time Slot + Last Seen the same way.

export const id = "0067-hide-container-fields-and-routines-noise";
export const describe =
  "Hides every VISIBLE field binding on container modules (48 slot containers "
  + "showing a redundant Time Slot), and hides Time Slot + Last Seen on the "
  + "Routines page via its own fieldVisibility. Values are never touched.";

/** Field names the Routines page should not display. */
export const ROUTINES_HIDDEN_FIELD_NAMES = ["Time Slot", "Last Seen"];

/** Resolve by name (case-insensitive); null when absent or ambiguous. */
export function resolveFieldByName(fields, name) {
  const hits = fields.filter((f) => (f.name || "").toLowerCase() === name.toLowerCase());
  return hits.length === 1 ? hits[0] : null;
}

/**
 * The container modules that currently SHOW at least one field, and the
 * bindings each would end up with. PURE — the selector is the whole risk.
 *
 * @returns Array<{ module, nextBindings, revealed: string[] }>
 */
export function containersShowingFields(modules) {
  const out = [];
  for (const mod of modules) {
    if (mod.role !== "container") continue;
    const bindings = Array.isArray(mod.fieldBindings) ? mod.fieldBindings : [];
    const shown = bindings.filter((b) => b.fieldId && !b.hidden);
    if (!shown.length) continue;                       // already quiet → skip
    out.push({
      module: mod,
      // Only the `hidden` flag moves. Role, order and every other key on the
      // binding survive, so un-hiding later restores exactly what was there.
      nextBindings: bindings.map((b) => (b.fieldId && !b.hidden ? { ...b, hidden: true } : b)),
      revealed: shown.map((b) => b.fieldId),
    });
  }
  return out;
}

/**
 * Merge ids into an existing hide-mode fieldVisibility without disturbing it.
 * Returns null when there is nothing to add (which is what makes a re-run a
 * no-op).
 */
export function mergeHiddenFieldIds(current, addIds) {
  const ids = addIds.filter(Boolean);
  if (!ids.length) return null;
  // An existing SHOW-mode is a deliberate whitelist; adding hide ids to it
  // would mean two different things at once. Refuse rather than guess.
  if (current?.mode === "show") return null;
  const have = new Set(Array.isArray(current?.fieldIds) ? current.fieldIds : []);
  const missing = ids.filter((id) => !have.has(id));
  if (!missing.length) return null;
  return { mode: "hide", fieldIds: [...have, ...missing] };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [fields, mods, occs] = await Promise.all([
    Field.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Occurrence.find({ gridId }).select("-textmap").lean(),
  ]);
  const modulesById = new Map(mods.map((m) => [m.id, m]));
  const labelOf = (o) => o.label || modulesById.get(o.moduleId)?.label || "";
  const fName = (id) => fields.find((f) => f.id === id)?.name || id;

  // ── 1. containers stop showing fields ───────────────────────────────────
  const targets = containersShowingFields(mods);
  const byField = {};
  for (const t of targets) for (const fid of t.revealed) byField[fName(fid)] = (byField[fName(fid)] || 0) + 1;
  log(`  · container modules showing a field: ${targets.length}  ${JSON.stringify(byField)}`);
  for (const t of targets.slice(0, 5)) log(`     "${t.module.label}" → ${t.revealed.map(fName).join(", ")}`);
  if (targets.length > 5) log(`     … +${targets.length - 5} more`);

  // ── 2. Routines hides Time Slot + Last Seen ─────────────────────────────
  const routines = occs.find(
    (o) => modulesById.get(o.moduleId)?.role === "page" && labelOf(o) === "Routines",
  );
  const hideIds = ROUTINES_HIDDEN_FIELD_NAMES
    .map((n) => resolveFieldByName(fields, n))
    .filter(Boolean)
    .map((f) => f.id);
  const nextFv = routines ? mergeHiddenFieldIds(routines.fieldVisibility, hideIds) : null;
  if (!routines) log("  · no Routines page — skipping that half");
  else log(`  · Routines page ${routines.id}: ${nextFv ? `hide ${nextFv.fieldIds.map(fName).join(", ")}` : "already hidden / show-mode — no change"}`);

  if (dryRun) { log("  · DRY RUN — nothing written"); return; }

  let modsWritten = 0;
  for (const t of targets) {
    await Module.updateOne({ gridId, id: t.module.id }, { $set: { fieldBindings: t.nextBindings } });
    modsWritten++;
  }
  if (nextFv) {
    await Occurrence.updateOne({ gridId, id: routines.id }, { $set: { fieldVisibility: nextFv } });
  }
  log(`  ✓ hid fields on ${modsWritten} container module(s)${nextFv ? "; Routines now hides Time Slot + Last Seen" : ""}`);
}
