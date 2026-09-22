// helpers/folderRename.js
//
// A FOLDER'S OWN PAGE CARRIES ITS NAME. Renaming the folder left the page it
// opens still labelled with the old one (measured 2026-09-22: the `Library`
// folder's page read `New Folder`) — and that label is what the panel header,
// the folder card and the tree's page row all show, so the rename looked
// half-applied everywhere except the tree.
//
// A page the user has TITLED THEMSELVES is never touched: the rename follows
// only while the page still says what the folder used to. That is the same
// rule `addBookmarkOccurrence` uses for a fetched title ("a label the caller
// passed is someone's choice and outranks a page's <title>").
//
// Pure, because the component it serves needs the whole tree mounted to test.

/**
 * @returns {{ moduleId: string, label: string } | null} the folder-page module
 *          to rename, or null when there is nothing to do.
 */
export function planFolderPageRename({ folder, newName, childOccurrences = [], modulesById = {} }) {
  const oldName = folder?.name;
  const next = String(newName || "").trim();
  if (!folder?.id || !next || next === oldName) return null;
  for (const occ of childOccurrences) {
    const mod = modulesById?.[occ?.moduleId];
    if (!mod || mod.kind !== "folder" || mod.role !== "page") continue;
    // Only when the page still wears the folder's old name.
    if ((mod.label ?? "") !== (oldName ?? "")) return null;
    return { moduleId: mod.id, label: next };
  }
  return null;
}
