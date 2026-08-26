/**
 * 0263 — one Templates folder, not three.
 *
 * User, 2026-08-26: *"move the more inner templates folder contents to the
 * boards section and delete that templates folder"* → *"i meant the library
 * templates but there shouldnt be two templates in the root folder either. they
 * should be merged"*.
 *
 * ── WHAT WAS ACTUALLY THERE ─────────────────────────────────────────────
 *
 * ```
 * Root/Library/Templates   mAif5lIvNpXI       0 occurrences · 0 sub-folders · not protected
 * Templates (TOP LEVEL)    PLySXSQBJrGx       0 occurrences · root of a manifestType:"templates"
 * Root/Templates           tpl-folder-<grid>  4 occurrences · PROTECTED   <- the real one
 * ```
 *
 * The real one holds `Schedule Template`, `Project: {ProjectName}`, `Day Page`
 * and a `Templates` page. The other two are **empty**, so "move the contents"
 * moves nothing — the whole ask is the deletion, and that is worth saying rather
 * than reporting a triumphant move of zero items.
 *
 * ── DELETING THE TOP-LEVEL ONE WOULD NOT HAVE STUCK ─────────────────────
 *
 * `socketHandlers/state.js` called `ensureTemplatesManifest` on EVERY grid
 * bootstrap, which find-or-mints a `manifestType:"templates"` manifest **and its
 * root folder**. Delete the folder and the next page load puts it back. That
 * call is removed in the same commit — the two halves cannot ship apart.
 *
 * **Nothing reads that manifest.** `0035` retired it, and both ends resolve
 * templates by LOCATION instead — `utils/templatesFolder.js findTemplatesFolder`
 * and `helpers/templateHelpers.js templatesFolderFor` each key on
 * `meta.protected` + the name "Templates". Checked rather than assumed: a grep
 * for `manifestType` + templates finds only that ensure util, a legacy one-off
 * script, and the assistant's generic manifest-lister.
 *
 * ── IT REFUSES RATHER THAN DELETING SOMETHING THAT HOLDS ANYTHING ───────
 *
 * Each doomed folder must be empty of occurrences AND sub-folders, must not be
 * protected, and must not be the user manifest's root. Anything else is reported
 * and kept — an empty folder is clutter, a folder with contents is data.
 */

export const id = "0263-merge-templates-folders";
export const describe =
  "Leaves ONE Templates folder — the protected one under the user manifest. Removes the empty Root/Library/Templates and the vestigial top-level Templates folder plus its retired templates manifest. Refuses to delete a folder that holds anything.";
export const touches = ["folders", "manifests"];

export const FOLDER_NAME = "Templates";

/** Pure. Which Templates folders survive, which go, and why. */
export function planTemplateMerge({ folders, occurrences, manifests }) {
  const refusals = [];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const named = folders.filter((f) => f.name === FOLDER_NAME);
  if (named.length <= 1) return { refusals, keep: named[0] || null, remove: [], manifestIds: [] };

  // The survivor is the PROTECTED one — the marker both ends resolve on.
  const keepers = named.filter((f) => f.meta?.protected);
  if (keepers.length !== 1) {
    refusals.push(`expected exactly one PROTECTED "${FOLDER_NAME}" folder, found ${keepers.length}`);
    return { refusals, remove: [], manifestIds: [] };
  }
  const keep = keepers[0];

  const userManifestRoots = new Set((manifests || []).filter((m) => m.manifestType === "user").map((m) => m.rootFolderId));
  const remove = [];
  for (const f of named) {
    if (f.id === keep.id) continue;
    const occKids = occurrences.filter((o) => o.parentId === f.id);
    const subKids = folders.filter((x) => x.parentId === f.id);
    const why = [];
    if (occKids.length) why.push(`holds ${occKids.length} occurrence(s)`);
    if (subKids.length) why.push(`holds ${subKids.length} sub-folder(s)`);
    if (f.meta?.protected) why.push("is protected");
    if (userManifestRoots.has(f.id)) why.push("is the user manifest's root");
    if (why.length) { refusals.push(`"${f.name}" ${f.id} — ${why.join("; ")}`); continue; }
    remove.push({ id: f.id, chain: chainOf(f.id, byId) });
  }
  // The retired templates manifest goes with its root folder.
  const removeIds = new Set(remove.map((r) => r.id));
  const manifestIds = (manifests || [])
    .filter((m) => m.manifestType === "templates" && removeIds.has(m.rootFolderId))
    .map((m) => m.id);
  return { refusals, keep, remove, manifestIds };
}

export function chainOf(folderId, byId) {
  const out = [];
  let cur = byId.get(folderId);
  let d = 0;
  while (cur && d++ < 8) { out.unshift(cur.name); cur = byId.get(cur.parentId); }
  return out.join("/");
}

export async function up({ gridId, models, log, dryRun }) {
  const { Folder, Occurrence, Manifest } = models;
  const [folders, occurrences, manifests] = await Promise.all([
    Folder.find({ gridId }).lean(), Occurrence.find({ gridId }).lean(), Manifest.find({ gridId }).lean(),
  ]);
  const p = planTemplateMerge({ folders, occurrences, manifests });
  for (const r of p.refusals) log(`  KEEPING — ${r}`);
  if (!p.remove.length) { log("one Templates folder already — nothing to do."); return; }

  const byId = new Map(folders.map((f) => [f.id, f]));
  log(`keeping "${chainOf(p.keep.id, byId)}" (${p.keep.id}) — the protected one both ends resolve on`);
  for (const r of p.remove) log(`  REMOVE empty "${r.chain}" (${r.id})`);
  if (p.manifestIds.length) log(`  REMOVE retired templates manifest(s): ${p.manifestIds.join(", ")}`);
  if (dryRun) { log("DRY RUN — nothing written."); return; }

  await Folder.deleteMany({ gridId, id: { $in: p.remove.map((r) => r.id) } });
  if (p.manifestIds.length) await Manifest.deleteMany({ gridId, id: { $in: p.manifestIds } });
  log(`removed ${p.remove.length} folder(s) and ${p.manifestIds.length} manifest(s).`);
}
