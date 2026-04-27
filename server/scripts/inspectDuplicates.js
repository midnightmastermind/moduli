// Quick read-only diagnostic for the Test Grid duplicate-creation issue.
// Run: node --env-file=.env server/scripts/inspectDuplicates.js
import "dotenv/config";
import mongoose from "mongoose";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Field from "../models/Field.js";
import Grid from "../models/Grid.js";
import User from "../models/User.js";

const TARGET_EMAIL = process.argv[2] || "josh@jpoms.com";

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const user = await User.findOne({ email: TARGET_EMAIL });
  if (!user) throw new Error(`No user ${TARGET_EMAIL}`);
  const userId = user._id.toString();

  const grid = await Grid.findOne({ userId, name: "Test Grid" }).sort({ _id: -1 });
  if (!grid) throw new Error("No Test Grid found");
  const gridId = grid._id.toString();
  console.log(`User: ${TARGET_EMAIL} (${userId})`);
  console.log(`Test Grid: ${gridId}\n`);

  const dateField = await Field.findOne({ gridId, name: "Date" });
  const dateFieldId = dateField?.id;
  console.log(`Date field id: ${dateFieldId}\n`);

  const modules = await Module.find({ gridId }).lean();
  const occurrences = await Occurrence.find({ gridId }).lean();

  const dueMod = modules.find(m => m.label === "Due");
  console.log(`Due modules in grid: ${modules.filter(m => m.label === "Due").length}`);
  if (dueMod) {
    const dues = occurrences.filter(o => o.targetId === dueMod.id);
    console.log(`Due occurrences: ${dues.length}`);
    const byDate = {};
    let noDate = 0;
    for (const o of dues) {
      const dv = o.fields?.[dateFieldId];
      const val = dv?.value ?? dv;
      const key = val ? String(val).slice(0, 10) : "(no date)";
      if (!val) noDate++;
      byDate[key] = (byDate[key] || 0) + 1;
    }
    console.log("Dues by date:");
    for (const [k, v] of Object.entries(byDate).sort()) console.log(`  ${k}: ${v}`);
    console.log(`Dues with no date field set: ${noDate}`);
  }

  // Slot modules
  const slotMods = modules.filter(m => m.meta?.scheduleSlot);
  console.log(`\nSlot modules: ${slotMods.length} (expected 48)`);
  const slotIds = new Set(slotMods.map(m => m.id));
  const slotOccs = occurrences.filter(o => slotIds.has(o.targetId));
  console.log(`Slot occurrences total: ${slotOccs.length}`);

  const byDate = {};
  let noDate = 0;
  for (const o of slotOccs) {
    const dv = o.fields?.[dateFieldId];
    const val = dv?.value ?? dv;
    const key = val ? String(val).slice(0, 10) : "(no date)";
    if (!val) noDate++;
    byDate[key] = (byDate[key] || 0) + 1;
  }
  console.log("Slots by date:");
  for (const [k, v] of Object.entries(byDate).sort()) console.log(`  ${k}: ${v} (expected 48)`);
  console.log(`Slots with no date field set: ${noDate}`);

  // First 3 slot occurrences raw
  console.log("\nFirst 3 slot occurrences (raw fields):");
  for (const o of slotOccs.slice(0, 3)) {
    console.log({ id: o.id, parentId: o.parentId, fields: o.fields });
  }

  // Schedule page
  const schedMod = modules.find(m => m.label === "Schedule");
  const schedOcc = occurrences.find(o => o.targetId === schedMod?.id);
  console.log(`\nSchedule page occurrence: ${schedOcc?.id}`);
  console.log(`Schedule filterOverride: ${JSON.stringify(schedOcc?.filterOverride)}`);
  console.log(`Schedule occurrences[].length: ${schedOcc?.occurrences?.length || 0}`);

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
