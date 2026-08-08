// server/migrations/0059-psych-appointment-with-angela.mjs
//
// User, 2026-08-08: "i have a psych appointment with Angela at sixteenth
// street clinic at 9am."
//
//   Psych appointment with Angela   Aug 11, 9:00am, 30 min,
//                                   Sixteenth Street Clinic, Angela, type=Psych
//
// ── WHAT THE USER WAS ASKED, AND ANSWERED ───────────────────────────────────
//
// Three things were genuinely unknowable and are NOT guessed here:
//   DATE      — the message carried a time but no day.        → Tue Aug 11
//   DURATION  — never stated.                                  → 30 minutes
//   TYPE      — the seven options are Therapy / Doctor /
//               Dentist / Optometrist / Haircut / Car Service
//               / Vet, and a psych visit is arguably two of
//               them. 0055 left the peer support group blank
//               rather than guess, because a wrong type feeds
//               every type-scoped tracker.                     → a NEW "Psych"
//
// Inventing a date on a real medical calendar is the same class of error as
// inventing an address (0054) or a phone number (0052).
//
// ── WHY A MIGRATION FOR PLAIN CONTENT ───────────────────────────────────────
//
// 0052 and 0055's reason, unchanged: poms grid is protected live data and the
// runner auto-snapshots before any write. A hand-run script against the live
// grid is the shape of the 2026-07-28 incident where verifying a guard dropped
// the grid.
//
// ── THREE WRITES, AND TWO OF THEM ARE OPTIONS ───────────────────────────────
//
// "Psych" and "Sixteenth Street Clinic" are not strings on the appointment —
// both fields are `type: "occurrence"` dropdowns that resolve their options by
// FEED-SHAPED FIND over `$allInstances`:
//
//   Appointment Type  fields.<boardCategory>.value CONTAINS "appointment"
//   Location          fields.<boardCategory>.value CONTAINS "place"
//
// So each new option is an INSTANCE OCCURRENCE carrying the board's tag, homed
// under the board the field's own `addNew.parentOccurrenceId` names. Nothing
// here hardcodes "appointment"/"place" or a board id — both are read out of the
// FIELD's stored predicate and addNew config, which is what keeps this correct
// if the boards are ever renamed or re-tagged.
//
// **THE TAG VALUE IS AN ARRAY, NOT A SCALAR.** Every existing option stores
// `{value: ["appointment"], flow: "in"}`. `CONTAINS` matches both shapes, so a
// scalar would resolve fine in the dropdown and then be the wrong shape for
// anything that reads the field expecting a list — the trap `boardOption.js`
// records. The shape is COPIED FROM AN EXEMPLAR read at run time, never
// written from memory.
//
// ── THE CLINIC GETS NO ADDRESS, DELIBERATELY ────────────────────────────────
//
// Sixteenth Street Community Health Centers has several Milwaukee sites. A
// plausible address on a medical appointment is indistinguishable from one the
// user entered and could send them to the wrong building — 0054's rule, which
// is why Dewey Center and Froedtert still carry names only. The address field
// is bound (copied from the exemplar) and left EMPTY for the user to fill with
// the picker's own search box.
//
// ── PLACEMENT ───────────────────────────────────────────────────────────────
//
// 30 minutes from 9:00am covers the 9:00am slot ONLY — `slotSpan.js` uses a
// half-open interval, so it does not bleed into 9:30am. The row is homed in the
// Tasks page's Occupational container, the same judgement 0055 made and the
// same one gesture to undo.

export const id = "0059-psych-appointment-with-angela";
export const describe =
  "Adds ONE appointment (Psych with Angela, Aug 11 9:00am, 30 min), plus two new "
  + "dropdown options it needs: a 'Psych' appointment type and a 'Sixteenth Street "
  + "Clinic' location (name only, no address). Deletes nothing; skips anything already present.";

const uid = () => (globalThis.crypto?.randomUUID?.()
  || `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

const APPT = {
  label: "Psych appointment with Angela",
  date: "2026-08-11",
  start: "9:00am",
  minutes: 30,
  location: "Sixteenth Street Clinic",
  people: ["Angela"],
  type: "Psych",
};

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Field } = models;

  // ── Fields, by NAME AND TYPE (this grid has two fields called "Due") ─────
  const fields = await Field.find({ gridId }).lean();
  const pick = (name, type) => fields.find(
    (f) => (f.name || "").trim().toLowerCase() === name.toLowerCase() && f.type === type,
  ) || null;

  const fDate = pick("Date", "date");
  const fSlot = pick("Time Slot", "select");
  const fDuration = pick("Duration", "duration");
  const fCompleted = pick("Completed", "boolean");
  const fType = pick("Appointment Type", "occurrence");
  const fLocation = pick("Location", "occurrence");
  const fPeople = pick("People", "occurrence");

  const missing = Object.entries({
    Date: fDate, "Time Slot": fSlot, Duration: fDuration,
    Completed: fCompleted, "Appointment Type": fType, Location: fLocation,
  }).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    log(`REFUSING: required field(s) absent or wrong type: ${missing.join(", ")}`);
    return;
  }

  // The start must be a slot the grid actually offers, or SLOTS_COVERED finds
  // nothing and the appointment silently lands nowhere. Refuse where we can
  // name the offender rather than let slotSpan refuse later.
  const slotOptions = (fSlot.meta?.optionsSource?.values || fSlot.meta?.options || [])
    .map((o) => (typeof o === "string" ? o : o?.value)).filter(Boolean);
  if (!slotOptions.includes(APPT.start)) {
    log(`REFUSING: the grid has no "${APPT.start}" time slot`);
    return;
  }
  log(`fields: Date=${fDate.id} Slot=${fSlot.id} Duration=${fDuration.id} Type=${fType.id} Location=${fLocation.id}`);

  // ── Read each option field's OWN rule for what an option must carry ──────
  // The tag field id and the tag value both come out of the stored predicate,
  // so nothing here knows the words "appointment" or "place".
  const readOptionRule = (field) => {
    const rules = field.meta?.optionsSource?.predicate?.rules || [];
    const tagRule = rules.find((r) => /^fields\..+\.value$/.test(r?.left || "") && r?.right);
    if (!tagRule) return null;
    return {
      tagFieldId: tagRule.left.split(".")[1],
      tagValue: tagRule.right,
      boardOccId: field.meta?.optionsSource?.addNew?.parentOccurrenceId || null,
    };
  };

  const typeRule = readOptionRule(fType);
  const locRule = readOptionRule(fLocation);
  if (!typeRule?.boardOccId || !locRule?.boardOccId) {
    log("REFUSING: could not read the option rule (tag field / add-new board) off Appointment Type or Location");
    return;
  }
  log(`option rules: type → tag ${typeRule.tagFieldId}="${typeRule.tagValue}" under ${typeRule.boardOccId}`);
  log(`              loc  → tag ${locRule.tagFieldId}="${locRule.tagValue}" under ${locRule.boardOccId}`);

  const userId = (await Occurrence.findOne({ gridId, id: typeRule.boardOccId }).lean())?.userId;
  if (!userId) { log(`REFUSING: no board occurrence ${typeRule.boardOccId}`); return; }

  const stamp = () => ({ flow: "in", timestamp: new Date().toISOString() });
  const linkInto = async (parentId, childId) => {
    await Occurrence.updateOne(
      { gridId, id: parentId, occurrences: { $ne: childId } },
      { $push: { occurrences: childId } },
    );
  };

  // ── Ensure ONE option under a board, shaped like its siblings ────────────
  // The exemplar is read HERE, at use time. 0054's defect was copying a shape
  // captured BEFORE a later step changed it.
  const ensureOption = async (rule, label, what) => {
    const board = await Occurrence.findOne({ gridId, id: rule.boardOccId }).lean();
    const siblings = await Occurrence.find({ gridId, id: { $in: board.occurrences || [] } }).lean();
    const sibMods = await Module.find({ gridId, id: { $in: siblings.map((s) => s.moduleId) } }).lean();
    const sibModById = Object.fromEntries(sibMods.map((m) => [m.id, m]));

    const existing = siblings.find(
      (s) => ((s.label || sibModById[s.moduleId]?.label || "").trim().toLowerCase() === label.toLowerCase()),
    );
    if (existing) { log(`SKIP   ${what} option "${label}" — already present (${existing.id})`); return existing.id; }

    // Copy an exemplar that is NOT a feed copy — a copy carries its source's
    // tag and would otherwise look like a legitimate template.
    const exemplar = siblings.find((s) => !s.meta?.feedSourceId && sibModById[s.moduleId]);
    if (!exemplar) { log(`REFUSING: no exemplar option under ${rule.boardOccId} to copy the shape of`); return null; }
    const exMod = sibModById[exemplar.moduleId];
    const bindings = (exMod.fieldBindings || []).map((b) => ({
      fieldId: b.fieldId, order: b.order, hidden: b.hidden, role: b.role,
    }));
    // The tag VALUE's shape is the exemplar's, not a literal — every existing
    // option stores an array and CONTAINS would hide a scalar mistake.
    const exTag = exemplar.fields?.[rule.tagFieldId]?.value;
    const tagValue = Array.isArray(exTag) ? [rule.tagValue] : rule.tagValue;

    log(`ADD    ${what} option "${label}" under ${rule.boardOccId} — copying "${exMod.label}" (${bindings.length} bindings, tag ${JSON.stringify(tagValue)})`);
    if (dryRun) return null;

    const modId = uid();
    const occId = uid();
    await new Module({
      id: modId, userId, gridId,
      role: "instance",
      label,
      defaultDragMode: exMod.defaultDragMode || "move",
      fieldBindings: bindings,
    }).save();
    await new Occurrence({
      id: occId, userId, gridId,
      moduleId: modId, targetId: modId, targetType: "module",
      parentId: rule.boardOccId,
      fields: { [rule.tagFieldId]: { value: tagValue, ...stamp() } },
      occurrences: [],
    }).save();
    await linkInto(rule.boardOccId, occId);
    return occId;
  };

  const typeOccId = await ensureOption(typeRule, APPT.type, "appointment-type");
  const locOccId = await ensureOption(locRule, APPT.location, "location");

  // ── Angela ──────────────────────────────────────────────────────────────
  // Resolved by MODULE label among instances, then narrowed to the occurrence
  // that actually sits on the People board — "Angela" also appears inside the
  // task label "Talk to Angela about Vivance", which is a different row.
  const peopleIds = [];
  for (const p of APPT.people) {
    const mods = await Module.find({ gridId, role: "instance", label: p }).lean();
    const occ = mods.length
      ? await Occurrence.findOne({ gridId, moduleId: { $in: mods.map((m) => m.id) } }).lean()
      : null;
    if (occ) { peopleIds.push(occ.id); log(`person "${p}" → ${occ.id}`); }
    else log(`         note: no person named "${p}" — left unset`);
  }

  // ── The Tasks page's Occupational container ─────────────────────────────
  const tasksMods = await Module.find({ gridId, role: "page", label: "Tasks" }).lean();
  const tasksOcc = tasksMods.length
    ? await Occurrence.findOne({ gridId, moduleId: { $in: tasksMods.map((m) => m.id) } }).lean()
    : null;
  if (!tasksOcc) { log("REFUSING: no Tasks page on this grid"); return; }
  const tasksKids = await Occurrence.find({ gridId, id: { $in: tasksOcc.occurrences || [] } }).lean();
  const kidMods = await Module.find({ gridId, id: { $in: tasksKids.map((k) => k.moduleId) } }).lean();
  const kidModById = Object.fromEntries(kidMods.map((m) => [m.id, m]));
  const home = tasksKids.find((k) => kidModById[k.moduleId]?.label === "Occupational");
  if (!home) { log("REFUSING: no Occupational container on the Tasks page"); return; }

  // ── The Appointment template ────────────────────────────────────────────
  const apptMod = await Module.findOne({ gridId, role: "instance", label: "Appointment" }).lean();
  if (!apptMod) { log("REFUSING: no Appointment module on this grid"); return; }
  if (!(apptMod.fieldBindings || []).some((b) => b.fieldId === fSlot.id)) {
    log("REFUSING: the Appointment module does not bind Time Slot — 0053 has not run");
    return;
  }

  // ── The appointment ─────────────────────────────────────────────────────
  // Idempotent on (label + date) among the home container's children, scoped
  // rather than global: an appointment label legitimately repeats across dates.
  const homeKids = await Occurrence.find({ gridId, id: { $in: home.occurrences || [] } }).lean();
  const homeMods = await Module.find({ gridId, id: { $in: homeKids.map((k) => k.moduleId) } }).lean();
  const homeModById = Object.fromEntries(homeMods.map((m) => [m.id, m]));
  const already = homeKids.some((k) => {
    const lbl = k.label || homeModById[k.moduleId]?.label || "";
    return lbl.toLowerCase() === APPT.label.toLowerCase()
      && (k.fields?.[fDate.id]?.value || "") === APPT.date;
  });
  if (already) { log(`SKIP   appointment "${APPT.label}" ${APPT.date} — already present`); return; }

  log(`ADD    appointment "${APPT.label}"  ${APPT.date} ${APPT.start} +${APPT.minutes}m  loc=${APPT.location} type=${APPT.type} people=${peopleIds.length}`);
  if (dryRun) return;

  const occId = uid();
  await new Occurrence({
    id: occId, userId, gridId,
    moduleId: apptMod.id, targetId: apptMod.id, targetType: "module",
    parentId: home.id,
    label: APPT.label,
    fields: {
      [fDate.id]: { value: APPT.date, ...stamp() },
      [fSlot.id]: { value: APPT.start, ...stamp() },
      [fDuration.id]: { value: APPT.minutes, flow: "replace", timestamp: new Date().toISOString() },
      [fCompleted.id]: { value: false, ...stamp() },
      ...(locOccId ? { [fLocation.id]: { value: locOccId, ...stamp() } } : {}),
      ...(typeOccId ? { [fType.id]: { value: typeOccId, ...stamp() } } : {}),
      ...(peopleIds.length && fPeople ? { [fPeople.id]: { value: peopleIds, ...stamp() } } : {}),
    },
    occurrences: [],
  }).save();
  await linkInto(home.id, occId);
  log(`DONE   appointment ${occId} under Occupational ${home.id}`);
}
