// scripts/clearUserData.js
// Wipes all grid data for a user (grids, modules, occurrences, fields,
// transactions, manifests, views, folders, operations) while keeping the
// user account and any codex-import preserved records.
// Does NOT re-seed — leaves a blank slate.
//
// Usage: node --env-file=.env scripts/clearUserData.js [email]
//   email defaults to josh@jpoms.com

import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, "../.env") });

import Grid from "../models/Grid.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Field from "../models/Field.js";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";
import Manifest from "../models/Manifest.js";
import View from "../models/View.js";
import Folder from "../models/Folder.js";
import Operation from "../models/Operation.js";

const TARGET_EMAIL = process.argv[2] || "josh@jpoms.com";

async function clearUserData() {
  console.log(`\nClearing grid data for: ${TARGET_EMAIL}`);

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB\n");

    const user = await User.findOne({ email: TARGET_EMAIL });
    if (!user) throw new Error(`User not found: ${TARGET_EMAIL}`);
    const userId = user._id.toString();
    console.log(`User ID: ${userId}\n`);

    // Preserve codex/notebook imports — same logic as resetData.js
    const preserveFilter = { userId, "meta.source": { $ne: "codex-import" } };

    const [occs, fields, mods, txns, grids, manifests, views, folders, ops] = await Promise.all([
      Occurrence.deleteMany(preserveFilter),
      Field.deleteMany({ userId }),
      Module.deleteMany(preserveFilter),
      Transaction.deleteMany({ userId }),
      Grid.deleteMany({ userId }),
      Manifest.deleteMany({ userId }),
      View.deleteMany(preserveFilter),
      Folder.deleteMany(preserveFilter),
      Operation.deleteMany({ userId }),
    ]);

    console.log("Deleted:");
    console.log(`  Grids:        ${grids.deletedCount}`);
    console.log(`  Modules:      ${mods.deletedCount}`);
    console.log(`  Occurrences:  ${occs.deletedCount}`);
    console.log(`  Fields:       ${fields.deletedCount}`);
    console.log(`  Operations:   ${ops.deletedCount}`);
    console.log(`  Manifests:    ${manifests.deletedCount}`);
    console.log(`  Views:        ${views.deletedCount}`);
    console.log(`  Folders:      ${folders.deletedCount}`);
    console.log(`  Transactions: ${txns.deletedCount}`);
    console.log("\nDone. User account preserved. Codex imports preserved.");

  } catch (err) {
    console.error("Failed:", err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

clearUserData();
