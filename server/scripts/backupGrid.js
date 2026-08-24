// scripts/backupGrid.js
//
// Grid-scoped, timestamped backup. This is the restore path for `poms grid`
// (the live data) — see docs/superpowers/plans/2026-07-28-poms-grid-live-data-freeze.md.
//
// Deliberately NOT exportSeedData.js: that one exports every grid the user owns
// into server/seed/*.json, which is the behavioural-test FIXTURE. Running it
// overwrites the fixture and it has no restore path. This writes one grid, to
// its own timestamped directory, and restoreGrid.js reads it back verbatim.
//
// Usage:
//   node --env-file=server/.env server/scripts/backupGrid.js --grid "poms grid"
//   node --env-file=server/.env server/scripts/backupGrid.js --gridId 6a66... --label pre-freeze
//   node --env-file=server/.env server/scripts/backupGrid.js --all
//   node --env-file=server/.env server/scripts/backupGrid.js --list
//
// Flags:
//   --grid <name>     grid to back up, by name (case-insensitive)
//   --gridId <id>     ...or by id (wins over --grid)
//   --all             back up every grid the user owns
//   --label <text>    slugged into the directory name, e.g. "pre-freeze"
//   --user <email>    default josh@jpoms.com
//   --out <dir>       default <repo>/backups
//   --list            list existing backups and exit
//   --keep <n>        after backing up, keep only the n newest UNLABELLED
//                     snapshots for that grid (labelled ones are never pruned)
//
// Every child collection is scoped by gridId (verified 2026-07-28: every
// Manifest and Folder row carries one, so nothing is user-scoped-only).

import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
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
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

// Child collections, all scoped by gridId. `optional: true` means an empty
// result is legitimate and must NOT trip the non-empty guard below.
export const BACKUP_COLLECTIONS = [
  { name: "modules", model: Module },
  { name: "occurrences", model: Occurrence },
  { name: "fields", model: Field },
  { name: "views", model: View },
  { name: "manifests", model: Manifest },
  { name: "folders", model: Folder },
  { name: "operations", model: Operation },
  { name: "transactions", model: Transaction, optional: true },
];

export function slugify(s) {
  return String(s || "unnamed").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unnamed";
}

/** Filesystem-safe ISO stamp: 2026-07-28T14-32-05-123Z */
export function stampNow(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, "-");
}

function gitHead() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
  } catch { return null; }
}

function parseArgs(argv) {
  const out = { all: false, list: false, label: null, grid: null, gridId: null, keep: null,
                user: "josh@jpoms.com", outDir: resolve(REPO_ROOT, "backups") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") out.all = true;
    else if (a === "--list") out.list = true;
    else if (a === "--grid") out.grid = argv[++i];
    else if (a === "--gridId") out.gridId = argv[++i];
    else if (a === "--label") out.label = argv[++i];
    else if (a === "--user") out.user = argv[++i];
    else if (a === "--out") out.outDir = resolve(argv[++i]);
    else if (a === "--keep") out.keep = Number(argv[++i]);
  }
  return out;
}

/**
 * Write one grid + every gridId-scoped document to `<outDir>/<slug>/<stamp>/`.
 * Throws if a non-optional collection is empty — a silently empty backup is
 * worse than no backup, because it reads as success.
 */
/**
 * @param only  collection names to capture, or null for ALL. A PARTIAL backup
 *              is for a migration that provably touches nothing else — the
 *              full one reads every occurrence on the grid, which on a large
 *              grid is minutes of database I/O for a rollback of a field's
 *              config. The manifest records the restriction, and `restoreGrid`
 *              REFUSES to treat an uncaptured collection as empty, because
 *              that path deletes it.
 */
export async function backupGrid(gridDoc, { outDir, label = null, userEmail = null, only = null } = {}) {
  const gridId = gridDoc._id.toString();
  const dirName = [stampNow(), label ? slugify(label) : null].filter(Boolean).join("_");
  const dir = path.join(outDir, slugify(gridDoc.name || gridId), dirName);
  fs.mkdirSync(dir, { recursive: true });

  const counts = {};
  const empty = [];

  fs.writeFileSync(path.join(dir, "grid.json"), JSON.stringify(gridDoc, null, 2));
  counts.grid = 1;

  const wanted = Array.isArray(only) && only.length ? new Set(only) : null;
  if (wanted) {
    const unknown = [...wanted].filter((n) => !BACKUP_COLLECTIONS.some((c) => c.name === n));
    // A typo here would silently capture NOTHING and still write a manifest
    // that looks like a backup. Fail instead.
    if (unknown.length) throw new Error(`backupGrid: unknown collection(s) ${unknown.join(", ")}`);
  }
  const captured = BACKUP_COLLECTIONS.filter((c) => !wanted || wanted.has(c.name));

  for (const { name, model, optional } of captured) {
    const docs = await model.find({ gridId }).lean();
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(docs, null, 2));
    counts[name] = docs.length;
    if (docs.length === 0 && !optional) empty.push(name);
  }

  const manifest = {
    grid: { id: gridId, name: gridDoc.name || null, rows: gridDoc.rows, cols: gridDoc.cols },
    userId: gridDoc.userId,
    userEmail,
    counts,
    // The load-bearing pair. `restoreGrid` reads these to know which
    // collections this backup can speak for — everything else it must leave
    // alone rather than restore as empty.
    partial: !!wanted,
    collections: captured.map((c) => c.name),
    label: label || null,
    takenAt: new Date().toISOString(),
    gitHead: gitHead(),
    database: mongoose.connection?.name || null,
    schemaNote: "child docs scoped by gridId; ids are verbatim (Occurrence.id is globally unique)",
  };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));

  if (empty.length) {
    throw new Error(
      `Backup of "${gridDoc.name}" wrote ZERO ${empty.join(", ")} — refusing to report success. ` +
      `Partial backup left at ${dir} for inspection.`
    );
  }
  return { dir, manifest };
}

/**
 * Keep the newest `keep` backups for a grid slug, delete the rest.
 *
 * Labelled backups (pre-freeze, pre-migration-…) are NEVER pruned: they mark a
 * specific moment someone deliberately captured, and the whole point of taking
 * one is that it is still there later. Only routine unlabelled snapshots rotate.
 */
export function pruneBackups(outDir, slug, keep = 14) {
  const slugDir = path.join(outDir, slug);
  if (!fs.existsSync(slugDir)) return [];
  const rows = fs.readdirSync(slugDir)
    .map(stamp => ({ stamp, dir: path.join(slugDir, stamp) }))
    .filter(r => fs.existsSync(path.join(r.dir, "manifest.json")))
    .map(r => {
      const m = JSON.parse(fs.readFileSync(path.join(r.dir, "manifest.json"), "utf8"));
      return { ...r, takenAt: m.takenAt || "", label: m.label || null };
    })
    .filter(r => !r.label)
    .sort((a, b) => String(b.takenAt).localeCompare(String(a.takenAt)));
  const doomed = rows.slice(keep);
  for (const d of doomed) fs.rmSync(d.dir, { recursive: true, force: true });
  return doomed.map(d => d.dir);
}

export function listBackups(outDir) {
  if (!fs.existsSync(outDir)) return [];
  const rows = [];
  for (const slug of fs.readdirSync(outDir)) {
    const slugDir = path.join(outDir, slug);
    if (!fs.statSync(slugDir).isDirectory()) continue;
    for (const stamp of fs.readdirSync(slugDir)) {
      const mPath = path.join(slugDir, stamp, "manifest.json");
      if (!fs.existsSync(mPath)) continue;
      try {
        const m = JSON.parse(fs.readFileSync(mPath, "utf8"));
        rows.push({ dir: path.join(slugDir, stamp), ...m });
      } catch { /* unreadable manifest — skip */ }
    }
  }
  return rows.sort((a, b) => String(b.takenAt).localeCompare(String(a.takenAt)));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    const rows = listBackups(args.outDir);
    if (!rows.length) { console.log(`No backups under ${args.outDir}`); return; }
    console.log(`📁 ${rows.length} backup(s) under ${args.outDir}\n`);
    for (const r of rows) {
      const c = r.counts || {};
      console.log(`  ${r.takenAt}  "${r.grid?.name}"${r.label ? `  [${r.label}]` : ""}`);
      console.log(`     ${r.dir}`);
      console.log(`     occurrences=${c.occurrences} modules=${c.modules} operations=${c.operations} fields=${c.fields}`);
    }
    return;
  }

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGO_URI is not set (run with --env-file=server/.env)");
  await mongoose.connect(uri);

  const user = await User.findOne({ email: args.user }).lean();
  if (!user) throw new Error(`User not found: ${args.user}`);
  const userId = user._id.toString();

  const all = await Grid.find({ userId }).lean();
  let targets;
  if (args.all) targets = all;
  else if (args.gridId) targets = all.filter(g => g._id.toString() === args.gridId);
  else if (args.grid) targets = all.filter(g => (g.name || "").toLowerCase() === args.grid.toLowerCase());
  else throw new Error("Pass --grid <name>, --gridId <id>, or --all");

  if (!targets.length) {
    throw new Error(`No grid matched. Available: ${all.map(g => `"${g.name || "(unnamed)"}"`).join(", ")}`);
  }

  for (const g of targets) {
    const { dir, manifest } = await backupGrid(g, {
      outDir: args.outDir, label: args.label, userEmail: args.user,
    });
    const c = manifest.counts;
    console.log(`✅ "${g.name || "(unnamed)"}" → ${dir}`);
    console.log(`   occurrences=${c.occurrences} modules=${c.modules} operations=${c.operations} ` +
                `fields=${c.fields} views=${c.views} manifests=${c.manifests} folders=${c.folders} ` +
                `transactions=${c.transactions}`);
    if (args.keep > 0) {
      const pruned = pruneBackups(args.outDir, slugify(g.name || g._id.toString()), args.keep);
      if (pruned.length) console.log(`   🧹 pruned ${pruned.length} old snapshot(s), kept ${args.keep}`);
    }
  }
}

// Only run when invoked directly, so restoreGrid.js can import the helpers.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main()
    .then(async () => { await mongoose.disconnect(); process.exit(0); })
    .catch(async (err) => {
      console.error("❌ Backup failed:", err.message);
      try { await mongoose.disconnect(); } catch { /* already closed */ }
      process.exit(1);
    });
}
