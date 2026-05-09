// Look up an ID across modules, occurrences, folders. Tells us what the
// orphaned parentId on Drink Water actually points at.
import mongoose from "mongoose";
import Occurrence from "../models/Occurrence.js";
import Module from "../models/Module.js";
import Folder from "../models/Folder.js";

const TARGET_ID = process.argv[2] || "9b4620f3-a851-4040-91fa-87bfa380d3ad";
await mongoose.connect(process.env.MONGO_URI);

const occ = await Occurrence.findOne({ id: TARGET_ID }).lean();
const mod = await Module.findOne({ id: TARGET_ID }).lean();
const folder = await Folder.findOne({ id: TARGET_ID }).lean();

console.log(`Looking up: ${TARGET_ID}\n`);
if (occ) {
  console.log("FOUND as Occurrence:");
  console.log(`  targetId=${occ.targetId} parentId=${occ.parentId} userId=${occ.userId} gridId=${occ.gridId}`);
  console.log(`  meta=${JSON.stringify(occ.meta)} fields=${JSON.stringify(occ.fields)}`);
}
if (mod) {
  console.log("FOUND as Module:");
  console.log(`  role=${mod.role} kind=${mod.kind} label=${mod.label} userId=${mod.userId} gridId=${mod.gridId}`);
  console.log(`  meta=${JSON.stringify(mod.meta)}`);
}
if (folder) {
  console.log("FOUND as Folder:");
  console.log(`  parentId=${folder.parentId} name=${folder.name} userId=${folder.userId} gridId=${folder.gridId}`);
}
if (!occ && !mod && !folder) console.log("NOT FOUND anywhere.");

await mongoose.disconnect();
