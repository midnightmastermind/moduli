// helpers/viewerReturn.js
//
// The way back to the file viewer (user, 2026-10-16: "we also need a way to go back to the file
// viewer after opening the file in a panel"). The viewer opens for an OWNER — a book row shows its
// cover beside its files — so "back" reopens THAT viewer, not a bare one for the file. When a file
// leaves a viewer through "Open in panel", the viewer's owner is remembered here; the file's page
// asks for it. Session memory on purpose: a reload, or a file opened some other way, falls back to
// the file's own viewer, which still shows the file.

const ownerByFile = new Map();

/** Remember which viewer a file was opened into a panel from. */
export function rememberViewerOrigin(fileOccId, ownerOccId) {
  if (fileOccId && ownerOccId) ownerByFile.set(fileOccId, ownerOccId);
}

/** The occurrence whose viewer to reopen for this file: the remembered owner, else the file. */
export function viewerOwnerFor(fileOccId, occurrencesById = null) {
  const owner = ownerByFile.get(fileOccId);
  if (owner && (!occurrencesById || occurrencesById[owner])) return owner;
  return fileOccId || null;
}

/** Test seam. */
export function _resetViewerOrigins() { ownerByFile.clear(); }
