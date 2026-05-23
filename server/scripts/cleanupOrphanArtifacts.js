// scripts/cleanupOrphanArtifacts.js
//
// Finds files in `server/uploads/user/` (and optionally `server/uploads/md/`)
// that no `Module.fileRef` references. Reports them by default; pass
// `--delete` to actually remove. `--age=N` (default 7) protects files newer
// than N days from deletion (safety net for in-flight uploads / race
// conditions where the Module row hasn't been persisted yet).
//
// Files/audit docket §8 gap #19 (the "orphan-file cleanup" entry).
//
// Usage:
//   node --env-file=.env server/scripts/cleanupOrphanArtifacts.js          # dry-run, list orphans
//   node --env-file=.env server/scripts/cleanupOrphanArtifacts.js --delete  # delete orphans ≥ 7 days old
//   node --env-file=.env server/scripts/cleanupOrphanArtifacts.js --delete --age=30  # delete ≥ 30 days
//   node --env-file=.env server/scripts/cleanupOrphanArtifacts.js --include-md  # also scan uploads/md/
//
// The script reads `MONGO_URI` from env. Cross-references file paths
// against `Module.fileRef` (both bare `user/<name>` refs and any leading-
// slash variants). Files referenced via absolute URLs (`https://…`)
// don't appear in `uploads/` so they're never candidates.

import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Module from "../models/Module.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.resolve(__dirname, "..", "uploads");
const userDir = path.join(uploadsDir, "user");
const mdDir = path.join(uploadsDir, "md");

const args = new Set(process.argv.slice(2));
const ageArg = process.argv.find(a => a.startsWith("--age="));
const MAX_AGE_DAYS = ageArg ? Number(ageArg.split("=")[1]) : 7;
const DO_DELETE = args.has("--delete");
const INCLUDE_MD = args.has("--include-md");

if (!Number.isFinite(MAX_AGE_DAYS) || MAX_AGE_DAYS < 0) {
  console.error("Invalid --age value:", ageArg);
  process.exit(1);
}

if (!process.env.MONGO_URI) {
  console.error("MONGO_URI missing. Run with `node --env-file=.env ...`");
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI);

// Build the referenced-fileRef set. Modules' `fileRef` is the bare
// relative path (`user/<ts>-<rnd>.<ext>`) for internal uploads; for
// external artifacts it's an absolute URL — which never matches a
// local file, so the dedup walk naturally skips it.
const modules = await Module.find({ role: "artifact" }).select("id userId fileRef").lean();
const referenced = new Set();
for (const m of modules) {
  if (!m.fileRef) continue;
  // Normalize: strip a leading slash so `/uploads/user/x.png` and
  // `user/x.png` resolve to the same key. We compare against entries
  // formatted as `user/<basename>` and `md/<basename>` further down.
  const ref = m.fileRef.startsWith("/uploads/")
    ? m.fileRef.slice("/uploads/".length)
    : m.fileRef.replace(/^\//, "");
  referenced.add(ref);
}

const orphans = [];
const scanned = { user: 0, md: 0 };
const now = Date.now();
const ageThresholdMs = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

function scanDir(dir, refPrefix, counterKey) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    scanned[counterKey]++;
    const ref = `${refPrefix}/${entry.name}`;
    if (referenced.has(ref)) continue;
    const fullPath = path.join(dir, entry.name);
    const stat = fs.statSync(fullPath);
    orphans.push({
      ref,
      fullPath,
      bytes: stat.size,
      ageDays: (now - stat.mtimeMs) / (24 * 60 * 60 * 1000),
    });
  }
}

scanDir(userDir, "user", "user");
if (INCLUDE_MD) scanDir(mdDir, "md", "md");

orphans.sort((a, b) => b.bytes - a.bytes);

console.log(`Modules with internal fileRef:    ${referenced.size}`);
console.log(`Files scanned in uploads/user/:   ${scanned.user}`);
if (INCLUDE_MD) console.log(`Files scanned in uploads/md/:     ${scanned.md}`);
console.log(`Orphans found:                    ${orphans.length}`);
console.log(`Age threshold for deletion:       ${MAX_AGE_DAYS} day(s)`);
console.log(`Mode:                             ${DO_DELETE ? "DELETE" : "dry-run"}\n`);

let totalBytes = 0;
let deletable = 0;
let deletableBytes = 0;
let actuallyDeleted = 0;
let actuallyDeletedBytes = 0;

for (const o of orphans) {
  totalBytes += o.bytes;
  const eligible = o.ageDays >= MAX_AGE_DAYS;
  if (eligible) {
    deletable++;
    deletableBytes += o.bytes;
  }
  const ageStr = `${o.ageDays.toFixed(1)}d`.padStart(8);
  const sizeStr = `${(o.bytes / 1024).toFixed(1)} KB`.padStart(12);
  const flag = eligible ? (DO_DELETE ? "DELETE" : "  old ") : "young ";
  console.log(`  [${flag}] ${ageStr}  ${sizeStr}  ${o.ref}`);
  if (DO_DELETE && eligible) {
    try {
      fs.unlinkSync(o.fullPath);
      actuallyDeleted++;
      actuallyDeletedBytes += o.bytes;
    } catch (err) {
      console.error(`    ! unlink failed: ${err.message}`);
    }
  }
}

const fmtMB = (b) => `${(b / 1024 / 1024).toFixed(2)} MB`;
console.log("");
console.log(`Total orphan bytes:               ${fmtMB(totalBytes)}`);
console.log(`Eligible for deletion (≥${MAX_AGE_DAYS}d):    ${deletable} files / ${fmtMB(deletableBytes)}`);
if (DO_DELETE) {
  console.log(`Actually deleted:                 ${actuallyDeleted} files / ${fmtMB(actuallyDeletedBytes)}`);
} else if (deletable > 0) {
  console.log(`\nRe-run with --delete to remove the ${deletable} eligible orphan(s).`);
}

await mongoose.disconnect();
