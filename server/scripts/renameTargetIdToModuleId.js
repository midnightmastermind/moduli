// server/scripts/renameTargetIdToModuleId.js
// One-shot Phase-2 migration: Occurrence.targetId → Occurrence.moduleId.
//
// IMPORTANT: this only renames the field on the `occurrences` collection.
// The codebase rename (schema, sockets, client) MUST land in the same
// commit/PR for the app to keep working after this script runs. Do NOT
// run this on a deployed DB without the matching code changes.
//
// Run: node --env-file=.env scripts/renameTargetIdToModuleId.js
//
// The script is idempotent: re-running it is a no-op once every doc
// already has moduleId.

import mongoose from "mongoose";

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI not set");
  await mongoose.connect(uri);

  const Occurrence = mongoose.connection.collection("occurrences");
  const before = await Occurrence.countDocuments({ targetId: { $exists: true } });
  console.log(`[migrate] occurrences with targetId: ${before}`);

  if (before === 0) {
    console.log("[migrate] nothing to migrate; exiting clean");
    await mongoose.disconnect();
    return;
  }

  const res = await Occurrence.updateMany(
    { targetId: { $exists: true } },
    { $rename: { targetId: "moduleId" } },
  );
  console.log(`[migrate] modified: ${res.modifiedCount}`);

  const after = await Occurrence.countDocuments({ targetId: { $exists: true } });
  if (after !== 0) {
    throw new Error(`[migrate] FAILED — ${after} docs still have targetId after rename`);
  }
  console.log("[migrate] verified — all docs now use moduleId");

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("[migrate] fatal:", e);
  process.exit(1);
});
