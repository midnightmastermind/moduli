#!/usr/bin/env node
// server/scripts/pruneHistory.js
//
// ONE-TIME CATCH-UP for the retention window added to `txRecorder.pruneLater`.
//
// The automatic prune bounds the transaction log from here on, but it only runs
// forward — the backlog that accumulated while MeasureOps were unprunable is
// still there. Measured on poms grid 2026-08-28: 37,840 rows / 87.7 MB, of which
// 37,028 carry no `docs` and could never be pruned.
//
// SAFE BY THE SAME PREDICATE THE RUNTIME USES — imported, not restated, so the
// two cannot drift: a row with no `docs` is one the undo stack can never pop
// (`STACK_FILTER` requires a non-empty `docs`). Nothing else reads the log
// except the history panel, which shows the most recent 100.
//
// DUMPS BEFORE DELETING. This is the user's own activity trail; "probably not
// needed" is not a reason to destroy it unrecoverably.
//
//   node --env-file=server/.env server/scripts/pruneHistory.js               # dry run
//   node --env-file=server/.env server/scripts/pruneHistory.js --apply
//   ... --grid "poms grid"     restrict to one grid
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import Transaction from "../models/Transaction.js";
import Grid from "../models/Grid.js";
import { HISTORY_ONLY, historyCutoff, HISTORY_CAP } from "../utils/txRecorder.js";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const gridName = argv.includes("--grid") ? argv[argv.indexOf("--grid") + 1] : null;

await mongoose.connect(process.env.MONGO_URI);

const grids = gridName ? await Grid.find({ name: gridName }).lean() : await Grid.find({}).lean();
if (gridName && !grids.length) { console.error(`no grid named "${gridName}"`); process.exit(1); }

const cutoff = historyCutoff();
console.log(`retention cutoff: ${cutoff.toISOString()}  (rows older than this carrying no \`docs\`)\n`);

let totalDoomed = 0, totalKept = 0;
const dump = [];
for (const g of grids) {
  const gid = String(g._id);
  const all = await Transaction.countDocuments({ gridId: gid });
  // BOTH limits, exactly as the runtime prune applies them: older than the
  // window, OR beyond the per-grid cap. A window alone leaves a burst in place
  // for a week (measured: one active day adds 8,000-22,000 rows).
  const aged = await Transaction.find({ gridId: gid, timestamp: { $lt: cutoff }, ...HISTORY_ONLY }).lean();
  const capCut = await Transaction.findOne({ gridId: gid, ...HISTORY_ONLY })
    .sort({ timestamp: -1 }).skip(HISTORY_CAP).select({ timestamp: 1 }).lean();
  const capped = capCut?.timestamp
    ? await Transaction.find({ gridId: gid, timestamp: { $lte: capCut.timestamp }, ...HISTORY_ONLY }).lean()
    : [];
  const seen = new Set(aged.map(t => t.id));
  const doomed = [...aged, ...capped.filter(t => !seen.has(t.id))];
  // The control that makes the number mean something: rows the undo stack can
  // still use. This must be untouched.
  const onStack = await Transaction.countDocuments({
    gridId: gid, docs: { $exists: true, $ne: [] }, "meta.derived": { $ne: true },
  });
  console.log(`"${g.name}"  ${all} transactions`);
  console.log(`   to prune (history-only, older than the window) ${doomed.length}`);
  console.log(`   ON THE UNDO STACK, never touched                ${onStack}`);
  totalDoomed += doomed.length; totalKept += all - doomed.length;
  dump.push(...doomed);
}

// ── AND THE ROWS WHOSE GRID NO LONGER EXISTS ──────────────────────────────
//
// A per-grid prune loops over live grids, so a transaction pointing at a DELETED
// grid can never be reached by it — and nothing can read it either, since the
// history panel is per-grid. Measured 2026-08-28: 6,299 across 8 dead grids,
// 6,256 of them from one. CLAUDE.md flagged that exact 6,256 on 2026-08-01 and
// it was never actioned.
//
// The age window still applies, so a grid deleted MINUTES ago keeps a recovery
// window rather than having its trail vanish with it.
let orphanDoomed = [];
if (!gridName) {
  const live = new Set(grids.map(g => String(g._id)));
  const rows = await Transaction.find({ timestamp: { $lt: cutoff } }).lean();
  orphanDoomed = rows.filter(t => !live.has(String(t.gridId)));
  const byGrid = new Map();
  for (const t of orphanDoomed) byGrid.set(String(t.gridId), (byGrid.get(String(t.gridId)) || 0) + 1);
  console.log(`\nrows whose grid no longer exists (older than the window): ${orphanDoomed.length}`);
  for (const [gid, n] of [...byGrid.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`   dead grid ${gid}  ${n}`);
  dump.push(...orphanDoomed);
  totalDoomed += orphanDoomed.length;
}

console.log(`\nTOTAL  prune ${totalDoomed}   keep ${totalKept}`);
if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with --apply."); await mongoose.disconnect(); process.exit(0); }
if (!dump.length) { console.log("nothing to prune."); await mongoose.disconnect(); process.exit(0); }

const dir = path.resolve("backups/transactions");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_pruned-history.json`);
fs.writeFileSync(file, JSON.stringify(dump));
console.log(`\n💾 Dumped ${dump.length} row(s) → ${file}  (${(fs.statSync(file).size / 1048576).toFixed(1)} MB)`);

let deleted = 0;
for (const g of grids) {
  // By explicit id, from the very list that was dumped — so what is deleted is
  // exactly what is recoverable, with no second query that could widen.
  const ids = dump.filter(t => String(t.gridId) === String(g._id)).map(t => t.id).filter(Boolean);
  for (let i = 0; i < ids.length; i += 500)
    deleted += (await Transaction.deleteMany({ id: { $in: ids.slice(i, i + 500) } })).deletedCount || 0;
}
// Deleted by explicit id, never by a "not in this list" query — a filter that
// deletes everything it does not recognise is one bad list away from erasing a
// live grid's trail.
for (let i = 0; i < orphanDoomed.length; i += 500) {
  const ids = orphanDoomed.slice(i, i + 500).map(t => t.id).filter(Boolean);
  if (ids.length) deleted += (await Transaction.deleteMany({ id: { $in: ids } })).deletedCount || 0;
}
console.log(`🗑️  deleted ${deleted} row(s)`);
await mongoose.disconnect();
