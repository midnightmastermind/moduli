// scripts/syncIndexes.js
// Force-creates every schema-declared index on Atlas. Run once after adding
// new index declarations to a model — Mongoose's autoIndex creates them
// lazily on first model use, but doesn't backfill existing collections.
//
// Run: node --env-file=.env server/scripts/syncIndexes.js
import mongoose from "mongoose";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import View from "../models/View.js";
import Field from "../models/Field.js";
import Folder from "../models/Folder.js";
import Operation from "../models/Operation.js";
import Manifest from "../models/Manifest.js";
import Grid from "../models/Grid.js";

await mongoose.connect(process.env.MONGO_URI);
console.log("✅ connected to Atlas");

const models = [
  ["Module", Module],
  ["Occurrence", Occurrence],
  ["View", View],
  ["Field", Field],
  ["Folder", Folder],
  ["Operation", Operation],
  ["Manifest", Manifest],
  ["Grid", Grid],
];

for (const [name, model] of models) {
  const t0 = Date.now();
  process.stdout.write(`  ${name.padEnd(12)} syncing... `);
  try {
    await model.syncIndexes();
    console.log(`done in ${Date.now() - t0}ms`);
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
  }
}

console.log("\n📊 final index list (Occurrence + Module — verify userId_1_gridId_1 is present):");
for (const name of ["occurrences", "modules"]) {
  const idxs = await mongoose.connection.db.collection(name).indexes();
  console.log(`\n  ${name}:`);
  for (const idx of idxs) console.log(`    ${idx.name}: ${JSON.stringify(idx.key)}`);
}

await mongoose.disconnect();
console.log("\n✅ disconnected");
