// One-off: inspect "Pay monthly bills" occurrences — do the source todo and the
// swept Schedule/Due copy actually share a linkedGroupId in the DB?
import mongoose from "mongoose";
import Occurrence from "../models/Occurrence.js";
import Module from "../models/Module.js";
import User from "../models/User.js";

const TARGET_EMAIL = process.argv[2] || "josh@jpoms.com";
await mongoose.connect(process.env.MONGO_URI);

const user = await User.findOne({ email: TARGET_EMAIL });
if (!user) { console.log(`no user ${TARGET_EMAIL}`); process.exit(1); }
const userId = user._id.toString();

const mods = await Module.find({ userId }).lean();
const billsMods = mods.filter(m => /pay monthly bills/i.test(m.label || ""));
console.log("Bills modules:", billsMods.map(m => `${m.id} "${m.label}" role=${m.role}`));

const modIds = new Set(billsMods.map(m => m.id));
const occs = await Occurrence.find({ userId }).lean();
const billsOccs = occs.filter(o => modIds.has(o.moduleId));

console.log(`\n${billsOccs.length} "Pay monthly bills" occurrence(s):\n`);
for (const o of billsOccs) {
  const completed = Object.entries(o.fields || {}).find(([k]) => {
    const f = mods.find(m => m.id);
    return false;
  });
  console.log(`occ ${o.id}`);
  console.log(`  moduleId       = ${o.moduleId}`);
  console.log(`  parentId       = ${o.parentId || "—"}`);
  console.log(`  linkedGroupId  = ${o.linkedGroupId || "(none)"}`);
  console.log(`  fields         = ${JSON.stringify(o.fields || {})}`);
  console.log(`  meta           = ${JSON.stringify(o.meta || {})}`);
  console.log("");
}

// Group by linkedGroupId
const groups = {};
for (const o of billsOccs) {
  const k = o.linkedGroupId || "(none)";
  (groups[k] = groups[k] || []).push(o.id);
}
console.log("Grouped by linkedGroupId:");
for (const [k, ids] of Object.entries(groups)) {
  console.log(`  ${k}: ${ids.length} occ(s) -> ${ids.join(", ")}`);
}

await mongoose.disconnect();
