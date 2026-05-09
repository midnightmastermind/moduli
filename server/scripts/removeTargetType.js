// server/scripts/removeTargetType.js
// One-shot Phase-3 migration: drop Occurrence.targetType.
//
// targetType is redundant with module.role (every occurrence's role is
// already on its referenced module). This unsets the field across the
// occurrences collection.
//
// IMPORTANT: like the targetId rename script, this only mutates the DB.
// The codebase changes (schema field removal, replacing reads with
// `modulesById[occ.moduleId]?.role`) must land in the same PR.
//
// Note: the JSX visual-block system (client/src/blocks/useBlockDnD.jsx)
// also uses a `targetType` field with values "slot"/"canvas"/"block-stack"
// — that's a DIFFERENT runtime object, NOT touched by this script and
// NOT in scope for the cleanup.
//
// Run: node --env-file=.env scripts/removeTargetType.js

import mongoose from "mongoose";

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI not set");
  await mongoose.connect(uri);

  const Occurrence = mongoose.connection.collection("occurrences");
  const before = await Occurrence.countDocuments({ targetType: { $exists: true } });
  console.log(`[migrate] occurrences with targetType: ${before}`);

  if (before === 0) {
    console.log("[migrate] nothing to migrate; exiting clean");
    await mongoose.disconnect();
    return;
  }

  const res = await Occurrence.updateMany(
    { targetType: { $exists: true } },
    { $unset: { targetType: 1 } },
  );
  console.log(`[migrate] modified: ${res.modifiedCount}`);

  const after = await Occurrence.countDocuments({ targetType: { $exists: true } });
  if (after !== 0) {
    throw new Error(`[migrate] FAILED — ${after} docs still have targetType after unset`);
  }
  console.log("[migrate] verified — targetType removed");

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("[migrate] fatal:", e);
  process.exit(1);
});
