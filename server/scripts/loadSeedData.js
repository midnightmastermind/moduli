// scripts/loadSeedData.js
// ============================================================
// Loads seed JSON files into the DB, replacing all user data.
// Usage: node scripts/loadSeedData.js [--from seed-snapshot]
//   default       → loads from server/seed/
//   --from <dir>  → loads from server/<dir>/
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
import User from "../models/User.js";

const MONGO_URI = process.env.MONGO_URI;
const TARGET_USER_EMAIL = "josh@jpoms.com";

// Parse --from flag
const fromIdx = process.argv.indexOf("--from");
const seedDirName = fromIdx !== -1 && process.argv[fromIdx + 1] ? process.argv[fromIdx + 1] : "seed";
const seedDir = resolve(__dirname, `../${seedDirName}`);

const collections = [
  { name: "grids",       model: Grid },
  { name: "modules",     model: Module },
  { name: "occurrences", model: Occurrence },
  { name: "fields",      model: Field },
  { name: "views",       model: View },
  { name: "manifests",   model: Manifest },
  { name: "folders",     model: Folder },
  { name: "operations",  model: Operation },
];

async function loadSeedData() {
  console.log(`📂 Loading seed data from ${seedDirName}/\n`);

  if (!fs.existsSync(seedDir)) {
    console.error(`❌ Seed directory not found: ${seedDir}`);
    console.error(`   Run 'node scripts/exportSeedData.js' first to generate seed files.`);
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB\n");

    // Find target user
    const user = await User.findOne({ email: TARGET_USER_EMAIL });
    if (!user) throw new Error(`User not found: ${TARGET_USER_EMAIL}`);
    const userId = user._id.toString();
    console.log(`👤 User: ${TARGET_USER_EMAIL} (${userId})\n`);

    // Clear existing data
    console.log("🗑️  Clearing existing user data...");
    for (const { model } of collections) {
      await model.deleteMany({ userId });
    }
    console.log("   ✅ Cleared\n");

    // Ensure uploads/md/ exists
    const uploadsMdDir = resolve(__dirname, "../uploads/md");
    fs.mkdirSync(uploadsMdDir, { recursive: true });

    // Load each collection
    console.log("📥 Inserting seed data...");
    for (const { name, model } of collections) {
      const filePath = resolve(seedDir, `${name}.json`);
      if (!fs.existsSync(filePath)) {
        console.log(`   ⏭️  ${name}.json not found, skipping`);
        continue;
      }

      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      // Replace {{USER_ID}} placeholder with actual userId
      const docs = raw.map(doc => {
        const d = { ...doc };
        if (d.userId === "{{USER_ID}}") d.userId = userId;
        // Restore _id for mongoose
        if (d._id && !d._id.match(/^[0-9a-f]{24}$/)) {
          // Invalid ObjectId — delete so mongoose auto-generates a valid one
          delete d._id;
        }
        return d;
      });

      if (docs.length > 0) {
        try {
          await model.insertMany(docs, { ordered: false });
        } catch (err) {
          if (err.name === 'MongoBulkWriteError' || err.name === 'BulkWriteError') {
            const inserted = err.result?.insertedCount || err.insertedCount || 0;
            console.log(`   ⚠️  ${name}: ${inserted}/${docs.length} docs loaded (${docs.length - inserted} failed)`);
            continue;
          }
          throw err;
        }
      }
      console.log(`   ✅ ${name}: ${docs.length} docs loaded`);
    }

    // Sync textmaps to uploads/md/
    console.log("\n📝 Syncing textmaps to uploads/md/...");
    const occurrences = await Occurrence.find({ userId, textmap: { $ne: null } }).lean();
    let synced = 0;
    for (const occ of occurrences) {
      if (occ.textmap) {
        const mdPath = resolve(uploadsMdDir, `${occ._id || occ.id}.md`);
        fs.writeFileSync(mdPath, JSON.stringify(occ.textmap));
        synced++;
      }
    }
    console.log(`   ✅ ${synced} textmap files written`);

    console.log(`\n🎉 Seed data loaded successfully!`);
    console.log(`   📊 Run 'npm run dev' to see the data.`);

  } catch (error) {
    console.error("❌ Load failed:", error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

loadSeedData();
