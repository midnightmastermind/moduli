/**
 * 0139 — an "Interests" folder to start the notebook off.
 *
 * USER, 2026-08-18: "could you also add in a folder called interests that
 * includes folders for comedy, computer science, martial arts, music,
 * philosophy, psychology, spirituality, off grid, writing, dnd, and travel so i
 * can start off my notebook."
 *
 * Eleven sub-folders, in the order they were asked for, under one new root
 * folder. Names are title-cased — the ask was typed in lowercase throughout, so
 * capitalisation was plainly not the instruction. `dnd` is rendered "D&D", the
 * ordinary way that interest is written; it is a display name and one rename
 * away if that is wrong.
 *
 * NO FOLDER-PAGE OCCURRENCES ARE MINTED, and that is deliberate rather than an
 * omission. Measured on this grid first: of the twelve folders already at the
 * root, only ONE carries a `role:"page" kind:"folder"` occurrence — the app
 * mints it on demand the first time you open a folder (`ManifestTree`'s folder
 * click). Minting twelve up front would be inventing state the app manages, and
 * inconsistently with every folder the user already has.
 *
 * IDEMPOTENT BY NAME WITHIN THE PARENT, not globally: "Music" or "Writing" could
 * perfectly well exist somewhere else in the tree and mean something else, so
 * the check is scoped to the folder being filled.
 *
 * SORT ORDER CONTINUES THE USER'S OWN SEQUENCE. `Files` is pinned last at 50, so
 * a plain max()+1 would land at 51 and bury this below the app's furniture;
 * protected folders are excluded from the calculation. Nothing is hardcoded, so
 * it still lands correctly once another folder is added.
 */
export const id = "0139-interests-folders";
export const describe = "Add an Interests folder with eleven sub-folders to start the notebook.";

export const PARENT_NAME = "Interests";
export const CHILDREN = [
  "Comedy", "Computer Science", "Martial Arts", "Music", "Philosophy",
  "Psychology", "Spirituality", "Off Grid", "Writing", "D&D", "Travel",
];

export async function up({ gridId, models, log, dryRun }) {
  const { Folder, Manifest } = models;

  const manifest = await Manifest.findOne({ gridId, manifestType: "user" }).lean();
  if (!manifest?.rootFolderId) {
    log("  REFUSING: no user manifest / root folder on this grid");
    return;
  }
  const rootId = manifest.rootFolderId;

  const siblings = await Folder.find({ gridId, parentId: rootId }).lean();
  // OWNERSHIP IS COPIED FROM THE FOLDERS THAT ALREADY EXIST rather than taken
  // from the runner: `userId` is not part of the migration context, and a folder
  // saved without one fails validation — which is exactly how this first ran.
  // Reading it off a sibling also guarantees the new folders belong to the same
  // person as the tree they are joining.
  const ownerId = siblings.find(f => f.userId)?.userId;
  if (!ownerId) { log("  REFUSING: cannot determine the owner from existing folders"); return; }
  // AFTER THE USER'S OWN FOLDERS, NOT AFTER THE SYSTEM ONES. `Files` is pinned
  // last at sortOrder 50 on purpose, so a naive max()+1 lands at 51 and buries a
  // folder the user asked for below the app's own furniture. Protected folders
  // are excluded from the calculation for exactly that reason.
  const nextOrder = siblings
    .filter(f => !f.meta?.protected)
    .reduce((m, f) => Math.max(m, Number(f.sortOrder) || 0), 0) + 1;

  let parent = siblings.find(f => f.name === PARENT_NAME);
  const plan = { createdParent: !parent, created: [], existing: [] };

  const kids = parent
    ? await Folder.find({ gridId, parentId: parent.id }).lean()
    : [];
  for (const name of CHILDREN) {
    if (kids.some(k => k.name === name)) plan.existing.push(name);
    else plan.created.push(name);
  }

  log(`  root "${rootId}" · ${siblings.length} folders · next sortOrder ${nextOrder}`);
  log(`  "${PARENT_NAME}": ${plan.createdParent ? "CREATE" : "already exists"}`);
  log(`  children to create: ${plan.created.length}${plan.created.length ? " — " + plan.created.join(", ") : ""}`);
  if (plan.existing.length) log(`  already present: ${plan.existing.join(", ")}`);
  if (dryRun) { log("  DRY RUN — nothing written"); return; }

  const mkId = () => Math.random().toString(36).slice(2, 14);

  if (!parent) {
    parent = {
      id: mkId(), userId: ownerId, gridId, parentId: rootId, name: PARENT_NAME,
      sortOrder: nextOrder, isExpanded: true, folderType: "normal",
    };
    await Folder.create(parent);
  }
  let order = kids.reduce((m, f) => Math.max(m, Number(f.sortOrder) || 0), -1) + 1;
  for (const name of plan.created) {
    await Folder.create({
      id: mkId(), userId: ownerId, gridId, parentId: parent.id, name,
      sortOrder: order++, isExpanded: false, folderType: "normal",
    });
  }

  // Read the result back — a create that silently did not land looks identical
  // to one that did, in the log.
  const after = await Folder.find({ gridId, parentId: parent.id }).lean();
  const missing = CHILDREN.filter(n => !after.some(f => f.name === n));
  log(`  verify: "${PARENT_NAME}" now holds ${after.length} folder(s) · missing ${missing.length}${missing.length ? " — " + missing.join(", ") : ""}`);
  if (missing.length) throw new Error("some interest folders did not persist");
}
