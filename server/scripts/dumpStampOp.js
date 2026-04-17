// Dumps the current stored Stamp / Water / Tasks ops to verify pipeline state.
import mongoose from "mongoose";
import Operation from "../models/Operation.js";

await mongoose.connect(process.env.MONGO_URI);
const testGridId = "69e10afc681f2f675fae81bf";

const names = ["Schedule: Stamp Date & Time Slot", "Water Today", "Tasks Completed Today", "Filter: Default to Today"];
for (const n of names) {
  const op = await Operation.findOne({ name: n, gridId: testGridId }).lean();
  if (!op) { console.log(`✗ ${n} not found`); continue; }
  console.log(`\n=== ${n} ===`);
  console.log(`sortOrder: ${op.sortOrder}  triggers: ${op.triggerTypes?.join(",")}`);
  console.log(JSON.stringify(op.pipeline, null, 2));
}

await mongoose.disconnect();
