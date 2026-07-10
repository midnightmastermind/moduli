// Live-DB apply of the schedule-completion policy (see utils/completionGate.js).
// createLiveData.js runs the same pass at seed time, so this is only needed to
// gate an ALREADY-seeded grid without a destructive reseed. Idempotent.
// Usage: node --env-file=.env scripts/patchCompletionGates.js [--apply]
import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });
import Operation from "../models/Operation.js";
import Field from "../models/Field.js";
import Occurrence from "../models/Occurrence.js";
import Module from "../models/Module.js";
import User from "../models/User.js";
import { gateScheduleTrackers, GATE_TRACKER_NAMES } from "../utils/completionGate.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const u = await User.findOne({ email: "josh@jpoms.com" });
  const userId = u._id.toString();
  const completedFieldId = (await Field.findOne({ userId, name: "Completed" })).id;
  const schedMod = (await Module.find({ userId, role: "page" }).lean()).find(x => x.label === "Schedule");
  const scheduleOccId = (await Occurrence.find({ userId, moduleId: schedMod.id }).lean())[0].id;
  console.log(`Completed=${completedFieldId} Schedule occ=${scheduleOccId} apply=${APPLY}\n`);

  const ops = await Operation.find({ userId, name: { $in: [...GATE_TRACKER_NAMES] } }).lean();
  const changed = gateScheduleTrackers(ops, { completedFieldId, scheduleOccId });
  for (const op of changed) {
    console.log(`  + ${op.name}`);
    if (APPLY) await Operation.updateOne({ _id: op._id }, { $set: { pipeline: op.pipeline } });
  }
  console.log(`\n${APPLY ? "APPLIED" : "DRY-RUN"}: ${changed.length} ops.`);
  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
