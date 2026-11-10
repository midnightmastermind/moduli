// utils/importsFolder.js
//
// The grid's Imports folder, found the way the client finds it (client/src/helpers/importsFolder.js
// `ensureImportsFolderAndPage`): the PROTECTED folder named "Imports" wherever it sits (0380 moved it
// inside Files), else any folder of that name. The server never creates one — a grid without it keeps
// the share rules it had (the retarget migration refuses, the catch-all falls back to Files).
import Folder from "../models/Folder.js";

export const IMPORTS_FOLDER_NAME = "Imports";

/** @returns {Promise<string|null>} the Imports folder's id on this grid. */
export async function findImportsFolder({ userId = null, gridId, FolderModel = Folder }) {
  if (!gridId) return null;
  const q = { gridId, name: IMPORTS_FOLDER_NAME, ...(userId ? { userId } : {}) };
  const prot = await FolderModel.findOne({ ...q, "meta.protected": true }).lean();
  if (prot) return prot.id;
  const any = await FolderModel.findOne(q).lean();
  return any?.id || null;
}
