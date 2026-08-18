/**
 * 0140 — the week's tasks, two new people, and the Keith appointment.
 *
 * USER, 2026-08-18: "add the tasks in to the tasks container (organized in):
 * look for peer mentor class, sign up for foodstamps, go grocery shopping, look
 * into WAC membership benefits, start working out, organize files, sign up for
 * case manager, an appointment with keith on aug 24th at 3pm. all except the
 * appointment, due on friday." Then: "also write review for shelly (people set
 * to Shelly), and work on clown website for Paul (people set to paul)."
 *
 * TWO OF THE ASKS ALREADY EXIST, and duplicating them would be the wrong
 * answer. Measured on the Tasks page before writing anything:
 *   "Sign up for peer support mentor class"  Occupational   <- "look for peer
 *                                                              mentor class"
 *   "Work on Paul's website"                 Paul's Website <- the clown site
 * The first is left exactly as it is. The second is the same job the user is
 * describing, so it gains the People binding they asked for instead of a second
 * copy appearing beside it.
 *
 * SHELLY AND PAUL DO NOT EXIST YET. The People field resolves occurrences off
 * the People board, so "people set to Shelly" is unsatisfiable until she is on
 * it. They are created with a NAME AND NOTHING ELSE — the `0052` rule: a
 * plausible-looking phone number or address in a real contact list is
 * indistinguishable from one the user entered, and will be trusted.
 *
 * EVERY SHAPE IS COPIED FROM AN EXEMPLAR, never enumerated. A task takes its
 * bindings from an existing task's module, the appointment from the existing
 * "Therapy with Keith" — including its Appointment Type and Location, which are
 * OCCURRENCE references this file has no business inventing. Same reasoning as
 * `0052`/`0059`: field ids and option ids drift, an exemplar does not.
 *
 * WHAT IS ASSUMED, stated rather than hidden: "friday" is 2026-08-21, the Friday
 * of the week the ask was made. The appointment takes the DURATION of Keith's
 * existing appointments (60 minutes) because the ask did not say — derived from
 * his own history rather than guessed at.
 *
 * WHICH CONTAINER EACH TASK LANDS IN is a judgement call the ask invited
 * ("organized in"), and the mapping is written here so it can be argued with:
 *   foodstamps        Financial      a benefits application
 *   grocery shopping  Physical       this grid files food under Physical
 *   WAC membership    Physical       a gym membership
 *   start working out Physical
 *   organize files    Environmental  order in your own space
 *   case manager      Occupational   where this grid already files health admin
 *   review for Shelly Social         a favour for a person, not a writing project
 *   Keith appointment Occupational   beside his existing appointments
 */
export const id = "0140-august-tasks-and-appointment";
export const describe = "Add the week's tasks (due Friday), Shelly and Paul, and the Aug 24 appointment with Keith.";

export const DUE = "2026-08-21";           // the Friday of the week asked about
export const APPT_DATE = "2026-08-24";
export const APPT_SLOT = "3:00pm";

export const TASKS = [
  { label: "Sign up for foodstamps",            container: "Financial" },
  { label: "Go grocery shopping",               container: "Physical" },
  { label: "Look into WAC membership benefits", container: "Physical" },
  { label: "Start working out",                 container: "Physical" },
  { label: "Organize files",                    container: "Environmental" },
  { label: "Sign up for case manager",          container: "Occupational" },
  { label: "Write review for Shelly",           container: "Social", person: "Shelly" },
];
export const NEW_PEOPLE = ["Shelly", "Paul"];

const uid = () => Math.random().toString(36).slice(2, 14);

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map(m => [m.id, m]));
  const byId = new Map(occs.map(o => [o.id, o]));
  const labelOf = (o) => o?.label || modById.get(o?.moduleId)?.label || "";
  const fieldByName = (n, type) => fields.find(f => f.name === n && (!type || f.type === type));

  const dueF = fieldByName("Due", "date");
  const peopleF = fieldByName("People", "occurrence");
  const dateF = fieldByName("Date", "date");
  const slotF = fieldByName("Time Slot", "select");
  const tagF = fields.find(f => /^board category$/i.test(f.name || ""));
  if (!dueF || !peopleF || !tagF) { log("  REFUSING: missing Due / People / Board Category field"); return; }

  const tasksPage = occs.find(o => {
    const md = modById.get(o.moduleId);
    return md?.role === "page" && /^tasks$/i.test(md.label || "");
  });
  if (!tasksPage) { log("  REFUSING: no Tasks page"); return; }
  const containers = new Map(
    (tasksPage.occurrences || []).map(id => [labelOf(byId.get(id)), byId.get(id)]).filter(([k, v]) => k && v),
  );

  // EXEMPLARS — the shapes are copied, never enumerated.
  const taskEx = occs.find(o => labelOf(o) === "Sign up for peer support mentor class");
  const apptEx = occs.find(o => labelOf(o) === "Therapy with Keith" && o.fields?.[slotF?.id]?.value);
  const personEx = occs.find(o => {
    const v = o.fields?.[tagF.id]?.value; const a = Array.isArray(v) ? v : [v];
    return a.includes("person") && !o.meta?.feedSourceId && labelOf(o) === "Keith";
  });
  if (!taskEx || !apptEx || !personEx) {
    log(`  REFUSING: missing an exemplar (task ${!!taskEx} · appointment ${!!apptEx} · person ${!!personEx})`);
    return;
  }
  const taskBindings = modById.get(taskEx.moduleId)?.fieldBindings || [];
  const apptBindings = modById.get(apptEx.moduleId)?.fieldBindings || [];
  const personMod = modById.get(personEx.moduleId);
  const peopleBoard = occs.find(o => (o.occurrences || []).includes(personEx.id));

  // ---- plan ---------------------------------------------------------------
  const plan = { people: [], tasks: [], appt: null, skipped: [], repointed: null };
  const personIds = {};
  for (const name of NEW_PEOPLE) {
    const found = occs.find(o => labelOf(o) === name && (Array.isArray(o.fields?.[tagF.id]?.value) ? o.fields[tagF.id].value : [o.fields?.[tagF.id]?.value]).includes("person"));
    if (found) { personIds[name] = found.id; plan.skipped.push(`person ${name} (exists)`); }
    else plan.people.push(name);
  }
  for (const t of TASKS) {
    if (occs.some(o => labelOf(o).toLowerCase() === t.label.toLowerCase())) plan.skipped.push(`task "${t.label}" (exists)`);
    else if (!containers.has(t.container)) plan.skipped.push(`task "${t.label}" (no "${t.container}" container)`);
    else plan.tasks.push(t);
  }
  const apptLabel = "Therapy with Keith";
  const already = occs.some(o => labelOf(o) === apptLabel && o.fields?.[dateF?.id]?.value === APPT_DATE);
  if (already) plan.skipped.push(`appointment ${APPT_DATE} (exists)`);
  else plan.appt = { label: apptLabel, date: APPT_DATE, slot: APPT_SLOT };

  const paulTask = occs.find(o => labelOf(o) === "Work on Paul's website");
  if (paulTask) plan.repointed = paulTask.id;

  log(`  people to create   : ${plan.people.join(", ") || "(none)"}`);
  log(`  tasks to create    : ${plan.tasks.length}`);
  for (const t of plan.tasks) log(`      "${t.label}" -> ${t.container}${t.person ? " · People=" + t.person : ""} · Due ${DUE}`);
  log(`  appointment        : ${plan.appt ? `${apptLabel} ${APPT_DATE} ${APPT_SLOT} (duration from his existing one)` : "(exists)"}`);
  log(`  Paul's website task: ${plan.repointed ? "gains a People binding set to Paul" : "(not found)"}`);
  if (plan.skipped.length) log(`  skipped            : ${plan.skipped.join(" · ")}`);
  if (dryRun) { log("  DRY RUN — nothing written"); return; }

  const owner = personEx.userId;
  const mkOcc = async (o) => { await Occurrence.create(o); occs.push(o); };
  const listInto = async (parent, childId) =>
    Occurrence.updateOne({ id: parent.id, gridId, occurrences: { $ne: childId } }, { $push: { occurrences: childId } });

  // ---- people: a NAME and nothing else -----------------------------------
  for (const name of plan.people) {
    const modId = uid(), occId = uid();
    await Module.create({
      id: modId, userId: owner, gridId, role: "instance", label: name,
      fieldBindings: personMod?.fieldBindings || [],
    });
    await mkOcc({
      id: occId, userId: owner, gridId, moduleId: modId, parentId: peopleBoard?.id || null,
      fields: { [tagF.id]: { value: personEx.fields?.[tagF.id]?.value, flow: "in" } },
    });
    if (peopleBoard) await listInto(peopleBoard, occId);
    personIds[name] = occId;
  }

  // ---- tasks --------------------------------------------------------------
  for (const t of plan.tasks) {
    const cont = containers.get(t.container);
    const modId = uid(), occId = uid();
    const bindings = [...taskBindings];
    if (t.person && !bindings.some(b => b.fieldId === peopleF.id)) bindings.push({ fieldId: peopleF.id, role: "input" });
    await Module.create({ id: modId, userId: owner, gridId, role: "instance", label: t.label, fieldBindings: bindings });
    const f = { [dueF.id]: { value: DUE, flow: "in" } };
    if (t.person && personIds[t.person]) f[peopleF.id] = { value: [personIds[t.person]], flow: "in" };
    await mkOcc({ id: occId, userId: owner, gridId, moduleId: modId, parentId: cont.id, fields: f });
    await listInto(cont, occId);
  }

  // ---- the appointment: shape copied from his existing one ----------------
  if (plan.appt) {
    const cont = containers.get("Occupational");
    const modId = uid(), occId = uid();
    await Module.create({ id: modId, userId: owner, gridId, role: "instance", label: apptLabel, fieldBindings: apptBindings });
    const f = {};
    for (const [fid, v] of Object.entries(apptEx.fields || {})) {
      // Carry the appointment's IDENTITY (type, place, who, how long) and
      // nothing about the past one's state.
      if (fid === dateF?.id || fid === slotF?.id) continue;
      if (v?.value === true) continue;                    // never copy "Completed"
      f[fid] = { ...v };
    }
    f[dateF.id] = { value: APPT_DATE, flow: "in" };
    f[slotF.id] = { value: APPT_SLOT, flow: "in" };
    await mkOcc({ id: occId, userId: owner, gridId, moduleId: modId, parentId: cont.id, fields: f });
    await listInto(cont, occId);
  }

  // ---- Paul's website: bind People rather than duplicate the task ---------
  if (plan.repointed && personIds.Paul) {
    const t = byId.get(plan.repointed);
    const md = modById.get(t.moduleId);
    const bindings = [...(md?.fieldBindings || [])];
    if (!bindings.some(b => b.fieldId === peopleF.id)) {
      bindings.push({ fieldId: peopleF.id, role: "input" });
      await Module.updateOne({ id: md.id, gridId }, { $set: { fieldBindings: bindings } });
    }
    await Occurrence.updateOne({ id: t.id, gridId }, { $set: { [`fields.${peopleF.id}`]: { value: [personIds.Paul], flow: "in" } } });
  }

  // ---- read it back -------------------------------------------------------
  const after = await Occurrence.find({ gridId }).lean();
  const afterMods = await Module.find({ gridId }).lean();
  const aMod = new Map(afterMods.map(m => [m.id, m]));
  const aLabel = (o) => o?.label || aMod.get(o?.moduleId)?.label || "";
  let bad = 0;
  for (const t of plan.tasks) {
    const o = after.find(x => aLabel(x) === t.label);
    const cont = after.find(x => aLabel(x) === t.container && (x.occurrences || []).includes(o?.id));
    const ok = o && cont && o.fields?.[dueF.id]?.value === DUE && (!t.person || Array.isArray(o.fields?.[peopleF.id]?.value));
    if (!ok) bad++;
    log(`  verify "${t.label}": in ${t.container}, due ${DUE}${t.person ? ", People set" : ""} -> ${ok ? "YES" : "NO"}`);
  }
  if (plan.appt) {
    const o = after.find(x => aLabel(x) === apptLabel && x.fields?.[dateF.id]?.value === APPT_DATE);
    const ok = !!o && o.fields?.[slotF.id]?.value === APPT_SLOT;
    if (!ok) bad++;
    log(`  verify appointment ${APPT_DATE} ${APPT_SLOT} -> ${ok ? "YES" : "NO"}`);
  }
  if (bad) throw new Error(`${bad} item(s) did not persist correctly`);
}
