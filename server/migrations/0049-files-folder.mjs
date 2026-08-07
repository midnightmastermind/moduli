// server/migrations/0049-files-folder.mjs
//
// Mint the protected **Files** folder and its four subfolders.
//
// Task 4 of docs/superpowers/plans/2026-08-06-intake-links-and-artifacts.md.
// The rule that reads them is `server/utils/filesFolder.js` (17 tests); this is
// the data half. Until the folder exists, `findFilesFolder` returns null and
// every caller correctly refuses to write — so nothing can use the rule yet.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
//
// **It files NO existing artifacts.** That is Step 4 of the plan and it MOVES
// user data — every artifact occurrence on the grid changes where it lives. The
// 0035 lesson (a selector that "looked like templates" swept the user's real
// project page out of its folder) says that gets its own dry run reported
// against a NAMED expectation, not a count. This migration only CREATES; it
// touches nothing that already exists, so there is nothing it can move wrongly.
//
// Splitting it this way also means the rule becomes usable immediately — new
// uploads can home correctly — while the backfill stays a separate, reviewable
// decision.
//
// ── WHY LOCATION IS THE MARKER ──────────────────────────────────────────────
//
// Same design Templates settled on in 0035: a file is a file because of WHERE it
// is, not because of a flag on it. `meta.protected` marks the folder (never the
// name — the user may have their own folder called "Files" and it is theirs to
// delete), and `assertNotProtectedFolder` throws on any attempt to remove it.
//
// IDEMPOTENT: find-or-create per folder, so a re-run is a no-op and a partially
// applied run self-heals.

import { FILES_FOLDER_NAME } from "../utils/protectedFolders.js";
import { FILES_SUBFOLDER_NAMES } from "../utils/filesFolder.js";

export const id = "0049-files-folder";

export async function up({ gridId, models, log, dryRun }) {
  const { Manifest, Folder } = models;

  // The user manifest's root folder is where Templates lives, so it is where
  // Files belongs too. No manifest → nothing to hang it off; refuse rather than
  // invent a root (an orphaned folder tree is invisible and un-deletable).
  const manifest = await Manifest.findOne({ gridId, manifestType: "user" }).lean();
  if (!manifest?.rootFolderId) {
    log(`no user manifest / rootFolderId on grid ${gridId} — nothing to do`);
    return;
  }
  const userId = manifest.userId;
  const rootId = manifest.rootFolderId;

  const uid = () => (globalThis.crypto?.randomUUID?.()
    || `fld-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

  // ── The Files folder itself ───────────────────────────────────────────────
  let files = await Folder.findOne({
    gridId, userId, parentId: rootId, name: FILES_FOLDER_NAME,
  }).lean();

  if (files) {
    log(`Files folder already present (${files.id})`);
    // Self-heal: an earlier partial run could have created it unprotected.
    if (!files.meta?.protected) {
      log(`  → it is NOT protected; stamping meta.protected`);
      if (!dryRun) {
        await Folder.updateOne({ id: files.id, userId }, { $set: { "meta.protected": true } });
      }
    }
  } else {
    log(`CREATE folder "${FILES_FOLDER_NAME}" under root ${rootId}`);
    const doc = {
      id: uid(), userId, gridId, parentId: rootId,
      name: FILES_FOLDER_NAME, folderType: "normal", sortOrder: 50,
      meta: { protected: true },
    };
    if (!dryRun) await Folder.create(doc);
    files = doc;
  }

  // ── The four subfolders ───────────────────────────────────────────────────
  // Derived from the SAME mimeToKind the upload path uses, so a file's kind and
  // its folder cannot disagree.
  let created = 0, present = 0;
  for (const [i, name] of FILES_SUBFOLDER_NAMES.entries()) {
    const existing = await Folder.findOne({
      gridId, userId, parentId: files.id, name,
    }).lean();
    if (existing) { present += 1; continue; }
    log(`CREATE subfolder "${name}"`);
    created += 1;
    if (!dryRun) {
      await Folder.create({
        id: uid(), userId, gridId, parentId: files.id,
        name, folderType: "normal", sortOrder: i,
        // Subfolders are NOT protected: the structure is the Files folder's, but
        // a user reorganising inside it is their business.
        meta: {},
      });
    }
  }

  log(`subfolders: ${created} created, ${present} already present`);
  log(dryRun ? "DRY RUN — nothing written" : "applied");
}
