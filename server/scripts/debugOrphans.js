// Diagnose orphan occurrences: parentId points to schedule but not in schedule.occurrences[]
import mongoose from "mongoose";
import Occurrence from "../models/Occurrence.js";
import Module from "../models/Module.js";
import User from "../models/User.js";

await mongoose.connect(process.env.MONGO_URI);
const user = await User.findOne({ email: "josh@jpoms.com" });
const userId = user._id.toString();

const schedMod = await Module.findOne({ userId, label: "Schedule" }).lean();
const schedOcc = await Occurrence.findOne({ userId, moduleId: schedMod.id }).lean();
console.log(`Schedule occ: ${schedOcc.id}`);
console.log(`Schedule.occurrences[].length = ${(schedOcc.occurrences || []).length}`);

const childrenWithParent = await Occurrence.find({ userId, parentId: schedOcc.id }).lean();
console.log(`Occurrences with parentId === Schedule: ${childrenWithParent.length}`);

const inList = new Set(schedOcc.occurrences || []);
const orphans = childrenWithParent.filter(c => !inList.has(c.id));
const linked = childrenWithParent.filter(c => inList.has(c.id));
console.log(`  ↳ linked (in occurrences[]): ${linked.length}`);
console.log(`  ↳ orphans (parentId set but not in list): ${orphans.length}`);

if (orphans.length) {
  console.log("\nFirst 5 orphans:");
  for (const o of orphans.slice(0, 5)) {
    const m = await Module.findOne({ id: o.moduleId }).lean();
    console.log(`  ${o.id} [${m?.role}] "${m?.label}" updated=${o.updatedAt}`);
  }
}

// Also check: occurrences with parentId pointing at any slot container (instances inside slots)
const slotIds = childrenWithParent.map(c => c.id);
const grandchildren = await Occurrence.find({ userId, parentId: { $in: slotIds } }).lean();
console.log(`\nGrandchildren (instances inside slots): ${grandchildren.length}`);
const slotsWithChildren = new Map();
for (const slot of childrenWithParent) {
  slotsWithChildren.set(slot.id, (slot.occurrences || []).length);
}
const gcOrphans = grandchildren.filter(g => {
  const slot = childrenWithParent.find(s => s.id === g.parentId);
  return slot && !(slot.occurrences || []).includes(g.id);
});
console.log(`  ↳ grandchild orphans (parentId set but not in slot.occurrences): ${gcOrphans.length}`);

await mongoose.disconnect();
