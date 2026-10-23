/**
 * 0429 — the WHOLE codex, light: every note in ~/notebook/codex becomes a page, its text in one block.
 *
 * User, 2026-10-23: "theres no way the codex only has less than 100 pages" — 0203 imported only the 75 hand-
 * annotated notes (notes_codex_annotated). The full codex is ~2,450 notes in 744 folders. Chosen: "All, but light":
 * a note is a board page (as 0203's are — `utils/codexPage` says why a board, not a doc) listing ONE doc container
 * whose textmap is the whole note (`markdownToReaderDoc`, the reader import's own converter). Two rows per note, not
 * the ~30 a fully-structured import makes, so the grid stays quick.
 *
 * FOLDERS: the first two levels of the source are mirrored under the existing Codex folder (13 topics, 42 folders);
 * anything deeper goes into its second-level folder (the page keeps its full path in `meta.codexFullPath`). Every new
 * folder gets its folder-page card (0272: a folder without one renders nothing on its parent's page).
 *
 * Empty files are skipped (a blank page). Images and other non-text files are not imported.
 * RESUMABLE: a note is skipped when a page already carries its `meta.codexFullPath`.
 */
import fs from "node:fs";
import path from "node:path";
import { markdownToReaderDoc } from "../services/markdownImporter.js";
import { compressTextmap } from "../utils/textmapCompression.js";

export const id = "0429-codex-full-light";
export const describe = "Import every note of ~/notebook/codex as a page with its text in one block, under Codex/<topic>/<sub>.";
export const touches = ["occurrences", "modules", "folders"];

export const CODEX_FULL_ROOT = process.env.CODEX_FULL_ROOT || "/home/joshpoms/notebook/codex";
const TEXT = /\.(md|txt)$/i;

/** Every text note under `root`: { absPath, relPath, folderKey } — folderKey = its first two directory levels. Pure. */
export function listNotes(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (TEXT.test(e.name)) {
        const relPath = path.relative(root, abs);
        const dirs = path.dirname(relPath) === "." ? [] : path.dirname(relPath).split(path.sep);
        out.push({ absPath: abs, relPath, folderKey: dirs.slice(0, 2).join("/") });
      }
    }
  };
  walk(root);
  return out;
}

/** A note's page name: its file name without the extension, else its first heading, else "Untitled". Pure. */
export function noteTitle(relPath, body = "") {
  const stem = path.basename(relPath).replace(TEXT, "");
  if (stem && !stem.startsWith(".")) return stem;
  const h1 = /^#\s+(.+)$/m.exec(String(body || ""));
  return h1 ? h1[1].trim() : (stem || "Untitled");
}

const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Occurrence, Module, Folder } = models;
  const userId = grid?.userId;
  if (!userId) { log("  REFUSING: the grid names no userId"); return; }
  if (!fs.existsSync(CODEX_FULL_ROOT)) { log(`  REFUSING: no codex at ${CODEX_FULL_ROOT}`); return; }
  const codex = await Folder.findOne({ gridId, name: "Codex" }).lean();
  if (!codex) { log("  REFUSING: no Codex folder on this grid"); return; }

  const notes = listNotes(CODEX_FULL_ROOT);
  const done = new Set((await Occurrence.find({ gridId, "meta.codexFullPath": { $exists: true } }, { "meta.codexFullPath": 1 }).lean())
    .map((o) => o.meta.codexFullPath));
  const todo = [];
  let empty = 0;
  for (const n of notes) {
    if (done.has(n.relPath)) continue;
    const body = fs.readFileSync(n.absPath, "utf8");
    if (!body.trim()) { empty++; continue; }
    todo.push({ ...n, body });
  }

  // Folders: Codex/<topic> and Codex/<topic>/<sub>, found or made.
  const folders = await Folder.find({ gridId }).lean();
  const childOf = (parentId, name) => folders.find((f) => f.parentId === parentId && f.name === name);
  const keys = [...new Set(todo.map((n) => n.folderKey))].sort();
  const newFolders = [];
  const folderFor = new Map([["", codex.id]]);
  for (const key of keys) {
    let parent = codex.id; let acc = "";
    for (const part of key.split("/").filter(Boolean)) {
      acc = acc ? `${acc}/${part}` : part;
      if (folderFor.has(acc)) { parent = folderFor.get(acc); continue; }
      let f = childOf(parent, part) || newFolders.find((x) => x.parentId === parent && x.name === part);
      if (!f) { f = { id: uid(), userId, gridId, name: part, parentId: parent, folderType: "normal", sortOrder: 0 }; newFolders.push(f); }
      folderFor.set(acc, f.id); parent = f.id;
    }
  }

  log(`  ${notes.length} notes in the codex · already imported ${done.size} · empty (skipped) ${empty} · to import ${todo.length}`);
  log(`  new folders ${newFolders.length}: ${newFolders.slice(0, 12).map((f) => f.name).join(", ")}${newFolders.length > 12 ? " …" : ""}`);
  log(`  rows to write: ${todo.length * 2 + newFolders.length} occurrences + as many modules`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  // Folders and their folder-page cards first, so every page has its home.
  if (newFolders.length) {
    await Folder.insertMany(newFolders);
    const cardMods = []; const cardOccs = [];
    for (const f of newFolders) {
      const mid = uid();
      cardMods.push({ id: mid, userId, gridId, role: "page", kind: "folder", label: f.name });
      cardOccs.push({ id: uid(), userId, gridId, moduleId: mid, targetId: mid, targetType: "module", parentId: f.id,
        sortOrder: -1, iteration: { mode: "persistent" }, fields: {}, meta: { folderPage: true } });
    }
    await Module.insertMany(cardMods);
    await Occurrence.insertMany(cardOccs);
  }

  const BATCH = 200;
  let made = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const mods = []; const occs = [];
    for (const n of todo.slice(i, i + BATCH)) {
      const { label, content } = markdownToReaderDoc(n.body);
      const title = noteTitle(n.relPath, n.body);
      const pageMod = uid(); const pageOcc = uid(); const docMod = uid(); const docOcc = uid();
      mods.push(
        { id: pageMod, userId, gridId, role: "page", kind: "board", label: title, meta: {} },
        { id: docMod, userId, gridId, role: "container", kind: "doc", label: label || title, meta: { headingLevel: 1 } },
      );
      occs.push(
        { id: pageOcc, userId, gridId, moduleId: pageMod, targetId: pageMod, targetType: "module",
          parentId: folderFor.get(n.folderKey), occurrences: [docOcc], iteration: { mode: "persistent" }, fields: {},
          meta: { codexFullPath: n.relPath } },
        { id: docOcc, userId, gridId, moduleId: docMod, targetId: docMod, targetType: "module", parentId: pageOcc,
          occurrences: [], iteration: { mode: "persistent" }, fields: {}, meta: {},
          textmap: compressTextmap({ type: "doc", content }) },
      );
    }
    await Module.insertMany(mods, { ordered: false });
    await Occurrence.insertMany(occs, { ordered: false });
    made += mods.length / 2;
    log(`  … ${made} / ${todo.length}`);
  }
  log(`  done — ${made} notes imported into ${newFolders.length} new folder(s). Restart the server (warm cache).`);
}
