// server/migrations/0407-attach-converted-epubs.mjs
//
// User 2026-10-16: convert the Kindle-only books to epub — "epub, keep the originals in there". The
// conversion (`server/_convertbooks.mjs`, run on the server: Drive → Calibre → Drive) puts each epub
// beside its original in Drive. This attaches each one to its book row: an artifact (fileRef
// `gdrive:<connection>:<fileId>`, kind ebook) homed in Files › Books, added to the row's Files list and
// made the row's `main` file — an epub reads best in the reader. The original stays attached.
//
// Input: CONVERTED_BOOKS_PATH — JSON `{ connectionId, results: [{ rowId, status, epubId, name, size }] }`.
// Idempotent: an artifact is found again by its fileRef; attaching twice changes nothing.

import fs from "node:fs";
import crypto from "node:crypto";
import { fileTitle } from "./0401-link-drive-books.mjs";

export const id = "0407-attach-converted-epubs";
export const describe = "Converted epubs (Drive, beside each original) become artifacts attached to their book rows as the main file; originals stay attached. Deletes nothing.";
export const touches = ["occurrences", "modules"];

/** The row's Files cell with the epub added and made main; Formats gains "epub". (PURE) */
export function attachEpub(fields, F, epubOccId) {
  const cell = fields?.[F.files] && typeof fields[F.files] === "object" ? fields[F.files] : {};
  const value = [...new Set([...(Array.isArray(cell.value) ? cell.value : []), epubOccId])];
  const out = { ...fields, [F.files]: { ...cell, value, flow: "replace", main: epubOccId } };
  if (F.formats) {
    const fm = String(fields?.[F.formats]?.value || "").split(/\s*,\s*/).filter(Boolean);
    if (!fm.includes("epub")) out[F.formats] = { ...(fields?.[F.formats] || {}), value: [...fm, "epub"].join(", "), flow: "replace" };
  }
  return out;
}

export async function up({ gridId, models, log, dryRun }) {
  const path = process.env.CONVERTED_BOOKS_PATH;
  if (!path) throw new Error("0407: set CONVERTED_BOOKS_PATH");
  const { connectionId, results } = JSON.parse(fs.readFileSync(path, "utf8"));
  const ok = results.filter((r) => r.status === "ok" && r.epubId);
  const { Grid, Module, Occurrence, Field, Folder } = models;
  const grid = await Grid.findById(gridId).lean(); const userId = String(grid.userId);
  const field = async (name) => (await Field.findOne({ gridId, name }).lean())?.id || null;
  const F = { files: await field("Files"), formats: await field("Formats") };
  const rows = new Map((await Occurrence.find({ gridId, id: { $in: ok.map((r) => r.rowId) } }).lean()).map((r) => [r.id, r]));
  const missing = ok.filter((r) => !rows.has(r.rowId));
  log(`${ok.length} converted epub(s) · ${ok.length - missing.length} rows found · ${missing.length} rows gone · ${results.length - ok.length} not converted`);
  if (dryRun) return;
  const filesFolder = await Folder.findOne({ gridId, name: "Files", "meta.protected": true }).lean();
  const booksFolder = await Folder.findOne({ gridId, name: "Books", parentId: filesFolder?.id }).lean();
  if (!booksFolder) throw new Error("0407: no Files › Books folder");
  let n = 0;
  for (const r of ok) {
    const row = rows.get(r.rowId); if (!row) continue;
    const fileRef = `gdrive:${connectionId}:${r.epubId}`;
    let mod = await Module.findOne({ gridId, fileRef }).lean();
    if (!mod) {
      mod = { id: crypto.randomUUID(), userId, gridId, role: "artifact", kind: "ebook", label: fileTitle(r.name), fileRef,
        defaultDragMode: "copy", fieldBindings: [],
        meta: { mimeType: "application/epub+zip", originalName: r.name, uploadSize: r.size, uploadStatus: "ready", folderId: booksFolder.id, source: "drive-convert" } };
      await Module.create(mod);
    }
    let occ = await Occurrence.findOne({ gridId, moduleId: mod.id }).lean();
    if (!occ) {
      occ = { id: crypto.randomUUID(), userId, gridId, moduleId: mod.id, targetId: mod.id, targetType: "module", parentId: booksFolder.id, fields: {}, occurrences: [] };
      await Occurrence.create(occ);
    }
    await Occurrence.updateOne({ id: row.id }, { $set: { fields: attachEpub(row.fields || {}, F, occ.id) } });
    n++;
  }
  const check = await Occurrence.countDocuments({ gridId, id: { $in: ok.map((r) => r.rowId) }, [`fields.${F.files}.main`]: { $exists: true } });
  log(`attached ${n}; read back ${check} rows with a main file. Restart the server (pm2).`);
}
