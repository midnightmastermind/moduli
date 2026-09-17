// 0334 — a ticked task stays in its own container.
//
// User, 2026-09-17, after copying an appointment out of Completed:
// *"i went to make it incomplete and the occurance just disappears"* →
// *"if i set something to complete, it shouldnt move it to completed section
// till end of day. it should remain in its spot"* →
// *"also feeds should not be removing the original from its spot. a feed is
// copylinks of the originals"*.
//
// ── THE FEED WAS NEVER WHAT REMOVED IT ─────────────────────────────────────
//
// The user's reading of a feed is exactly right, and the code agrees:
// `feedSync` sweeps only rows IT minted (`meta.feedSourceId`) and says so —
// *"only rows THIS feed minted are ever removed, never a hand-placed child"*.
// The Completed container mints a COPY of each ticked task and never touches
// the original.
//
// What removes the original from view is a LOCAL FILTER sitting on each of the
// eleven dimension containers on the Tasks page:
//
//     id: "hide-completed-…"   active: true   hides: true
//     rule: $occ.fields.<Completed>.value IS_NOT true
//
// So ticking a task hid it from Emotional AND (correctly) copied it into
// Completed; unticking removed the copy and left the original hidden behind a
// date filter. From the user's seat it vanished twice, and neither time was it
// where they put it.
//
// Removing the eleven filters is the whole fix. Completed stays a feed — a
// second VIEW of what is ticked — and the original never leaves its container.
//
// ── SCOPED BY THE RULE, NOT BY THE ID ──────────────────────────────────────
//
// The `hide-completed-` id prefix is a name; the thing that makes one of these
// dangerous is its SHAPE. A filter is removed only when it HIDES and its whole
// condition is one rule reading the Completed field. Any other local filter on
// those containers — a date window, a tag narrowing, anything the user added —
// is left exactly as it is, and the migration reports what it kept.
//
// The Completed field is resolved by NAME **and TYPE**, refusing on ambiguity:
// this grid carries duplicate field names (0053's own note records having to
// discriminate two fields called "Due"), and clearing filters keyed on the
// wrong field would un-hide something nobody asked about.

export const id = "0334-a-ticked-task-stays-where-it-is";
export const description =
  "Remove the hide-completed local filters from the Tasks page containers so a ticked task stays in its own container.";
export const touches = ["occurrences"];

/** The Completed field, by name AND type. Throws rather than guessing. */
export function resolveCompletedField(fields) {
  const hits = fields.filter((f) => f.name === "Completed" && f.type === "boolean");
  if (hits.length !== 1) {
    throw new Error(`expected exactly one boolean field named "Completed", found ${hits.length} - refusing`);
  }
  return hits[0].id;
}

/**
 * Does this local filter hide on Completed and nothing else?
 * PURE — which filters go is the entire risk, so it is testable without a DB.
 */
export function hidesOnCompleted(filter, completedFieldId) {
  if (!filter || filter.hides !== true) return false;
  const rules = filter.condition?.rules;
  if (!Array.isArray(rules) || rules.length !== 1) return false;
  return rules[0]?.left === `$occ.fields.${completedFieldId}.value`;
}

export function planFilterRemoval(occurrences, completedFieldId) {
  const plan = [];
  for (const occ of occurrences) {
    const filters = occ.filters;
    if (!Array.isArray(filters) || !filters.length) continue;
    const next = filters.filter((f) => !hidesOnCompleted(f, completedFieldId));
    if (next.length === filters.length) continue;
    plan.push({
      _id: occ._id,
      id: occ.id,
      removed: filters.length - next.length,
      kept: next.length,
      next,
    });
  }
  return plan;
}

export async function up({ gridId, models, log = console.log, dryRun = true }) {
  const { Occurrence, Field, Module } = models;
  const gid = String(gridId);

  const completedFieldId = resolveCompletedField(await Field.find({ gridId: gid }).lean());
  const occurrences = await Occurrence.find({ gridId: gid }).lean();
  const plan = planFilterRemoval(occurrences, completedFieldId);

  // Report by LABEL so the dry run can be checked against a named expectation
  // rather than accepted as a count (the 0035 lesson).
  const mods = new Map((await Module.find({ gridId: gid }).lean()).map((m) => [m.id, m]));
  const nameOf = (id) => {
    const o = occurrences.find((x) => x.id === id);
    return o?.label || mods.get(o?.moduleId)?.label || id;
  };

  log(`Completed field: ${completedFieldId} · containers hiding on it: ${plan.length}`);
  for (const p of plan) log(`  ${nameOf(p.id)} [${p.id}] - removing ${p.removed}, keeping ${p.kept} other filter(s)`);
  if (dryRun || !plan.length) return { changed: 0, planned: plan.length };

  for (const p of plan) await Occurrence.updateOne({ _id: p._id }, { $set: { filters: p.next } });

  // Read the RESULT back out of the database, not off the log.
  const after = await Occurrence.find({ gridId: gid }).lean();
  const left = planFilterRemoval(after, completedFieldId);
  if (left.length) throw new Error(`${left.length} container(s) still hide on Completed after the write`);
  log(`cleared ${plan.length} hide-completed filter(s); 0 left`);
  return { changed: plan.length };
}
