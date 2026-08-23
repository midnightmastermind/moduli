/**
 * 0202 — the Codex folder tree and the field its tags go in.
 *
 * Split from the import itself (0203) on purpose: this one is small, reversible
 * and cheap to re-run, and it is the half that must be RIGHT before ~2,200
 * occurrences are minted into it. A folder tree that lands wrong is one delete;
 * a 75-page import into the wrong folder is not.
 *
 * ── THE TAGS GET THEIR OWN FIELD ───────────────────────────────────────────
 *
 * User's call. The existing `Tags` field is MIXED — 45 live values, only nine
 * of which are wellness dimensions; the rest are board categories (`image`,
 * `grocery`, `person`) that drive real pickers (CLAUDE.md 2026-08-20 (5)).
 * Adding 135 codex tags would put them in every board-category dropdown.
 *
 * ── IT MIRRORS THE SOURCE TREE, ONE FOLDER PER DIRECTORY ───────────────────
 *
 * Not one per file: 75 folders each holding one page is a tree nobody can read,
 * and the source's own 8 subfolders are the grouping the user already chose.
 */
const uid = () => Math.random().toString(36).slice(2, 12);

export const id = "0202-codex-folders-and-tags";
export const describe =
  "Create the Codex folder (mirroring the notes_codex_annotated tree) and a `Codex Tags` multi-select field carrying the corpus's tags.";

/**
 * One folder for Codex, one per source subfolder. Never one per file.
 *
 * NO `manifestId` IS WRITTEN, and finding that out cost a rehearsal run. The
 * `Folder` schema has no such field, so Mongoose strict mode SILENTLY STRIPS it
 * — the folders insert fine and the key is simply not there. `0199` writes one
 * too, equally inertly. A folder is scoped by its PARENT CHAIN from the
 * manifest's `rootFolderId`, and that is what both the tree and the idempotency
 * check must ask about.
 */
export function planCodexFolders(files, { rootFolderId, userId }) {
  const codex = { id: uid(), userId, name: "Codex", parentId: rootFolderId };
  const subs = [...new Set(files.map((f) => f.folder).filter(Boolean))].sort();
  const folders = [codex, ...subs.map((name) => ({ id: uid(), userId, name, parentId: codex.id }))];
  // A root-level file belongs to Codex itself, which is why "" is a real key
  // here rather than a missing one the caller has to special-case.
  const byRelFolder = new Map([["", codex.id]]);
  folders.slice(1).forEach((f) => byRelFolder.set(f.name, f.id));
  return { folders, byRelFolder };
}

/** Every tag in the corpus, once, sorted. */
export function collectCodexTags(parsed) {
  return [...new Set(parsed.flatMap((p) => p.tags || []))].sort();
}

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Folder, Field, Manifest } = models;
  const { listCodexFiles, CODEX_ROOT } = await import("../utils/codexCorpus.js");
  const { splitTagLine } = await import("../utils/codexParse.js");
  const fs = (await import("node:fs")).default;

  if (!fs.existsSync(CODEX_ROOT)) { log(`  REFUSING: no corpus at ${CODEX_ROOT}`); return; }
  const manifest = await Manifest.findOne({ id: grid.manifestId }).lean();
  const rootFolderId = manifest?.rootFolderId;
  if (!rootFolderId) { log("  REFUSING: the grid's manifest has no root folder"); return; }

  // Idempotency: a Codex folder already under the root means this ran. Keyed on
  // `parentId`, NOT `manifestId` — see planCodexFolders: that key never
  // persists, so a manifestId-scoped query matches nothing and the guard would
  // never fire, duplicating all 9 folders on the next apply.
  const existing = await Folder.findOne({ name: "Codex", parentId: rootFolderId }).lean();
  const existingField = await Field.findOne({ gridId, name: "Codex Tags" }).lean();
  if (existing && existingField) { log("  Codex folder and field already exist — nothing to do"); return; }

  const files = listCodexFiles();
  const parsed = files.map((f) => ({ ...f, ...splitTagLine(fs.readFileSync(f.absPath, "utf8")) }));
  const { folders } = planCodexFolders(files, { rootFolderId, userId: grid.userId });
  const tags = collectCodexTags(parsed);

  log(`  ${files.length} file(s) -> ${folders.length} folder(s): ${folders.map((f) => f.name).join(", ")}`);
  log(`  ${tags.length} distinct tag(s), e.g. ${tags.slice(0, 8).join(", ")}`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  if (!existing) await Folder.insertMany(folders);
  if (!existingField) {
    await Field.create({
      id: uid(), userId: grid.userId, gridId, name: "Codex Tags", type: "select",
      meta: { multiSelect: true, optionsSource: { mode: "manual", values: tags } },
    });
  }
  log(`  done — ${existing ? 0 : folders.length} folder(s), ${existingField ? 0 : 1} field with ${tags.length} options`);
}
