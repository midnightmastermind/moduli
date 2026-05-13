// server/utils/templatesManifest.js
// Ensures each grid has exactly one manifestType:"templates" manifest + root folder.
// Called on grid bootstrap (after loadUserIntoCache). Idempotent — uses deterministic
// IDs so repeated calls in the same session or across reconnects are no-ops.
import Manifest from "../models/Manifest.js";
import Folder from "../models/Folder.js";

export async function ensureTemplatesManifest({ gridId, userId, uc }) {
  const existing = Object.values(uc.manifestsById || {}).find(
    m => m.gridId === gridId && m.manifestType === "templates"
  );
  if (existing) return existing;

  const folderId = `tpl-root-${gridId}`;
  const manifestId = `tpl-mfst-${gridId}`;

  const folder = await Folder.findOneAndUpdate(
    { id: folderId },
    { id: folderId, name: "Templates", userId, gridId, folderType: "templates", parentId: null, sortOrder: 0 },
    { upsert: true, new: true }
  ).lean();

  const manifest = await Manifest.findOneAndUpdate(
    { id: manifestId },
    { id: manifestId, name: "Templates", userId, gridId, manifestType: "templates", rootFolderId: folderId },
    { upsert: true, new: true }
  ).lean();

  uc.foldersById = uc.foldersById || {};
  uc.manifestsById = uc.manifestsById || {};
  uc.foldersById[folderId] = { ...folder, id: folderId };
  uc.manifestsById[manifestId] = { ...manifest, id: manifestId };
  return uc.manifestsById[manifestId];
}
