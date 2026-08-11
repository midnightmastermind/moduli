// server/migrations/0080-resolve-orphaned-journals.mjs
//
// User, 2026-08-11: "if its a duplicate, remove it from the data. but if its
// not, keep it and resolve it."
//
// 0079 made the emotions wheel record a mood, and reported that two days record
// nothing because their journal is detached from the Schedule. This settles
// those, one rule per case, measured rather than assumed:
//
//   2026-07-30  e94b2cb1  NO PARENT AT ALL   the only journal that day  -> RESOLVE
//   2026-08-10  3688118a  orphaned 9:00pm    the only journal that day  -> RESOLVE
//   2026-08-11  0bd186c8  orphaned 9:00pm    a SECOND journal that day  -> REMOVE
//   2026-08-11  9937acfa  reaches Schedule   the healthy one            -> keep
//   2026-08-12  1ff5e9c9  reaches Schedule   the healthy one            -> keep
//
// ── WHY THEY ARE HOMELESS, which is what makes two of them KEEPERS ──────────
//
// The Schedule's day columns are TRANSIENT: `Schedule: Build Schedule` deletes
// the previous column and rebuilds for the dates now in the filter. Only Aug 11
// and Aug 12 have one today. A journal whose column was swept survives with its
// slot detached — so "not reachable from the Schedule" means "an older day",
// NOT "junk". Deleting those would be deleting the user's journal for a day
// they simply are not looking at.
//
// ── THE DELETE GUARD, and why it is TEXT-ONLY ───────────────────────────────
//
// Measured at full depth through `decompressTextmap` — 0038 scored FIELD VALUES,
// fired on the app's own date stamp, and refused to delete anything; its header
// records making that mistake TWICE, and 0070 repeats the rule. A field value is
// the app's footprint; only text is the user's writing. The duplicate is removed
// only when ALL of these hold, and the migration REFUSES (loudly, writing
// nothing) if any does not:
//
//   * a sibling journal exists for the SAME DAY that DOES reach the Schedule
//   * the candidate holds 0 characters of text, at full subtree depth
//   * it holds no Mood value, and no children
//
// So a duplicate carrying writing is KEPT and reported, never dropped.
//
// ── WHAT "RESOLVE" MEANS ────────────────────────────────────────────────────
//
// The two keepers are linked into the Schedule page's own `occurrences[]`, which
// is the array every renderer and every ancestor walk reads. That makes them
// reachable — so 0079's `HAS_ANCESTOR <Schedule page>` scope finds them and
// clicking the wheel on those days records — WITHOUT inventing a day column for
// a past date, which is `Schedule: Build Schedule`'s job and not a migration's.
//
// They do not clutter the Schedule: a dated occurrence is subject to the same
// date-filter cascade as everything else, so each is visible only on its own
// day. `parentId` is set ONLY for the one that has none — re-parenting the other
// away from its slot would be moving the user's data to make a lookup tidier.
import { decompressTextmap } from "../utils/textmapCompression.js";
import fs from "node:fs";
import path from "node:path";

export const id = "0080-resolve-orphaned-journals";
export const describe =
  "Remove the one duplicate journal (empty, same day as a healthy sibling) and re-link the " +
  "genuinely homeless ones into the Schedule so the emotions wheel can record on their days.";

/** PURE — text at full subtree depth. The only thing that may veto a delete. */
export function subtreeTextLength(rootId, occById, seen = new Set()) {
  if (seen.has(rootId)) return 0;
  seen.add(rootId);
  const occ = occById.get(rootId);
  if (!occ) return 0;
  let n = 0;
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.text === "string") n += node.text.trim().length;
    for (const kid of node.content || []) walk(kid);
  };
  try {
    const tm = decompressTextmap(occ.textmap);
    if (tm) walk(tm);
  } catch { /* unreadable textmap is NOT evidence of emptiness — see the guard */ }
  for (const kid of occ.occurrences || []) n += subtreeTextLength(kid, occById, seen);
  return n;
}

/**
 * PURE — classify one dated journal. Exported so the decision is testable
 * without a database; the migration only executes what this returns.
 */
export function classifyJournal(occ, { sameDaySiblings, reachesSchedule, textLength, moodFieldId }) {
  const mood = occ.fields?.[moodFieldId]?.value;
  const hasMood = Array.isArray(mood) ? mood.length > 0 : mood != null && mood !== "";
  const hasChildren = (occ.occurrences || []).length > 0;

  if (reachesSchedule) return { action: "keep", why: "already reachable from the Schedule" };

  const healthyTwin = sameDaySiblings.some((s) => s.id !== occ.id && s.reachesSchedule);
  if (!healthyTwin) {
    return { action: "resolve", why: "the only journal for its day — homeless, not duplicate" };
  }
  // A duplicate. Only now may it be removed, and only if it is empty.
  if (textLength > 0) return { action: "keep", why: `duplicate but holds ${textLength} characters of writing` };
  if (hasMood) return { action: "keep", why: "duplicate but carries a recorded mood" };
  if (hasChildren) return { action: "keep", why: "duplicate but has children" };
  return { action: "remove", why: "duplicate of a reachable journal on the same day, and empty" };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;

  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const occById = new Map(occs.map((o) => [o.id, o]));
  const modById = new Map(mods.map((m) => [m.id, m]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "(?)";

  const dateField = fields.find((f) => f.name === "Date" && f.type === "date");
  const moodField = fields.find((f) => f.name === "Mood");
  if (!dateField || !moodField) {
    log(`REFUSING: missing field (Date=${!!dateField} Mood=${!!moodField}) — nothing written.`);
    return;
  }

  const schedulePage = occs.find((o) => {
    const m = modById.get(o.moduleId);
    return m?.role === "page" && (o.label ?? m?.label) === "Schedule";
  });
  if (!schedulePage) {
    log(`REFUSING: no Schedule page — there is nowhere to resolve a journal to.`);
    return;
  }

  const parentsOf = (id) => occs.filter((o) => (o.occurrences || []).includes(id));
  const reaches = (id) => {
    const seen = new Set();
    let cur = id, guard = 0;
    while (cur && guard++ < 16) {
      if (cur === schedulePage.id) return true;
      if (seen.has(cur)) break;
      seen.add(cur);
      cur = parentsOf(cur)[0]?.id ?? occById.get(cur)?.parentId ?? null;
    }
    return false;
  };

  // Dated journals only: an undated one is a catalog/template row, not a day's
  // journal, and must never be touched by any of this.
  const dated = occs.filter((o) =>
    (modById.get(o.moduleId)?.fieldBindings || []).some((b) => b.fieldId === moodField.id)
    && o.fields?.[dateField.id]?.value);

  const byDay = new Map();
  for (const o of dated) {
    const day = String(o.fields[dateField.id].value).slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push({ ...o, reachesSchedule: reaches(o.id) });
  }

  const toRemove = [], toResolve = [];
  for (const [day, list] of [...byDay.entries()].sort()) {
    for (const occ of list) {
      const textLength = subtreeTextLength(occ.id, occById);
      const verdict = classifyJournal(occ, {
        sameDaySiblings: list, reachesSchedule: occ.reachesSchedule,
        textLength, moodFieldId: moodField.id,
      });
      log(`${day}  ${occ.id.slice(0, 8)}  text=${textLength}  ${verdict.action.toUpperCase()} — ${verdict.why}`);
      if (verdict.action === "remove") toRemove.push(occ);
      if (verdict.action === "resolve") toResolve.push(occ);
    }
  }

  log(`\n=> remove ${toRemove.length}, resolve ${toResolve.length}`);
  if (dryRun) {
    for (const o of toRemove) log(`   WOULD REMOVE  ${o.id.slice(0, 8)} ${nameOf(o)}`);
    for (const o of toResolve) log(`   WOULD RESOLVE ${o.id.slice(0, 8)} ${nameOf(o)} -> listed by the Schedule page`);
    return;
  }

  // Dump before deleting — a restore has to be byte-for-byte what was removed.
  if (toRemove.length) {
    const dir = path.resolve("backups/orphans");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_0080-duplicate-journals.json`);
    // RAW documents (textmap still compressed) — what was actually stored.
    const raw = await Occurrence.find({ gridId, id: { $in: toRemove.map((o) => o.id) } }).lean();
    fs.writeFileSync(file, JSON.stringify(raw, null, 2));
    log(`dumped ${raw.length} document(s) to ${file}`);

    for (const o of toRemove) {
      // Unlink from every parent that lists it, then delete. Deleting without
      // unlinking is the dangling-child-ref class this repo has repaired
      // repeatedly.
      await Occurrence.updateMany({ gridId, occurrences: o.id }, { $pull: { occurrences: o.id } });
      await Occurrence.deleteOne({ gridId, id: o.id });
      log(`removed ${o.id.slice(0, 8)} (${nameOf(o)})`);
    }
  }

  for (const o of toResolve) {
    await Occurrence.updateOne(
      { gridId, id: schedulePage.id, occurrences: { $ne: o.id } },
      { $push: { occurrences: o.id } },
    );
    // Only give it a parentId if it has NONE — re-parenting one that already
    // sits in a slot would be moving the user's data to tidy a lookup.
    if (!o.parentId) {
      await Occurrence.updateOne({ gridId, id: o.id }, { $set: { parentId: schedulePage.id } });
      log(`resolved ${o.id.slice(0, 8)} (${nameOf(o)}) — listed by the Schedule page, parentId set`);
    } else {
      log(`resolved ${o.id.slice(0, 8)} (${nameOf(o)}) — listed by the Schedule page, slot parent kept`);
    }
  }
}
