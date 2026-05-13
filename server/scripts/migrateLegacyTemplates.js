// server/scripts/migrateLegacyTemplates.js
// One-shot, idempotent migration.
// Converts Grid.templates[] (flat instance-only) into nested subtrees
// in the per-grid Templates manifest (manifestType: "templates").
//
// Run: node --env-file=.env server/scripts/migrateLegacyTemplates.js

import mongoose from "mongoose";
import Grid from "../models/Grid.js";
import Folder from "../models/Folder.js";
import Manifest from "../models/Manifest.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

async function ensureManifest(grid) {
  const gridId = grid._id.toString();
  let m = await Manifest.findOne({ gridId, manifestType: "templates" });
  if (m) return m;

  const folderId = `tpl-root-${gridId}`;
  await Folder.findOneAndUpdate(
    { id: folderId },
    {
      id: folderId, name: "Templates",
      userId: grid.userId, gridId,
      folderType: "templates", parentId: null, sortOrder: 0,
    },
    { upsert: true }
  );

  const manifestId = `tpl-mfst-${gridId}`;
  m = await Manifest.findOneAndUpdate(
    { id: manifestId },
    {
      id: manifestId, name: "Templates",
      userId: grid.userId, gridId,
      manifestType: "templates", rootFolderId: folderId,
    },
    { upsert: true, new: true }
  );
  return m;
}

async function migrateGrid(grid) {
  const gridId = grid._id.toString();
  const manifest = await ensureManifest(grid);
  const existing = await Occurrence.find({
    userId: grid.userId, gridId, parentId: manifest.rootFolderId,
  }).lean();
  const haveNames = new Set(existing.map(o => o.meta?.templateName).filter(Boolean));

  let migrated = 0;
  for (const t of grid.templates || []) {
    const name = t.name || "Untitled";
    if (haveNames.has(name)) continue;

    // Container module to host the template
    const tplModId = newId();
    await Module.create({
      id: tplModId, userId: grid.userId, gridId,
      role: "container", kind: "list", label: name,
      meta: { templateModule: true },
    });

    // Root template occurrence
    const tplOccId = newId();

    // For each legacy item, mint a child occurrence pointing at the existing instance module
    const childIds = [];
    for (const item of (t.items || [])) {
      if (!item.instanceId) continue;
      const childOccId = newId();
      await Occurrence.create({
        id: childOccId, userId: grid.userId, gridId,
        moduleId: item.instanceId, targetId: item.instanceId, targetType: "module",
        parentId: tplOccId,
        fields: item.fieldDefaults || {},
        occurrences: [],
      });
      childIds.push(childOccId);
    }

    await Occurrence.create({
      id: tplOccId, userId: grid.userId, gridId,
      moduleId: tplModId, targetId: tplModId, targetType: "module",
      parentId: manifest.rootFolderId,
      occurrences: childIds,
      meta: { templateName: name },
    });

    migrated++;
    console.log(`  Migrated "${name}" → ${tplOccId} (${childIds.length} items)`);
  }
  return migrated;
}

async function run() {
  const url = process.env.MONGO_URL;
  if (!url) {
    console.error("MONGO_URL not set. Run with: node --env-file=.env server/scripts/migrateLegacyTemplates.js");
    process.exit(1);
  }
  await mongoose.connect(url);
  const grids = await Grid.find({ "templates.0": { $exists: true } });
  console.log(`Found ${grids.length} grids with legacy templates.`);

  let total = 0;
  for (const grid of grids) {
    console.log(`Grid ${grid._id} (user ${grid.userId}):`);
    const n = await migrateGrid(grid);
    total += n;
    if (n === 0) console.log("  (nothing to migrate)");
  }

  console.log(`\nDone. Migrated ${total} template(s) across ${grids.length} grid(s).`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
