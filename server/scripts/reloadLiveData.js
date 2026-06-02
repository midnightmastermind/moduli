// scripts/reloadLiveData.js
// ============================================================
// Fast restore of the live grid from server/seed/*.json — no
// expression evaluation, no seed-time computation. Wipes the user's
// existing grid data and bulk-inserts the JSON snapshot.
//
// Workflow:
//   1. `node scripts/createLiveData.js --clear`  — one-time slow seed +
//                                                  auto-exports to seed/
//   2. `node scripts/reloadLiveData.js`          — fast restore from seed/
//                                                  (use this from now on)
//
// Usage:
//   node --env-file=.env server/scripts/reloadLiveData.js [email]
//
// Default email = josh@jpoms.com. The {{USER_ID}} placeholder in the
// seed JSON gets swapped to the target user's id at insert time, so
// the same snapshot can re-seed any user.
// ============================================================
import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, "../.env") });

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

const DEFAULT_USER_EMAIL = "josh@jpoms.com";

// Same order as createLiveData.SEED_COLLECTIONS_FOR_EXPORT — keep in sync.
const COLLECTIONS = [
  ["grids",       Grid],
  ["modules",     Module],
  ["occurrences", Occurrence],
  ["fields",      Field],
  ["views",       View],
  ["manifests",   Manifest],
  ["folders",     Folder],
  ["operations",  Operation],
];

async function main() {
  const positionals = process.argv.slice(2).filter(a => !a.startsWith("--"));
  const targetEmail = positionals[0] || DEFAULT_USER_EMAIL;
  const seedDir = resolve(__dirname, "../seed");

  console.log(`🔄 Reloading live data for ${targetEmail} from ${seedDir}/`);

  if (!fs.existsSync(seedDir)) {
    console.error(`\n❌ No seed directory at ${seedDir}/`);
    console.error(`   Run \`node scripts/createLiveData.js --clear\` first to generate the seed.\n`);
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected\n");

    // Same index-sync prelude as createLiveData — keeps the compound
    // (userId, gridId) index alive on Atlas.
    {
      const t0 = Date.now();
      for (const [name, model] of COLLECTIONS) {
        try { await model.syncIndexes(); }
        catch (err) { console.warn(`  ⚠️  ${name}.syncIndexes failed: ${err.message}`); }
      }
      console.log(`✅ Indexes synced (${Date.now() - t0}ms)\n`);
    }

    const user = await User.findOne({ email: targetEmail });
    if (!user) throw new Error(`User not found: ${targetEmail}`);
    const userId = user._id.toString();
    console.log(`✅ Found user: ${userId}\n`);

    // Wipe every grid-scoped collection for this user.
    const t0 = Date.now();
    console.log("🗑️  Clearing existing user data...");
    for (const [name, model] of COLLECTIONS) {
      const { deletedCount } = await model.deleteMany({ userId });
      if (deletedCount > 0) console.log(`   ${name.padEnd(12)} −${deletedCount}`);
    }
    // Transactions aren't part of COLLECTIONS (no transactions.json — they
    // accumulate at runtime, not at seed time), but they share the user
    // scope and grow unbounded (65k+ rows in dev). Wipe alongside.
    {
      const { deletedCount } = await Transaction.deleteMany({ userId });
      if (deletedCount > 0) console.log(`   ${"transactions".padEnd(12)} −${deletedCount}`);
    }
    console.log(`   ✅ Cleared in ${Date.now() - t0}ms\n`);

    // Bulk-insert the snapshot. Per-collection ordered:false so any single
    // dup-id row doesn't abort the rest (skipped + reported).
    console.log("📥 Inserting seed data...");
    const tIns = Date.now();
    for (const [name, model] of COLLECTIONS) {
      const filePath = resolve(seedDir, `${name}.json`);
      if (!fs.existsSync(filePath)) {
        console.log(`   ${name.padEnd(12)} ⏭️  no ${name}.json — skipped`);
        continue;
      }
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      // Restore userId placeholder → actual id.
      // Drop _id when it isn't a valid 24-char hex ObjectId — Mongoose
      // will then auto-mint one. This handles the Grid collection where
      // _id is meaningful and we keep it, vs other collections where it
      // was just a stringified ObjectId.
      const docs = raw.map(d => {
        const next = { ...d };
        if (next.userId === "{{USER_ID}}") next.userId = userId;
        if (next._id && !/^[0-9a-f]{24}$/i.test(next._id)) delete next._id;
        return next;
      });
      if (docs.length === 0) {
        console.log(`   ${name.padEnd(12)} (empty)`);
        continue;
      }
      try {
        await model.insertMany(docs, { ordered: false });
        console.log(`   ${name.padEnd(12)} +${docs.length}`);
      } catch (err) {
        const inserted = err.result?.insertedCount || err.insertedCount || 0;
        const failed = docs.length - inserted;
        console.log(`   ${name.padEnd(12)} +${inserted}/${docs.length} (${failed} failed: ${err.code || err.name})`);
      }
    }
    console.log(`✅ Inserted in ${Date.now() - tIns}ms\n`);

    // Textmaps are stored inline on each Occurrence document (the
    // server's `loadUserIntoCache` decompresses them and ships them
    // via full_state in one shot — see Apr 11 2026 server changes).
    // No more uploads/md/<id>.md mirroring.

    console.log(`🎉 Reload complete (total ${Date.now() - t0}ms).`);
  } catch (err) {
    console.error("❌ Failed:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("✅ Disconnected");
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isDirectRun) main();
