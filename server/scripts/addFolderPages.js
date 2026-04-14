// scripts/addFolderPages.js
// ============================================================
// Creates folder-page modules + occurrences for every imported
// codex folder so the UI can navigate into them and show
// PreviewNode cards for children.
//
// Usage: cd server && node scripts/addFolderPages.js
// ============================================================

import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, "../.env") });

import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Folder from "../models/Folder.js";
import User from "../models/User.js";
import Grid from "../models/Grid.js";

const uid = () => crypto.randomUUID();

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const user = await User.findOne({ email: "josh@jpoms.com" });
  if (!user) throw new Error("User not found");
  const userId = user._id.toString();

  const grid = await Grid.findOne({ userId }).lean();
  const gridId = grid.id || grid._id.toString();

  // Find all codex-import folders
  const importFolders = await Folder.find({ userId, "meta.source": "codex-import" }).lean();
  console.log(`Found ${importFolders.length} import folders`);

  // Check which folders already have a folder-page occurrence
  const existingFolderPages = await Occurrence.find({
    userId,
    "meta.source": "codex-import",
  }).lean();

  const existingFolderPageModules = await Module.find({
    userId,
    role: "page",
    kind: "folder",
    "meta.source": "codex-import",
  }).lean();

  // Build set of folderIds that already have folder-page occurrences
  const foldersWithPages = new Set();
  for (const occ of existingFolderPages) {
    const mod = existingFolderPageModules.find(m => m.id === occ.targetId);
    if (mod) foldersWithPages.add(occ.parentId);
  }

  const moduleBatch = [];
  const occurrenceBatch = [];
  let created = 0;

  for (const folder of importFolders) {
    if (foldersWithPages.has(folder.id)) continue;

    const modId = uid();
    const occId = uid();

    moduleBatch.push({
      id: modId,
      userId,
      gridId,
      role: "page",
      kind: "folder",
      label: folder.name,
      meta: { source: "codex-import" },
    });

    occurrenceBatch.push({
      id: occId,
      userId,
      gridId,
      targetId: modId,
      targetType: "module",
      parentId: folder.id,
      sortOrder: -1, // before other content
      iteration: { mode: "persistent" },
      fields: {},
      meta: { source: "codex-import" },
    });

    created++;
  }

  if (moduleBatch.length) {
    await Module.insertMany(moduleBatch, { ordered: false });
    await Occurrence.insertMany(occurrenceBatch, { ordered: false });
  }

  console.log(`Created ${created} folder-page modules + occurrences`);
  console.log(`Skipped ${foldersWithPages.size} folders that already had pages`);

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
