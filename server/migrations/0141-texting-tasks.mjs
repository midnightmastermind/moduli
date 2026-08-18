/**
 * 0141 — the texting work becomes TASKS, one per person.
 *
 * USER, 2026-08-18: "could you also copy over text tasks from routines over to
 * tasks and add tasks for texting tim, terrell, shelly, and paul into the task
 * list in my grid"
 *
 * MEASURED FIRST, AND IT RESOLVED THE AMBIGUITY. There is exactly ONE `Text` on
 * the whole grid — the catalog action at `Routines > Social > Reach Out > Text`
 * (occ kksu053pE-Lo). There is no set of existing "text tasks" to move:
 *
 *     modules labelled Text        1   (role: instance)
 *     occurrences of it            1   (the catalog action, Tags=["social"])
 *     Text rows anywhere else      0
 *
 * So the four named tasks ARE the copy: the Routines action says "text someone",
 * and the Tasks page says WHO. A bare person-less "Text" row beside them would
 * be a task nobody can act on.
 *
 * THE CATALOG ACTION IS NOT MOVED, and that is deliberate. `0109` records the
 * rule the hard way: the Routines catalog holds the ONE canonical action every
 * placed row is cloned from, and matching it by label is how a migration deletes
 * the "+ Add" flow permanently. Text stays exactly where it is.
 *
 * THE `Habit` BINDING IS DELIBERATELY NOT CARRIED, and this is the load-bearing
 * decision. The Routines Text action binds Completed · People · Date · Category
 * · Habit. Per the 2026-07-30 (6) rule (`0008`/`0010`), the hidden Habit marker
 * is the discriminator "Completed Habits" counts on — a task minted with it
 * lands silently in the HABIT count instead of the TASK count. These are tasks,
 * on the Tasks page, so they take the TASK shape instead: bindings copied from
 * "Write review for Shelly", the existing task that is also about a person.
 *
 * TIM AND TERRELL DO NOT EXIST on the People board (Shelly and Paul do — `0140`
 * created them). They are created with a NAME AND NOTHING ELSE, the `0052` rule:
 * a plausible-looking phone number in a real contact list is indistinguishable
 * from one the user entered, and will be trusted.
 *
 * NO DUE DATE IS INVENTED. The ask did not name one, and "Work on Paul's
 * website" is the precedent on this very page for a task that carries none. The
 * Tasks page has an empty `filterOverride`, so an undated row renders — checked
 * rather than assumed.
 *
 * Idempotent on the task LABEL and on the person's name, so a re-run adds
 * nothing.
 */
export const id = "0141-texting-tasks";
export const describe = "Text Tim / Terrell / Shelly / Paul as tasks under Tasks > Social; Tim and Terrell added to People.";

export const CONTAINER = "Social";
export const PEOPLE = ["Tim", "Terrell", "Shelly", "Paul"];
export const labelFor = (name) => `Text ${name}`;

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

  // Resolve by name AND TYPE — this grid carries duplicate field names (0053).
  const peopleF = fields.find(f => f.name === "People" && f.type === "occurrence");
  const tagF = fields.find(f => /^board category$/i.test(f.name || ""));
  if (!peopleF || !tagF) { log("  REFUSING: missing People (occurrence) / Board Category field"); return; }

  const tasksPage = occs.find(o => {
    const md = modById.get(o.moduleId);
    return md?.role === "page" && /^tasks$/i.test(md.label || "");
  });
  if (!tasksPage) { log("  REFUSING: no Tasks page"); return; }
  const container = (tasksPage.occurrences || [])
    .map(id => byId.get(id))
    .find(o => labelOf(o) === CONTAINER);
  if (!container) { log(`  REFUSING: no "${CONTAINER}" container on the Tasks page`); return; }

  // EXEMPLARS — shapes are copied, never enumerated.
  const taskEx = occs.find(o => labelOf(o) === "Write review for Shelly");
  const personEx = occs.find(o => {
    const v = o.fields?.[tagF.id]?.value; const a = Array.isArray(v) ? v : [v];
    return a.includes("person") && !o.meta?.feedSourceId && labelOf(o) === "Keith";
  });
  // Read only — proves the concept these tasks come from still exists.
  const textAction = occs.find(o => labelOf(o) === "Text" && modById.get(o.moduleId)?.role === "instance");
  if (!taskEx || !personEx) {
    log(`  REFUSING: missing an exemplar (task ${!!taskEx} · person ${!!personEx})`);
    return;
  }
  const taskBindings = modById.get(taskEx.moduleId)?.fieldBindings || [];
  if (!taskBindings.some(b => b.fieldId === peopleF.id)) {
    log("  REFUSING: the task exemplar does not bind People — the wrong exemplar");
    return;
  }
  const personMod = modById.get(personEx.moduleId);
  const peopleBoard = occs.find(o => (o.occurrences || []).includes(personEx.id));

  // ---- plan ---------------------------------------------------------------
  const personIdOf = (name) => occs.find(o => {
    if (labelOf(o) !== name) return false;
    const v = o.fields?.[tagF.id]?.value; const a = Array.isArray(v) ? v : [v];
    return a.includes("person") && !o.meta?.feedSourceId;
  })?.id || null;

  const plan = { people: [], tasks: [], skipped: [] };
  const personIds = {};
  for (const name of PEOPLE) {
    const found = personIdOf(name);
    if (found) { personIds[name] = found; plan.skipped.push(`person ${name} (exists)`); }
    else plan.people.push(name);

    const label = labelFor(name);
    if (occs.some(o => labelOf(o).toLowerCase() === label.toLowerCase())) plan.skipped.push(`task "${label}" (exists)`);
    else plan.tasks.push({ label, person: name });
  }

  log(`  source action      : ${textAction ? `"Text" at Routines > Social > Reach Out (LEFT IN PLACE)` : "(not found — shape still copied from the task exemplar)"}`);
  log(`  people to create   : ${plan.people.join(", ") || "(none)"}`);
  log(`  tasks to create    : ${plan.tasks.length} -> ${CONTAINER}`);
  for (const t of plan.tasks) log(`      "${t.label}" · People=${t.person} · no Due (not asked for)`);
  if (plan.skipped.length) log(`  skipped            : ${plan.skipped.join(" · ")}`);
  if (dryRun) { log("  DRY RUN — nothing written"); return; }

  const owner = personEx.userId;
  const listInto = async (parentId, childId) =>
    Occurrence.updateOne({ id: parentId, gridId, occurrences: { $ne: childId } }, { $push: { occurrences: childId } });

  // ---- people: a NAME and nothing else ------------------------------------
  for (const name of plan.people) {
    const modId = uid(), occId = uid();
    await Module.create({
      id: modId, userId: owner, gridId, role: "instance", label: name,
      fieldBindings: personMod?.fieldBindings || [],
    });
    await Occurrence.create({
      id: occId, userId: owner, gridId, moduleId: modId, parentId: peopleBoard?.id || null,
      fields: { [tagF.id]: { value: personEx.fields?.[tagF.id]?.value, flow: "in" } },
    });
    if (peopleBoard) await listInto(peopleBoard.id, occId);
    personIds[name] = occId;
  }

  // ---- the tasks ----------------------------------------------------------
  for (const t of plan.tasks) {
    const modId = uid(), occId = uid();
    await Module.create({ id: modId, userId: owner, gridId, role: "instance", label: t.label, fieldBindings: taskBindings });
    await Occurrence.create({
      id: occId, userId: owner, gridId, moduleId: modId, parentId: container.id,
      fields: personIds[t.person] ? { [peopleF.id]: { value: [personIds[t.person]], flow: "in" } } : {},
    });
    await listInto(container.id, occId);
  }

  // ---- read it back, through the same lookups the app uses ----------------
  const [after, afterMods] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
  ]);
  const aMod = new Map(afterMods.map(m => [m.id, m]));
  const aById = new Map(after.map(o => [o.id, o]));
  const aLabel = (o) => o?.label || aMod.get(o?.moduleId)?.label || "";
  const cont = after.find(o => o.id === container.id);
  let bad = 0;
  for (const name of PEOPLE) {
    const label = labelFor(name);
    const o = after.find(x => aLabel(x) === label);
    const listed = !!o && (cont.occurrences || []).includes(o.id);
    const who = o?.fields?.[peopleF.id]?.value;
    const resolves = Array.isArray(who) && who.length === 1 && aLabel(aById.get(who[0])) === name;
    const habitFree = !(aMod.get(o?.moduleId)?.fieldBindings || []).some(b => /habit/i.test(fields.find(f => f.id === b.fieldId)?.name || ""));
    const ok = o && listed && resolves && habitFree;
    if (!ok) bad++;
    log(`  verify "${label}": listed by ${CONTAINER} ${listed} · People -> ${resolves ? name : "UNRESOLVED"} · no Habit binding ${habitFree} -> ${ok ? "YES" : "NO"}`);
  }
  const stillThere = after.some(o => aLabel(o) === "Text" && aMod.get(o.moduleId)?.role === "instance");
  log(`  verify the Routines "Text" action still exists: ${stillThere ? "YES" : "NO"}`);
  if (!stillThere) bad++;
  log(bad ? `  ${bad} CHECK(S) FAILED` : "  all checks passed");
}
