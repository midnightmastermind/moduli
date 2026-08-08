// server/migrations/0055-real-appointments-and-tasks.mjs
//
// The user's REAL appointments and tasks, 2026-08-07:
//
//   Therapy with Keith            Aug 10, 2:00pm–3:00pm, Dewey Center
//   Therapy with Keith            Aug  7, 1:00pm–2:00pm, Dewey Center
//   Peer Support Group - Froedtert Aug 13, 6:00pm–8:00pm
//   Sign up for peer support mentor class   due Aug 11
//   Talk to Angela about Vivance            due Aug 11
//   Work on Paul's website                  no due date, wants its own container
//
// ── WHY A MIGRATION FOR WHAT IS PLAINLY CONTENT ─────────────────────────────
//
// Same reason 0052 gave for adding two people: poms grid is protected live data
// and the migration runner auto-snapshots before any write. A hand-run script
// against the live grid is the exact shape of the 2026-07-28 incident where
// verifying a guard dropped the grid.
//
// ── THIS IS WHAT FINALLY EXERCISES `Schedule: Place Dated Work` ─────────────
//
// CLAUDE.md's own honest gap from 2026-08-08: "no real appointment has ever
// been placed by this op." It has been inert on poms grid because there were
// zero due-dated occurrences and the one Appointment was the catalog source.
// These rows are its first real input, so the SHAPES here are dictated by what
// the op actually matches on — read out of the stored pipeline, not assumed:
//
//   appointments  templateId IS <the Appointment module>
//                 AND Date SAME_DAY <day>  AND Time Slot IS_NOT_EMPTY
//                 AND meta.feedSourceId IS_EMPTY
//                 → SLOTS_COVERED(start = Time Slot, duration = Duration)
//
//   due work      Due IS_NOT_EMPTY  AND meta.feedSourceId IS_EMPTY
//                 → IS_DUE_ON(due, completedOn, from = Date, day)
//
// **THE `Due` THE OP READS IS `GVKdfbbkUEwW`, THE DATE ONE.** This grid has TWO
// fields called Due — a display-only number tile (`bKIKDURV5WTU`) and the real
// date — and writing the wrong one places nothing while looking entirely
// correct in the UI. Verified by counting id references in the stored pipeline:
// the date id appears 3 times, the number id zero. Everything below therefore
// resolves fields by NAME **AND TYPE**.
//
// Duration is a plain NUMBER OF MINUTES (`slotSpan.js` takes `durationMinutes`;
// the only duration value on the grid is `{value: 0}`). Dates are plain
// `YYYY-MM-DD` strings, matching every existing Date value — never a parsed
// Date object, which is how this codebase has repeatedly lost a day to UTC.
//
// ── WHERE THEY LIVE ─────────────────────────────────────────────────────────
//
// The op finds appointments by templateId across ALL instances, so their parent
// is purely where you see them when they are not in a slot. They go in the
// Tasks page's **Occupational** container — the obligations/admin dimension,
// which is where the Appointment action itself was deliberately placed on
// 2026-07-29 ("so Social keeps reading as chosen contact").
//
// **That dimension is a judgement call, and it is one gesture to undo** — drag
// the row to another container. Flagged rather than hidden.
//
// ── IT INVENTS NOTHING ──────────────────────────────────────────────────────
//
// The peer support group gets NO Appointment Type: the options are Therapy /
// Doctor / Dentist / Optometrist / Haircut / Car Service / Vet and a support
// group is none of them. Picking the nearest-looking one would be a guess that
// then feeds every type-scoped tracker. Both therapy sessions DO get Therapy,
// which the user named. Neither location carries an address yet (0054 explains
// why); that is the user's to fill with the search box.

export const id = "0055-real-appointments-and-tasks";

const uid = () => (globalThis.crypto?.randomUUID?.()
  || `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

const APPOINTMENTS = [
  { label: "Therapy with Keith", date: "2026-08-10", start: "2:00pm", minutes: 60, location: "Dewey Center", people: ["Keith"], type: "Therapy" },
  { label: "Therapy with Keith", date: "2026-08-07", start: "1:00pm", minutes: 60, location: "Dewey Center", people: ["Keith"], type: "Therapy" },
  { label: "Peer Support Group - Froedtert", date: "2026-08-13", start: "6:00pm", minutes: 120, location: "Froedtert", people: [], type: null },
];

const DUE_TASKS = [
  { label: "Sign up for peer support mentor class", due: "2026-08-11" },
  { label: "Talk to Angela about Vivance", due: "2026-08-11", people: ["Angela"] },
];

const PROJECT = {
  container: "Paul's Website",
  tasks: [{ label: "Work on Paul's website" }],
};

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Field } = models;

  // ── Fields, by NAME AND TYPE ─────────────────────────────────────────────
  const fields = await Field.find({ gridId }).lean();
  const pick = (name, type) => fields.find(
    (f) => (f.name || "").trim().toLowerCase() === name.toLowerCase() && f.type === type,
  ) || null;

  const fDate = pick("Date", "date");
  const fSlot = pick("Time Slot", "select");
  const fDuration = pick("Duration", "duration");
  const fDue = pick("Due", "date");            // NOT the number tile
  const fCompleted = pick("Completed", "boolean");
  const fCompletedOn = pick("Completed On", "date");
  const fType = pick("Appointment Type", "occurrence");
  const fLocation = pick("Location", "occurrence") || pick("Place", "occurrence");
  const fPeople = pick("People", "occurrence");

  const missing = Object.entries({ Date: fDate, "Time Slot": fSlot, Duration: fDuration, Due: fDue, Completed: fCompleted })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    log(`REFUSING: required field(s) absent or wrong type: ${missing.join(", ")}`);
    return;
  }
  log(`fields: Date=${fDate.id} Slot=${fSlot.id} Duration=${fDuration.id} Due=${fDue.id} (the DATE one)`);

  // The start label must be one the Time Slot field actually offers, or
  // SLOTS_COVERED finds no matching slot and the appointment silently lands
  // nowhere. slotSpan.js refuses an unknown start rather than rounding; this
  // refuses it earlier, where it can name the offender.
  const slotOptions = (fSlot.meta?.optionsSource?.values || fSlot.meta?.options || [])
    .map((o) => (typeof o === "string" ? o : o?.value)).filter(Boolean);
  const badStart = APPOINTMENTS.filter((a) => !slotOptions.includes(a.start));
  if (badStart.length) {
    log(`REFUSING: start time(s) the grid has no slot for: ${badStart.map((a) => a.start).join(", ")}`);
    return;
  }

  // ── The Appointment template ─────────────────────────────────────────────
  const apptMod = await Module.findOne({ gridId, role: "instance", label: "Appointment" }).lean();
  if (!apptMod) { log("REFUSING: no Appointment module on this grid"); return; }
  if (!(apptMod.fieldBindings || []).some((b) => b.fieldId === fSlot.id)) {
    log("REFUSING: the Appointment module does not bind Time Slot — 0053 has not run");
    return;
  }
  log(`Appointment template ${apptMod.id} — ${(apptMod.fieldBindings || []).length} bindings`);

  // ── Named occurrences (locations / people / types), resolved by label ────
  const labelToOcc = async (label) => {
    const mods = await Module.find({ gridId, role: "instance", label }).lean();
    if (!mods.length) return null;
    const occ = await Occurrence.findOne({ gridId, moduleId: { $in: mods.map((m) => m.id) } }).lean();
    return occ?.id || null;
  };

  // ── The Tasks page and its Occupational container ────────────────────────
  const tasksMods = await Module.find({ gridId, role: "page", label: "Tasks" }).lean();
  const tasksOcc = tasksMods.length
    ? await Occurrence.findOne({ gridId, moduleId: { $in: tasksMods.map((m) => m.id) } }).lean()
    : null;
  if (!tasksOcc) { log("REFUSING: no Tasks page on this grid"); return; }

  const tasksKids = await Occurrence.find({ gridId, id: { $in: tasksOcc.occurrences || [] } }).lean();
  const kidMods = await Module.find({ gridId, id: { $in: tasksKids.map((k) => k.moduleId) } }).lean();
  const kidModById = Object.fromEntries(kidMods.map((m) => [m.id, m]));
  const occupational = tasksKids.find((k) => kidModById[k.moduleId]?.label === "Occupational");
  if (!occupational) { log("REFUSING: no Occupational container on the Tasks page"); return; }
  log(`Tasks page ${tasksOcc.id} — home container Occupational ${occupational.id}`);

  const userId = tasksOcc.userId;
  const stamp = () => ({ flow: "in", timestamp: new Date().toISOString() });
  const linkInto = async (parentId, childId) => {
    await Occurrence.updateOne(
      { gridId, id: parentId, occurrences: { $ne: childId } },
      { $push: { occurrences: childId } },
    );
  };

  // ── 1. The appointments ──────────────────────────────────────────────────
  // Idempotent on (label + date) among the home container's children — scoped,
  // because "Therapy with Keith" legitimately repeats across dates and a global
  // label match would decide the second one already existed (0035's class).
  const homeKids = await Occurrence.find({
    gridId, id: { $in: occupational.occurrences || [] },
  }).lean();
  const homeMods = await Module.find({
    gridId, id: { $in: homeKids.map((k) => k.moduleId) },
  }).lean();
  const homeModById = Object.fromEntries(homeMods.map((m) => [m.id, m]));
  const existingKey = new Set(homeKids.map((k) => {
    const lbl = k.label || homeModById[k.moduleId]?.label || "";
    const d = k.fields?.[fDate.id]?.value || "";
    return `${lbl.toLowerCase()}@${d}`;
  }));

  let added = 0;
  for (const a of APPOINTMENTS) {
    if (existingKey.has(`${a.label.toLowerCase()}@${a.date}`)) {
      log(`SKIP   appointment ${a.label} ${a.date} — already present`);
      continue;
    }
    const locId = a.location ? await labelToOcc(a.location) : null;
    const typeId = a.type ? await labelToOcc(a.type) : null;
    const peopleIds = [];
    for (const p of a.people || []) {
      const pid = await labelToOcc(p);
      if (pid) peopleIds.push(p && pid);
      else log(`         note: no person named "${p}" — left unset`);
    }
    if (a.location && !locId) log(`         note: no location named "${a.location}" — left unset`);

    const occId = uid();
    const f = {
      [fDate.id]: { value: a.date, ...stamp() },
      [fSlot.id]: { value: a.start, ...stamp() },
      [fDuration.id]: { value: a.minutes, flow: "replace", timestamp: new Date().toISOString() },
      ...(fCompleted ? { [fCompleted.id]: { value: false, ...stamp() } } : {}),
      ...(locId && fLocation ? { [fLocation.id]: { value: locId, ...stamp() } } : {}),
      ...(typeId && fType ? { [fType.id]: { value: typeId, ...stamp() } } : {}),
      ...(peopleIds.length && fPeople ? { [fPeople.id]: { value: peopleIds, ...stamp() } } : {}),
    };
    const endMin = a.minutes;
    log(`ADD    appointment "${a.label}"  ${a.date} ${a.start} +${endMin}m  loc=${a.location || "—"} type=${a.type || "(none)"}`);
    if (dryRun) { added++; continue; }

    // Reuses the Appointment MODULE (templateId is what the op matches on) and
    // carries its own name via the per-occurrence label override.
    await new Occurrence({
      id: occId, userId, gridId,
      moduleId: apptMod.id,
      targetId: apptMod.id, targetType: "module",
      parentId: occupational.id,
      label: a.label,
      fields: f,
      occurrences: [],
    }).save();
    await linkInto(occupational.id, occId);
    added++;
  }

  // ── 2. The due-dated tasks ───────────────────────────────────────────────
  // A one-off task has no catalog entry to be an occurrence of, so each gets
  // its own module — the same shape 0052 used for a person. The bindings are
  // enumerated rather than derived because the Tasks containers are EMPTY, so
  // there is no exemplar to copy; these four are exactly what the placement op
  // and the completion sweep read.
  const taskBindings = [
    { fieldId: fCompleted.id, role: "input", order: 0 },
    { fieldId: fDue.id, role: "input", order: 1 },
    ...(fCompletedOn ? [{ fieldId: fCompletedOn.id, role: "input", order: 2, hidden: true }] : []),
    { fieldId: fDate.id, role: "input", order: 3, hidden: true },
  ];

  const existingTaskNames = new Set(homeMods.map((m) => (m.label || "").toLowerCase()));
  for (const t of DUE_TASKS) {
    if (existingTaskNames.has(t.label.toLowerCase())) {
      log(`SKIP   task ${t.label} — already present`);
      continue;
    }
    const peopleIds = [];
    for (const p of t.people || []) {
      const pid = await labelToOcc(p);
      if (pid) peopleIds.push(pid);
    }
    const modId = uid();
    const occId = uid();
    log(`ADD    task "${t.label}"  due ${t.due}`);
    if (dryRun) { added++; continue; }

    await new Module({
      id: modId, userId, gridId,
      role: "instance",
      label: t.label,
      defaultDragMode: "move",
      fieldBindings: peopleIds.length && fPeople
        ? [...taskBindings, { fieldId: fPeople.id, role: "input", order: 4 }]
        : taskBindings,
    }).save();
    await new Occurrence({
      id: occId, userId, gridId,
      moduleId: modId,
      targetId: modId, targetType: "module",
      parentId: occupational.id,
      fields: {
        [fDue.id]: { value: t.due, ...stamp() },
        [fCompleted.id]: { value: false, ...stamp() },
        ...(peopleIds.length && fPeople ? { [fPeople.id]: { value: peopleIds, ...stamp() } } : {}),
      },
      occurrences: [],
    }).save();
    await linkInto(occupational.id, occId);
    added++;
  }

  // ── 3. Paul's website, in its own container ──────────────────────────────
  // User: "organize it in a container on the Tasks page." A container rather
  // than a loose row, so the rest of that project has somewhere to go.
  const projMod = kidMods.find((m) => (m.label || "").toLowerCase() === PROJECT.container.toLowerCase());
  let projOccId = projMod
    ? tasksKids.find((k) => k.moduleId === projMod.id)?.id
    : null;

  if (projOccId) {
    log(`SKIP   container "${PROJECT.container}" — already on the Tasks page`);
  } else {
    const modId = uid();
    projOccId = uid();
    log(`ADD    container "${PROJECT.container}" on the Tasks page`);
    if (!dryRun) {
      await new Module({
        id: modId, userId, gridId,
        role: "container",
        kind: "board",
        label: PROJECT.container,
        fieldBindings: [],
      }).save();
      await new Occurrence({
        id: projOccId, userId, gridId,
        moduleId: modId,
        targetId: modId, targetType: "module",
        parentId: tasksOcc.id,
        fields: {},
        occurrences: [],
      }).save();
      await linkInto(tasksOcc.id, projOccId);
    }
    added++;
  }

  const projKids = (!dryRun && projOccId)
    ? await Occurrence.find({ gridId, parentId: projOccId }).lean()
    : [];
  const projKidMods = projKids.length
    ? await Module.find({ gridId, id: { $in: projKids.map((k) => k.moduleId) } }).lean()
    : [];
  const projNames = new Set(projKidMods.map((m) => (m.label || "").toLowerCase()));

  for (const t of PROJECT.tasks) {
    if (projNames.has(t.label.toLowerCase())) {
      log(`SKIP   task ${t.label} — already in the container`);
      continue;
    }
    const modId = uid();
    const occId = uid();
    // NO Due value — the user said this one has no due date, and an empty Due
    // is what keeps the placement op from putting it in every day's Due list.
    log(`ADD    task "${t.label}"  (no due date, by design)`);
    if (dryRun) { added++; continue; }
    await new Module({
      id: modId, userId, gridId,
      role: "instance",
      label: t.label,
      defaultDragMode: "move",
      fieldBindings: taskBindings,
    }).save();
    await new Occurrence({
      id: occId, userId, gridId,
      moduleId: modId,
      targetId: modId, targetType: "module",
      parentId: projOccId,
      fields: { [fCompleted.id]: { value: false, ...stamp() } },
      occurrences: [],
    }).save();
    await linkInto(projOccId, occId);
    added++;
  }

  log(added ? `${added} row(s) ${dryRun ? "would be" : ""} added` : "nothing to add — everything already present");
}
