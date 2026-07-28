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

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGO_URI is not set (run with --env-file=server/.env)");
  await mongoose.connect(uri);

  const user = await User.findOne({ email: EMAIL }).lean();
  if (!user) throw new Error(`User not found: ${EMAIL}`);
  const userId = user._id.toString();

  const grids = await Grid.find({ userId }).select({ _id: 1, name: 1 }).lean();
  const live = new Set(grids.map(g => g._id.toString()));
  console.log(`👤 ${EMAIL} — ${grids.length} live grid(s): ${grids.map(g => `"${g.name || "(unnamed)"}"`).join(", ")}\n`);

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

  if (nullTotal) {
    console.log(`\n   ${nullTotal} document(s) have NO gridId — left alone on purpose ` +
                `(could be mid-flight; "probably dead" is not good enough for a delete).`);
  }
  if (!orphanTotal) { console.log("\n✅ No orphans."); return; }

  console.log(`\n   TOTAL: ${orphanTotal} orphan(s) from ${new Set(plan.flatMap(p => p.ids)).size ? "dead grid(s)" : ""}`);
  if (!APPLY) { console.log("\nDRY RUN — nothing deleted. Re-run with --apply."); return; }

  // Dump the FULL documents before deleting. backupGrid can't cover these —
  // it is grid-scoped and these belong to no grid — so this is their only
  // safety net, and a sweep with no way back is not one I want to run.
  const dumpDir = resolve(REPO_ROOT, "backups", "orphans");
  fs.mkdirSync(dumpDir, { recursive: true });
  const dumpPath = path.join(dumpDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const dump = {};
  for (const { name, model, ids } of plan) {
    dump[name] = await model.find({ _id: { $in: ids } }).lean();
  }
  fs.writeFileSync(dumpPath, JSON.stringify(dump, null, 2));
  const dumped = Object.values(dump).reduce((n, a) => n + a.length, 0);
  if (dumped !== orphanTotal) {
    throw new Error(`Dump holds ${dumped} of ${orphanTotal} orphans — refusing to delete.`);
  }
  console.log(`\n💾 Dumped ${dumped} document(s) → ${dumpPath}`);

  for (const { name, model, ids } of plan) {
    const { deletedCount } = await model.deleteMany({ _id: { $in: ids } });
    console.log(`   🗑️  ${name}: ${deletedCount}`);
  }
  console.log(`\n✅ Swept ${orphanTotal} orphan(s). Dump: ${dumpPath}`);
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
