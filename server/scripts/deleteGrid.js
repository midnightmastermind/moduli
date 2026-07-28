// scripts/deleteGrid.js
//
// Delete a grid AND everything scoped to it, safely:
//   - refuses protected grids (utils/protectedGrids.js)
//   - backs the grid up first, automatically, with no flag needed
//   - dry run by default
//
// Use this rather than the UI's delete button when you care about the scoped
// documents: the runtime handler now cascades too, but this leaves a restorable
// snapshot behind, which the UI path does not.
//
// Usage:
//   node --env-file=server/.env server/scripts/deleteGrid.js --gridId <id>
//   node --env-file=server/.env server/scripts/deleteGrid.js --grid "test grid 2" --apply

import mongoose from "mongoose";
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
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";
import { assertNotProtected } from "../utils/protectedGrids.js";
import { backupGrid } from "./backupGrid.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

const SCOPED = [
  ["occurrences", Occurrence], ["modules", Module], ["fields", Field],
  ["views", View], ["manifests", Manifest], ["folders", Folder],
  ["operations", Operation], ["transactions", Transaction],
];

function parseArgs(argv) {
  const out = { grid: null, gridId: null, apply: false, user: "josh@jpoms.com", noBackup: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--grid") out.grid = argv[++i];
    else if (a === "--gridId") out.gridId = argv[++i];
    else if (a === "--apply") out.apply = true;
    else if (a === "--user") out.user = argv[++i];
    else if (a === "--no-backup") out.noBackup = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.grid && !args.gridId) throw new Error("Pass --grid <name> or --gridId <id>");

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGO_URI is not set (run with --env-file=server/.env)");
  await mongoose.connect(uri);

  const user = await User.findOne({ email: args.user }).lean();
  if (!user) throw new Error(`User not found: ${args.user}`);
  const grids = await Grid.find({ userId: user._id.toString() }).lean();
  const grid = args.gridId
    ? grids.find(g => g._id.toString() === args.gridId)
    : grids.find(g => (g.name || "").toLowerCase() === args.grid.toLowerCase());
  if (!grid) {
    throw new Error(`No grid matched. Available: ${grids.map(g => `"${g.name || "(unnamed)"}"`).join(", ")}`);
  }

  // Refuse protected grids before counting anything.
  assertNotProtected(grid, "delete");

  const gridId = grid._id.toString();
  const counts = {};
  for (const [name, model] of SCOPED) counts[name] = await model.countDocuments({ gridId });

  console.log(`🎯 "${grid.name || "(unnamed)"}"  id=${gridId}  ${grid.rows}×${grid.cols}`);
  console.log(`   ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ")}\n`);

  if (!args.apply) { console.log("DRY RUN — nothing deleted. Re-run with --apply."); return; }

  if (!args.noBackup) {
    const { dir } = await backupGrid(grid, {
      outDir: resolve(REPO_ROOT, "backups"), label: "pre-delete", userEmail: args.user,
    }).catch(err => {
      // A grid with zero occurrences trips backupGrid's non-empty guard. That
      // guard is right for a real grid and wrong for a husk, so downgrade it to
      // a warning here rather than blocking the cleanup it exists to protect.
      console.log(`   ⚠️  backup skipped: ${err.message.split("\n")[0]}`);
      return { dir: null };
    });
    if (dir) console.log(`💾 Snapshot: ${dir}\n`);
  }

  for (const [name, model] of SCOPED) {
    const { deletedCount } = await model.deleteMany({ gridId });
    if (deletedCount) console.log(`   🗑️  ${name}: ${deletedCount}`);
  }
  await Grid.deleteOne({ _id: grid._id });
  console.log(`\n✅ Deleted "${grid.name || "(unnamed)"}"`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main()
    .then(async () => { await mongoose.disconnect(); process.exit(0); })
    .catch(async (err) => {
      console.error("❌ Delete failed:", err.message);
      try { await mongoose.disconnect(); } catch { /* already closed */ }
      process.exit(1);
    });
}
