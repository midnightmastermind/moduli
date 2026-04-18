// scripts/resetTestGridData.js
// ============================================================
// Wipes + recreates the deterministic "Test Grid" for BOTH seeded
// users (josh@jpoms.com and test@moduli.test) so vitest + e2e runs
// start from a known clean state. Other grids on these users, and
// all data on other users, are left untouched.
//
// Run:
//   node --env-file=.env scripts/resetTestGridData.js
// ============================================================

import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, "../.env") });

import User from "../models/User.js";
import { createTestGrid, dropExistingTestGrid } from "./createTestGrid.js";

const TARGET_EMAILS = ["josh@jpoms.com", "test@moduli.test"];

async function main() {
  console.log("🔄 Resetting Test Grid for seeded users...\n");

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected\n");

    for (const email of TARGET_EMAILS) {
      const user = await User.findOne({ email });
      if (!user) {
        console.log(`⚠️  Skipping ${email} — user not found`);
        continue;
      }
      const userId = user._id.toString();

      const dropped = await dropExistingTestGrid(userId);
      console.log(`🗑️  ${email}: ${dropped ? "dropped existing Test Grid" : "no existing Test Grid"}`);

      const result = await createTestGrid(userId);
      console.log(`✅ ${email}: created Test Grid ${result.gridId} (${result.prefillCount} prefilled slots)\n`);
    }

    console.log("=".repeat(50));
    console.log("🎉 Test Grid reset complete for both users");
    console.log("=".repeat(50));
  } catch (err) {
    console.error("❌ Failed:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("✅ Disconnected");
  }
}

main();
