// server/utils/templatesManifest.js
// Ensures each grid has exactly one manifestType:"templates" manifest + root folder.
// Called on grid bootstrap (after loadUserIntoCache). Core: manifestEnsure.js.
import { ensureManifestOfType } from "./manifestEnsure.js";

export function ensureTemplatesManifest({ gridId, userId, uc }) {
  return ensureManifestOfType({
    gridId, userId, uc,
    prefix: "tpl", name: "Templates",
    manifestType: "templates", folderType: "templates",
  });
}
