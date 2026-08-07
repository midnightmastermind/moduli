// server/migrations/0050-protect-imports-folder.mjs
//
// Make **Imports** a protected folder in the root, alongside Templates (0035)
// and Files (0049). User's ask, 2026-08-07.
//
// ── WHY IMPORTS BELONGS IN THAT SET ─────────────────────────────────────────
//
// The three share one property: **the app files things there without asking.**
// An assistant import, a page dragged in from a browser tab, a Wikipedia batch
// — all of them land under Imports whether or not the folder was on the user's
// mind. Deleting it therefore does not remove the concept; the very next import
// silently re-mints it (`ensureImportsFolderAndPage` is find-or-create), so the
// delete reads as destructive and isn't even durable. That is the definition of
// structural rather than user-owned.
//
// ── THE MARKER IS `meta.protected`, NEVER THE NAME ──────────────────────────
//
// Same rule the other two carry: a user may have their own folder called
// "Imports" and it is theirs to delete. This migration only touches a folder
// named Imports sitting DIRECTLY UNDER THE USER MANIFEST'S ROOT — which is the
// only place the client's helper ever mints one. 0035's lesson stated once
// more: a selector that matches "things that look like X" will match the user's
// real work, so it must be pinned by LOCATION, not by resemblance.
//
// ── THE HALF-APPLIED DELETE THIS PAIRS WITH ─────────────────────────────────
//
// Protection alone would have made things WORSE. `ManifestTree`'s folder delete
// REPARENTS every child out to the folder's parent and then emits the delete —
// so a server-side refusal used to leave the folder alive with its contents
// scattered into the root. The client half of this change (hide the menu item +
// bail in the handler, `helpers/protectedFolders.js`) is what makes the guard
// safe rather than merely loud. That gap applied to Templates and Files too; it
// is closed for all three.
//
// FIND-OR-CREATE, like 0049 — a grid that has never imported anything gets the
// folder so the tree is the same shape everywhere. Nothing is moved into it.
// IDEMPOTENT: a re-run reports "already protected" and writes nothing.

import { IMPORTS_FOLDER_NAME } from "../utils/protectedFolders.js";

export const id = "0050-protect-imports-folder";

export async function up({ gridId, models, log, dryRun }) {
  const { Manifest, Folder } = models;

  const manifest = await Manifest.findOne({ gridId, manifestType: "user" }).lean();
  if (!manifest?.rootFolderId) {
    log(`no user manifest / rootFolderId on grid ${gridId} — nothing to do`);
    return;
  }
  const userId = manifest.userId;
  const rootId = manifest.rootFolderId;

  const existing = await Folder.findOne({
    gridId, userId, parentId: rootId, name: IMPORTS_FOLDER_NAME,
  }).lean();

  if (!existing) {
    const uid = () => (globalThis.crypto?.randomUUID?.()
      || `fld-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    log(`CREATE folder "${IMPORTS_FOLDER_NAME}" under root ${rootId} (protected)`);
    if (!dryRun) {
      await Folder.create({
        id: uid(), userId, gridId, parentId: rootId,
        name: IMPORTS_FOLDER_NAME, folderType: "normal", sortOrder: 51,
        meta: { protected: true },
      });
    }
  } else if (existing.meta?.protected) {
    log(`"${IMPORTS_FOLDER_NAME}" (${existing.id}) is already protected — nothing to do`);
  } else {
    log(`STAMP meta.protected on "${IMPORTS_FOLDER_NAME}" (${existing.id})`);
    if (!dryRun) {
      // $set the one key rather than writing `meta` whole: the folder may carry
      // meta.cover and rewriting the object would drop it (the 2026-07-31
      // `$set: {"ownStyle.bg"}` lesson, from the safe side).
      await Folder.updateOne({ id: existing.id, userId }, { $set: { "meta.protected": true } });
    }
  }

  log(dryRun ? "DRY RUN — nothing written" : "applied");
}
