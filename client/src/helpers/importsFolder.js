// Shared "Imports" folder helpers.
//
// Imported content (assistant Wikipedia/markdown imports, drag-from-browser
// text/html imports) has no natural home in the grid, so it gets wrapped in a
// doc page parented under a dedicated "Imports" folder. The panel's Local tree
// buckets a page by foldersById[occ.parentId] (see ManifestTree.localTreeData)
// and the Root tree lists pages under their folder — so landing under "Imports"
// makes every import show up grouped instead of as a loose root page.
import * as CommitHelpers from "./CommitHelpers";
import { IMPORTS_FOLDER_NAME } from "./protectedFolders";

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
    (f) => f && f.name === IMPORTS_FOLDER_NAME && f.parentId === rootFolderId &&
           (!gridId || !f.gridId || f.gridId === gridId)
  );
  const folderId = existing?.id || crypto.randomUUID();
  if (!existing) {
    CommitHelpers.createFolder({
      dispatch, socket,
      folder: {
        id: folderId, name: IMPORTS_FOLDER_NAME, parentId: rootFolderId, gridId, userId,
        folderType: "normal",
        // Structural, like Templates and Files: the app files things here without
        // asking, so it is not the user's to delete. `meta.protected` is the ONLY
        // marker — the name is not evidence (2026-08-03: a selector that matched
        // "things that look like templates" moved a real page).
        meta: { protected: true },
      },
    });
  } else if (!existing.meta?.protected) {
    // Self-heal a folder minted before protection existed, so the guard covers
    // every grid without waiting on the migration. Merge — a folder carries
    // more than this flag (meta.cover, at least).
    CommitHelpers.updateFolder({
      dispatch, socket,
      folder: { id: folderId, meta: { ...(existing.meta || {}), protected: true } },
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

// Open a panel on the ROOT folder page: ensure the page occ, point a board View
// at it, and wire both onto the panel occurrence. The one "a panel is never a
// dead 'No content' shell" step — shared by the Toolbar + button
// (App.addNewPanel), the empty-cell tap (Grid), and closing a panel's LAST page
// (ModulePanel.closePage). Returns the folder-page occ id (null when the
// manifest hasn't loaded yet).
//
// `existingView` is what makes the third caller safe. A freshly-minted panel has
// no view, so one is created; a panel that just lost its last page already has
// one, and minting a second would strand the first — an orphan View per emptied
// panel, forever. Pass the panel's current view and it is re-pointed instead.
export function openPanelOnRootFolderPage({ panelOccId, grid, gridId, manifestsById, occurrencesById, modulesById, dispatch, socket, userId, existingView = null }) {
  const folderPageOccId = ensureRootFolderPageOcc({
    grid, manifestsById, occurrencesById, modulesById, dispatch, socket, userId,
  });
  if (!panelOccId || !folderPageOccId) return folderPageOccId;
  const viewId = existingView?.id || crypto.randomUUID();
  if (existingView?.id) {
    CommitHelpers.updateView({
      dispatch, socket,
      view: { ...existingView, viewType: "board", activeOccurrenceId: folderPageOccId },
      emit: true,
    });
  } else {
    CommitHelpers.createView({
      dispatch, socket,
      view: { id: viewId, userId, gridId, viewType: "board", activeOccurrenceId: folderPageOccId },
      emit: true,
    });
  }
  CommitHelpers.updateOccurrence({
    dispatch, socket,
    occurrence: { id: panelOccId, viewId, occurrences: [folderPageOccId] },
    emit: true,
  });
  return folderPageOccId;
}

// Find-or-create the folder-page occurrence (`role:"page" kind:"folder"`) for a
// folder so it renders as a card in the parent folder page. Idempotent via a
// `meta.folderPage` self-identifying tag (the only occurrence we mint with it).
// Returns the occurrence id.
// FOLDERS THIS SESSION HAS ALREADY MINTED A PAGE FOR.
//
// The `existing` lookup below reads the occurrence map it is HANDED, so two
// callers that resolved their map in the same tick both see "no page yet" and
// both mint. That is not hypothetical: `ModulePage` mints missing folder pages
// from an effect, and two panels showing the same folder page fire it in one
// commit. Measured on poms grid 2026-08-25 — 8 folders holding exactly 2
// folder-page occurrences apiece — and the user's symptom was a folder page
// listing ITSELF, endlessly: "a trackers folder with trackers inside the
// trackers folder and its like that all the way down."
//
// A latch keyed on the folder closes the same-tick window. It deliberately does
// NOT expire: within one session, one mint per folder is the whole contract, and
// the caller gets the id back either way. It cannot help ACROSS tabs — that
// needs a server-side uniqueness guard — which is exactly why the renderer
// (`ModulePage.folderChildOccs`) drops folder pages of its own folder by KIND
// rather than by id, so a duplicate that does arrive cannot loop.
const _mintedFolderPages = new Map();

export function ensureFolderPageOcc({ folderId, label, gridId, occurrencesById, dispatch, socket, userId }) {
  if (!folderId) return null;
  const existing = Object.values(occurrencesById || {}).find(
    (o) => o && o.parentId === folderId && o.meta?.folderPage === true
  );
  if (existing) return existing.id;
  const latchKey = `${gridId || ""}::${folderId}`;
  const alreadyMinted = _mintedFolderPages.get(latchKey);
  if (alreadyMinted) return alreadyMinted;
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
  _mintedFolderPages.set(latchKey, occId);
  return occId;
}

// Test seam only — production never calls this.
export function __resetFolderPageLatch() {
  _mintedFolderPages.clear();
}

// Artifact-module kind → View routing fields. The client twin of the server's
// upload-path derivation (server.js viewFieldsForKind); the ONE place that
// knows how an artifact kind renders full screen.
export function viewFieldsForArtifactKind(kind) {
  if (["image", "video", "audio", "pdf"].includes(kind)) return { viewType: "display", artifactType: kind };
  // A BOOKMARK IS A DISPLAY ARTIFACT, and leaving it out of this list is what
  // made one open as a DOC PAGE (user, 2026-09-04: *"its showing up as a doc
  // page … this is me just navigating to the browser"*). `ArtifactContent`
  // routes to `BookmarkView` on `artifactType === "bookmark"`; without it here
  // the minted View said `markdown`, and a markdown view renders the doc editor.
  //
  // The kind existed long before this function was asked about it — the fall
  // through to markdown is a DEFAULT, and a default that is wrong for a kind
  // the app already has is indistinguishable from a missing feature.
  if (kind === "bookmark") return { viewType: "display", artifactType: "bookmark" };
  if (kind === "code") return { viewType: "code", artifactType: null };
  return { viewType: "markdown", artifactType: null };
}

// Find-or-create the ARTIFACT PAGE for an artifact occurrence — a
// `role:"page" kind:"display"` page that shows the artifact full screen.
// Opened when the user clicks an artifact in the manifest tree or a folder
// page (per user 2026-07-12: "it should open an artifact page where we
// display the artifact occurrence"). Owns the whole "what counts as an
// artifact click" rule: non-artifact occurrences return null so call sites
// can fall through to their normal open path. Idempotent via
// `meta.artifactPage = <artifactOccId>`; parentId stays null so the viewer
// shell never shows as a tree row of its own. The page carries a REAL View
// (viewType/artifactType from the module kind) so renderers never have to
// synthesize one. Returns the page occurrence id.
export function ensureArtifactPageOcc({ artifactOccId, occurrencesById, modulesById, gridId, userId, dispatch, socket }) {
  if (!artifactOccId) return null;
  const artOcc = occurrencesById?.[artifactOccId];
  const artMod = artOcc ? modulesById?.[artOcc.moduleId] : null;
  if (!artOcc || artMod?.role !== "artifact") return null;
  const existing = Object.values(occurrencesById || {}).find(
    (o) => o && o.meta?.artifactPage === artifactOccId
  );
  if (existing) return existing.id;
  const modId = crypto.randomUUID();
  const occId = crypto.randomUUID();
  const viewId = crypto.randomUUID();
  CommitHelpers.createModule({
    dispatch, socket,
    module: {
      id: modId, userId, gridId, role: "page", kind: "display",
      label: artMod.label || artMod.meta?.originalName || "Artifact",
    }, emit: true,
  });
  CommitHelpers.createView({
    dispatch, socket,
    view: { id: viewId, userId, gridId, ...viewFieldsForArtifactKind(artMod.kind), activeOccurrenceId: artifactOccId },
    emit: true,
  });
  CommitHelpers.createOccurrence({
    dispatch, socket,
    occurrence: {
      id: occId, userId, gridId, moduleId: modId, targetId: modId, targetType: "module",
      parentId: null, viewId, occurrences: [artifactOccId],
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
