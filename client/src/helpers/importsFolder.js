// Shared "Imports" folder helpers.
//
// Imported content (assistant Wikipedia/markdown imports, drag-from-browser
// text/html imports) has no natural home in the grid, so it gets wrapped in a
// doc page parented under a dedicated "Imports" folder. The panel's Local tree
// buckets a page by foldersById[occ.parentId] (see ManifestTree.localTreeData)
// and the Root tree lists pages under their folder — so landing under "Imports"
// makes every import show up grouped instead of as a loose root page.
import * as CommitHelpers from "./CommitHelpers";

// Find (or lazily create) the "Imports" folder under the grid manifest's root
// folder. `manifests` / `folders` are plain arrays (callers pass either the
// reducer's state.manifests/state.folders or Object.values of the *ById maps).
export function ensureImportsFolder({ grid, manifests, folders, dispatch, socket, userId }) {
  const gridId = grid?._id || grid?.id || null;
  const manifest = grid?.manifestId ? (manifests || []).find((m) => m && m.id === grid.manifestId) : null;
  const rootFolderId = manifest?.rootFolderId || null;
  const existing = (folders || []).find(
    (f) => f && f.name === "Imports" && f.parentId === rootFolderId &&
           (!gridId || !f.gridId || f.gridId === gridId)
  );
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  CommitHelpers.createFolder({
    dispatch, socket,
    folder: { id, name: "Imports", parentId: rootFolderId, gridId, userId, folderType: "normal" },
  });
  return id;
}

// Wrap an already-created root occurrence in a DOC page that embeds it, parent
// the page under the Imports folder, and pin it to `panelOccurrenceId`. Returns
// the new page occurrence id. A doc page reads top-to-bottom like a document
// (a board page would lay the content out as kanban columns).
export function createImportsDocPage({
  rootOccId, panelOccurrenceId, grid, manifests, folders, dispatch, socket, userId, label, folderId,
}) {
  const gridId = grid?._id || grid?.id || null;
  // `folderId` lets a batch caller ensure the Imports folder ONCE up front and
  // reuse it across many pages (avoids re-creating it per page from a stale
  // folders snapshot inside a loop).
  const importsFolderId = folderId || ensureImportsFolder({ grid, manifests, folders, dispatch, socket, userId });
  const modId = crypto.randomUUID();
  const pageOccId = crypto.randomUUID();
  CommitHelpers.createPage({
    dispatch, socket,
    module: { id: modId, userId, gridId, role: "page", kind: "doc", label: label || "Imported" },
    occurrence: {
      id: pageOccId, userId, gridId, moduleId: modId, parentId: importsFolderId,
      occurrences: [rootOccId],
      textmap: { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: rootOccId } }] },
      iteration: { mode: "persistent" }, fields: {}, filterOverride: {},
    },
    panelOccurrenceId,
  });
  return pageOccId;
}
