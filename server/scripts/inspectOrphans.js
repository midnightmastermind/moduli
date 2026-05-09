// Look at the Drink Water occurrence's parent chain.
import mongoose from "mongoose";
import Occurrence from "../models/Occurrence.js";
import Module from "../models/Module.js";
import User from "../models/User.js";

const TARGET_EMAIL = process.argv[2] || "josh@jpoms.com";
await mongoose.connect(process.env.MONGO_URI);

const user = await User.findOne({ email: TARGET_EMAIL });
const userId = user._id.toString();

const occs = await Occurrence.find({ userId }).lean();
const mods = await Module.find({ userId }).lean();
const occById = Object.fromEntries(occs.map(o => [o.id, o]));
const modById = Object.fromEntries(mods.map(m => [m.id, m]));

const drinkWater = occs.find(o => {
  const m = modById[o.targetId];
  return m?.label === "Drink Water" && o.fields?.HDT0kEI6?.value === true;
});

if (!drinkWater) {
  console.log("No completed Drink Water found");
  process.exit();
}

console.log(`Drink Water (completed): ${drinkWater.id}`);
console.log(`  parentId: ${drinkWater.parentId}`);
console.log(`  fields:`, drinkWater.fields);

let cur = drinkWater.parentId;
let depth = 0;
while (cur && depth++ < 10) {
  const occ = occById[cur];
  if (!occ) {
    console.log(`  ↑ ${cur} — NOT IN DB (orphan parent)`);
    break;
  }
  const mod = modById[occ.targetId];
  console.log(`  ↑ ${occ.id} [${mod?.role}] "${mod?.label}" (parentId=${occ.parentId || "—"})`);
  cur = occ.parentId;
}

// Also check what the 7:00am slot for today looks like
console.log(`\n=== All 7:00am-related occurrences ===`);
for (const o of occs) {
  const slotF = Object.values(o.fields || {}).find(v => v?.value === "7:00am");
  if (slotF) {
    const m = modById[o.targetId];
    console.log(`  ${o.id} [${m?.role}] "${m?.label}" parent=${o.parentId} fields=${JSON.stringify(o.fields).slice(0, 150)}`);
  }
}

// Show what schedule page's occurrences[] currently says
const schedMod = mods.find(m => m.label === "Schedule");
const schedOcc = occs.find(o => o.targetId === schedMod.id);
console.log(`\n=== Schedule page's occurrences[] (${schedOcc.occurrences?.length || 0}) ===`);
for (const id of schedOcc.occurrences || []) {
  const o = occById[id];
  const m = o ? modById[o.targetId] : null;
  console.log(`  ${id} ${o ? `"${m?.label}"` : "MISSING"}`);
}

await mongoose.disconnect();
