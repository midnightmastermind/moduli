// server/migrations/0110-hot-tub-on-the-daily-template.mjs
//
// User, 2026-08-13: "add that to schedule in the same timeslot as hygeine."
//
// `0108` put Hot Tub beside Hygiene on the four CYCLE templates and on today's
// column. That is not yet enough for the ask to be true tomorrow: the rotation
// is not wired, so `Schedule: Build Schedule` still applies the original **Day**
// template every morning — and Day has no Hot Tub. Without this, the routine
// appears today, vanishes tomorrow, and looks like it silently stopped working.
//
// IT GOES IN HYGIENE'S OWN SLOT, resolved by FINDING Hygiene rather than by
// naming a time. On the cycle templates Hygiene sits at 7:30am (moved after the
// workouts); on Day it is still 7:00am, because Day has no workouts for it to
// come after. "The same timeslot as hygiene" is therefore a lookup, not a
// constant — and it stays correct if Hygiene is moved again later.
//
// The row is cloned from the Hot Tub ROUTINE (Physical > Care) the same way
// `0108` clones Eat and Exercise, so all three placements are the same shape.
import { randomUUID } from "node:crypto";

export const id = "0110-hot-tub-on-the-daily-template";
export const describe = "The daily 'Day' template carries Hot Tub in Hygiene's slot.";

export const TEMPLATE = "Day";
export const ROUTINE = "Hot Tub";
export const BESIDE = "Hygiene";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const byId = new Map(occs.map((o) => [o.id, o]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "?";
  const TS = fields.find((f) => f.name === "Time Slot" && !f.displayEnabled)?.id;
  if (!TS) { log(`REFUSING: no "Time Slot" field.`); return; }

  // The template the build op actually applies, found under Schedule Template.
  const stPage = occs.find((o) => nameOf(o) === "Schedule Template");
  const tpl = (stPage?.occurrences || []).map((i) => byId.get(i))
    .find((t) => t && nameOf(t) === TEMPLATE);
  if (!tpl) { log(`REFUSING: no "${TEMPLATE}" template under "Schedule Template".`); return; }

  // The routine to clone, from the Routines catalog — never a placement.
  const routines = occs.find((o) => nameOf(o) === "Routines");
  const physical = (routines?.occurrences || []).map((i) => byId.get(i))
    .find((d) => /^physical$/i.test(nameOf(d)));
  let src = null;
  for (const cid of physical?.occurrences || []) {
    for (const k of (byId.get(cid)?.occurrences || []).map((i) => byId.get(i)).filter(Boolean)) {
      if (nameOf(k) === ROUTINE) src = k;
    }
  }
  if (!src) { log(`REFUSING: no "${ROUTINE}" routine under Physical.`); return; }

  // Hygiene's slot, by lookup — see the header.
  let slot = null;
  for (const sid of tpl.occurrences || []) {
    const s = byId.get(sid);
    if ((s?.occurrences || []).some((i) => nameOf(byId.get(i)) === BESIDE)) slot = s;
  }
  if (!slot) { log(`REFUSING: "${BESIDE}" is not in any slot of "${TEMPLATE}".`); return; }

  const already = (slot.occurrences || []).some((i) => nameOf(byId.get(i)) === ROUTINE);
  const slotTime = slot.fields?.[TS]?.value;
  log(`template "${TEMPLATE}" · ${BESIDE} sits at ${slotTime}`);
  if (already) { log(`"${ROUTINE}" already there — no change.`); return; }
  if (dryRun) { log(`WOULD place "${ROUTINE}" at ${slotTime} beside ${BESIDE}.`); return; }

  const srcMod = modById.get(src.moduleId);
  const nMod = randomUUID(), nOcc = randomUUID();
  await Module.create({
    id: nMod, gridId, userId: src.userId, label: ROUTINE,
    role: srcMod?.role || "instance",
    fieldBindings: srcMod?.fieldBindings || [],
    meta: { ...(srcMod?.meta || {}) },
    ownStyle: srcMod?.ownStyle || null,
    styleMode: srcMod?.styleMode || "inherit",
  });
  await Occurrence.create({
    id: nOcc, gridId, userId: src.userId, moduleId: nMod, targetId: nMod,
    parentId: slot.id, occurrences: [],
    fields: { ...(src.fields || {}), [TS]: { value: slotTime, flow: "in" } },
    meta: { appliedFromTemplateId: src.id },
  });
  await Occurrence.updateOne({ gridId, id: slot.id }, { $push: { occurrences: nOcc } });
  log(`placed "${ROUTINE}" at ${slotTime} in "${TEMPLATE}".`);
}
