// 0503 — the Done field goes; Completed is what a task has (user, 2026-11-16: "all tasks should have a completed
// field, thats a must for the tasks container" · "yes lets do what you suggested to 2 and 3" · "dont mark them
// completed if they are not marked done, keep it unchecked").
//
// Done (0443) was a hidden end-of-day marker: a row in Tasks › Done since an earlier day got Done = true and the
// section's filter "Done IS false" hid it. It looked like a second "completed" and did not agree with Completed —
// 43 of 124 Done rows had Completed false (dragged into Done, never ticked), and 17 tasks could not be completed at all.
//
//   (2) Every task has Completed: the Tasks page applies [the grid's list + Completed] to everything under it
//       (`occurrence.autoAppliedFieldIds`, nearest-wins — so the grid's Tags and Date are carried, not dropped).
//   (3) The Done section keeps a row while its Completed On is empty, today or later — so a ticked task stays visible
//       for the rest of its day and is gone the next, which is what Done did, with the field every task already has.
//   A row marked Done gets Completed = true and, when it has none, Completed On = its Done Since (else yesterday), so
//   it stays hidden exactly as before. A row NOT marked Done is left unticked. Done and Done Since are then removed:
//   values, bindings, the section's filter, "Tasks: Mark Done", the two steps of "Tasks: Completed to Done" that
//   cleared them, and the fields.
export const id = "0503-done-becomes-completed";
export const describe = "Remove the Done / Done Since fields: rows marked Done become Completed (Completed On = Done Since), the Done section hides rows completed before today, and the Tasks page gives every task Completed.";
export const touches = ["fields", "modules", "occurrences", "operations"];

const DONE_SECTION = "eac2cc53-c04f-403e-ac01-dd0d76bb8f19";
const TASKS_PAGE = "9zU5UYHq5FMn";
const MARK_DONE = "Tasks: Mark Done";
const COMPLETED_TO_DONE = "Tasks: Completed to Done";

const uid = () => Math.random().toString(36).slice(2, 14);

/** The section's filters without the Done filter, plus "keep while Completed On is empty, today or later". Pure. */
export function doneSectionFilters(filters, { doneId, completedOnId }) {
  const kept = (filters || []).filter((f) => f?.fieldId !== doneId && !String(f?.id || "").startsWith("keep-today-"));
  const left = `$occ.fields.${completedOnId}.value`;
  return [...kept, {
    id: `keep-today-${uid()}`, active: true, hides: true,
    condition: { operator: "OR", rules: [
      { id: uid(), left, comparator: "IS_EMPTY", right: null },
      { id: uid(), left, comparator: "DATE_IS_TODAY", right: null },
      { id: uid(), left, comparator: "DATE_AFTER_TODAY", right: null },
    ] },
  }];
}

/** A row's fields after Done goes. Pure: null when nothing changes. Marked Done → Completed (+ Completed On). */
export function fieldsWithoutDone(fields, { doneId, sinceId, completedId, completedOnId, yesterday }) {
  if (!fields || !(doneId in fields || sinceId in fields)) return null;
  const next = { ...fields };
  if (fields[doneId]?.value === true) {
    if (next[completedId]?.value !== true) next[completedId] = { ...(next[completedId] || {}), value: true, flow: next[completedId]?.flow || "in" };
    if (!next[completedOnId]?.value) next[completedOnId] = { value: fields[sinceId]?.value || yesterday, flow: "in" };
  }
  delete next[doneId]; delete next[sinceId];
  return next;
}

/** A pipeline without the steps that write the given field ids. Pure; returns [pipeline, removedCount]. */
export function withoutFieldWrites(pipeline, fieldIds) {
  let removed = 0;
  const writes = (st) => st?.type === "action" && st.config?.type === "UPDATE" && fieldIds.some((fid) => String(st.config.path || "").includes(`.fields.${fid}.`));
  const walk = (steps) => (steps || []).filter((st) => { if (writes(st)) { removed++; return false; } return true; })
    .map((st) => ({ ...st, ...(st.then ? { then: walk(st.then) } : {}), ...(st.else ? { else: walk(st.else) } : {}), ...(st.body ? { body: walk(st.body) } : {}) }));
  return [{ ...pipeline, steps: walk(pipeline?.steps) }, removed];
}

/** The Tasks page's own list: the inherited one plus Completed. Pure. */
export function tasksAutoApplied(own, gridList, completedId) {
  const base = Array.isArray(own) ? own : (Array.isArray(gridList) ? gridList : []);
  return base.includes(completedId) ? base : [...base, completedId];
}

const localDay = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Field, Module, Occurrence, Operation } = models;
  const fields = await Field.find({ gridId }).lean();
  const byName = (n) => fields.find((f) => f.name === n);
  const done = byName("Done"), since = byName("Done Since"), completed = byName("Completed"), completedOn = byName("Completed On");
  if (!completed || !completedOn) throw new Error("REFUSING: no Completed / Completed On field");
  if (!done) { log("  no Done field — nothing to do"); return; }
  const ids = { doneId: done.id, sinceId: since?.id || "__none__", completedId: completed.id, completedOnId: completedOn.id,
    yesterday: localDay(new Date(Date.now() - 86400000)) };

  const section = await Occurrence.findOne({ gridId, id: DONE_SECTION }).lean();
  const page = await Occurrence.findOne({ gridId, id: TASKS_PAGE }).lean();
  if (!section || !page) throw new Error("REFUSING: the Tasks page or its Done section is missing");

  // rows
  const rows = await Occurrence.find({ gridId, $or: [{ [`fields.${ids.doneId}`]: { $exists: true } }, { [`fields.${ids.sinceId}`]: { $exists: true } }] }).lean();
  let ticked = 0, stamped = 0;
  const rowWrites = [];
  for (const o of rows) {
    const next = fieldsWithoutDone(o.fields, ids);
    if (!next) continue;
    if (o.fields?.[ids.doneId]?.value === true && o.fields?.[ids.completedId]?.value !== true) ticked++;
    if (o.fields?.[ids.doneId]?.value === true && !o.fields?.[ids.completedOnId]?.value) stamped++;
    rowWrites.push({ updateOne: { filter: { gridId, id: o.id }, update: { $set: { fields: next } } } });
  }
  log(`  rows carrying Done/Done Since: ${rows.length} · newly Completed: ${ticked} · Completed On stamped: ${stamped}`);

  const mods = await Module.countDocuments({ gridId, "fieldBindings.fieldId": { $in: [ids.doneId, ids.sinceId] } });
  log(`  modules binding them: ${mods}`);

  const filters = doneSectionFilters(section.filters, ids);
  const fo = { ...(section.filterOverride || {}) }; delete fo[ids.doneId];
  log(`  Done section filters: ${(section.filters || []).length} → ${filters.length} (keeps rows completed today or not yet)`);

  const ctd = await Operation.findOne({ gridId, name: COMPLETED_TO_DONE }).lean();
  const [ctdPipe, removedSteps] = ctd ? withoutFieldWrites(ctd.pipeline, [ids.doneId, ids.sinceId]) : [null, 0];
  log(`  "${COMPLETED_TO_DONE}": ${removedSteps} step(s) removed · "${MARK_DONE}" deleted`);

  const auto = tasksAutoApplied(page.autoAppliedFieldIds, grid?.meta?.autoAppliedFieldIds, ids.completedId);
  log(`  Tasks page gives every item: ${auto.map((id) => fields.find((f) => f.id === id)?.name || id).join(", ")}`);
  if (dryRun) return;

  if (rowWrites.length) await Occurrence.bulkWrite(rowWrites);
  await Module.updateMany({ gridId }, { $pull: { fieldBindings: { fieldId: { $in: [ids.doneId, ids.sinceId] } } } });
  await Occurrence.updateOne({ gridId, id: DONE_SECTION }, { $set: { filters, filterOverride: Object.keys(fo).length ? fo : null } });
  if (ctd) await Operation.updateOne({ gridId, id: ctd.id }, { $set: { pipeline: ctdPipe } });
  await Operation.deleteOne({ gridId, name: MARK_DONE });
  await Occurrence.updateOne({ gridId, id: TASKS_PAGE }, { $set: { autoAppliedFieldIds: auto } });
  await Field.deleteMany({ gridId, id: { $in: [ids.doneId, ids.sinceId] } });

  // read back
  const leftRows = await Occurrence.countDocuments({ gridId, $or: [{ [`fields.${ids.doneId}`]: { $exists: true } }, { [`fields.${ids.sinceId}`]: { $exists: true } }] });
  const leftMods = await Module.countDocuments({ gridId, "fieldBindings.fieldId": { $in: [ids.doneId, ids.sinceId] } });
  const leftFields = await Field.countDocuments({ gridId, id: { $in: [ids.doneId, ids.sinceId] } });
  const pageNow = await Occurrence.findOne({ gridId, id: TASKS_PAGE }).lean();
  log(`  read back: rows ${leftRows}, bindings ${leftMods}, fields ${leftFields}, Tasks page list ${JSON.stringify(pageNow.autoAppliedFieldIds)}`);
  if (leftRows || leftMods || leftFields || !(pageNow.autoAppliedFieldIds || []).includes(ids.completedId)) throw new Error("read-back failed");
}
