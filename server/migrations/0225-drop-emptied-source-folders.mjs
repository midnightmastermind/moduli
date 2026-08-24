// 0225 — the husk `0224` left behind.
//
// `0224` moved the Bookmarks board page into `Boards/Media`, which leaves
// `Root/Bookmarks` sitting in the tree holding nothing. An empty folder with a
// familiar name is worse than no folder: it is exactly where the user will look
// for the thing that is no longer in it.
//
// **IT REPAIRS FORWARD RATHER THAN EDITING `0224`.** That migration has
// executed and its ledger entry has to describe what ran (the 2026-08-07 (4)
// rule). Migrations run in order, so a grid that has seen neither gets the move
// and the sweep back to back and converges on the same tree.
//
// ── THE PREDICATE IS THE WHOLE SAFETY, AND IT IS DELIBERATELY NARROW ──────
//
// A folder is dropped only when it is empty THREE ways — no child folders, no
// occurrence parented to it, and no occurrence anywhere naming it as a parent —
// and only when it is one of the folders `0224` actually emptied. A generic
// "delete every empty folder" would sweep folders the user made on purpose and
// has not filled yet, which is not this migration's business. `Root/Interests/
// Music` and `Root/Files/Documents` are both empty on poms grid today and both
// are deliberately LEFT ALONE for that reason.

export const id = "0225-drop-emptied-source-folders";
export const description = "Remove the source folders 0224 emptied, if they are still empty";

/** Only the folders `0224` moves things OUT of. Named rather than derived, so
 *  this can never widen into a general empty-folder sweep. */
export const EMPTIED_BY_0224 = ["Bookmarks"];

/** Empty three ways. PURE. */
export function isDroppable(folder, { childFolders, parentedOccs, listedAnywhere }) {
  if (!folder) return { drop: false, why: "no such folder" };
  if (!EMPTIED_BY_0224.includes(folder.name)) return { drop: false, why: `"${folder.name}" is not one 0224 emptied` };
  if (childFolders > 0) return { drop: false, why: `${childFolders} subfolder(s)` };
  if (parentedOccs > 0) return { drop: false, why: `${parentedOccs} page(s) parented` };
  if (listedAnywhere > 0) return { drop: false, why: `named as a parent by ${listedAnywhere} occurrence(s)` };
  return { drop: true, why: "empty three ways" };
}

export async function up({ models, gridId, dryRun, log }) {
  const { Folder, Occurrence } = models;
  const gid = String(gridId);
  const folders = await Folder.find({ gridId: gid }).lean();
  const occs = await Occurrence.find({ gridId: gid }).lean();

  let dropped = 0;
  for (const name of EMPTIED_BY_0224) {
    // Only one parented to the ROOT — a nested folder of the same name is a
    // different folder, and this grid repeats folder names.
    const root = folders.find((f) => !f.parentId && f.name === "Root");
    const f = folders.find((x) => x.name === name && String(x.parentId) === String(root?.id));
    const verdict = isDroppable(f, {
      childFolders: f ? folders.filter((x) => String(x.parentId) === String(f.id)).length : 0,
      parentedOccs: f ? occs.filter((o) => String(o.parentId) === String(f.id)).length : 0,
      listedAnywhere: f ? occs.filter((o) => (o.occurrences || []).includes(f.id)).length : 0,
    });
    if (!verdict.drop) { log(`  keeping "${name}": ${verdict.why}`); continue; }
    log(`  ${dryRun ? "would drop" : "dropping"} empty folder "${name}" (${verdict.why})`);
    if (!dryRun) await Folder.deleteOne({ id: f.id, gridId: gid });
    dropped++;
  }
  return { dropped };
}
