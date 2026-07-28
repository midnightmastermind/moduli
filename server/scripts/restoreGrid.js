// scripts/restoreGrid.js
//
// Restore a grid from a backupGrid.js directory. Pair with backupGrid.js —
// see docs/superpowers/plans/2026-07-28-poms-grid-live-data-freeze.md.
//
// WHY THIS RESTORES VERBATIM (same grid id, same document ids):
// `Occurrence.id` is a globally UNIQUE index, and occurrence ids are woven
// through parentId, occurrences[], moduleId, viewId, textmap embeds, operation
// pipelines and field bindings. Remapping them on restore means rewriting every
// one of those references, and a half-correct remap would give false confidence
// in the one tool whose entire job is to be trustworthy. So: restore is a
// faithful reinsert, which is exactly the disaster case ("the grid is gone,
// put it back"). To REHEARSE a restore without touching live data, restore into
// a scratch DATABASE with --into-db; verbatim ids collide with nothing there.
//
// Usage:
//   # dry run (default) — reports what it would write
//   node --env-file=server/.env server/scripts/restoreGrid.js --from backups/poms-grid/<stamp>
//   # commit
//   node --env-file=server/.env server/scripts/restoreGrid.js --from <dir> --apply
//   # rehearsal into a scratch database, then verify
//   node --env-file=server/.env server/scripts/restoreGrid.js --from <dir> --into-db moduli_restore_drill --apply
//   node --env-file=server/.env server/scripts/restoreGrid.js --from <dir> --into-db moduli_restore_drill --verify
//
// Flags:
//   --from <dir>       backup directory (must contain manifest.json)
//   --apply            actually write (default is a dry run)
//   --into-db <name>   restore into a different database on the same cluster
//   --overwrite        allowed to replace an existing grid of the same id —
//                      deletes its scoped docs first. Requires --apply and
//                      --yes-overwrite-live.
//   --verify           compare the target database against the backup, report
//                      per-collection diffs, exit non-zero on mismatch
//   --drop-db          delete the --into-db scratch database (rehearsal cleanup)

import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { fileURLToPath } from "url";

import Grid from "../models/Grid.js";
import { BACKUP_COLLECTIONS } from "./backupGrid.js";

function parseArgs(argv) {
  const out = { from: null, apply: false, intoDb: null, overwrite: false,
                yesOverwrite: false, verify: false, dropDb: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from") out.from = path.resolve(argv[++i]);
    else if (a === "--apply") out.apply = true;
    else if (a === "--into-db") out.intoDb = argv[++i];
    else if (a === "--overwrite") out.overwrite = true;
    else if (a === "--yes-overwrite-live") out.yesOverwrite = true;
    else if (a === "--verify") out.verify = true;
    else if (a === "--drop-db") out.dropDb = true;
  }
  return out;
}

export function readBackup(dir) {
  const mPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(mPath)) throw new Error(`No manifest.json in ${dir} — not a backup directory`);
  const manifest = JSON.parse(fs.readFileSync(mPath, "utf8"));
  const grid = JSON.parse(fs.readFileSync(path.join(dir, "grid.json"), "utf8"));
  const data = {};
  for (const { name } of BACKUP_COLLECTIONS) {
    const p = path.join(dir, `${name}.json`);
    data[name] = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : [];
  }
  // The backup's own integrity check: the manifest counts must match the files
  // on disk. A truncated write is caught HERE, not after we have deleted the
  // live data we were about to restore over.
  const mismatched = [];
  for (const [name, n] of Object.entries(manifest.counts || {})) {
    if (name === "grid") continue;
    if ((data[name]?.length ?? 0) !== n) mismatched.push(`${name}: manifest=${n} file=${data[name]?.length ?? 0}`);
  }
  if (mismatched.length) throw new Error(`Backup is inconsistent — ${mismatched.join("; ")}`);
  return { manifest, grid, data };
}

/**
 * Deterministic content hash for a set of documents. Both sides go through a
 * JSON round-trip first so a Date/ObjectId from Mongo compares equal to the
 * string it was serialised as, then keys are sorted so field order can't make
 * two identical documents look different.
 */
export function contentHash(docs) {
  const stable = (v) => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === "object") {
      return Object.keys(v).sort().reduce((acc, k) => { acc[k] = stable(v[k]); return acc; }, {});
    }
    return v;
  };
  const norm = JSON.parse(JSON.stringify(docs))
    .map(stable)
    // Sort by whatever identity the collection has, so insertion order is
    // irrelevant to the comparison.
    .sort((a, b) => String(a.id ?? a._id).localeCompare(String(b.id ?? b._id)));
  return createHash("sha256").update(JSON.stringify(norm)).digest("hex").slice(0, 16);
}

/** Live counts for a grid id, per collection. */
async function censusFor(conn, gridId) {
  const counts = {};
  for (const { name, model } of BACKUP_COLLECTIONS) {
    counts[name] = await conn.model(model.modelName, model.schema).countDocuments({ gridId });
  }
  counts.grid = await conn.model("Grid", Grid.schema).countDocuments({ _id: gridId });
  return counts;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.from) throw new Error("Pass --from <backup directory>");

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGO_URI is not set (run with --env-file=server/.env)");
  await mongoose.connect(uri);

  const conn = args.intoDb ? mongoose.connection.useDb(args.intoDb, { useCache: true }) : mongoose.connection;
  const targetDb = conn.name;
  const GridM = conn.model("Grid", Grid.schema);

  const { manifest, grid, data } = readBackup(args.from);
  const gridId = manifest.grid.id;

  console.log(`📦 Backup : "${manifest.grid.name}"  ${manifest.takenAt}${manifest.label ? `  [${manifest.label}]` : ""}`);
  console.log(`   from   : ${args.from}`);
  console.log(`   source : db=${manifest.database} git=${(manifest.gitHead || "").slice(0, 8)}`);
  console.log(`   target : db=${targetDb}  gridId=${gridId}\n`);

  if (args.dropDb) {
    if (!args.intoDb) throw new Error("--drop-db requires --into-db (refusing to drop the primary database)");
    if (!args.apply) { console.log(`DRY RUN — would drop database "${args.intoDb}"`); return; }
    await conn.dropDatabase();
    console.log(`🗑️  Dropped scratch database "${args.intoDb}"`);
    return;
  }

  if (args.verify) {
    // Counts AND content. Matching counts alone would pass a restore that
    // dropped every field off every occurrence, which is the exact failure this
    // tool exists to rule out.
    const rows = [["collection", "backup", targetDb, "hash(backup)", `hash(${targetDb})`, ""]];
    let bad = 0;
    const check = (key, wantDocs, gotDocs) => {
      const wantH = contentHash(wantDocs), gotH = contentHash(gotDocs);
      const ok = wantDocs.length === gotDocs.length && wantH === gotH;
      if (!ok) bad++;
      rows.push([key, String(wantDocs.length), String(gotDocs.length), wantH, gotH, ok ? "ok" : "MISMATCH"]);
    };

    const liveGrid = await GridM.find({ _id: gridId }).lean();
    check("grid", [grid], liveGrid);
    for (const { name, model } of BACKUP_COLLECTIONS) {
      const liveDocs = await conn.model(model.modelName, model.schema).find({ gridId }).lean();
      check(name, data[name], liveDocs);
    }

    const w = rows[0].map((_, i) => Math.max(...rows.map(r => r[i].length)));
    rows.forEach((r, i) => {
      console.log("   " + r.map((c, j) => c.padEnd(w[j])).join("  "));
      if (i === 0) console.log("   " + w.map(n => "-".repeat(n)).join("  "));
    });
    if (bad) { console.error(`\n❌ ${bad} collection(s) do not match the backup`); process.exitCode = 1; }
    else console.log(`\n✅ ${targetDb} matches the backup exactly — counts AND content`);
    return;
  }

  // --- restore ---------------------------------------------------------
  const existingGrid = await GridM.findById(gridId).lean();
  const existing = await censusFor(conn, gridId);
  const occupied = Object.entries(existing).filter(([, n]) => n > 0);

  if (occupied.length && !args.overwrite) {
    throw new Error(
      `Target db "${targetDb}" already holds this grid ` +
      `(${occupied.map(([k, n]) => `${k}=${n}`).join(", ")}). ` +
      `Restoring would collide on unique ids. Use --into-db for a rehearsal, or ` +
      `--overwrite --yes-overwrite-live to replace it.`
    );
  }
  if (occupied.length && args.overwrite && !args.yesOverwrite) {
    throw new Error("--overwrite also requires --yes-overwrite-live (this deletes live documents).");
  }

  const plan = [
    ["grid", 1],
    ...BACKUP_COLLECTIONS.map(({ name }) => [name, data[name].length]),
  ];
  console.log("   Would write:");
  for (const [name, n] of plan) console.log(`     ${name.padEnd(13)} ${n}`);
  if (existingGrid) console.log(`\n   ⚠️  Replacing existing grid "${existingGrid.name}" in ${targetDb}`);

  if (!args.apply) { console.log("\nDRY RUN — nothing written. Re-run with --apply."); return; }

  if (occupied.length) {
    for (const { name, model } of BACKUP_COLLECTIONS) {
      await conn.model(model.modelName, model.schema).deleteMany({ gridId });
    }
    await GridM.deleteOne({ _id: gridId });
    console.log("\n   🗑️  Cleared the existing grid");
  }

  await GridM.collection.insertOne({ ...grid, _id: new mongoose.Types.ObjectId(gridId) });
  for (const { name, model } of BACKUP_COLLECTIONS) {
    const docs = data[name];
    if (!docs.length) continue;
    // insertMany on the raw collection: the documents are already schema-shaped
    // (they came out of this same schema) and we want them back BYTE-IDENTICAL,
    // not re-defaulted by Mongoose on the way in.
    await conn.model(model.modelName, model.schema).collection.insertMany(
      docs.map(d => ({ ...d, _id: typeof d._id === "string" && /^[a-f0-9]{24}$/i.test(d._id)
        ? new mongoose.Types.ObjectId(d._id) : d._id })),
      { ordered: false }
    );
  }
  console.log(`\n✅ Restored "${manifest.grid.name}" into ${targetDb}`);
  console.log(`   Verify with:  --from ${args.from}${args.intoDb ? ` --into-db ${args.intoDb}` : ""} --verify`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main()
    .then(async () => { await mongoose.disconnect(); process.exit(process.exitCode || 0); })
    .catch(async (err) => {
      console.error("❌ Restore failed:", err.message);
      try { await mongoose.disconnect(); } catch { /* already closed */ }
      process.exit(1);
    });
}
