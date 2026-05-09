// Look at all occurrences with non-empty `fields` to see what the user has been
// marking — and whether the latest completed=true edits actually made it to the DB.
import mongoose from "mongoose";
import Occurrence from "../models/Occurrence.js";
import Module from "../models/Module.js";
import User from "../models/User.js";

const TARGET_EMAIL = process.argv[2] || "josh@jpoms.com";
await mongoose.connect(process.env.MONGO_URI);

const user = await User.findOne({ email: TARGET_EMAIL });
const userId = user._id.toString();

const occs = await Occurrence.find({ userId }).sort({ updatedAt: -1 }).lean();
const mods = await Module.find({ userId }).lean();
const modById = Object.fromEntries(mods.map(m => [m.id, m]));

console.log(`Total occurrences: ${occs.length}\n`);

const withFields = occs.filter(o => o.fields && Object.keys(o.fields).length > 0);
console.log(`With non-empty fields: ${withFields.length}\n`);

for (const o of withFields) {
  const m = modById[o.targetId];
  const entries = Object.entries(o.fields).map(([k, v]) => {
    const val = v?.value ?? v;
    return `${k.slice(0, 8)}=${JSON.stringify(val)}`;
  });
  console.log(`${o.id} [${m?.role}] "${m?.label}"`);
  console.log(`  parentId=${o.parentId || "—"} updated=${o.updatedAt}`);
  console.log(`  fields: ${entries.join(", ")}`);
}

await mongoose.disconnect();
