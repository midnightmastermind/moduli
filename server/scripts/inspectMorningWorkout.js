// Throw-away diagnostic — print Morning Workout module's fieldBindings
// + any occurrences carrying date/timeslot field values.
import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: resolve(dirname(__filename), "../.env") });

import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Field from "../models/Field.js";

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const mods = await Module.find({ label: /morning workout/i }).lean();
  console.log(`\n=== Modules labelled "Morning Workout": ${mods.length} ===`);
  for (const m of mods) {
    console.log(`\nModule ${m.id}  gridId=${m.gridId}`);
    console.log(`  role=${m.role}  kind=${m.kind}`);
    console.log(`  fieldBindings (${(m.fieldBindings || []).length}):`);
    for (const b of m.fieldBindings || []) {
      const f = await Field.findOne({ id: b.fieldId }).select({ name: 1, type: 1 }).lean();
      console.log(`    - ${b.fieldId}  (${f?.name || "?"}, ${f?.type || "?"})  role=${b.role}  hidden=${b.hidden}  order=${b.order}`);
    }
    const occs = await Occurrence.find({ moduleId: m.id }).lean();
    console.log(`  occurrences (${occs.length}):`);
    for (const o of occs.slice(0, 10)) {
      const fids = Object.keys(o.fields || {});
      console.log(`    - ${o.id}  parentId=${o.parentId}  fields=[${fids.join(", ")}]`);
      for (const fid of fids) {
        const v = o.fields[fid];
        const vv = (v && typeof v === "object" && "value" in v) ? v.value : v;
        const bound = (m.fieldBindings || []).some(b => b.fieldId === fid);
        console.log(`        ${fid} = ${JSON.stringify(vv)}  ${bound ? "[bound]" : "[NOT BOUND]"}`);
      }
    }
  }
  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
