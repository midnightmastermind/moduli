// scripts/sweepOrphans.js
//
// Delete documents whose `gridId` points at a grid that no longer exists.
//
// These accumulate because `delete_grid` used to remove the Grid row only and
// strand everything scoped to it (fixed 2026-07-28, but the historical debris
// remains). Orphans are invisible in the app yet still load into every
// `full_state` scan, so they are a slow leak on load time, not just untidiness.
//
// CONSERVATIVE BY DESIGN: only documents with a gridId that matches NO existing
// grid are swept. Documents with a NULL/absent gridId are reported and LEFT
// ALONE — they could be mid-flight writes, and "probably dead" is not good
// enough for a delete.
//
// ALSO repairs DANGLING CHILD REFS: ids in an occurrence's `occurrences[]`
// that point at documents which do not exist. Those are litter from the
// create/update asymmetry — `create_occurrence` is queued server-side and
// bails on disconnect, `update_occurrence` is neither, so a client that went
// away mid-burst persisted a parent listing children that were never created
// (fixed at the source 2026-07-29: the create carries parentId and the server
// links it atomically, so the client no longer emits its own parent write).
//
// ALSO sweeps MODULE-LESS OCCURRENCES: the same asymmetry one level up. The
// occurrence's own create survived the queue and its MODULE's did not, so it
// renders as nothing, forever — `gridIntegrity`'s `missing-module` error. These
// turn up after most live-probing sessions and were being cleaned by a fresh
// ad-hoc script each time; this is that script, kept.
//
// Only EMPTY, UNREACHABLE ones go: no text, no field values, no children, and
// listed by no parent's `occurrences[]` or textmap embed. Anything else is
// reported and LEFT ALONE. Text is measured through `decompressTextmap` — raw
// reads store textmap COMPRESSED, so scanning the raw value reports "no text"
// for everything and would happily delete a journal entry.
//
// Usage:
//   node --env-file=server/.env server/scripts/sweepOrphans.js            # dry run
//   node --env-file=server/.env server/scripts/sweepOrphans.js --apply

import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

import Grid from "../models/Grid.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Field from "../models/Field.js";
import View from "../models/View.js";
import Manifest from "../models/Manifest.js";
import Folder from "../models/Folder.js";
import Operation from "../models/Operation.js";
import User from "../models/User.js";
import { decompressTextmap } from "../utils/textmapCompression.js";

const COLLECTIONS = [
  ["occurrences", Occurrence], ["modules", Module], ["fields", Field],
  ["views", View], ["manifests", Manifest], ["folders", Folder],
  ["operations", Operation],
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

const APPLY = process.argv.includes("--apply");
const EMAIL = process.argv.includes("--user")
  ? process.argv[process.argv.indexOf("--user") + 1] : "josh@jpoms.com";
// Scope the REPAIR passes (dangling child refs, module-less occurrences) to one
// grid. Without it those passes walk every live grid, so repairing poms grid
// also rewrites `test grid 1` — the frozen archive — with nothing to stop it.
// Deliberately NOT an assertNotProtected guard: that rule exists to stop a grid
// being DELETED, and poms grid is protected yet is swept on purpose. What was
// missing is operator choice, not protection.
// Pass 1 (true orphans) is unscoped by design — it only matches documents whose
// gridId names a grid that no longer exists, and a live grid is never that.
const GRID_NAME = process.argv.includes("--grid")
  ? process.argv[process.argv.indexOf("--grid") + 1] : null;

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGO_URI is not set (run with --env-file=server/.env)");
  await mongoose.connect(uri);

  const user = await User.findOne({ email: EMAIL }).lean();
  if (!user) throw new Error(`User not found: ${EMAIL}`);
  const userId = user._id.toString();

  const grids = await Grid.find({ userId }).select({ _id: 1, name: 1 }).lean();
  const live = new Set(grids.map(g => g._id.toString()));
  console.log(`👤 ${EMAIL} — ${grids.length} live grid(s): ${grids.map(g => `"${g.name || "(unnamed)"}"`).join(", ")}`);

  // Resolve --grid to an id up front and FAIL if it names nothing — a typo must
  // not silently widen the sweep back to every grid.
  let scopeGridId = null;
  if (GRID_NAME) {
    const match = grids.find(g => (g.name || "").toLowerCase() === GRID_NAME.toLowerCase());
    if (!match) {
      throw new Error(`--grid "${GRID_NAME}" matched no grid. Available: ${grids.map(g => `"${g.name}"`).join(", ")}`);
    }
    scopeGridId = match._id.toString();
  }
  console.log(GRID_NAME
    ? `🎯 repair passes scoped to "${GRID_NAME}" — no other grid is written`
    : `⚠️  repair passes will write EVERY live grid above (pass --grid "<name>" to scope)`);
  console.log("");

  let orphanTotal = 0, nullTotal = 0;
  const plan = [];

  for (const [name, model] of COLLECTIONS) {
    const docs = await model.find({ userId }).select({ _id: 1, gridId: 1 }).lean();
    const nulls = docs.filter(d => !d.gridId);
    const orphans = docs.filter(d => d.gridId && !live.has(String(d.gridId)));
    if (nulls.length) nullTotal += nulls.length;
    if (!orphans.length) continue;

    const byGrid = {};
    for (const o of orphans) byGrid[o.gridId] = (byGrid[o.gridId] || 0) + 1;
    console.log(`   ${name}: ${orphans.length} orphan(s)`);
    for (const [gid, n] of Object.entries(byGrid)) console.log(`      ${gid} → ${n}`);
    orphanTotal += orphans.length;
    plan.push({ name, model, ids: orphans.map(o => o._id) });
  }

  // ── Dangling child refs ────────────────────────────────────────────────
  const allOccs = await Occurrence.find({ userId })
    .select({ _id: 1, id: 1, gridId: 1, occurrences: 1, moduleId: 1, parentId: 1, label: 1, fields: 1, textmap: 1 })
    .lean();
  const liveIds = new Set(allOccs.map(o => o.id));
  const doomedIds = new Set(plan.flatMap(p => p.ids.map(String)));
  const byId = new Map(allOccs.map(o => [String(o._id), o]));
  const danglingFix = [];
  for (const o of allOccs) {
    if (doomedIds.has(String(o._id))) continue;          // being deleted anyway
    // Only PARENTS in the target grid are repaired. `liveIds` stays global on
    // purpose, so a child that legitimately lives elsewhere is never counted as
    // dangling just because the sweep is scoped.
    if (scopeGridId && String(o.gridId) !== scopeGridId) continue;
    const kids = o.occurrences || [];
    const kept = kids.filter(k => liveIds.has(k));
    if (kept.length !== kids.length) danglingFix.push({ _id: o._id, id: o.id, gridId: o.gridId, before: kids.length, kept });
  }
  const danglingTotal = danglingFix.reduce((n, d) => n + (d.before - d.kept.length), 0);
  if (danglingTotal) {
    console.log(`\n   DANGLING child refs: ${danglingTotal} across ${danglingFix.length} parent(s)`);
    for (const d of danglingFix.slice(0, 6)) console.log(`      ${d.id}: ${d.before} → ${d.kept.length}`);
    if (danglingFix.length > 6) console.log(`      … ${danglingFix.length - 6} more`);
  }

  // ── Module-less occurrences ────────────────────────────────────────────
  // Matches gridIntegrity's `missing-module` rule exactly (per-grid module
  // lookup) so a clean sweep clears that error rather than half of it.
  const allMods = await Module.find({ userId }).select({ id: 1, gridId: 1 }).lean();
  const modKeys = new Set(allMods.map(m => `${m.gridId}::${m.id}`));
  const listedIds = new Set();
  const embeddedIds = new Set();
  for (const o of allOccs) {
    for (const k of o.occurrences || []) listedIds.add(k);
    const tm = decompressTextmap(o.textmap) || {};
    for (const n of tm.content || []) {
      const ref = n?.attrs?.occurrenceId;
      if (ref) embeddedIds.add(ref);
    }
  }
  const hasText = (o) => {
    const tm = decompressTextmap(o?.textmap) || {};
    return /"text":"[^"]+"/.test(JSON.stringify(tm.content || []));
  };
  const hasFieldValue = (o) => Object.values(o.fields || {})
    .some(v => v && v.value !== null && v.value !== undefined && v.value !== "");

  const moduleLessDrop = [];
  let moduleLessKept = 0;
  for (const o of allOccs) {
    if (doomedIds.has(String(o._id))) continue;          // its whole grid is going
    if (scopeGridId && String(o.gridId) !== scopeGridId) continue;
    if (!o.gridId || modKeys.has(`${o.gridId}::${o.moduleId}`)) continue;
    const why = [];
    if (hasText(o)) why.push("has writing");
    if (hasFieldValue(o)) why.push("has field values");
    if ((o.occurrences || []).length) why.push("has children");
    if (listedIds.has(o.id)) why.push("a parent lists it");
    if (embeddedIds.has(o.id)) why.push("a textmap embeds it");
    if (why.length) {
      console.log(`      KEEPING module-less ${o.id.slice(0, 8)} — ${why.join(", ")}`);
      moduleLessKept++;
      continue;
    }
    moduleLessDrop.push(o);
  }
  if (moduleLessDrop.length || moduleLessKept) {
    console.log(`\n   MODULE-LESS occurrences: ${moduleLessDrop.length} empty + unreachable ` +
                `(deleting)${moduleLessKept ? `, ${moduleLessKept} kept` : ""}`);
    for (const o of moduleLessDrop.slice(0, 6)) {
      console.log(`      ${o.id.slice(0, 8)}  parentId=${(o.parentId || "(none)").slice(0, 8)}`);
    }
    if (moduleLessDrop.length > 6) console.log(`      … ${moduleLessDrop.length - 6} more`);
  }

  if (nullTotal) {
    console.log(`\n   ${nullTotal} document(s) have NO gridId — left alone on purpose ` +
                `(could be mid-flight; "probably dead" is not good enough for a delete).`);
  }
  if (!orphanTotal && !danglingTotal && !moduleLessDrop.length) {
    console.log("\n✅ No orphans, no dangling child refs, no module-less occurrences.");
    return;
  }

  console.log(`\n   TOTAL: ${orphanTotal} orphan document(s), ${danglingTotal} dangling child ref(s)` +
              `, ${moduleLessDrop.length} module-less occurrence(s)`);
  if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with --apply."); return; }

  // Dump the FULL documents before deleting. backupGrid can't cover these —
  // it is grid-scoped and these belong to no grid — so this is their only
  // safety net, and a sweep with no way back is not one I want to run.
  const dumpDir = resolve(REPO_ROOT, "backups", "orphans");
  fs.mkdirSync(dumpDir, { recursive: true });
  const dumpPath = path.join(dumpDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const dump = { _danglingParents: danglingFix.map(d => ({ _id: d._id, id: d.id, gridId: d.gridId, occurrencesBefore: (byId.get(String(d._id))?.occurrences) || [] })) };
  for (const { name, model, ids } of plan) {
    dump[name] = await model.find({ _id: { $in: ids } }).lean();
  }
  // Dumped RAW (textmap still compressed) — a restore has to be byte-for-byte
  // what was deleted, not a decompressed rendering of it.
  const moduleLessIds = moduleLessDrop.map(o => o._id);
  dump.moduleLess = moduleLessIds.length
    ? await Occurrence.find({ _id: { $in: moduleLessIds } }).lean() : [];
  fs.writeFileSync(dumpPath, JSON.stringify(dump, null, 2));
  const dumped = Object.entries(dump).reduce((n, [k, a]) => n + (k.startsWith("_") ? 0 : a.length), 0);
  const expected = orphanTotal + moduleLessDrop.length;
  if (dumped !== expected) {
    throw new Error(`Dump holds ${dumped} of ${expected} documents — refusing to delete.`);
  }
  console.log(`\n💾 Dumped ${dumped} document(s) → ${dumpPath}`);

  for (const { name, model, ids } of plan) {
    const { deletedCount } = await model.deleteMany({ _id: { $in: ids } });
    console.log(`   🗑️  ${name}: ${deletedCount}`);
  }
  if (moduleLessIds.length) {
    const { deletedCount } = await Occurrence.deleteMany({ _id: { $in: moduleLessIds } });
    console.log(`   🗑️  module-less occurrences: ${deletedCount}`);
  }
  // Repair the child lists. Dumped above alongside the orphans so a bad prune
  // is reversible.
  for (const d of danglingFix) {
    await Occurrence.updateOne({ _id: d._id }, { $set: { occurrences: d.kept } });
  }
  if (danglingTotal) console.log(`   🔗 repaired ${danglingTotal} dangling child ref(s) across ${danglingFix.length} parent(s)`);
  console.log(`\n✅ Swept ${orphanTotal} orphan(s) + ${moduleLessDrop.length} module-less occurrence(s), ` +
              `repaired ${danglingTotal} child ref(s). Dump: ${dumpPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main()
    .then(async () => { await mongoose.disconnect(); process.exit(0); })
    .catch(async (err) => {
      console.error("❌ Sweep failed:", err.message);
      try { await mongoose.disconnect(); } catch { /* already closed */ }
      process.exit(1);
    });
}
