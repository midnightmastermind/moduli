// helpers/fileHome.js
// Where an uploaded file LIVES. An upload is filed in a Files folder (Files/Images, Files/Video, …) — that
// occurrence, parented to a FOLDER, is the file's home. Every other placement of the same module (a copy
// dropped on a board, embedded in a doc) gets a "Go to file" button that opens the home (user, 2026-10-22:
// "go to file button if its an uploaded thing (goes to it in the file section, this is for copies of it)").

const FILE_KINDS = new Set(["image", "video", "audio", "pdf", "ebook", "code", "markdown", "model"]);

/** An uploaded file: a file kind with a stored file — not an external URL (a Wikipedia picture has no home). */
export function isUploadedFile(module) {
  if (module?.role !== "artifact" || !FILE_KINDS.has(module?.kind)) return false;
  const ref = String(module?.fileRef || "");
  return !!ref && !/^(https?:|data:|blob:)/i.test(ref);
}

/**
 * The id of this file's HOME occurrence (its placement in a Files folder), or null. The card shows "Go to
 * file" wherever it is drawn — a file card is never drawn on a folder page (those use the preview face), so
 * even the home's own card, listed on a board, is "outside Files". `placements` is every occurrence of the
 * module (App's occurrencesByModuleId entry).
 */
export function fileHomeOccId(occurrence, module, placements, foldersById) {
  if (!occurrence?.id || !isUploadedFile(module)) return null;
  const isFolder = (id) => !!id && !!foldersById?.[id];
  if (isFolder(occurrence.parentId)) return occurrence.id;
  for (const o of placements || []) {
    if (o && isFolder(o.parentId)) return o.id;
  }
  return null;
}
