// server/utils/userManifest.js
// Ensures each grid has a manifestType:"user" manifest + root folder, and that
// the grid doc points at it via grid.manifestId. Grids minted outside the seed
// (create_grid from the Toolbar, the fresh-user 1×1 fallback) previously had NO
// manifest, so the manifest tree, folder pages, and the empty-cell add-panel
// flow were all dead on them — a new panel could only render "No content".
// Called on grid bootstrap next to ensureTemplatesManifest. Idempotent —
// deterministic IDs, same pattern as templatesManifest.js.
import Manifest from "../models/Manifest.js";
import Folder from "../models/Folder.js";
import Grid from "../models/Grid.js";

export async function ensureUserManifest({ gridId, userId, uc, gridDoc }) {
  let manifest =
    (gridDoc?.manifestId && (uc.manifestsById || {})[gridDoc.manifestId]) ||
    Object.values(uc.manifestsById || {}).find(
      m => m.gridId === gridId && m.manifestType === "user"
    ) ||
    null;

  if (!manifest) {
    const folderId = `usr-root-${gridId}`;
    const manifestId = `usr-mfst-${gridId}`;

    const folder = await Folder.findOneAndUpdate(
      { id: folderId },
      { id: folderId, name: "Root", userId, gridId, folderType: "normal", parentId: null, sortOrder: 0 },
      { upsert: true, returnDocument: "after" }
    ).lean();

    manifest = await Manifest.findOneAndUpdate(
      { id: manifestId },
      { id: manifestId, name: "Root", userId, gridId, manifestType: "user", rootFolderId: folderId },
      { upsert: true, returnDocument: "after" }
    ).lean();

    uc.foldersById = uc.foldersById || {};
    uc.manifestsById = uc.manifestsById || {};
    uc.foldersById[folderId] = { ...folder, id: folderId };
    uc.manifestsById[manifestId] = { ...manifest, id: manifestId };
  }

  const manifestId = manifest.id;
  if (gridDoc && gridDoc.manifestId !== manifestId) {
    await Grid.updateOne({ _id: gridId, userId }, { $set: { manifestId } });
    gridDoc.manifestId = manifestId;
  }
  return manifest;
}
