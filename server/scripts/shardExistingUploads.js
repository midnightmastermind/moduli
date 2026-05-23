// scripts/shardExistingUploads.js
//
// Migrates legacy flat uploads (`uploads/user/<file>`) into the new sharded
// layout (`uploads/user/YYYY-MM/<file>`). Atomic per-file: move file +
// update Module.fileRef in a single pass. Re-runnable (skips files already
// in a shard subdir).
//
// Files/audit docket §8 gap #18 ("Upload directory is flat"). Pairs with
// the server-side change in `server.js` (`yearMonthShard()` helper +
// both upload handlers using `user/YYYY-MM/` going forward).
//
// Shard derivation: leading-timestamp filename like `1776963929698-xyz.png`
// → parse first dash-separated component as ms-since-epoch → year-month.
// Falls back to file mtime when the filename has no parseable prefix.
//
// Usage:
//   node --env-file=.env server/scripts/shardExistingUploads.js          # dry-run
//   node --env-file=.env server/scripts/shardExistingUploads.js --apply  # actually move + update DB

import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Module from "../models/Module.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.resolve(__dirname, "..", "uploads");
const userDir = path.join(uploadsDir, "user");

const args = new Set(process.argv.slice(2));
const DO_APPLY = args.has("--apply");

if (!process.env.MONGO_URI) {
  console.error("MONGO_URI missing. Run with `node --env-file=.env ...`");
  process.exit(1);
}
if (!fs.existsSync(userDir)) {
  console.log("No uploads/user/ directory; nothing to migrate.");
  process.exit(0);
}

await mongoose.connect(process.env.MONGO_URI);

function shardFromFilename(filename, stat) {
  // Filename format minted by both upload handlers:
  //   `${Date.now()}-${Math.random().toString(36).slice(2)}.ext`
  // The leading numeric component is ms-since-epoch.
  const m = filename.match(/^(\d{10,})-/);
  let date;
  if (m) {
    const ms = Number(m[1]);
    date = new Date(ms);
    if (Number.isNaN(date.getTime())) date = null;
  }
  if (!date) date = new Date(stat.mtimeMs);
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${mo}`;
}

const entries = fs.readdirSync(userDir, { withFileTypes: true });
const files = entries.filter(e => e.isFile());
const dirs = entries.filter(e => e.isDirectory());

console.log(`Files at top-level of uploads/user/:        ${files.length}`);
console.log(`Shard subdirs already present:              ${dirs.length} (${dirs.map(d => d.name).join(", ") || "—"})`);
console.log(`Mode:                                       ${DO_APPLY ? "APPLY" : "dry-run"}\n`);

let moved = 0;
let dbUpdated = 0;
let skipped = 0;
let dbMissing = 0;
let conflicts = 0;

for (const entry of files) {
  const filename = entry.name;
  const oldFullPath = path.join(userDir, filename);
  const stat = fs.statSync(oldFullPath);
  const shard = shardFromFilename(filename, stat);
  const newRelPath = `user/${shard}/${filename}`;
  const newFullPath = path.join(uploadsDir, "user", shard, filename);
  const oldFileRef = `user/${filename}`;

  // Conflict check: target shouldn't already exist.
  if (fs.existsSync(newFullPath)) {
    console.log(`  [CONFLICT] ${oldFileRef} → ${newRelPath} (target exists)`);
    conflicts++;
    continue;
  }

  // Find the Module that references this file. Allow multiple matches —
  // dedup may have left the same fileRef on more than one module if the
  // SHA-256 path wasn't taken yet (unlikely but possible).
  const modules = await Module.find({ fileRef: oldFileRef }).select("id fileRef userId").lean();

  if (modules.length === 0) {
    // Orphan — no DB reference. Skip migration (let cleanupOrphanArtifacts handle).
    console.log(`  [orphan]   ${oldFileRef}`);
    dbMissing++;
    skipped++;
    continue;
  }

  console.log(`  [move]     ${oldFileRef} → ${newRelPath}  (${modules.length} module ref${modules.length === 1 ? "" : "s"})`);
  if (!DO_APPLY) continue;

  // Atomic-ish: move file first; if that fails, leave DB untouched.
  // If file move succeeds but DB update fails, the cleanup script can
  // detect orphans + we can manually fix up. Acceptable failure mode.
  fs.mkdirSync(path.dirname(newFullPath), { recursive: true });
  fs.renameSync(oldFullPath, newFullPath);
  moved++;

  for (const mod of modules) {
    await Module.updateOne({ id: mod.id }, { $set: { fileRef: newRelPath } });
    dbUpdated++;
  }
}

const fmtMB = (b) => `${(b / 1024 / 1024).toFixed(2)} MB`;
let scannedBytes = 0;
for (const entry of files) {
  const fullPath = path.join(userDir, entry.name);
  if (fs.existsSync(fullPath)) scannedBytes += fs.statSync(fullPath).size;
}

console.log("");
console.log(`Files scanned:                              ${files.length}`);
console.log(`Files moved:                                ${moved}`);
console.log(`Module.fileRef rows updated:                ${dbUpdated}`);
console.log(`Skipped (orphans — no Module ref):          ${dbMissing}`);
console.log(`Skipped (conflict — target file existed):   ${conflicts}`);
if (!DO_APPLY && (files.length - dbMissing - conflicts) > 0) {
  console.log(`\nRe-run with --apply to actually migrate ${files.length - dbMissing - conflicts} file(s).`);
  console.log(`Remaining top-level bytes pre-migration:    ${fmtMB(scannedBytes)}`);
}

await mongoose.disconnect();
