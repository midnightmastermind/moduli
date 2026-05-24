// server/scripts/migrateListToBoard.js
//
// q3 ii (2026-05-24) — `kind:"list"` container modules collapsed into
// `kind:"board"`. This script walks every Module record in the live DB and
// rewrites `kind:"list"` → `kind:"board"` on container-role records.
//
// Safe by default (dry-run). Pass --apply to commit.
//   node --env-file=.env server/scripts/migrateListToBoard.js          # dry run
//   node --env-file=.env server/scripts/migrateListToBoard.js --apply  # commit

import mongoose from "mongoose";
import Module from "../models/Module.js";

const apply = process.argv.includes("--apply");

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("Missing MONGODB_URI / MONGO_URI in env");
    process.exit(1);
  }
  await mongoose.connect(mongoUri);
  console.log(`Connected to ${mongoose.connection.name}`);

  const targets = await Module.find({ role: "container", kind: "list" }).lean();
  console.log(`Container modules with kind:"list" → board: ${targets.length}`);
  if (targets.length === 0) {
    console.log("Nothing to migrate. Disconnecting.");
    await mongoose.disconnect();
    return;
  }

  for (const m of targets.slice(0, 20)) {
    console.log(`  ${m.id || m._id} · ${m.label || "(no label)"}`);
  }
  if (targets.length > 20) console.log(`  …and ${targets.length - 20} more`);

  if (!apply) {
    console.log("\nDry run — pass --apply to actually rewrite.");
    await mongoose.disconnect();
    return;
  }

  const res = await Module.updateMany(
    { role: "container", kind: "list" },
    { $set: { kind: "board" } }
  );
  console.log(`Updated ${res.modifiedCount} records.`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
