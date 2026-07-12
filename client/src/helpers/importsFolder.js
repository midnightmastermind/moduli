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
// folder, AND ensure it has a folder-page occurrence so it surfaces as a CARD
// in the root folder page. Returns `{ folderId, folderPageOccId }`.
//
// Why the folder-page occurrence matters: a bare Folder record shows in the
// Local/Root TREE, but `PageFolder` (the folder-page card grid) only lists a
// sub-folder when it finds a `role:"page" kind:"folder"` occurrence among that
// folder's children (see ModulePage.folderChildOccs). Without it the Imports
// folder is invisible on the root folder page — the user only sees folders they
// happened to click in the tree (which mints the occurrence). Mirrors
// ManifestTree.openFolderAsPage.
//
// `manifests` / `folders` are plain arrays (callers pass either the reducer's
// state.manifests/state.folders or Object.values of the *ById maps).
// `occurrencesById` is the reducer map (used to find an existing folder-page
// occurrence so this is idempotent across imports).
export function ensureImportsFolderAndPage({ grid, manifests, folders, occurrencesById, dispatch, socket, userId }) {
  const gridId = grid?._id || grid?.id || null;
  const manifest = grid?.manifestId ? (manifests || []).find((m) => m && m.id === grid.manifestId) : null;
  const rootFolderId = manifest?.rootFolderId || null;
  const existing = (folders || []).find(
    (f) => f && f.name === "Imports" && f.parentId === rootFolderId &&
           (!gridId || !f.gridId || f.gridId === gridId)
  );
  const folderId = existing?.id || crypto.randomUUID();
  if (!existing) {
    CommitHelpers.createFolder({
      dispatch, socket,
      folder: { id: folderId, name: "Imports", parentId: rootFolderId, gridId, userId, folderType: "normal" },
    });
  }
  const folderPageOccId = ensureFolderPageOcc({ folderId, label: "Imports", gridId, occurrencesById, dispatch, socket, userId });
  return { folderId, folderPageOccId };
}

// Back-compat thin wrapper: callers that only need the folder id (createImportsDocPage's
// parent, etc.) keep their string return shape.
export function ensureImportsFolder(args) {
  return ensureImportsFolderAndPage(args).folderId;
}

// Guard: should an import tool's `output` be wrapped into a persisted Imports
// doc page? Only when the import ACTUALLY persisted content — i.e. it has a root
// occurrence id AND was NOT a dry run. A dry run plans the tree (and returns a
// `rootOccurrenceId` for the planned root) but mints/persists nothing, so wrapping
// it leaves a permanent page whose moduleEmbed points at an occurrence that never
// existed → the "empty embed" placeholder. Every import route's response carries
// `dryRun`, so one predicate covers wikipedia_import / import_markdown / import_html.
export function shouldWrapImportOutput(output) {
  return !!output && !output.dryRun && !!output.rootOccurrenceId;
}

// Resolve (or mint) the ROOT folder-page occurrence for a grid — the card grid
// of everything on the grid. The default page for freshly-minted panels
// (empty-cell tap-to-add, the Toolbar + button) so a new panel never opens on
// "No content". Returns null only when the grid has no user manifest yet (the
// server ensures one on every full_state, so that means state hasn't loaded).
export function ensureRootFolderPageOcc({ grid, manifestsById, occurrencesById, modulesById, dispatch, socket, userId }) {
  const gridId = grid?._id || grid?.id || null;
  const manifest = manifestsById?.[grid?.manifestId];
  const rootFolderId = manifest?.rootFolderId;
  if (!rootFolderId) return null;
  const existing = Object.values(occurrencesById || {}).find((o) => {
    if (!o || o.parentId !== rootFolderId) return false;
    if (o.meta?.folderPage === true) return true;
    const mod = modulesById?.[o.moduleId];
    return mod?.role === "page" && mod?.kind === "folder";
  });
  return existing?.id || ensureFolderPageOcc({
    folderId: rootFolderId, label: manifest?.name || "Root", gridId,
    occurrencesById, dispatch, socket, userId,
  });
}

// Find-or-create the folder-page occurrence (`role:"page" kind:"folder"`) for a
// folder so it renders as a card in the parent folder page. Idempotent via a
// `meta.folderPage` self-identifying tag (the only occurrence we mint with it).
// Returns the occurrence id.
export function ensureFolderPageOcc({ folderId, label, gridId, occurrencesById, dispatch, socket, userId }) {
  if (!folderId) return null;
  const existing = Object.values(occurrencesById || {}).find(
    (o) => o && o.parentId === folderId && o.meta?.folderPage === true
  );
  if (existing) return existing.id;
  const modId = crypto.randomUUID();
  const occId = crypto.randomUUID();
  CommitHelpers.createModule({
    dispatch, socket,
    module: { id: modId, userId, gridId, role: "page", kind: "folder", label: label || "Folder" }, emit: true,
  });
  CommitHelpers.createOccurrence({
    dispatch, socket,
    occurrence: {
      id: occId, userId, gridId, moduleId: modId, targetId: modId, targetType: "module",
      parentId: folderId, sortOrder: -1, iteration: { mode: "persistent" }, fields: {}, meta: { folderPage: true },
    }, emit: true,
  });
  return occId;
}

// Find-or-create the ARTIFACT PAGE for an artifact occurrence — a
// `role:"page" kind:"display"` page that shows the artifact full screen.
// Opened when the user clicks an artifact in the manifest tree or a folder
// page (per user 2026-07-12: "it should open an artifact page where we
// display the artifact occurrence"). Idempotent via `meta.artifactPage =
// <artifactOccId>`; parentId stays null so the viewer shell never shows as a
// tree row of its own. Returns the page occurrence id (null when the artifact
// can't resolve).
export function ensureArtifactPageOcc({ artifactOccId, occurrencesById, modulesById, gridId, userId, dispatch, socket }) {
  if (!artifactOccId) return null;
  const existing = Object.values(occurrencesById || {}).find(
    (o) => o && o.meta?.artifactPage === artifactOccId
  );
  if (existing) return existing.id;
  const artOcc = occurrencesById?.[artifactOccId];
  const artMod = artOcc ? modulesById?.[artOcc.moduleId] : null;
  if (!artOcc || !artMod) return null;
  const modId = crypto.randomUUID();
  const occId = crypto.randomUUID();
  CommitHelpers.createModule({
    dispatch, socket,
    module: {
      id: modId, userId, gridId, role: "page", kind: "display",
      label: artMod.label || artMod.meta?.originalName || "Artifact",
    }, emit: true,
  });
  CommitHelpers.createOccurrence({
    dispatch, socket,
    occurrence: {
      id: occId, userId, gridId, moduleId: modId, targetId: modId, targetType: "module",
      parentId: null, occurrences: [artifactOccId],
      iteration: { mode: "persistent" }, fields: {}, meta: { artifactPage: artifactOccId },
    }, emit: true,
  });
  return occId;
}

// Wrap an already-created root occurrence in a DOC page that embeds it, parent
// the page under the Imports folder, and pin it to `panelOccurrenceId`. Returns
// the new page occurrence id. A doc page reads top-to-bottom like a document
// (a board page would lay the content out as kanban columns).
export function createImportsDocPage({
  rootOccId, panelOccurrenceId, grid, manifests, folders, occurrencesById, dispatch, socket, userId, label, folderId,
}) {
  const gridId = grid?._id || grid?.id || null;
  // `folderId` lets a batch caller ensure the Imports folder ONCE up front and
  // reuse it across many pages (avoids re-creating it per page from a stale
  // folders snapshot inside a loop). When not passed, ensure the folder AND its
  // folder-page card occurrence so the import surfaces on the root folder page.
  const importsFolderId = folderId || ensureImportsFolder({ grid, manifests, folders, occurrencesById, dispatch, socket, userId });
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
