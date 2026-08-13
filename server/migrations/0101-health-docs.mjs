// server/migrations/0101-health-docs.mjs
//
// User, 2026-08-13: "add those new md docs i just added to the system under
// health folder in the notes folder, converted to doc pages."
//
// The three files, dropped into `screenshots/` (their Zone.Identifier stamps are
// today; the content mtimes are older because the copy preserved them):
//
//   Nutrition Plan.md         a 3-day Mediterranean bulking plan — shopping list
//                             with per-item macros, 8 meals with recipes
//   Fitness Plan.md           a 3-day push / legs / pull split, 24 movements
//   Basic Nutrition Guide.md  macro targets, vitamin/mineral RDAs, hydration
//
// EACH BECOMES A PAGE, NOT A BARE IMPORT ROOT. `markdownToModuli` always returns
// a `role:"container" kind:"doc"` root — the importer has never minted a page —
// so a page is created per doc whose textmap EMBEDS that root. Listing the root
// under the folder without embedding it is the listed-but-not-embedded class
// this grid has been repaired for repeatedly; a doc renders its TEXTMAP.
//
// THE IMPORT IS DETACHED AND THE PAGE IS MINTED AFTER IT, so the page is created
// already embedding a root that exists. Minting the page first leaves an empty
// page behind whenever an import fails (2026-08-08 (5)).
//
// IDEMPOTENT BY TITLE: a page already named for a doc is skipped, so a re-run
// imports nothing and cannot produce a second copy.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { markdownToModuli } from "../services/markdownImporter.js";

export const id = "0101-health-docs";
export const describe =
  "Imports the Nutrition Plan, Fitness Plan and Basic Nutrition Guide as doc pages under Notes → Health.";

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../screenshots");
export const DOCS = ["Nutrition Plan.md", "Fitness Plan.md", "Basic Nutrition Guide.md"];

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Folder, Manifest } = models;
  const [occs, mods, folders] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Folder.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));

  const notes = folders.find((f) => (f.name || "").toLowerCase() === "notes");
  if (!notes) { log(`REFUSING: no "Notes" folder — nothing written.`); return; }
  let health = folders.find((f) =>
    (f.name || "").toLowerCase() === "health" && f.parentId === notes.id);

  const present = DOCS.filter((d) => fs.existsSync(path.join(SRC_DIR, d)));
  const missing = DOCS.filter((d) => !fs.existsSync(path.join(SRC_DIR, d)));
  if (missing.length) log(`NOT FOUND on disk (skipped): ${missing.join(", ")}`);

  const titleOf = (f) => f.replace(/\.md$/i, "");
  const already = present.filter((f) =>
    mods.some((m) => m.role === "page" && (m.label || "") === titleOf(f)));
  const todo = present.filter((f) => !already.includes(f));
  log(`Notes folder ${notes.id.slice(0, 8)} · Health folder ${health ? health.id.slice(0, 8) : "(to create)"}`);
  log(`docs found: ${present.length} · already imported: ${already.length} · to import: ${todo.length}`);
  for (const f of todo) {
    const bytes = fs.statSync(path.join(SRC_DIR, f)).size;
    log(`   ${titleOf(f).padEnd(24)} ${bytes} bytes`);
  }

  if (dryRun) {
    log(`WOULD ${health ? "" : "create the Health folder and "}import ${todo.length} doc(s) as pages.`);
    return;
  }
  if (!todo.length) { log(`nothing to import.`); return; }

  if (!health) {
    const hid = randomUUID();
    await Folder.create({
      id: hid, gridId, userId: notes.userId, name: "Health",
      parentId: notes.id, manifestId: notes.manifestId,
      folderType: "normal", sortOrder: (folders.filter((f) => f.parentId === notes.id).length || 0),
    });
    health = { id: hid, userId: notes.userId };
    log(`created the Health folder under Notes.`);
  }

  for (const file of todo) {
    const title = titleOf(file);
    const markdown = fs.readFileSync(path.join(SRC_DIR, file), "utf8");
    // DETACHED: the page is minted only once the root exists.
    const result = await markdownToModuli({
      gridId, userId: notes.userId, markdown, title, parentId: null,
    });
    const rootId = result?.rootOccurrenceId;
    if (!rootId) { log(`   ${title}: importer returned no root — SKIPPED, nothing minted`); continue; }

    const pageModId = randomUUID();
    const pageOccId = randomUUID();
    await Module.create({
      id: pageModId, gridId, userId: notes.userId,
      label: title, role: "page", kind: "doc",
      meta: { allowChildContainers: true },
    });
    await Occurrence.create({
      id: pageOccId, gridId, userId: notes.userId,
      moduleId: pageModId, targetId: pageModId,
      parentId: health.id,
      // EMBEDDED, not merely listed — a doc renders its textmap.
      textmap: { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: rootId } }] },
      occurrences: [rootId],
      filterOverride: {},
    });
    await Occurrence.updateOne({ gridId, id: rootId }, { $set: { parentId: pageOccId } });
    log(`   ${title}: ${result.modules?.length || 0} module(s), ${result.occurrences?.length || 0} occurrence(s) -> page ${pageOccId.slice(0, 8)}`);
  }
  log(`imported ${todo.length} doc page(s) under Notes → Health.`);
}
