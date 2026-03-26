// scripts/exportSeedData.js
// ============================================================
// Exports the current DB state for a user to JSON seed files.
// Usage: node scripts/exportSeedData.js [--snapshot]
//   default  → writes to server/seed/
//   --snapshot → writes to server/seed-snapshot/ (for diffing)
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

const isSnapshot = process.argv.includes("--snapshot");
const outDir = resolve(__dirname, isSnapshot ? "../seed-snapshot" : "../seed");

function cleanDoc(doc) {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  // Convert ObjectId _id to string id for portability
  if (obj._id) {
    obj._id = obj._id.toString();
  }
  // Remove mongoose version key
  delete obj.__v;
  return obj;
}

async function exportData() {
  const label = isSnapshot ? "seed-snapshot" : "seed";
  console.log(`📦 Exporting DB → ${label}/\n`);

  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB\n");

    const user = await User.findOne({ email: TARGET_USER_EMAIL });
    if (!user) throw new Error(`User not found: ${TARGET_USER_EMAIL}`);
    const userId = user._id.toString();
    console.log(`👤 User: ${TARGET_USER_EMAIL} (${userId})\n`);

    fs.mkdirSync(outDir, { recursive: true });

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

    for (const { name, model } of collections) {
      const docs = await model.find({ userId }).lean();
      // Clean up each doc
      const cleaned = docs.map(d => {
        const obj = { ...d };
        if (obj._id) obj._id = obj._id.toString();
        if (obj.userId) obj.userId = "{{USER_ID}}";
        delete obj.__v;
        return obj;
      });
      const filePath = resolve(outDir, `${name}.json`);
      fs.writeFileSync(filePath, JSON.stringify(cleaned, null, 2));
      console.log(`   ✅ ${name}: ${cleaned.length} docs → ${name}.json`);
    }

    console.log(`\n🎉 Export complete → ${outDir}/`);

  } catch (error) {
    console.error("❌ Export failed:", error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

exportData();
