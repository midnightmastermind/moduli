// server/utils/filesFolder.js
//
// WHERE files live. Location is the ONLY marker of "this is a file": the
// children of the one protected "Files" folder under the user manifest. Mirrors
// utils/templatesFolder.js field for field — the Templates folder solved exactly
// this problem in migration 0035 (one protected folder, `meta.protected` as the
// marker, location as the only identity), and artifacts never got the same
// treatment.
//
// Task 4 of docs/superpowers/plans/2026-08-06-intake-links-and-artifacts.md.
//
// ════════════════════════════════════════════════════════════════════════════
// THE PLACEMENT SEMANTIC — read this before adding a caller (plan Task 4 Step 2)
// ════════════════════════════════════════════════════════════════════════════
//
// "This file is in Files AND on my day page" has two possible meanings, and the
// right one DEPENDS ON THE KIND. Getting it wrong is silent, so it is decided
// here rather than at each call site:
//
//   • MEDIA (image / video / audio / pdf / code) → **COPY PER PLACEMENT.**
//     One module (one `fileRef`, one deduped blob on disk), N occurrences. Each
//     placement is its own row that can be moved, styled and deleted without
//     touching the others, and the bytes are single-sourced by the sha256 dedup
//     that already exists. Deleting a placement leaves the file in Files;
//     deleting it in Files removes it everywhere.
//
//   • MARKDOWN (a textmap-bearing artifact) → **ONE OCCURRENCE, MULTI-PARENTED.**
//     Its id appears in several parents' `occurrences[]`; there is exactly one
//     row. **`textmap` lives on the OCCURRENCE, so two occurrences of one
//     markdown module would carry two INDEPENDENT BODIES** — you would edit the
//     copy on your day page and the one in Files would still show the old text,
//     with no indication why. This repo already paid for that lesson once:
//     `CommitHelpers.createPageInContainer` carries the same warning verbatim
//     ("do not 'fix' this with two occurrences, one per home"), and the
//     Schedule's shared slots are the same pattern working correctly.
//
// `placementSemanticForKind` below is the single source of that rule so a caller
// cannot quietly disagree with it.

import { FILES_FOLDER_NAME, isProtectedFolder } from "./protectedFolders.js";

// Paranoia guard: a corrupt folder chain must not spin the walk forever.
const MAX_FOLDER_DEPTH = 16;

/**
 * Subfolders, derived from the SAME `mimeToKind` the upload path already uses
 * (server.js) — not a second classification. `code` and `markdown` are both
 * documents: splitting them would put a `.md` note and a `.js` file in
 * different places for no reason a user would predict.
 */
export const FILES_SUBFOLDER_BY_KIND = {
  image: "Images",
  video: "Video",
  audio: "Audio",
  pdf: "Documents",
  code: "Documents",
  markdown: "Documents",
};

export const FILES_SUBFOLDER_NAMES = ["Images", "Video", "Audio", "Documents"];

/** Which subfolder a given artifact kind homes into. Unknown kinds → Documents. */
export function filesSubfolderForKind(kind) {
  return FILES_SUBFOLDER_BY_KIND[kind] || "Documents";
}

/**
 * "copy" (a new occurrence per placement) or "multiparent" (one occurrence
 * listed by several parents). See the header — this is the whole decision.
 */
export function placementSemanticForKind(kind) {
  return kind === "markdown" ? "multiparent" : "copy";
}

/**
 * The Files folder AND its subfolders, as a Set of ids — what "is this homed in
 * Files?" is asked against. Empty Set on a grid that never ran the migration,
 * which is what makes `classifyFileDelete` degrade to the old behaviour there.
 */
export function filesFolderIdSet(uc, { gridId, userId }) {
  const root = findFilesFolder(uc, { gridId, userId });
  if (!root) return new Set();
  const ids = new Set([root.id]);
  for (const f of Object.values(uc?.foldersById || {})) {
    if (f && f.gridId === gridId && f.userId === userId && f.parentId === root.id) ids.add(f.id);
  }
  return ids;
}

/**
 * Placement-delete vs file-delete (plan Task 4 Step 5).
 *
 * "Remove this from my day page" and "delete this file" are the same gesture on
 * the same row, and only the CONTEXT tells them apart. So the caller must say
 * WHERE the delete came from; this decides what that means.
 *
 *   • Homed in Files, deleted from some OTHER parent  → **unlink** that one
 *     parent. The file stays in Files, and every other placement is untouched.
 *   • Homed in Files, deleted from inside Files (or with no context at all)
 *     → **delete-file**: the row goes, and `sweepModuleId` names the module
 *     whose remaining occurrences — the copy placements — go with it.
 *   • Not homed in Files → **delete-occurrence**, byte-identical to the
 *     behaviour before this rule existed.
 *
 * **A missing `fromParentId` deliberately means "the file", not "unlink".** A
 * caller that cannot say where it is deleting from has not told us it meant a
 * placement, and silently unlinking from nowhere would leave the user's delete
 * looking like it did nothing.
 *
 * **A grid with no Files folder degrades to the old behaviour** rather than
 * failing — the same posture `resolveFilesFolderId` takes. "No Files folder" is
 * not "the wrong folder".
 *
 * Pure: the caller resolves `filesFolderIds` (the Files folder plus its
 * subfolders) and applies the result.
 */
export function classifyFileDelete({ occurrence, fromParentId = null, filesFolderIds }) {
  const ordinary = { action: "delete-occurrence", parentId: null, sweepModuleId: null };
  if (!occurrence) return ordinary;

  const inFiles = filesFolderIds?.has?.(occurrence.parentId);
  if (!inFiles) return ordinary;

  // Deleting from a parent that is not the file's own home is a PLACEMENT.
  if (fromParentId && fromParentId !== occurrence.parentId) {
    return { action: "unlink", parentId: fromParentId, sweepModuleId: null };
  }

  return { action: "delete-file", parentId: null, sweepModuleId: occurrence.moduleId || null };
}

/** The protected Files folder for this user+grid, or null. */
export function findFilesFolder(uc, { gridId, userId }) {
  return Object.values(uc?.foldersById || {}).find(
    f => f
      && f.gridId === gridId
      && f.userId === userId
      && isProtectedFolder(f)
      && f.name === FILES_FOLDER_NAME,
  ) || null;
}

/** A named subfolder directly under the Files folder, or null. */
export function findFilesSubfolder(uc, { gridId, userId, name }) {
  const root = findFilesFolder(uc, { gridId, userId });
  if (!root) return null;
  return Object.values(uc?.foldersById || {}).find(
    f => f
      && f.gridId === gridId
      && f.userId === userId
      && f.parentId === root.id
      && f.name === name,
  ) || null;
}

/**
 * Resolve the folder a file write should land in.
 *
 * No `parentFolderId` → the kind's subfolder (falling back to the Files folder
 * itself when that subfolder has not been minted yet). With one → that folder,
 * but ONLY when it sits inside the Files folder for this user+grid.
 *
 * **Returns null rather than guessing** — the same guard `resolveTemplatesFolderId`
 * carries. A file written to the wrong folder is data loss that looks like a
 * missing file, so callers must surface an error instead of writing somewhere
 * else. Null is also what a grid that has not run the Files migration returns.
 */
export function resolveFilesFolderId(uc, { gridId, userId, parentFolderId, kind = null }) {
  const folder = findFilesFolder(uc, { gridId, userId });
  if (!folder) return null;

  if (!parentFolderId) {
    if (!kind) return folder.id;
    const sub = findFilesSubfolder(uc, { gridId, userId, name: filesSubfolderForKind(kind) });
    return sub ? sub.id : folder.id;
  }

  let cur = uc?.foldersById?.[parentFolderId];
  for (let i = 0; cur && i < MAX_FOLDER_DEPTH; i++) {
    if (cur.userId !== userId || cur.gridId !== gridId) return null;
    if (cur.id === folder.id) return parentFolderId;
    cur = cur.parentId ? uc.foldersById?.[cur.parentId] : null;
  }
  return null;
}
