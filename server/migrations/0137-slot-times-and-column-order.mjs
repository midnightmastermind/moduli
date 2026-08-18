/**
 * 0137 — slots get their Time Slot back, and day columns are put in clock order.
 *
 * USER, 2026-08-18: "it only did 4am on and forgot todo list."
 *
 * Both halves of that are one column read the way it is STORED. Today's column
 * lists its children starting at 4:00am and wraps round to 12:00am at the END,
 * with Todo buried in the middle after 12:00pm — a day column renders its
 * `occurrences[]` in array order, so that is exactly what was on screen. Nothing
 * was missing; it was rotated.
 *
 * Underneath it, real data damage:
 *
 *     time-labelled slot occurrences   482
 *       Time Slot EMPTY                102   <- 20 on the `Day` TEMPLATE
 *       Time Slot != its own label       0
 *
 * THE TEMPLATE IS WHERE IT MATTERS. `Schedule: Build Schedule` COPY_LINKs each
 * day's slots from `Day`, so 20 empty slots there become 20 empty slots on every
 * column built afterwards — today's column mirrors the template exactly.
 *
 * WHY FILLING FROM THE LABEL IS SAFE HERE, measured rather than assumed: of the
 * 380 slots that DO carry a value, **zero** differ from their own label. So the
 * convention "a slot's Time Slot is its own label" is not an assumption, it is
 * what the surviving data says without exception. This only ever fills an EMPTY
 * value — it never rewrites one, so an identity marker or a hand-set value
 * cannot be clobbered. That distinction is the whole safety of the change: the
 * 2026-07-30 repair had to tell an identity marker from a mis-stamp because
 * both existed; here there are no mis-stamps to tell apart.
 *
 * WHY IT IS NOT COSMETIC. `Alarm`, `Pomodoro: Start` and `Schedule: Mark Passed
 * Slots` all FIND a slot by `fields.<timeslot>.value`. An empty one is invisible
 * to all three, so an alarm lands nowhere and the current-slot tint never moves.
 *
 * ORDER IS RESTORED TO THE DOCUMENTED CONVENTION — heads first (Todo), then the
 * slots in clock order. Deliberately NOT alphabetical and not by creation time:
 * "10:00am" sorts before "2:00am" as text, and creation order is what produced
 * the rotation in the first place (a column rebuilt in several passes appends as
 * it goes).
 *
 * ANYTHING THAT IS NOT A SLOT KEEPS ITS PLACE, at the front, in its existing
 * relative order — this reorders a schedule, it does not decide what belongs in
 * one.
 */
export const id = "0137-slot-times-and-column-order";
export const describe =
  "Refill empty Time Slot values from each slot's own label, and put day columns + the Day template back in clock order.";

const SLOT_LABEL = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i;

/** "4:30pm" -> 990. Null for anything that is not a slot label. */
export function slotMinutes(label) {
  const m = SLOT_LABEL.exec(String(label || "").trim());
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "pm") h += 12;
  return h * 60 + Number(m[2]);
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const byId = new Map(occs.map(o => [o.id, o]));
  const modById = new Map(mods.map(m => [m.id, m]));
  const labelOf = (o) => o?.label || modById.get(o?.moduleId)?.label || "";

  const tsField = fields.find(f => /^time slot$/i.test(f.name || ""));
  const fmtField = fields.find(f => /^schedule format$/i.test(f.name || ""));
  if (!tsField || !fmtField) {
    log("  REFUSING: no `Time Slot` / `Schedule Format` field on this grid");
    return;
  }

  // ---- 1. refill empty Time Slot values ----------------------------------
  // CONTROL FIRST: if no slot anywhere disagrees with its label, the rule holds.
  // A slot that DID disagree would mean this grid uses the value for something
  // else, and filling blanks from labels would be guessing.
  const slots = occs.filter(o => slotMinutes(labelOf(o)) != null);
  const disagreeing = slots.filter(o => {
    const v = o.fields?.[tsField.id]?.value;
    return v && v !== labelOf(o);
  });
  if (disagreeing.length) {
    log(`  REFUSING: ${disagreeing.length} slot(s) carry a Time Slot that is NOT their own label — the label rule does not hold on this grid`);
    return;
  }

  const empty = slots.filter(o => {
    const v = o.fields?.[tsField.id]?.value;
    return v == null || v === "";
  });
  log(`  slots: ${slots.length} · empty Time Slot: ${empty.length} · disagreeing: 0 (the control)`);

  // ---- 2. collect the containers whose order is the schedule --------------
  // STRUCTURAL: a day column carries `Schedule Format = day-col`; the template
  // is whatever else LISTS slots. Never by label — "Day" is one rename away.
  const isDayCol = (o) => o.fields?.[fmtField.id]?.value === "day-col";
  const listsSlots = (o) => (o.occurrences || []).some(id => slotMinutes(labelOf(byId.get(id))) != null);
  const holders = occs.filter(o => (isDayCol(o) || listsSlots(o)) && (o.occurrences || []).length > 1);

  const reorders = [];
  for (const h of holders) {
    const kids = h.occurrences || [];
    const heads = kids.filter(id => slotMinutes(labelOf(byId.get(id))) == null);
    const slotIds = kids.filter(id => slotMinutes(labelOf(byId.get(id))) != null);
    const sorted = [...slotIds].sort(
      (a, b) => slotMinutes(labelOf(byId.get(a))) - slotMinutes(labelOf(byId.get(b))),
    );
    const next = [...heads, ...sorted];
    if (JSON.stringify(next) !== JSON.stringify(kids)) {
      reorders.push({ id: h.id, label: labelOf(h), next, firstWas: labelOf(byId.get(kids[0])), firstNow: labelOf(byId.get(next[0])) });
    }
  }
  log(`  containers holding slots: ${holders.length} · out of clock order: ${reorders.length}`);
  for (const r of reorders) log(`    "${r.label}": starts ${r.firstWas} -> ${r.firstNow}`);

  if (dryRun) { log("  DRY RUN — nothing written"); return; }

  let filled = 0;
  for (const o of empty) {
    await Occurrence.updateOne(
      { id: o.id, gridId },
      { $set: { [`fields.${tsField.id}`]: { value: labelOf(o), flow: "in" } } },
    );
    filled++;
  }
  for (const r of reorders) {
    await Occurrence.updateOne({ id: r.id, gridId }, { $set: { occurrences: r.next } });
  }

  // Read the RESULT back — the log says what was attempted, not what is true.
  const after = await Occurrence.find({ gridId }).lean();
  const afterById = new Map(after.map(o => [o.id, o]));
  const stillEmpty = after.filter(o => {
    const lab = o.label || modById.get(o.moduleId)?.label || "";
    return slotMinutes(lab) != null && !(o.fields?.[tsField.id]?.value);
  }).length;
  const stillUnsorted = holders.filter(h => {
    const kids = afterById.get(h.id)?.occurrences || [];
    const s = kids.map(id => slotMinutes(afterById.get(id)?.label || modById.get(afterById.get(id)?.moduleId)?.label || "")).filter(v => v != null);
    return s.some((v, i) => i && v < s[i - 1]);
  }).length;
  log(`  filled ${filled} · reordered ${reorders.length}`);
  log(`  verify: slots still empty ${stillEmpty} · containers still out of order ${stillUnsorted}`);
  if (stillEmpty || stillUnsorted) throw new Error("repair did not converge");
}
