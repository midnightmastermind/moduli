// 0445 — a copy-linked CONTAINER carries no date (user, 2026-10-27).
//
// From today a copy-link group shares every field and value, Date included
// ("copylink should always share the same fields and values"). Until now Date
// and Time Slot were held back from the fan-out, because Schedule slot and Todo
// copies (one group per slot, ~38 members across the day columns) carried a
// Date — and a shared Date hides a slot on every other day. The user's point:
// "the original timeslots shouldnt have a date anyway" — the day column above
// them holds the date and its filter covers what is inside.
//
// So: every container that is a member of a linked group (2+ members) loses the
// value of each field the grid FILTERS on. Rows (instances, files, textblocks)
// are untouched — a row's date is real data. Refuses if a planned container's
// own children reference its date by identity signature (a day column: those
// are dated on purpose and are not copy-linked; the dry run must list none).
export const id = "0445-linked-containers-carry-no-date";
export const describe = "Clears the filter date off copy-linked containers (Schedule slots, Todo) now that copy-links share every field.";
export const touches = ["occurrences"];

export function filterFieldIdsOf(grid) {
  const ids = new Set(Object.keys(grid?.activeFilterValues || {}));
  for (const f of grid?.namedFilters || []) for (const c of f?.conditions || []) if (c?.fieldId) ids.add(c.fieldId);
  return ids;
}

/** Pure: which container occurrences lose which filter-field values. */
export function planClears(occurrences, roleOfModule, filterIds) {
  const groups = new Map();
  for (const o of occurrences) if (o.linkedGroupId) {
    if (!groups.has(o.linkedGroupId)) groups.set(o.linkedGroupId, []);
    groups.get(o.linkedGroupId).push(o);
  }
  const plan = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    for (const o of members) {
      if (roleOfModule(o.moduleId) !== "container") continue;
      const fids = [...filterIds].filter((f) => { const v = o.fields?.[f]?.value; return v != null && v !== ""; });
      if (fids.length) plan.push({ id: o.id, label: o.label, fields: fids, values: fids.map((f) => o.fields[f].value) });
    }
  }
  return plan;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Grid, Occurrence, Module } = models;
  const grid = await Grid.findOne({ _id: gridId }).lean();
  const filterIds = filterFieldIdsOf(grid);
  if (!filterIds.size) { log("  the grid filters on nothing — nothing to clear"); return; }
  const occs = await Occurrence.find({ gridId, linkedGroupId: { $ne: null } }).lean();
  const roles = new Map((await Module.find({ gridId, id: { $in: [...new Set(occs.map((o) => o.moduleId))] } }, { id: 1, role: 1, label: 1 }).lean()).map((m) => [m.id, m]));
  const plan = planClears(occs, (mid) => roles.get(mid)?.role, filterIds);
  const daySig = plan.filter((p) => /col:/.test(occs.find((o) => o.id === p.id)?.identitySignature || ""));
  if (daySig.length) { log(`  REFUSED: ${daySig.length} planned container(s) are day columns`); throw new Error("day columns in plan"); }
  const byLabel = {};
  for (const p of plan) { const l = p.label || roles.get(occs.find((o) => o.id === p.id)?.moduleId)?.label || p.id; byLabel[l] = (byLabel[l] || 0) + 1; }
  log(`  ${plan.length} linked container(s) carry a date: ${Object.entries(byLabel).map(([l, n]) => `${l}×${n}`).join(", ")}`);
  if (dryRun) return;
  const now = new Date();
  for (const p of plan) {
    const $set = { updatedAt: now };
    for (const f of p.fields) $set[`fields.${f}.value`] = null;
    await Occurrence.updateOne({ gridId, id: p.id }, { $set });
  }
  const after = planClears(await Occurrence.find({ gridId, linkedGroupId: { $ne: null } }).lean(), (mid) => roles.get(mid)?.role, filterIds);
  if (after.length) throw new Error(`${after.length} still dated`);
  log("  applied. RESTART pm2.");
}
