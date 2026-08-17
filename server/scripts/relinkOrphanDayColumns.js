#!/usr/bin/env node
/**
 * relinkOrphanDayColumns.js — RE-LINK a day column its own parent has stopped
 * listing.
 *
 * THE SYMPTOM IS ALWAYS "the schedule didn't get created", AND IT IS NEVER THAT.
 * A page renders its `occurrences[]`; `parentId` is what the builder stamps.
 * When the two disagree the column is fully built, correct, and invisible.
 * Observed 2026-08-17 on poms grid: today's column existed with 52 children and
 * a `parentId` naming the Schedule page, while the page listed two stale
 * Journals and not the column.
 *
 * CAUSE — the documented stale-array echo (CLAUDE.md 2026-08-13 (2)): a client
 * holds whatever the last `full_state` gave it and writes the WHOLE array back.
 * The timestamps are the fingerprint: the column was updated at .406 and the
 * page's array overwritten at .409 — three milliseconds later, with a copy
 * taken before the build. Any connected tab can do this, including a headless
 * probe that loads the live grid and closes mid-burst.
 *
 * WHY `$push` AND NOT A WHOLE-ARRAY WRITE. A read-modify-write of the very
 * field that just got clobbered races the same client again. `$push` with a
 * `$ne` guard is atomic, additive, and idempotent — re-run it as often as you
 * like and it converges. Same reasoning as migration 0111.
 *
 * DELETES NOTHING. Anything else the parent lists is left exactly as it is:
 * a stale child is a nuisance, and this script has no business deciding that
 * something the user might have put there is junk.
 *
 * AFTER RUNNING: restart pm2 (the warm per-user cache is authoritative for
 * reads and will otherwise re-serve the old array) AND have the browser tab
 * reload — the restart clears the server cache, not the copy in the tab.
 *
 *   node --env-file=.env scripts/relinkOrphanDayColumns.js            # dry run
 *   node --env-file=.env scripts/relinkOrphanDayColumns.js --apply
 */
import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APPLY = process.argv.includes("--apply");
const GRID_NAME = process.argv.find((a) => a.startsWith("--grid="))?.slice(7) || "poms grid";

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const grid = await db.collection("grids").findOne({ name: GRID_NAME });
  if (!grid) throw new Error(`no grid named "${GRID_NAME}"`);
  const gridId = String(grid._id);

  const [occ, mods, fields] = await Promise.all([
    db.collection("occurrences").find({ gridId }).toArray(),
    db.collection("modules").find({ gridId }).toArray(),
    db.collection("fields").find({ gridId }).toArray(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const occById = new Map(occ.map((o) => [o.id, o]));
  const labelOf = (o) => o?.label || modById.get(o?.moduleId)?.label || "(unlabelled)";

  // STRUCTURAL, never by label. "Schedule - Monday…" is one rename away from
  // wrong; carrying a `Schedule Format` of "day-col" is what a day column IS.
  const fmtField = fields.find((f) => /schedule format/i.test(f.name || ""));
  if (!fmtField) throw new Error("no `Schedule Format` field on this grid — cannot identify a day column structurally");

  const dayCols = occ.filter((o) => o.fields?.[fmtField.id]?.value === "day-col");
  console.log(`grid "${GRID_NAME}" — ${occ.length} occurrences, ${dayCols.length} day column(s)`);

  const orphans = [];
  for (const col of dayCols) {
    const parent = col.parentId ? occById.get(col.parentId) : null;
    if (!parent) {
      console.log(`  SKIP ${labelOf(col)} — parentId ${col.parentId || "(none)"} resolves to nothing`);
      continue;
    }
    const listed = (parent.occurrences || []).includes(col.id);
    console.log(`  ${listed ? "ok  " : "ORPHAN"} ${labelOf(col)} · ${(col.occurrences || []).length} children · parent "${labelOf(parent)}" ${listed ? "lists it" : "DOES NOT list it"}`);
    if (!listed) orphans.push({ col, parent });
  }

  if (!orphans.length) { console.log("\nnothing to relink."); await mongoose.disconnect(); return; }

  if (!APPLY) {
    console.log(`\nDRY RUN — would push ${orphans.length} column id(s) into their parent's occurrences[]:`);
    for (const { col, parent } of orphans) console.log(`  ${col.id} -> "${labelOf(parent)}" (${parent.id})`);
    console.log("\nre-run with --apply");
    await mongoose.disconnect();
    return;
  }

  // Dump the parents we are about to touch. A repair that cannot be undone is
  // not a repair.
  const dir = path.join(__dirname, "..", "backups", "orphans");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dumpPath = path.join(dir, `relink-daycol-${stamp}.json`);
  fs.writeFileSync(dumpPath, JSON.stringify(orphans.map(({ col, parent }) => ({ col, parent })), null, 1));
  console.log(`\ndumped ${orphans.length} pair(s) to ${dumpPath}`);

  for (const { col, parent } of orphans) {
    const res = await db.collection("occurrences").updateOne(
      { id: parent.id, gridId, occurrences: { $ne: col.id } },
      { $push: { occurrences: col.id }, $set: { updatedAt: new Date() } },
    );
    console.log(`  ${res.modifiedCount ? "relinked" : "no-op (already listed)"}: ${col.id} -> ${parent.id}`);
  }

  // Read the result BACK. The log says what was attempted; only a re-read says
  // what is true.
  const after = await db.collection("occurrences").find({ gridId, id: { $in: orphans.map((o) => o.parent.id) } }).toArray();
  let bad = 0;
  for (const { col, parent } of orphans) {
    const p = after.find((x) => x.id === parent.id);
    const ok = (p?.occurrences || []).includes(col.id);
    if (!ok) bad++;
    console.log(`  verify: "${labelOf(parent)}" lists ${col.id} -> ${ok ? "YES" : "NO"}`);
  }
  console.log(bad ? `\n${bad} FAILED — investigate before trusting this.` : "\nall relinked.");
  console.log("NOW: restart pm2, and reload the browser tab (the tab holds its own copy of the array).");
  await mongoose.disconnect();
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
