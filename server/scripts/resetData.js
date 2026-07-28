// scripts/resetData.js
// ============================================================
// Resets the database with sample habit/task data to showcase the site
// Uses createDefaultUserData utility for consistency with new user setup
// ============================================================

import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import fs from "fs";

// Get the current file's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from the server root folder (adjust if your .env is elsewhere)
dotenv.config({ path: resolve(__dirname, "../.env") });

console.log("Loaded MONGO_URI:", process.env.MONGO_URI); // Should now print correctly
// Import models for cleanup
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

// Import the reusable utility
import createDefaultUserData from "../utils/createDefaultUserData.js";
import { createTestGrid } from "./createTestGrid.js";
import { protectedGridIdsForUser, withProtectedExcluded } from "../utils/protectedGrids.js";

const MONGO_URI = process.env.MONGO_URI;

// Target user email for sample data
const TARGET_USER_EMAIL = "josh@jpoms.com";

// Test user for automated E2E tests (Playwright)
const TEST_USER_EMAIL = "test@moduli.test";
const TEST_USER_PASSWORD = "testpass123";

async function resetUserData(userId) {
  // Protected grids (the live data) and their scoped docs survive a reset —
  // this script's bare Grid.deleteMany({ userId }) used to take them too.
  const protectedIds = await protectedGridIdsForUser(Grid, userId);
  if (protectedIds.length) console.log(`  (preserving ${protectedIds.length} protected grid(s))`);

  // Preserve imported codex/notebook data (meta.source === "codex-import")
  const preserveFilter = withProtectedExcluded(
    { userId, "meta.source": { $ne: "codex-import" } }, protectedIds);
  const userFilter = withProtectedExcluded({ userId }, protectedIds);
  const gridFilter = protectedIds.length ? { userId, _id: { $nin: protectedIds } } : { userId };

  await Occurrence.deleteMany(preserveFilter);
  await Field.deleteMany(userFilter);
  await Module.deleteMany(preserveFilter);
  await Transaction.deleteMany(userFilter);
  await Grid.deleteMany(gridFilter);
  await Manifest.deleteMany(userFilter);
  await View.deleteMany(preserveFilter);
  await Folder.deleteMany(preserveFilter);
  await Operation.deleteMany(userFilter);
}

async function resetData() {
  console.log("🔄 Starting data reset with sample data...\n");

  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB\n");

    // ===================================================================
    // STEP 0: Find the target user
    // ===================================================================
    console.log(`🔍 Looking up user: ${TARGET_USER_EMAIL}...`);
    const user = await User.findOne({ email: TARGET_USER_EMAIL });
    if (!user) {
      throw new Error(`User not found with email: ${TARGET_USER_EMAIL}`);
    }
    const userId = user._id.toString();
    console.log(`   ✅ Found user: ${userId}\n`);

    // ===================================================================
    // STEP 1: Clear existing data FOR THIS USER ONLY
    // ===================================================================
    console.log("🗑️  Clearing existing data for user...");
    await resetUserData(userId);
    console.log("   ✅ User data cleared\n");

    // ===================================================================
    // STEP 1.5: Ensure uploads/md/ folder exists for textmap file sync
    // ===================================================================
    const uploadsMdDir = resolve(__dirname, "../uploads/md");
    console.log(`🗂️  Ensuring uploads/md/ folder at ${uploadsMdDir}...`);
    fs.mkdirSync(uploadsMdDir, { recursive: true });
    console.log("   ✅ uploads/md/ folder ready\n");

    // ===================================================================
    // STEP 2: Create default data using the reusable utility
    // ===================================================================
    console.log("📊 Creating sample data for user...\n");

    const { gridId, summary } = await createDefaultUserData(userId);

    // Also seed the deterministic Test Grid (used by vitest + e2e fixtures).
    const testGridResult = await createTestGrid(userId);
    console.log(`   ✅ Test Grid seeded for ${TARGET_USER_EMAIL}: ${testGridResult.gridId}`);

    // Re-parent preserved import folders under the new manifest root
    const newManifest = await Manifest.findOne({ userId, manifestType: "user" });
    if (newManifest) {
      const importRoots = await Folder.find({ userId, "meta.source": "codex-import", name: { $in: ["Codex", "Notes (Annotated)"] } });
      if (importRoots.length) {
        for (const f of importRoots) {
          f.parentId = newManifest.rootFolderId;
          await f.save();
        }
        // Also update gridId on all preserved records to match new grid
        const newGridId = gridId;
        await Module.updateMany({ userId, "meta.source": "codex-import" }, { $set: { gridId: newGridId } });
        await Occurrence.updateMany({ userId, "meta.source": "codex-import" }, { $set: { gridId: newGridId } });
        await View.updateMany({ userId, "meta.source": "codex-import" }, { $set: { gridId: newGridId } });
        console.log(`   ✅ Re-parented ${importRoots.length} import folders + updated gridId`);
      }
    }

    // ===================================================================
    // TEST USER: Create or reset test@moduli.test with same example data
    // ===================================================================
    console.log(`\n🧪 Setting up test user: ${TEST_USER_EMAIL}...`);
    let testUser = await User.findOne({ email: TEST_USER_EMAIL });
    if (!testUser) {
      testUser = await User.create({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD });
      console.log(`   ✅ Created test user: ${testUser._id}`);
    } else {
      console.log(`   ✅ Found test user: ${testUser._id}`);
    }
    const testUserId = testUser._id.toString();
    await resetUserData(testUserId);
    await createDefaultUserData(testUserId);
    const testUserGrid = await createTestGrid(testUserId);
    console.log(`   ✅ Test user data populated (default + Test Grid ${testUserGrid.gridId})\n`);

    // ===================================================================
    // SUMMARY
    // ===================================================================
    console.log("=".repeat(60));
    console.log("🎉 DATA RESET COMPLETE!");
    console.log("=".repeat(60));
    console.log(`📊 Summary:`);
    console.log(`   - User: ${TARGET_USER_EMAIL} (${userId})`);
    console.log(`   - Grid ID: ${gridId}`);
    console.log(`   - Fields: ${summary.fields}`);
    console.log(`   - Instances: ${summary.instances}`);
    console.log(`   - Containers: ${summary.containers}`);
    console.log(`   - Panels: ${summary.panels}`);
    console.log(`   - Manifests: ${summary.manifests || 1}`);
    console.log(`   - Views: ${summary.views || 1}`);
    console.log(`   - Folders: ${summary.folders || 3}`);
    console.log(`   - Textmap files: synced to uploads/md/{occurrenceId}.md`);
    console.log(`   - Iterations: ${summary.iterations || 5}`);
    console.log(`   - Operations: ${summary.operations || 1}`);
    console.log(`   - Templates: ${summary.templates || 1}`);
    console.log("=".repeat(60));
    console.log("\n📖 Sample data includes:");
    console.log("   - Daily Toolkit: 8 wellness dimensions with copy-mode templates (persistent)");
    console.log("   - Todo List: One-off tasks with untilDone persistence");
    console.log("   - Schedule: 48 time slot containers (24-hour, 30-min increments)");
    console.log("   - Daily Goals: 8 dimension summaries with derived/aggregate fields");
    console.log("   - Accounts: Lifetime aggregation dashboards");
    console.log("   - Day Page: Notebook with tree sidebar + daily journal");
    console.log("   - Derived fields: Completed count, Total duration, Steps, Water, etc.");
    console.log("   - Persistence modes: persistent, specific, untilDone");
    console.log("   - Iteration: Daily, Weekly, Monthly + compound (Work/Personal)");
    console.log("   - Category dimensions: Context (work, personal, health, finance)");
    console.log("   - Templates: Morning Routine (6 items)");
    console.log("   - File tree: Root → Day Pages + Documents folders with sample docs");
    console.log("   - Operation: Auto count completed tasks (block tree)");
    console.log("=".repeat(60));

  } catch (error) {
    console.error("❌ Reset failed:", error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("\n✅ Disconnected from MongoDB");
  }
}

// Run reset
resetData();
