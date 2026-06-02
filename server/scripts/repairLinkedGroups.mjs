// Repairs the linkedGroupId on Schedule source tasks whose Schedule Table
// row copies carry `lg-<sourceId>` but the source itself has lg unset.
// Symptom: Table:Build's per-fire existence check fails, over-deletes
// every row and re-mints them. Caused by UPDATE_OCCURRENCE effects not
// mirroring to localOccsById (fixed in client commit on bindSocketToStore.js).
// This script backfills the DB for already-broken rows so the user doesn't
// have to re-seed.
import mongoose from "mongoose";
import Occurrence from "../models/Occurrence.js";
import Module from "../models/Module.js";

await mongoose.connect(process.env.MONGO_URI);

const allOccs = await Occurrence.find({}, { id: 1, linkedGroupId: 1, parentId: 1, occurrences: 1, moduleId: 1 }).lean();
const byId = new Map(allOccs.map(o => [o.id, o]));

let fixed = 0;
const updates = [];
for (const o of allOccs) {
  // Row/card copies carry lg-<sourceId>. If the source exists and has no lg,
  // backfill it with the same lg.
  if (!o.linkedGroupId || !o.linkedGroupId.startsWith("lg-")) continue;
  const sourceId = o.linkedGroupId.slice(3);
  const source = byId.get(sourceId);
  if (!source) continue;
  if (source.linkedGroupId === o.linkedGroupId) continue; // already correct
  if (source.linkedGroupId) continue;                      // source has different lg — leave alone
  updates.push({ updateOne: { filter: { id: sourceId }, update: { $set: { linkedGroupId: o.linkedGroupId } } } });
  fixed++;
}

if (updates.length === 0) {
  console.log("No broken sources found.");
} else {
  console.log(`Backfilling ${updates.length} source tasks with their copy's linkedGroupId.`);
  const result = await Occurrence.bulkWrite(updates);
  console.log("Result:", JSON.stringify(result, null, 2));
}

await mongoose.disconnect();
