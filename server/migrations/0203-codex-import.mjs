/**
 * 0203 — 75 annotated notes become 75 pages.
 *
 * It DRIVES the existing importer rather than adding a second one:
 * `markdownToModuli` already turns markdown into a module/occurrence tree with
 * headings as containers and prose as textblocks. What it cannot do is mint a
 * page (`utils/codexPage`), read a tag line (`utils/codexParse`), or tell an
 * annotation from a quote — that last one is fixed in the importer itself,
 * because 54 of the corpus's 460 blockquotes were losing their final sentence
 * to the pull-quote attribution split.
 *
 * ── RESUMABLE, and that is the whole safety of a ~2,200-occurrence write ────
 *
 * Every page is signed `meta.codexPath` with the file's path RELATIVE to the
 * corpus root. A run that dies at file 40 leaves 35, and a re-run does exactly
 * those. The relative path matters: `Untitled 1.md` exists at the root AND in
 * `untitled_notes/` with different content, so a basename signature would make
 * the second look already-imported and silently drop it.
 *
 * ── ORDER: IMPORT, THEN MINT THE PAGE ──────────────────────────────────────
 *
 * The page is created only once the import has returned a root id for it to
 * embed. Minting first leaves an empty page behind every time an import fails,
 * and a file that fails is expected here — this is 75 real documents, not a
 * fixture.
 */
import { markdownToModuli } from "../services/markdownImporter.js";
import { listCodexFiles, CODEX_ROOT } from "../utils/codexCorpus.js";
import { splitTagLine } from "../utils/codexParse.js";
import { planCodexPage, codexTitle } from "../utils/codexPage.js";
import fs from "node:fs";

export const id = "0203-codex-import";
export const describe =
  "Import the 75 annotated notes as pages under the Codex folder — headings as containers, prose as textblocks, annotations as marked quote blocks, the tag line into Codex Tags.";

/** Which files still need doing. Pure, so resumability is testable. */
export function planCodexRun(files, alreadyDone) {
  const todo = files.filter((f) => !alreadyDone.has(f.relPath));
  return { todo, alreadyDone: files.length - todo.length };
}

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Occurrence, Module, Field, Folder, Manifest } = models;
  if (!fs.existsSync(CODEX_ROOT)) { log(`  REFUSING: no corpus at ${CODEX_ROOT}`); return; }

  const manifest = await Manifest.findOne({ id: grid.manifestId }).lean();
  // Keyed on parentId, never manifestId — that key does not persist on a
  // Folder (see 0202). A manifestId-scoped query silently matches nothing.
  const codexFolder = await Folder.findOne({ name: "Codex", parentId: manifest?.rootFolderId }).lean();
  if (!codexFolder) { log("  REFUSING: no Codex folder — run 0202 first"); return; }
  const subFolders = await Folder.find({ parentId: codexFolder.id }).lean();
  const folderFor = new Map([["", codexFolder.id], ...subFolders.map((f) => [f.name, f.id])]);

  const tagField = await Field.findOne({ gridId, name: "Codex Tags" }).lean();
  if (!tagField) { log("  REFUSING: no `Codex Tags` field — run 0202 first"); return; }

  const files = listCodexFiles();
  const done = new Set((await Occurrence.find({ gridId, "meta.codexPath": { $exists: true } }).lean())
    .map((o) => o.meta.codexPath));
  const { todo, alreadyDone } = planCodexRun(files, done);
  log(`  ${files.length} file(s): ${todo.length} to import, ${alreadyDone} already done`);

  if (dryRun) {
    // Plan ONE file for real so the shape is known before 75 are written.
    if (todo[0]) {
      const { tags, body } = splitTagLine(fs.readFileSync(todo[0].absPath, "utf8"));
      const res = await markdownToModuli({
        gridId, userId: grid.userId, markdown: body,
        title: codexTitle(todo[0].relPath, body), dryRun: true,
      });
      log(`  e.g. ${todo[0].relPath}: ${res.stats.occurrences} occurrence(s) ` +
          `(${res.stats.containers} containers, ${res.stats.textblocks} textblocks, ` +
          `${res.stats.artifacts} artifacts), tags: ${tags.join(", ") || "none"}`);
    }
    const missingFolders = [...new Set(files.map((f) => f.folder))].filter((k) => !folderFor.has(k));
    if (missingFolders.length) log(`  WARNING: no folder for ${missingFolders.join(", ")}`);
    log("  (dry run — nothing written)");
    return;
  }

  let pages = 0, occs = 0;
  const failed = [];
  for (const f of todo) {
    const folderId = folderFor.get(f.folder);
    if (!folderId) { failed.push(`${f.relPath} (no folder)`); continue; }
    const { tags, body } = splitTagLine(fs.readFileSync(f.absPath, "utf8"));
    const title = codexTitle(f.relPath, body);
    let res;
    try {
      // IMPORT FIRST. The page is minted only once there is a root id to embed.
      res = await markdownToModuli({ gridId, userId: grid.userId, markdown: body, title, dryRun: false });
    } catch (e) { failed.push(`${f.relPath} (${e.message})`); continue; }

    const { pageModule, pageOcc } = planCodexPage({
      gridId, userId: grid.userId, folderId, tagFieldId: tagField.id,
      relPath: f.relPath, rootOccurrenceId: res.rootOccurrenceId, tags, body,
    });
    await Module.create(pageModule);
    await Occurrence.create(pageOcc);
    // The imported root is parented to the PAGE, so the tree resolves it. The
    // importer left it null (no parentId was passed) precisely so this could be
    // set after the page exists.
    await Occurrence.updateOne({ id: res.rootOccurrenceId, gridId }, { $set: { parentId: pageOcc.id } });
    pages++; occs += res.stats.occurrences + 1;
    if (pages % 10 === 0) log(`     …${pages}/${todo.length} pages, ${occs} occurrences`);
  }
  log(`  done — ${pages} page(s), ${occs} occurrence(s)`);
  if (failed.length) log(`  ${failed.length} FAILED (re-run to retry): ${failed.slice(0, 5).join("; ")}`);
}
