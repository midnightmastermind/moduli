// server/utils/userManifest.js
// Ensures each grid has a manifestType:"user" manifest + root folder, and that
// the grid doc points at it via grid.manifestId. Grids minted outside the seed
// (create_grid from the Toolbar, the fresh-user 1×1 fallback) previously had NO
// manifest, so the manifest tree, folder pages, and the empty-cell add-panel
// flow were all dead on them — a new panel could only render "No content".
// Called on grid bootstrap next to ensureTemplatesManifest. Core: manifestEnsure.js.
import Grid from "../models/Grid.js";
import { ensureManifestOfType } from "./manifestEnsure.js";

export async function ensureUserManifest({ gridId, userId, uc, gridDoc }) {
  const manifest = await ensureManifestOfType({
    gridId, userId, uc,
    prefix: "usr", name: "Root",
    manifestType: "user", folderType: "normal",
    preferId: gridDoc?.manifestId || null,
  });

  if (gridDoc && gridDoc.manifestId !== manifest.id) {
    await Grid.updateOne({ _id: gridId, userId }, { $set: { manifestId: manifest.id } });
    gridDoc.manifestId = manifest.id;
  }
  return manifest;
}
