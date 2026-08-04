// scripts/checkGrid.js — run the structural integrity checks against a live grid.
//   node --env-file=server/.env server/scripts/checkGrid.js --grid "poms grid"
//   node --env-file=server/.env server/scripts/checkGrid.js --all
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";
import Grid from "../models/Grid.js";
import Occurrence from "../models/Occurrence.js";
import Module from "../models/Module.js";
import Field from "../models/Field.js";
import Operation from "../models/Operation.js";
import Folder from "../models/Folder.js";
import User from "../models/User.js";
import { checkGridIntegrity, reportGridIntegrity } from "../utils/gridIntegrity.js";

const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const ALL = process.argv.includes("--all");

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGO_URI is not set (run with --env-file=server/.env)");
  await mongoose.connect(uri);
  const user = await User.findOne({ email: arg("--user", "josh@jpoms.com") }).lean();
  if (!user) throw new Error("User not found");
  const grids = await Grid.find({ userId: user._id.toString() }).lean();
  const wanted = ALL ? grids : grids.filter(g => (g.name || "").toLowerCase() === String(arg("--grid", "")).toLowerCase());
  if (!wanted.length) throw new Error(`No grid matched. Available: ${grids.map(g => `"${g.name}"`).join(", ")}`);
  let ok = true;
  for (const g of wanted) {
    const gid = g._id.toString();
    const [occurrences, modules, fields, operations, folders] = await Promise.all([
      Occurrence.find({ gridId: gid }).lean(), Module.find({ gridId: gid }).lean(),
      Field.find({ gridId: gid }).lean(), Operation.find({ gridId: gid }).lean(),
      Folder.find({ gridId: gid }).lean(),
    ]);
    ok = reportGridIntegrity(checkGridIntegrity({ grid: g, occurrences, modules, fields, operations, folders }),
      { label: `"${g.name || "(unnamed)"}"` }) && ok;
  }
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().then(async () => { await mongoose.disconnect(); process.exit(process.exitCode || 0); })
    .catch(async (e) => { console.error("❌", e.message); try { await mongoose.disconnect(); } catch {} process.exit(1); });
}
