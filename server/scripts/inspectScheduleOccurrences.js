// inspectScheduleOccurrences.js
// Dumps the water-tracking occurrences inside the schedule page and shows
// what their date field actually contains.
// Run: node --env-file=.env scripts/inspectScheduleOccurrences.js

import mongoose from "mongoose";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

await mongoose.connect(process.env.MONGO_URI);

const testGridId = "69e10afc681f2f675fae81bf";
const scheduleOccId = "atZKQpmthMgM";
const waterFieldId = "dmc4Tj15C9Oq";
const completedFieldId = "LEbHAatN6n-I";
const dateFieldId = "5qNJnmEJCkYr";

function walkDescendants(rootId, occsByIdMap, out = new Set()) {
  const occ = occsByIdMap.get(rootId);
  if (!occ) return out;
  for (const childId of occ.occurrences || []) {
    if (out.has(childId)) continue;
    out.add(childId);
    walkDescendants(childId, occsByIdMap, out);
  }
  return out;
}

const all = await Occurrence.find({ gridId: testGridId }).lean();
const map = new Map(all.map(o => [o.id, o]));
const schedule = map.get(scheduleOccId);
if (!schedule) {
  console.error("Schedule occurrence not found:", scheduleOccId);
  process.exit(1);
}

const descendants = walkDescendants(scheduleOccId, map);
console.log(`Schedule (${scheduleOccId}) has ${descendants.size} descendants`);

const waterOccs = [];
const completedOccs = [];
for (const id of descendants) {
  const o = map.get(id);
  if (!o) continue;
  if (o.fields?.[waterFieldId]) waterOccs.push(o);
  if (o.fields?.[completedFieldId]) completedOccs.push(o);
}

console.log("\n=== Occurrences with water field ===");
for (const o of waterOccs) {
  console.log({
    id: o.id,
    parentId: o.parentId,
    water: o.fields?.[waterFieldId],
    date: o.fields?.[dateFieldId],
  });
}

console.log("\n=== Occurrences with completed field ===");
for (const o of completedOccs) {
  console.log({
    id: o.id,
    parentId: o.parentId,
    completed: o.fields?.[completedFieldId],
    date: o.fields?.[dateFieldId],
  });
}

console.log("\n=== Water / Tasks Completed / Schedule Stamp operations ===");
const opNames = ["Water Today", "Tasks Completed Today", "Schedule Stamp", "Filter: Default to Today"];
const ops = await Operation.find({ name: { $in: opNames }, gridId: testGridId }).lean();
for (const op of ops) {
  console.log(`\n--- ${op.name} ---`);
  console.log("sortOrder:", op.sortOrder);
  console.log("triggerTypes:", op.triggerTypes);
  console.log("enabled:", op.enabled);
  console.log("pipeline steps:", (op.pipeline?.steps || []).length);
}

await mongoose.disconnect();
