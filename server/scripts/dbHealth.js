// scripts/dbHealth.js
// Quick health check on the user's grid data + indexes.
// Run: node --env-file=./server/.env server/scripts/dbHealth.js
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));

import Grid from "../models/Grid.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import User from "../models/User.js";

const TARGET_EMAIL = process.argv[2] || "josh@jpoms.com";

await mongoose.connect(process.env.MONGO_URI);
console.log("✅ connected\n");

// 1. Index check — verify the compound (userId, gridId) is actually built.
console.log("── Indexes ───────────────────────────────────");
for (const name of ["modules", "occurrences"]) {
  const idxs = await mongoose.connection.db.collection(name).indexes();
  const compound = idxs.find(i => i.key?.userId === 1 && i.key?.gridId === 1);
  console.log(`  ${name}: ${idxs.length} indexes — userId+gridId compound: ${compound ? "✅" : "❌ MISSING"}`);
}

// 2. Per-collection sizes (across the whole DB, not just one user).
console.log("\n── Collection sizes (entire DB) ──────────────");
for (const name of ["users", "grids", "modules", "occurrences", "fields", "operations", "views", "folders", "manifests"]) {
  const c = await mongoose.connection.db.collection(name).countDocuments();
  console.log(`  ${name.padEnd(12)} ${c} docs`);
}

// 3. Time the actual full_state queries for this user.
const user = await User.findOne({ email: TARGET_EMAIL });
if (!user) { console.error(`user ${TARGET_EMAIL} not found`); process.exit(1); }
const userId = user._id.toString();
const grids = await Grid.find({ userId }).lean();
console.log(`\n── User ${TARGET_EMAIL}: ${grids.length} grids ───────────`);

for (const g of grids) {
  const gridId = g._id.toString();
  console.log(`\n  Grid "${g.name || "(unnamed)"}" (${gridId}):`);
  const tests = [
    ["Module count", () => Module.countDocuments({ userId, gridId })],
    ["Module find lean", () => Module.find({ userId, gridId }).lean()],
    ["Occurrence count", () => Occurrence.countDocuments({ userId, gridId })],
    ["Occurrence find lean", () => Occurrence.find({ userId, gridId }).lean()],
  ];
  for (const [label, fn] of tests) {
    const t0 = Date.now();
    const r = await fn();
    const ms = Date.now() - t0;
    const n = Array.isArray(r) ? r.length : r;
    console.log(`    ${label.padEnd(25)} ${ms.toString().padStart(5)}ms — ${n}`);
  }

  // 4. Textmap size — if occurrences carry huge textmaps the transfer is the bottleneck.
  const occs = await Occurrence.find({ userId, gridId, textmap: { $ne: null } }).select({ textmap: 1 }).lean();
  let totalBytes = 0;
  let maxBytes = 0;
  let maxId = null;
  for (const o of occs) {
    const s = JSON.stringify(o.textmap || "");
    totalBytes += s.length;
    if (s.length > maxBytes) { maxBytes = s.length; maxId = o._id; }
  }
  console.log(`    Textmap: ${occs.length} occs carry one, total ${(totalBytes / 1024).toFixed(1)} KB (max ${(maxBytes / 1024).toFixed(1)} KB on ${maxId})`);
}

await mongoose.disconnect();
console.log("\n✅ done");
