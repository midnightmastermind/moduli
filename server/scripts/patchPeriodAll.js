// Live-DB apply of the period-all policy (see utils/periodAllPolicy.js): every
// date-gated tracker aggregates ALL when the goals page has no day selected, and
// filters to the selected period otherwise. createLiveData runs the same pass at
// seed time, so this is only for an already-seeded grid without a reseed.
// NOTE: the 5 formerly-`timeFilter:"all"` trackers (Checking/Mom's balances,
// Total Workouts, Total Reading Time, Completion Rate) have NO date gate in an
// already-seeded DB, so this can't make them filterable — that needs a reseed
// (their all-time default is already the correct no-filter behavior). This pass
// fully covers every already-date-gated tracker (Water/Steps/Protein/… + the
// inline Volume/Nutrition/Moods/media/History).
// Usage: node --env-file=.env scripts/patchPeriodAll.js [--apply]
import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });
import Operation from "../models/Operation.js";
import User from "../models/User.js";
import { applyPeriodAllPolicy } from "../utils/periodAllPolicy.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const u = await User.findOne({ email: "josh@jpoms.com" });
  const ops = await Operation.find({ userId: u._id.toString() }).lean();
  const changed = applyPeriodAllPolicy(ops);
  for (const op of changed) {
    console.log(`  ~ ${op.name}`);
    if (APPLY) await Operation.updateOne({ _id: op._id }, { $set: { pipeline: op.pipeline } });
  }
  console.log(`\n${APPLY ? "APPLIED" : "DRY-RUN"}: ${changed.length} trackers.`);
  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
