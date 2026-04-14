// scripts/compressTextmaps.js
// One-time migration: compress all existing raw JSON textmaps in MongoDB with fflate gzip.
// Safe to run multiple times — already-compressed textmaps (strings) are skipped.
// Run: node scripts/compressTextmaps.js

import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, "../.env") });

import Occurrence from "../models/Occurrence.js";
import { compressTextmap, isCompressed } from "../utils/textmapCompression.js";

const MONGO_URI = process.env.MONGO_URI;
const BATCH_SIZE = 100;

async function run() {
  console.log("🔄 Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected\n");

  // Only fetch occurrences that have a textmap field
  const total = await Occurrence.countDocuments({ textmap: { $exists: true, $ne: null } });
  console.log(`📊 Found ${total} occurrences with textmap\n`);

  let processed = 0;
  let compressed = 0;
  let skipped = 0;
  let errors = 0;

  // Process in batches to avoid OOM on 14k+ records
  let skip = 0;
  while (skip < total) {
    const batch = await Occurrence.find({ textmap: { $exists: true, $ne: null } })
      .select("_id id textmap")
      .skip(skip)
      .limit(BATCH_SIZE)
      .lean();

    if (batch.length === 0) break;

    const bulkOps = [];
    for (const occ of batch) {
      processed++;
      try {
        if (isCompressed(occ.textmap)) {
          skipped++;
          continue;
        }
        // Raw JSON object — compress it
        const compressedTextmap = compressTextmap(occ.textmap);
        bulkOps.push({
          updateOne: {
            filter: { _id: occ._id },
            update: { $set: { textmap: compressedTextmap } },
          },
        });
        compressed++;
      } catch (err) {
        console.error(`  ❌ Error on occurrence ${occ.id || occ._id}:`, err.message);
        errors++;
      }
    }

    if (bulkOps.length > 0) {
      await Occurrence.bulkWrite(bulkOps);
    }

    skip += BATCH_SIZE;
    const pct = Math.round((processed / total) * 100);
    process.stdout.write(`\r  Progress: ${processed}/${total} (${pct}%) — compressed: ${compressed}, skipped: ${skipped}, errors: ${errors}`);
  }

  console.log("\n\n" + "=".repeat(50));
  console.log("✅ Migration complete!");
  console.log(`   Total processed : ${processed}`);
  console.log(`   Newly compressed: ${compressed}`);
  console.log(`   Already done    : ${skipped}`);
  console.log(`   Errors          : ${errors}`);
  console.log("=".repeat(50));

  await mongoose.disconnect();
  console.log("\n✅ Disconnected");
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
