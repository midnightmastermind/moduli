// server/migrations/0071-retire-orphaned-due-shells.mjs
//
// User, 2026-08-11: *"relink those orphaned occurances to todo"*.
//
// `0070` merged each day's Due into its Todo but deliberately REFUSED two Due
// containers that no parent lists — pairing them across days would have
// silently rescheduled real work, and refusing was the right call at the time.
// This finishes them, now that where their children belong is knowable rather
// than a guess.
//
// ── WHAT THESE ACTUALLY ARE ────────────────────────────────────────────────
//
// Occurrences that no `occurrences[]` anywhere lists, yet which still hold
// children — the documented create/disconnect debris (`create_occurrence` is
// QUEUED server-side and survives; the parent-list write is a separate
// `update_occurrence` that does not). They render NOWHERE, because every
// surface reads its parent's child list. Their only remaining effect is that
// the tasks they list show phantom extra parents, which is what skewed the
// field-visibility walk in task #9.
//
// ── THE SAFE OPERATION IS A CHECK, NOT A MOVE ──────────────────────────────
//
// Their children are ALREADY in the day's Todo — 0070 put them there from the
// PAIRED Due, and these orphans list the very same occurrences. So there is
// nothing to relink: the correct action is to VERIFY each child is reachable
// from a real Todo and only then retire the shell.
//
// A child that is NOT reachable is REPORTED AND THE SHELL IS KEPT. Deleting a
// container that holds the only link to a task is exactly how work disappears,
// and "probably dead" is not good enough for a delete — the posture
// `sweepOrphans` already takes.
//
// ── WHY sweepOrphans COULD NOT DO THIS ─────────────────────────────────────
//
// Its predicate is "empty AND unreachable". These are unreachable but NOT
// empty, so it correctly declines them. Emptying them first is what makes them
// ordinary debris, and that is only safe once the children are known to be
// reachable elsewhere — which is the check below.

export const id = "0071-retire-orphaned-due-shells";
export const describe =
  "Retires Due containers that no parent lists, after verifying every child "
  + "they hold is already reachable from a real Todo. Keeps any shell whose "
  + "child would otherwise lose its last link.";

export const DUE_MARKER = "Due";
export const TODO_MARKER = "Todo";

export function readValue(occ, fieldId) {
  const raw = occ?.fields?.[fieldId];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return "value" in raw ? raw.value : undefined;
  return raw;
}

export function resolveFieldByName(fields, name, type) {
  const hits = fields.filter(
    (f) => (f.name || "").toLowerCase() === name.toLowerCase() && (!type || f.type === type),
  );
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Which orphaned Due shells can be retired, and which must be kept.
 *
 * PURE — the safety check is the whole point, so it is testable without a
 * database.
 *
 * @returns { retire: [{ occ, kids }], keep: [{ occ, unreachable }] }
 */
export function planRetire({ occurrences, timeslotFieldId }) {
  const byId = new Map(occurrences.map((o) => [o.id, o]));
  const marker = (o) => readValue(o, timeslotFieldId);

  // Who lists whom. A container is ORPHANED when nothing lists it.
  const listedBy = new Map();
  for (const o of occurrences) {
    for (const childId of o.occurrences || []) {
      if (!listedBy.has(childId)) listedBy.set(childId, new Set());
      listedBy.get(childId).add(o.id);
    }
  }

  // Every occurrence reachable from a REAL Todo — i.e. a Todo that is itself
  // listed by someone, so it actually renders.
  const inLiveTodo = new Set();
  for (const o of occurrences) {
    if (marker(o) !== TODO_MARKER) continue;
    if (!(listedBy.get(o.id)?.size)) continue;      // an orphaned Todo is no home
    for (const childId of o.occurrences || []) inLiveTodo.add(childId);
  }

  const retire = [];
  const keep = [];
  for (const o of occurrences) {
    if (marker(o) !== DUE_MARKER) continue;
    if (listedBy.get(o.id)?.size) continue;         // still listed → 0070's job, not this
    const kids = [...new Set(o.occurrences || [])];
    const unreachable = kids.filter((id) => !inLiveTodo.has(id) && byId.has(id));
    if (unreachable.length) keep.push({ occ: o, unreachable });
    else retire.push({ occ: o, kids });
  }
  return { retire, keep };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Field } = models;
  const [fields, occs] = await Promise.all([
    Field.find({ gridId }).lean(),
    Occurrence.find({ gridId }).select("-textmap").lean(),
  ]);

  const timeslot = resolveFieldByName(fields, "Time Slot", "select")
    || resolveFieldByName(fields, "Time Slot");
  if (!timeslot) { log("  · no unambiguous Time Slot field — REFUSING"); return; }

  const { retire, keep } = planRetire({ occurrences: occs, timeslotFieldId: timeslot.id });
  log(`  · orphaned Due shells: ${retire.length + keep.length}`);
  for (const r of retire) log(`     retire ${r.occ.id} — ${r.kids.length} child(ren), all already in a live Todo`);
  for (const k of keep) log(`     ⚠ KEEP ${k.occ.id} — ${k.unreachable.length} child(ren) reachable nowhere else`);
  if (!retire.length) { log("  · nothing to retire"); return; }
  if (dryRun) { log("  · DRY RUN — nothing written"); return; }

  for (const r of retire) {
    // EMPTY FIRST. delete_occurrence cascades through `occurrences[]`, so
    // removing a shell that still lists a task could take the task with it.
    await Occurrence.updateOne({ gridId, id: r.occ.id }, { $set: { occurrences: [] } });
    await Occurrence.deleteOne({ gridId, id: r.occ.id });
  }
  log(`  ✓ retired ${retire.length} orphaned shell(s); their tasks keep every real placement`);
}
