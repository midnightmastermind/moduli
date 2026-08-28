/**
 * 0272 — a folder with no card is invisible on its parent's page.
 *
 * User, 2026-08-28: *"none of my documents are showing up"* … *"they show up
 * just not on folder page"* … *"empty folders inside of another folder requires
 * me to open up the parent folder to see those in the preview. i navigated to
 * root folder page and interests said i had nothing in there (the preview showed
 * an empty container), even though i have a bunch of empty folders."*
 *
 * A sub-folder renders as a card ONLY if it contains a `role:"page"
 * kind:"folder"` occurrence — that occurrence IS the card. The sidebar reads
 * `foldersById` directly, so the tree shows every folder while the folder PAGE
 * shows only the ones that have a card. That is the whole reason this reads as
 * data loss when nothing is lost.
 *
 * 2026-08-24 (3) fixed it by minting on view — but only for the DIRECT children
 * of the folder being viewed. So opening `Documents` mints cards for `Notes` and
 * `Codex`; from `Root`, those grandchildren still have none, and `Documents`'
 * own PREVIEW renders empty. That is exactly the "I have to open the parent
 * first" the user describes.
 *
 * MEASURED ON POMS GRID BEFORE WRITING:
 *     folders 68 · with a card 37 · MISSING 31
 *     "Documents" holds 2 sub-folders, its page shows 0   -> Notes, Codex
 *     "Codex"     holds 8,            shows 0             -> daytracker, dreams, …
 *     "Media"     holds 2,            shows 0             -> Music, Books
 *     "Notes"     holds 1,            shows 0             -> Health
 *
 * THE PREDICATE IS THE RENDERER'S, NOT THE MINT HELPER'S. `ensureFolderPageOcc`
 * identifies an existing page by `meta.folderPage === true`, while the renderer
 * identifies it by the MODULE's kind+role — two tests for one thing. Minting off
 * the helper's test would DUPLICATE a card for any folder whose occurrence lacks
 * that flag. This uses the renderer's test, and stamps `meta.folderPage` on what
 * it creates so both tests agree from here on.
 *
 * `folderType: "category"` folders are skipped: they are not tree nodes and
 * never render as a card — the same exemption `ModulePage` makes.
 */
export const id = "0272-missing-folder-page-occurrences";
export const describe = "Mint the folder-page occurrence for folders that have none — they were invisible on their parent's page.";

/**
 * PURE. Which folders have no card, using the RENDERER's test.
 * Exported so the rule is testable without a database (the 0048 shape).
 */
export function planFolderPages(folders, occurrences, modulesById) {
  const hasCard = new Set();
  for (const o of occurrences) {
    const m = modulesById[o.moduleId];
    if (m?.role === "page" && m?.kind === "folder" && o.parentId) hasCard.add(o.parentId);
  }
  return folders
    .filter(f => f.folderType !== "category")   // not a tree node — never a card
    .filter(f => !hasCard.has(f.id))
    .map(f => ({ folderId: f.id, label: f.name || "Folder" }));
}

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const userId = grid?.userId;
  if (!userId) { log("  REFUSING: the grid names no userId — every row here needs one"); return; }

  const [folders, occs, mods] = await Promise.all([
    models.Folder.find({ gridId }).lean(),
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const modulesById = Object.fromEntries(mods.map(m => [m.id, m]));
  const plan = planFolderPages(folders, occs, modulesById);

  log(`  folders ${folders.length} · already carrying a card ${folders.length - plan.length} · MISSING ${plan.length}`);
  if (!plan.length) { log("  every folder already renders as a card — already converged"); return; }

  const byId = Object.fromEntries(folders.map(f => [f.id, f]));
  for (const p of plan.slice(0, 20)) log(`      "${p.label}"  in "${byId[byId[p.folderId]?.parentId]?.name ?? byId[p.folderId]?.parentId ?? "(root)"}"`);
  if (plan.length > 20) log(`      …+${plan.length - 20} more`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  let made = 0;
  for (const p of plan) {
    const modId = uid(), occId = uid();
    await Module.create({ id: modId, userId, gridId, role: "page", kind: "folder", label: p.label });
    await Occurrence.create({
      id: occId, userId, gridId, moduleId: modId, targetId: modId, targetType: "module",
      parentId: p.folderId, sortOrder: -1, iteration: { mode: "persistent" },
      fields: {}, meta: { folderPage: true },
    });
    made++;
  }
  log(`  done — minted ${made} folder-page occurrence(s); each folder now renders as a card on its parent's page`);
}
