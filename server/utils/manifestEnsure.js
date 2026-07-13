// server/utils/manifestEnsure.js
// The one find-or-mint core behind ensureTemplatesManifest / ensureUserManifest.
// Idempotent: deterministic `<prefix>-root-/<prefix>-mfst-<gridId>` ids, so
// repeated calls in a session or across reconnects are no-ops. `preferId`
// (optional) short-circuits the scan when the caller already knows the
// manifest id (e.g. grid.manifestId).
import Manifest from "../models/Manifest.js";
import Folder from "../models/Folder.js";

export async function ensureManifestOfType({ gridId, userId, uc, prefix, name, manifestType, folderType, preferId = null }) {
  const existing =
    (preferId && (uc.manifestsById || {})[preferId]) ||
    Object.values(uc.manifestsById || {}).find(
      m => m.gridId === gridId && m.manifestType === manifestType
    ) ||
    null;
  if (existing) return existing;

  const folderId = `${prefix}-root-${gridId}`;
  const manifestId = `${prefix}-mfst-${gridId}`;

  const folder = await Folder.findOneAndUpdate(
    { id: folderId },
    { id: folderId, name, userId, gridId, folderType, parentId: null, sortOrder: 0 },
    { upsert: true, returnDocument: "after" }
  ).lean();

  const manifest = await Manifest.findOneAndUpdate(
    { id: manifestId },
    { id: manifestId, name, userId, gridId, manifestType, rootFolderId: folderId },
    { upsert: true, returnDocument: "after" }
  ).lean();

  uc.foldersById = uc.foldersById || {};
  uc.manifestsById = uc.manifestsById || {};
  uc.foldersById[folderId] = { ...folder, id: folderId };
  uc.manifestsById[manifestId] = { ...manifest, id: manifestId };
  return uc.manifestsById[manifestId];
}
