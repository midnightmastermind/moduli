// server/scripts/testScheduleAutoBuild.js
// Run: node --env-file=.env server/scripts/testScheduleAutoBuild.js
//
// Boots a fresh Test Grid, then asserts the static state needed for the
// Schedule Auto-Build operation to do its work. Runtime scenarios (operation
// pipeline execution) require the dev server — listed at the bottom for manual
// verification.

import "dotenv/config";
import mongoose from "mongoose";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";
import { dropExistingTestGrid, createTestGrid } from "./createTestGrid.js";
import User from "../models/User.js";

const TEST_EMAIL = "josh@jpoms.com";

function assert(cond, msg) {
  console.log((cond ? "  PASS  " : "  FAIL  ") + msg);
  if (!cond) process.exitCode = 1;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const user = await User.findOne({ email: TEST_EMAIL });
  if (!user) throw new Error(`User ${TEST_EMAIL} not found — create the test user first.`);
  const userId = user._id.toString();

  console.log("Resetting Test Grid…");
  await dropExistingTestGrid(userId);
  const result = await createTestGrid(userId);
  console.log(`Created grid ${result.gridId}.`);

  console.log("\n[Scenario 1] Schedule starts empty after seed");
  const slotMods = await Module.find({ gridId: result.gridId, "meta.scheduleSlot": true });
  const slotIds = slotMods.map(m => m.id);
  const initialOccs = slotIds.length === 0
    ? 0
    : await Occurrence.countDocuments({ gridId: result.gridId, targetId: { $in: slotIds } });
  assert(slotMods.length === 48, `48 slot modules tagged with meta.scheduleSlot (got ${slotMods.length})`);
  assert(initialOccs === 0, `0 slot occurrences before any operation run (got ${initialOccs})`);

  console.log("\n[Scenario 2] Auto-Build operation is registered");
  const autoBuild = await Operation.findOne({ gridId: result.gridId, name: "Schedule: Auto-Build for Active Date" });
  assert(!!autoBuild, "operation present in DB");
  assert(Array.isArray(autoBuild?.triggerTypes) && autoBuild.triggerTypes.includes("onLoad"),  "fires onLoad");
  assert(Array.isArray(autoBuild?.triggerTypes) && autoBuild.triggerTypes.includes("onFilterChange"), "fires onFilterChange");

  console.log("\n[Scenario 3] Clear-on-move operation replaced");
  const clearOp = await Operation.findOne({ gridId: result.gridId, name: "Schedule: Clear Date on Move-Out" });
  assert(!!clearOp, "Schedule: Clear Date on Move-Out present");
  const oldClear = await Operation.findOne({ gridId: result.gridId, name: "Schedule: Clear Date & Time Slot" });
  assert(!oldClear, "old Schedule: Clear Date & Time Slot operation removed");

  console.log("\n[Scenario 4] Todo container tagged + new modules present");
  const todoCont = await Module.findOne({ gridId: result.gridId, "meta.todoListContainer": true });
  assert(!!todoCont, "Todo container module carries meta.todoListContainer");
  const takeMed = await Module.findOne({ gridId: result.gridId, label: "Take Medication" });
  const goGym  = await Module.findOne({ gridId: result.gridId, label: "Go to Gym" });
  assert(!!takeMed, "Take Medication module exists");
  assert(!!goGym,   "Go to Gym module exists");

  console.log("\nManually verify in the browser:");
  console.log("  a. Open the app — schedule populates with 48 slots + Due at top + 3 presets.");
  console.log("  b. Navigate to tomorrow — tomorrow populates similarly.");
  console.log("  c. Navigate back — today's slots intact.");
  console.log("  d. Add a todo with dueDate=tomorrow, switch to tomorrow — todo appears in Due.");
  console.log("  e. Drag a slot occurrence out (move) — its date/timeslot clears.");
  console.log("  f. Drag a slot occurrence out (copy) — original keeps fields, new copy has them too.");

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
