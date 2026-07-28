// scripts/renameGrids.js
//
// One-shot, idempotent: put the grids on their final names and stamp the
// protected ones so every guard in utils/protectedGrids.js actually engages.
//
// WHY THIS MATTERS MORE THAN IT LOOKS: the protected list matches on NAME, so
// until the live grid is actually called "poms grid" the guards do nothing for
// it. That window is not theoretical — on 2026-07-28 a destructive check run
// against the live database dropped the grid while it was still called "Poms",
// because "Poms" was not on the list yet. (Restored byte-identical from the
// Task 1 backup; that is what backups are for.) The `meta.protected` stamp
// added here is the half that survives a later rename.
//
// Usage:
//   node --env-file=server/.env server/scripts/renameGrids.js           # dry run
//   node --env-file=server/.env server/scripts/renameGrids.js --apply

import mongoose from "mongoose";
import Grid from "../models/Grid.js";
import User from "../models/User.js";
import { isProtectedGrid } from "../utils/protectedGrids.js";

// oldName → { to, protect }. Matched case-insensitively; already-renamed grids
// are skipped, so re-running is a no-op.
const RENAMES = [
  { from: "Poms",      to: "poms grid",   protect: true },
  { from: "test grid", to: "test grid 1", protect: true },
];

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

  const grids = await Grid.find({ userId }).lean();
  console.log(`👤 ${EMAIL} — ${grids.length} grid(s)\n`);

  const plan = [];
  for (const { from, to, protect } of RENAMES) {
    const g = grids.find(x => (x.name || "").toLowerCase() === from.toLowerCase())
           || grids.find(x => (x.name || "").toLowerCase() === to.toLowerCase());
    if (!g) { console.log(`   – no grid named "${from}" (or "${to}") — skipping`); continue; }
    const needsRename = g.name !== to;
    const needsStamp = protect && g.meta?.protected !== true;
    if (!needsRename && !needsStamp) {
      console.log(`   ✓ "${to}" already correct (protected=${g.meta?.protected === true})`);
      continue;
    }
    plan.push({ id: g._id, from: g.name, to, needsRename, needsStamp, meta: g.meta || {} });
    console.log(`   → "${g.name}" ⇒ "${to}"${needsStamp ? "  + meta.protected" : ""}`);
  }

  if (!plan.length) { console.log("\nNothing to do."); return; }
  if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with --apply."); return; }

  for (const p of plan) {
    // Read-modify-write on meta: it is a Mixed field, so a bare $set of a
    // subkey is fine, but writing the whole object keeps any other keys intact.
    const meta = { ...p.meta };
    if (p.needsStamp) {
      meta.protected = true;
      meta.protectedAt = new Date().toISOString();
    }
    await Grid.updateOne({ _id: p.id }, { $set: { name: p.to, meta } });
    console.log(`   ✅ ${p.to}`);
  }

  // Re-read and prove the guards now engage on the real documents.
  const after = await Grid.find({ userId }).lean();
  console.log("\nFinal state:");
  for (const g of after) {
    console.log(`   "${g.name || "(unnamed)"}"  protected=${isProtectedGrid(g)}` +
                `  occurrences=${(g.occurrences || []).length} panel(s)`);
  }
}

main()
  .then(async () => { await mongoose.disconnect(); process.exit(0); })
  .catch(async (err) => {
    console.error("❌ Rename failed:", err.message);
    try { await mongoose.disconnect(); } catch { /* already closed */ }
    process.exit(1);
  });
