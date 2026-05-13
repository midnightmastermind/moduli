// Debug script: dumps schedule-related occurrences to see why FIND checks fail.
import mongoose from "mongoose";
import Occurrence from "../models/Occurrence.js";
import Module from "../models/Module.js";
import User from "../models/User.js";

const TARGET_EMAIL = process.argv[2] || "josh@jpoms.com";

await mongoose.connect(process.env.MONGO_URI);
const user = await User.findOne({ email: TARGET_EMAIL });
const userId = user._id.toString();

// Find Schedule page module + occurrence
const schedMod = await Module.findOne({ userId, label: "Schedule" }).lean();
console.log("Schedule module:", schedMod?.id, schedMod?.role, schedMod?.label);

const schedOcc = await Occurrence.findOne({ userId, moduleId: schedMod?.id }).lean();
console.log("Schedule occurrence:", schedOcc?.id, "children:", schedOcc?.occurrences?.length);

// Walk the tree under Schedule and dump every occurrence + its field values
async function walk(occId, depth = 0, prefix = "") {
  const occ = await Occurrence.findOne({ id: occId }).lean();
  if (!occ) return;
  const mod = await Module.findOne({ id: occ.moduleId }).lean();
  const fieldStrs = [];
  for (const [fid, fv] of Object.entries(occ.fields || {})) {
    const v = fv?.value !== undefined ? fv.value : fv;
    fieldStrs.push(`${fid}=${JSON.stringify(v)}`);
  }
  console.log(
    `${prefix}${" ".repeat(depth * 2)}${occ.id} [${mod?.role || "?"}] "${mod?.label || "?"}" fields:{${fieldStrs.join(", ")}}`
  );
  for (const cid of occ.occurrences || []) {
    await walk(cid, depth + 1, prefix);
  }
}

if (schedOcc) {
  console.log("\n=== Schedule occurrence tree ===");
  await walk(schedOcc.id);
}

// Also dump the goal "Task Progress" occurrence
const goalMod = await Module.findOne({ userId, label: "Task Progress" }).lean();
const goalOcc = goalMod ? await Occurrence.findOne({ userId, moduleId: goalMod.id }).lean() : null;
console.log("\n=== Task Progress goal ===");
console.log("Module:", goalMod?.id);
console.log("Occurrence:", goalOcc?.id, "filterOverride:", JSON.stringify(goalOcc?.filterOverride));
console.log("Fields:", JSON.stringify(goalOcc?.fields));

// Print the most recently updated occurrence (likely the user's recent toggle)
const recentOccs = await Occurrence.find({ userId }).sort({ updatedAt: -1 }).limit(5).lean();
console.log("\n=== 5 most recently updated occurrences ===");
for (const o of recentOccs) {
  const m = await Module.findOne({ id: o.moduleId }).lean();
  const fStrs = Object.entries(o.fields || {}).map(([k, v]) => `${k}=${JSON.stringify(v?.value !== undefined ? v.value : v)}`);
  console.log(`  ${o.id} updated=${o.updatedAt} [${m?.role || "?"}] "${m?.label || "?"}" parentId=${o.parentId || "—"}`);
  console.log(`    fields: {${fStrs.join(", ")}}`);
}

await mongoose.disconnect();
