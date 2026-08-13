// server/migrations/0099-recover-lost-moods.mjs
//
// User, 2026-08-13: "the entire point is recording everything. the moods need to
// persist. if i go back to yesterday, it should show the moods for that day."
//
// 0098 STOPS THE BLEEDING; THIS PUTS BACK WHAT ALREADY BLED. Homing a Check In
// inside the schedule's Todo meant a schedule rebuild cascaded into it, so moods
// recorded on the 11th and 12th were deleted. The migration runner's own
// pre-migration snapshots still hold them, which is the one reason this is
// recoverable at all — and the reason that auto-snapshot exists.
//
// IT RECONSTRUCTS FROM EVERY SNAPSHOT, not the newest, because the rows died at
// different times: the journal's ten moods survive in an 02:32 snapshot while a
// later Check In only appears at 03:21. Taking the UNION per day and subtracting
// what is already live is what makes it idempotent — a second run recovers
// nothing.
//
// EVERY RECOVERED MOOD BECOMES A CHECK IN, not a journal value. The journal no
// longer carries Mood at all (0088, the user's call), and the Check In is what
// the wheel reads and the tracker counts. So history comes back in the shape the
// system uses now, rather than restoring a field that was deliberately removed.
//
// HOMED ON THE DAY COLUMN, exactly as 0098 does for new ones — a recovered mood
// that a schedule rebuild could delete again would be pointless.
//
// A DAY WITH NO COLUMN IS REPORTED AND SKIPPED rather than homed somewhere
// arbitrary: there is nowhere it could render, and inventing a parent is how
// rows become invisible.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

export const id = "0099-recover-lost-moods";
export const describe =
  "Puts back the moods a schedule rebuild deleted, reconstructed from the pre-migration snapshots.";

const BACKUP_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "../../backups/poms-grid");

/** PURE — union of (day -> mood ids) across snapshot rows. */
export function collectMoods(rows, { moodFieldId, dateFieldId }) {
  const byDay = new Map();
  for (const o of rows || []) {
    const v = o?.fields?.[moodFieldId]?.value;
    if (!Array.isArray(v) || !v.length) continue;
    const day = String(o?.fields?.[dateFieldId]?.value || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (!byDay.has(day)) byDay.set(day, new Set());
    for (const id of v) if (typeof id === "string" && id) byDay.get(day).add(id);
  }
  return byDay;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const byId = new Map(occs.map((o) => [o.id, o]));
  const nameOf = (id) => byId.get(id)?.label ?? modById.get(byId.get(id)?.moduleId)?.label ?? String(id).slice(0, 8);

  const moodField = fields.find((f) => f.name === "Mood");
  const dateField = fields.find((f) => f.name === "Date" && f.type === "date");
  const doneField = fields.find((f) => f.name === "Completed" && f.type === "boolean");
  const checkInMod = mods.find((m) => /^check ?in$/i.test(m.label || "") && m.role === "instance");
  if (!moodField || !dateField || !doneField || !checkInMod) {
    log(`REFUSING: mood=${!!moodField} date=${!!dateField} done=${!!doneField} checkIn=${!!checkInMod}`);
    return;
  }
  if (!fs.existsSync(BACKUP_DIR)) { log(`REFUSING: no snapshot directory at ${BACKUP_DIR}`); return; }

  // What history the snapshots remember.
  const fromSnaps = new Map();
  let scanned = 0;
  for (const snap of fs.readdirSync(BACKUP_DIR).sort()) {
    const dir = path.join(BACKUP_DIR, snap);
    let file;
    try { file = fs.readdirSync(dir).find((x) => /occurrence/i.test(x)); } catch { continue; }
    if (!file) continue;
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")); } catch { continue; }
    const rows = Array.isArray(parsed) ? parsed : (parsed.docs || parsed.occurrences || []);
    scanned++;
    for (const [day, ids] of collectMoods(rows, { moodFieldId: moodField.id, dateFieldId: dateField.id })) {
      if (!fromSnaps.has(day)) fromSnaps.set(day, new Set());
      for (const i of ids) fromSnaps.get(day).add(i);
    }
  }

  // What is live now.
  const liveByDay = collectMoods(occs, { moodFieldId: moodField.id, dateFieldId: dateField.id });

  // Where a recovered row can live.
  const graph = occs.find((o) => modById.get(o.moduleId)?.kind === "graph");
  const cols = graph ? occs.filter((o) => (o.occurrences || []).includes(graph.id)) : [];
  const colForDay = (d) => cols.find((c) =>
    String(c.fields?.[dateField.id]?.value || "").slice(0, 10) === d);

  const plan = [];
  log(`snapshots scanned: ${scanned}`);
  for (const [day, ids] of [...fromSnaps].sort()) {
    const live = liveByDay.get(day) || new Set();
    const missing = [...ids].filter((i) => !live.has(i));
    const col = colForDay(day);
    log(`  ${day}  remembered ${ids.size} · live ${live.size} · missing ${missing.length}` +
      (col ? "" : "  <- NO day column, skipped"));
    if (!col || !missing.length) continue;
    for (const moodId of missing) plan.push({ day, moodId, colId: col.id });
  }
  log(`to recover: ${plan.length} mood(s)`);
  for (const p of plan.slice(0, 30)) log(`    ${p.day}  ${nameOf(p.moodId)}`);

  if (dryRun) {
    log(`WOULD mint ${plan.length} Check In(s), homed on their day column.`);
    return;
  }
  for (const p of plan) {
    const newId = randomUUID();
    await Occurrence.create({
      id: newId, gridId, userId: checkInMod.userId,
      moduleId: checkInMod.id, parentId: p.colId,
      fields: {
        [dateField.id]: { value: p.day, flow: "in" },
        [moodField.id]: { value: [p.moodId], flow: "in" },
        [doneField.id]: { value: true, flow: "in" },
      },
      occurrences: [],
    });
    await Occurrence.updateOne(
      { gridId, id: p.colId, occurrences: { $ne: newId } },
      { $push: { occurrences: newId } });
  }
  log(`recovered ${plan.length} mood(s).`);
}
