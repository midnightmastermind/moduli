// 0380 — the Imports folder moves inside Files.
//
// User, 2026-10-01: *"we also need to consolidate the imports and files folder
// together, just move the imports folder under files"*. Both are protected
// structural folders at the root. Only the Imports FOLDER record moves; its
// pages, its folder-page card and the pictures homed in it go with it because
// they are parented to the folder, not to the root.
//
// Safe because the client now finds the protected Imports folder WHEREVER it
// sits (helpers/importsFolder.js, same commit) — before that change a lookup
// pinned to the root would have minted a second Imports at the root on the
// next import. Idempotent: an Imports already inside Files is left alone.

export const id = "0380-imports-under-files";
export const describe = "Move the protected Imports folder inside the protected Files folder, last among its siblings.";
export const touches = ["folders"];

export async function up({ gridId, models, log, dryRun }) {
  const { Folder } = models;
  const gid = String(gridId);
  const files = await Folder.findOne({ gridId: gid, name: "Files", "meta.protected": true }).lean();
  const imports = await Folder.findOne({ gridId: gid, name: "Imports", "meta.protected": true }).lean();
  if (!files || !imports) throw new Error("protected Files / Imports folder not found");
  if (imports.parentId === files.id) { log("Imports is already inside Files"); return; }
  const last = await Folder.find({ gridId: gid, parentId: files.id }, { sortOrder: 1 }).lean();
  const sortOrder = Math.max(-1, ...last.map((f) => Number(f.sortOrder) || 0)) + 1;
  log(`Imports: ${imports.parentId} → Files (${files.id}), sortOrder ${sortOrder}`);
  if (dryRun) return;
  await Folder.updateOne({ id: imports.id }, { $set: { parentId: files.id, sortOrder } });
}
