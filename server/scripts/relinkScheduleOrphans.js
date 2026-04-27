// scripts/relinkScheduleOrphans.js
// One-time cleanup for the Test Grid: re-link slot/Due occurrences whose
// parentId points at the Schedule page but whose ID is missing from the
// page's `occurrences[]` array (the aftermath of an earlier race during
// bulk creates). Atomic $push, ordered by date FIELD then slot hour/minute.
//
// Run: node --env-file=.env scripts/relinkScheduleOrphans.js [email]

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

  const dateField = await Field.findOne({ gridId, name: "Date" });
  const dateFieldId = dateField?.id;
  if (!dateFieldId) throw new Error("No Date field");

  const schedMod = await Module.findOne({ gridId, label: "Schedule" });
  const schedOcc = await Occurrence.findOne({ gridId, targetId: schedMod.id });
  if (!schedOcc) throw new Error("No Schedule page occurrence");

  console.log(`User: ${TARGET_EMAIL}`);
  console.log(`Test Grid: ${gridId}`);
  console.log(`Schedule page occ: ${schedOcc.id}`);
  console.log(`schedPage.occurrences[] before: ${schedOcc.occurrences?.length || 0}`);

  // Modules whose meta marks them as schedule slots, plus the Due module.
  const slotMods = await Module.find({ gridId, "meta.scheduleSlot": true }).lean();
  const dueMod = await Module.findOne({ gridId, label: "Due" }).lean();
  const childModuleIds = new Set([
    ...slotMods.map(m => m.id),
    ...(dueMod ? [dueMod.id] : []),
  ]);

  // Eligible candidates: occurrence.parentId matches schedPage AND target is a slot/Due module.
  const linkedSet = new Set(schedOcc.occurrences || []);
  const allChildren = await Occurrence.find({
    gridId, parentId: schedOcc.id,
    targetId: { $in: Array.from(childModuleIds) },
  }).lean();
  const orphans = allChildren.filter(o => !linkedSet.has(o.id));

  console.log(`Total schedule children with matching parentId: ${allChildren.length}`);
  console.log(`Orphans (parentId set, but missing from occurrences[]): ${orphans.length}`);

  if (orphans.length === 0) {
    console.log("Nothing to relink. Done.");
    await mongoose.disconnect();
    return;
  }

  // Sort orphans for stable ordering: date asc, then slotHour, slotMinute, then Due last.
  // Slot module meta has slotHour/slotMinute; Due is the catch-all (sorts to end).
  const moduleById = new Map(slotMods.map(m => [m.id, m]));
  const orderKey = (o) => {
    const dv = o.fields?.[dateFieldId];
    const date = dv?.value ? String(dv.value).slice(0, 10) : "9999-99-99";
    const mod = moduleById.get(o.targetId);
    if (!mod) return `${date}|99|99|due`;
    const h = String(mod.meta?.slotHour ?? 0).padStart(2, "0");
    const m = String(mod.meta?.slotMinute ?? 0).padStart(2, "0");
    return `${date}|${h}|${m}|slot`;
  };
  orphans.sort((a, b) => orderKey(a).localeCompare(orderKey(b)));

  // Atomic $push per orphan, gated by $ne so re-runs are no-ops.
  let pushed = 0;
  for (const o of orphans) {
    const updated = await Occurrence.findOneAndUpdate(
      { id: schedOcc.id, userId, occurrences: { $ne: o.id } },
      { $push: { occurrences: o.id } },
      { returnDocument: "after" }
    );
    if (updated) pushed++;
  }

  const after = await Occurrence.findOne({ id: schedOcc.id, userId });
  console.log(`Linked ${pushed}/${orphans.length} orphans`);
  console.log(`schedPage.occurrences[] after: ${after.occurrences?.length || 0}`);

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
