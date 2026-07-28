// scripts/runMigrations.js
//
// Applies pending migrations to a grid. This is the ONLY sanctioned way to
// change `poms grid`'s structure now that the seed can't touch it — see
// server/migrations/README.md and the freeze plan.
//
// Usage:
//   node --env-file=server/.env server/scripts/runMigrations.js --grid "poms grid"
//   node --env-file=server/.env server/scripts/runMigrations.js --grid "poms grid" --apply
//   node --env-file=server/.env server/scripts/runMigrations.js --grid "test grid 2" --apply --only 0001-foo
//
// Flags:
//   --grid <name>   target grid (required)
//   --apply         actually write (default is a dry run)
//   --only <id>     run just this migration id
//   --force         re-run a migration already recorded as applied
//   --user <email>  default josh@jpoms.com

import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
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
import { backupGrid } from "./backupGrid.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const MIGRATIONS_DIR = resolve(__dirname, "../migrations");

const MODELS = { Grid, Module, Occurrence, Field, View, Manifest, Folder, Operation };

function parseArgs(argv) {
  const out = { grid: null, apply: false, only: null, force: false, user: "josh@jpoms.com" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--grid") out.grid = argv[++i];
    else if (a === "--apply") out.apply = true;
    else if (a === "--only") out.only = argv[++i];
    else if (a === "--force") out.force = true;
    else if (a === "--user") out.user = argv[++i];
  }
  return out;
}

/** Every migration module, in id order. */
export async function loadMigrations(dir = MIGRATIONS_DIR) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => /^\d{4}-.*\.mjs$/.test(f)).sort();
  const out = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(dir, f)).href);
    if (!mod.id || typeof mod.up !== "function") {
      throw new Error(`${f} must export an \`id\` and an \`up\` function`);
    }
    if (out.some(m => m.id === mod.id)) throw new Error(`Duplicate migration id: ${mod.id}`);
    out.push({ id: mod.id, describe: mod.describe || "(no description)", up: mod.up, file: f });
  }
  return out;
}

/** Which of `migrations` still need to run against this grid. */
export function pendingFor(migrations, appliedIds = [], { only = null, force = false } = {}) {
  const applied = new Set(appliedIds);
  return migrations.filter(m => {
    if (only && m.id !== only) return false;
    if (applied.has(m.id) && !force) return false;
    return true;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.grid) throw new Error("Pass --grid <name>");

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGO_URI is not set (run with --env-file=server/.env)");
  await mongoose.connect(uri);

  const user = await User.findOne({ email: args.user }).lean();
  if (!user) throw new Error(`User not found: ${args.user}`);
  const grids = await Grid.find({ userId: user._id.toString() }).lean();
  const grid = grids.find(g => (g.name || "").toLowerCase() === args.grid.toLowerCase());
  if (!grid) {
    throw new Error(`No grid named "${args.grid}". Available: ${grids.map(g => `"${g.name}"`).join(", ")}`);
  }
  const gridId = grid._id.toString();
  const appliedIds = grid.meta?.migrations || [];

  const all = await loadMigrations();
  const pending = pendingFor(all, appliedIds, { only: args.only, force: args.force });

  console.log(`🎯 "${grid.name}"  (${all.length} migration(s), ${appliedIds.length} already applied)\n`);
  if (!pending.length) { console.log("Nothing pending."); return; }

  for (const m of pending) {
    console.log(`   ${m.id}${appliedIds.includes(m.id) ? "  [RE-RUN]" : ""}`);
    console.log(`      ${m.describe}`);
  }

  if (!args.apply) {
    console.log("\nDRY RUN — running each migration in preview mode:\n");
    for (const m of pending) {
      const log = (msg) => console.log(`      ${msg}`);
      console.log(`   ${m.id}`);
      await m.up({ gridId, grid, models: MODELS, log, dryRun: true });
    }
    console.log("\nNothing written. Re-run with --apply.");
    return;
  }

  // Snapshot BEFORE any write, with no flag needed to get it. If a migration
  // corrupts the grid, the path printed on failure is the way back.
  const { dir } = await backupGrid(grid, {
    outDir: resolve(REPO_ROOT, "backups"),
    label: `pre-migration-${pending[0].id}`,
    userEmail: args.user,
  });
  console.log(`\n💾 Snapshot: ${dir}\n`);

  const done = [];
  for (const m of pending) {
    const log = (msg) => console.log(`      ${msg}`);
    console.log(`   ▶ ${m.id}`);
    try {
      await m.up({ gridId, grid, models: MODELS, log, dryRun: false });
    } catch (err) {
      console.error(`\n❌ ${m.id} threw: ${err.message}`);
      console.error(`   Stopping. ${done.length} migration(s) applied before this one.`);
      console.error(`   Restore with:  node --env-file=server/.env server/scripts/restoreGrid.js \\`);
      console.error(`                    --from ${dir} --apply --overwrite --yes-overwrite-live`);
      process.exitCode = 1;
      return;
    }
    done.push(m.id);
    // Record after EACH one, not at the end: a later failure must not make the
    // runner forget what already succeeded.
    const nextApplied = Array.from(new Set([...appliedIds, ...done]));
    await Grid.updateOne({ _id: gridId }, { $set: { "meta.migrations": nextApplied } });
    console.log(`   ✅ ${m.id}`);
  }
  console.log(`\n🎉 ${done.length} migration(s) applied to "${grid.name}"`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main()
    .then(async () => { await mongoose.disconnect(); process.exit(process.exitCode || 0); })
    .catch(async (err) => {
      console.error("❌ Migration run failed:", err.message);
      try { await mongoose.disconnect(); } catch { /* already closed */ }
      process.exit(1);
    });
}
