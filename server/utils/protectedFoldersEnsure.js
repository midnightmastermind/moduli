// server/utils/protectedFoldersEnsure.js
//
// Find-or-mint the protected Templates and Files folders under the user
// manifest's root, on grid bootstrap.
//
// Until 2026-09-21 only migrations minted them (0035 Templates, 0049 Files), and
// migrations only ever ran on the seeded grids. A grid created from the Toolbar
// therefore had neither: `templatesFolderFor` returned null, so "Save as new
// template" returned before emitting anything (no error, no template), and
// `resolveFilesFolderId` refused every upload home. Found rebuilding a grid
// through the UI.
//
// Same rules as the migrations, so a migrated grid and a bootstrapped one are
// indistinguishable:
//   - the folder sits directly under the user root, marked `meta.protected`
//   - an existing same-named folder directly under the root is ADOPTED
//     (stamped protected), as 0035/0049 do — never a second one beside it
//   - Files' four subfolders are NOT protected
// Cache-first: when both folders already exist this costs no query, which is
// every load on every grid after its first.
import Folder from "../models/Folder.js";
import { TEMPLATES_FOLDER_NAME, FILES_FOLDER_NAME, isProtectedFolder } from "./protectedFolders.js";
import { FILES_SUBFOLDER_NAMES } from "./filesFolder.js";

function findChild(uc, { gridId, userId, parentId, name }) {
  return Object.values(uc.foldersById || {}).find(
    f => f && f.gridId === gridId && f.userId === userId && f.parentId === parentId && f.name === name,
  ) || null;
}

function findProtected(uc, { gridId, userId, name }) {
  return Object.values(uc.foldersById || {}).find(
    f => f && f.gridId === gridId && f.userId === userId && isProtectedFolder(f) && f.name === name,
  ) || null;
}

async function upsertFolder(uc, doc) {
  const saved = await Folder.findOneAndUpdate(
    { id: doc.id }, doc, { upsert: true, returnDocument: "after" },
  ).lean();
  uc.foldersById[doc.id] = { ...saved, id: doc.id };
  return uc.foldersById[doc.id];
}

async function ensureProtected(uc, { gridId, userId, rootFolderId, name, id, sortOrder }) {
  const existing = findProtected(uc, { gridId, userId, name });
  if (existing) return existing;

  const adoptable = findChild(uc, { gridId, userId, parentId: rootFolderId, name });
  if (adoptable) {
    await Folder.updateOne({ id: adoptable.id, userId }, { $set: { "meta.protected": true } });
    adoptable.meta = { ...(adoptable.meta || {}), protected: true };
    return adoptable;
  }

  return upsertFolder(uc, {
    id, userId, gridId, parentId: rootFolderId, name,
    folderType: "normal", sortOrder, meta: { protected: true },
  });
}

export async function ensureProtectedFolders({ gridId, userId, uc, manifest }) {
  const rootFolderId = manifest?.rootFolderId;
  if (!rootFolderId) return null;
  uc.foldersById = uc.foldersById || {};

  // `tpl-folder-<gridId>` is the id 0035 mints, so a later 0035 run is a no-op.
  const templates = await ensureProtected(uc, {
    gridId, userId, rootFolderId, name: TEMPLATES_FOLDER_NAME,
    id: `tpl-folder-${gridId}`, sortOrder: 0,
  });

  const files = await ensureProtected(uc, {
    gridId, userId, rootFolderId, name: FILES_FOLDER_NAME,
    id: `files-folder-${gridId}`, sortOrder: 50,
  });
  for (const [i, name] of FILES_SUBFOLDER_NAMES.entries()) {
    if (findChild(uc, { gridId, userId, parentId: files.id, name })) continue;
    await upsertFolder(uc, {
      id: `files-${name.toLowerCase()}-${gridId}`, userId, gridId, parentId: files.id,
      name, folderType: "normal", sortOrder: i, meta: {},
    });
  }

  return { templates, files };
}
