// server/migrations/0401-link-drive-books.mjs
//
// User 2026-10-15: the book files are in Google Drive's "Moduli uploads/Books"; connect them to the
// book rows. Answers: a file matching no row gets a new book row; two rows for one book are MERGED;
// volumes of one book get a row per volume; non-book files are skipped.
//
// Input: BOOKS_DRIVE_PATH — JSON `{ connectionId, files: [{ id, name, size, mimeType }] }`, written on
// the server by `_drivebooks.mjs` (the Drive token is decrypted there). Kept outside git: titles.
//
// Each file becomes an artifact (fileRef `gdrive:<connection>:<fileId>`, kind pdf | ebook) homed in
// Files › Books and attached to its row's Files field (the first one is the row's `main`).
// Idempotent: an artifact is found again by its fileRef, a made row by meta.externalId.

import fs from "node:fs";
import crypto from "node:crypto";

export const id = "0401-link-drive-books";
export const describe = "Book files in Drive's Moduli uploads/Books become artifacts attached to their book rows; "
  + "unmatched files get new book rows, extra volumes get their own rows. DELETES duplicate book rows after "
  + "merging their values into the kept row (references repointed).";
export const touches = ["occurrences", "modules", "folders"];

// ── matching (PURE) ──────────────────────────────────────────────────────────
export const norm = (s) => String(s || "").toLowerCase()
  .replace(/f[_*]{1,2}c?k/g, "fuck").replace(/&/g, "and").replace(/[‘’]/g, "'")
  .replace(/[^a-z0-9]+/g, " ").trim();

/**
 * A Drive file name -> { title, author }. Handles the shapes in the user's library: Kindle's
 * "_<32-char key>" / "_B0…" (ASIN) suffixes and "_ " for ":"; " - Unknown"; "<title>.pdf-cdeKey_<key>";
 * "[(Title)] [Author_ X] Published on (…)"; and "Last, First_Last, First - title-Publisher (year)" pdfs.
 */
export function parseFileName(name) {
  let t = String(name).replace(/\.[a-z0-9]{2,5}$/i, "");
  t = t.replace(/(\.pdf)?-cdeKey(_[A-Z0-9]{32})?$/i, "").replace(/_[A-Z0-9]{32}$/, "").replace(/_B0[A-Z0-9]{8}$/, "");
  t = t.replace(/_+$/, "").replace(/ - Unknown$/i, "");
  t = t.replace(/\b(f)_(ck)(?=[^a-z]|$)/gi, "$1*$2");
  let author = null;
  const bracket = t.match(/^\[\((.*)\)\]\s*\[Author_? ?([^\]]*)\]/);
  if (bracket) { t = bracket[1]; author = bracket[2].trim(); }
  const pdf = !bracket && t.match(/^(?:\(.*?\)\s*)?(.+?) - (.+)-[^-]+\(\d{4}\)$/);
  if (pdf) { author = pdf[1].replace(/_\s*/g, " & "); t = pdf[2]; }
  t = t.replace(/\s*_\s+/g, ": ").replace(/_/g, " ").replace(/\s+:/g, ":").replace(/\s+/g, " ").trim();
  if (!author) { const m = t.match(/^(.*\S) - (?!.* - )(.+)$/); if (m) { t = m[1]; author = m[2].trim(); } }
  return { title: t, author: author ? author.replace(/\s+/g, " ").trim() : null };
}
export const fileTitle = (name) => parseFileName(name).title;
/** The volume number a title names, or null ("Vol 2", "(Volume 3)"). */
export const volumeOf = (t) => { const m = String(t).match(/\bvol(?:ume)?\.?\s*(\d+)/i); return m ? Number(m[1]) : null; };
const mainOf = (t) => norm(String(t).replace(/^[[(][^\])]*[\])]\s*/, "").replace(/ - [^-]+$/, "")
  .replace(/^(the|a|an) /i, "").replace(/, the$/i, "").split(/[:([]/)[0]);
const titleKey = (t) => norm(String(t).replace(/ - [^-]+$/, "").replace(/, the$/i, "").replace(/^the /i, ""));

/**
 * The plan. `rows`: [{ id, label, sizeMiB }] (book rows, in their board's order). Returns
 *  links:   [{ rowId, fileIds }]                       attach to an existing row
 *  merges:  [{ keepId, dropIds }]                      same book, several rows
 *  clones:  [{ fromRowId, label, fileIds }]            another volume of a row's book
 *  creates: [{ label, author, fileIds }]                no row
 */
export function planBookLinks({ files, rows }) {
  const keyed = rows.map((r) => ({ r, k: norm(r.label), t: titleKey(r.label), m: mainOf(r.label) }));
  const rowFiles = new Map(); const creates = new Map(); const mergeGroups = new Map();
  for (const f of files) {
    const { title, author } = parseFileName(f.name);
    const full = author ? `${title} - ${author}` : title;
    const tries = [
      (x) => x.k === norm(full) || x.k === norm(title), (x) => x.t === titleKey(title),
      (x) => mainOf(title).length > 3 && x.m === mainOf(title),
    ];
    let cand = [];
    for (const t of tries) { cand = keyed.filter(t); if (cand.length) break; }
    if (cand.length > 1 && new Set(cand.map((c) => c.t)).size === 1) {
      const keep = cand[0].r.id;
      mergeGroups.set(keep, new Set([...(mergeGroups.get(keep) || []), ...cand.slice(1).map((c) => c.r.id)]));
      cand = [cand[0]];
    } else if (cand.length > 1) {
      const mib = f.size / 1048576;
      const bySize = cand.filter((c) => Math.abs(Number(c.r.sizeMiB) - mib) < Math.max(0.15, mib * 0.03));
      cand = bySize.length === 1 ? bySize : [];
    }
    if (cand.length === 1) {
      const id = cand[0].r.id; if (!rowFiles.has(id)) rowFiles.set(id, []); rowFiles.get(id).push(f);
    } else {
      const key = titleKey(title);
      if (!creates.has(key)) creates.set(key, { label: title, author, fileIds: [] });
      creates.get(key).fileIds.push(f.id);
    }
  }
  const links = []; const clones = [];
  for (const [rowId, rf] of rowFiles) {
    const groups = new Map();
    // One row per VOLUME; other format/name differences of the same volume stay on one row.
    for (const f of rf) { const k = volumeOf(fileTitle(f.name)) ?? 0; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f); }
    const ordered = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
    if (ordered.length === 1) { links.push({ rowId, fileIds: rf.map((f) => f.id) }); continue; }
    links.push({ rowId, fileIds: ordered[0].map((f) => f.id), relabel: fileTitle(ordered[0][0].name) });
    for (const g of ordered.slice(1)) clones.push({ fromRowId: rowId, label: fileTitle(g[0].name), fileIds: g.map((f) => f.id) });
  }
  const merges = [...mergeGroups].map(([keepId, drops]) => ({ keepId, dropIds: [...drops] }));
  return { links, merges, clones, creates: [...creates.values()] };
}

/** Which of several duplicate rows to keep: the one with the most filled-in fields. */
export function pickKeeper(rows) {
  const filled = (r) => Object.values(r.fields || {}).filter((c) => {
    const v = c && typeof c === "object" && "value" in c ? c.value : c;
    return v != null && v !== "" && !(Array.isArray(v) && !v.length);
  }).length;
  return [...rows].sort((a, b) => filled(b) - filled(a))[0];
}
/** The kept row's fields, with every empty field filled from the dropped rows. */
export function mergeFields(keep, drops) {
  const out = { ...(keep.fields || {}) };
  const empty = (c) => { const v = c && typeof c === "object" && "value" in c ? c.value : c; return v == null || v === "" || (Array.isArray(v) && !v.length); };
  for (const d of drops) for (const [k, c] of Object.entries(d.fields || {})) if (empty(out[k]) && !empty(c)) out[k] = c;
  return out;
}

/** The kept row's meta, with keys it lacks (a cover, an author) taken from the dropped rows. */
export function mergeMeta(keep, drops) {
  const out = { ...(keep.meta || {}) };
  for (const d of drops) for (const [k, v] of Object.entries(d.meta || {})) if (out[k] == null && v != null) out[k] = v;
  return out;
}

const kindOf = (name) => (/\.pdf$/i.test(name) ? "pdf" : "ebook");
const mimeOf = (f) => (/\.pdf$/i.test(f.name) ? "application/pdf" : f.mimeType || "application/octet-stream");

// ── writes ───────────────────────────────────────────────────────────────────
export async function up({ gridId, models, log, dryRun }) {
  const path = process.env.BOOKS_DRIVE_PATH;
  if (!path) throw new Error("0401: set BOOKS_DRIVE_PATH to the JSON written by _drivebooks.mjs");
  const { connectionId, files } = JSON.parse(fs.readFileSync(path, "utf8"));
  const { Grid, Module, Occurrence, Field, Folder } = models;
  const grid = await Grid.findById(gridId).lean();
  const userId = String(grid.userId);
  const field = async (name) => (await Field.findOne({ gridId, name }).lean())?.id || null;
  const F = { files: await field("Files"), formats: await field("Formats"), owned: await field("Owned"),
    category: await field("Board Category"), size: await field("Size"), author: await field("Author") };
  if (!F.files) throw new Error("0401: no Files field");

  const bookMods = await Module.find({ gridId, role: "artifact", kind: { $in: ["book", "comic"] } }).lean();
  const bookModIds = bookMods.map((m) => m.id);
  const rowDocs = await Occurrence.find({ gridId, moduleId: { $in: bookModIds }, "meta.feedSourceId": null }).lean();
  const sizeOf = (r) => parseFloat(r.fields?.[F.size]?.value);
  const plan = planBookLinks({ files, rows: rowDocs.map((r) => ({ id: r.id, label: r.label || "", sizeMiB: sizeOf(r) })) });
  log(`files ${files.length} · link ${plan.links.length} rows · merge ${plan.merges.length} · volume rows ${plan.clones.length} · new rows ${plan.creates.length}`);
  for (const m of plan.merges) log(`  merge ${rowDocs.find((r) => r.id === m.keepId)?.label} (+${m.dropIds.length})`);
  for (const c of plan.clones) log(`  volume row: ${c.label}`);
  for (const c of plan.creates) log(`  new row: ${c.label}${c.author ? ` — ${c.author}` : ""} (${c.fileIds.length} file)`);
  if (dryRun) return;

  // Files › Books
  const filesFolder = await Folder.findOne({ gridId, name: "Files", "meta.protected": true }).lean();
  if (!filesFolder) throw new Error("0401: no protected Files folder");
  let booksFolder = await Folder.findOne({ gridId, name: "Books", parentId: filesFolder.id }).lean();
  if (!booksFolder) {
    booksFolder = { id: crypto.randomUUID(), userId, gridId, name: "Books", parentId: filesFolder.id, sortOrder: 9, isExpanded: false, folderType: "normal", meta: {} };
    await Folder.create(booksFolder);
  }

  // The Files binding on the book modules (role "files" — the row's attachments).
  for (const m of bookMods) {
    if ((m.fieldBindings || []).some((b) => b.fieldId === F.files)) continue;
    const order = Math.max(0, ...(m.fieldBindings || []).map((b) => b.order || 0)) + 1;
    await Module.updateOne({ id: m.id }, { $push: { fieldBindings: { fieldId: F.files, role: "files", hidden: true, order } } });
  }

  // One artifact per file (found again by fileRef).
  const artOccByFile = new Map();
  for (const f of files) {
    const fileRef = `gdrive:${connectionId}:${f.id}`;
    let mod = await Module.findOne({ gridId, fileRef }).lean();
    if (!mod) {
      mod = { id: crypto.randomUUID(), userId, gridId, role: "artifact", kind: kindOf(f.name), label: fileTitle(f.name), fileRef,
        defaultDragMode: "copy", fieldBindings: [],
        meta: { mimeType: mimeOf(f), originalName: f.name, uploadSize: f.size, uploadStatus: "ready", folderId: booksFolder.id, source: "drive-books" } };
      await Module.create(mod);
    }
    let occ = await Occurrence.findOne({ gridId, moduleId: mod.id }).lean();
    if (!occ) {
      occ = { id: crypto.randomUUID(), userId, gridId, moduleId: mod.id, targetId: mod.id, targetType: "module", parentId: booksFolder.id, fields: {}, occurrences: [] };
      await Occurrence.create(occ);
    }
    artOccByFile.set(f.id, occ.id);
  }
  const attach = (fields, fileIds) => {
    const cell = fields?.[F.files] && typeof fields[F.files] === "object" ? fields[F.files] : {};
    const value = [...new Set([...(Array.isArray(cell.value) ? cell.value : []), ...fileIds.map((x) => artOccByFile.get(x))])];
    return { ...fields, [F.files]: { ...cell, value, flow: "replace", main: cell.main && value.includes(cell.main) ? cell.main : value[0] } };
  };

  // Merges first (the kept row is the one that gets the file).
  const allOccs = plan.merges.length ? await Occurrence.find({ gridId }, { id: 1, occurrences: 1, fields: 1 }).lean() : [];
  for (const { keepId, dropIds } of plan.merges) {
    const group = rowDocs.filter((r) => r.id === keepId || dropIds.includes(r.id));
    if (group.length < 2) continue;
    const keep = pickKeeper(group); const drops = group.filter((r) => r.id !== keep.id);
    await Occurrence.updateOne({ id: keep.id }, { $set: { fields: mergeFields(keep, drops), meta: mergeMeta(keep, drops) } });
    log(`  merged ${drops.length} into "${keep.label}"`);
    for (const d of drops) {
      const refs = allOccs.filter((r) => r.id !== d.id && ((r.occurrences || []).includes(d.id)
        || Object.values(r.fields || {}).some((c) => c?.value === d.id || (Array.isArray(c?.value) && c.value.includes(d.id)))));
      for (const r of refs) {
        const upd = {};
        if ((r.occurrences || []).includes(d.id)) upd.occurrences = r.occurrences.filter((x) => x !== d.id);
        let touched = false; const nf = {};
        for (const [k, c] of Object.entries(r.fields || {})) {
          const v = c?.value;
          if (v === d.id) { nf[k] = { ...c, value: keep.id }; touched = true; }
          else if (Array.isArray(v) && v.includes(d.id)) { nf[k] = { ...c, value: [...new Set(v.map((x) => (x === d.id ? keep.id : x)))] }; touched = true; }
          else nf[k] = c;
        }
        if (touched) upd.fields = nf;
        if (Object.keys(upd).length) { await Occurrence.updateOne({ id: r.id }, { $set: upd }); Object.assign(r, upd); }
      }
      await Occurrence.deleteOne({ id: d.id });
    }
    // the plan's link names the first candidate; point it at the keeper
    for (const l of plan.links) if (l.rowId === keepId || dropIds.includes(l.rowId)) l.rowId = keep.id;
  }

  // Links (+ relabel the row that keeps volume 1).
  for (const l of plan.links) {
    const row = await Occurrence.findOne({ id: l.rowId }).lean();
    if (!row) continue;
    const set = { fields: attach(row.fields || {}, l.fileIds) };
    if (l.relabel) set.label = l.relabel;
    await Occurrence.updateOne({ id: row.id }, { $set: set });
  }

  const sizeLabel = (ids) => `${(ids.reduce((n, x) => n + Number(files.find((f) => f.id === x)?.size || 0), 0) / 1048576).toFixed(1)} MB`;
  // Volume rows: a copy of the row, placed after it.
  for (const c of plan.clones) {
    const ext = `gdrive-book:${c.fileIds[0]}`;
    if (await Occurrence.findOne({ gridId, "meta.externalId": ext }).lean()) continue;
    const src = await Occurrence.findOne({ id: c.fromRowId }).lean();
    const { _id, __v, ...base } = src;
    const fields = { ...(base.fields || {}) }; delete fields[F.files];
    if (F.size) fields[F.size] = { value: sizeLabel(c.fileIds), flow: "replace" };
    const row = { ...base, id: crypto.randomUUID(), label: c.label, fields: attach(fields, c.fileIds), linkedGroupId: null,
      meta: { ...(base.meta || {}), externalId: ext }, createdAt: new Date(), updatedAt: new Date() };
    await Occurrence.create(row);
    const parent = await Occurrence.findOne({ id: src.parentId }).lean();
    if (parent) {
      const list = (parent.occurrences || []).filter((x) => x !== row.id);
      const at = list.indexOf(src.id); list.splice(at === -1 ? list.length : at + 1, 0, row.id);
      await Occurrence.updateOne({ id: parent.id }, { $set: { occurrences: list } });
    }
  }

  // Author is an occurrence field naming a row on the Authors board — only an existing row is linked.
  const authorRows = await Occurrence.find({ gridId, [`fields.${F.category}.value`]: "bookAuthor", "meta.feedSourceId": null }, { id: 1, label: 1 }).lean();
  const authorByName = new Map(authorRows.map((a) => [norm(a.label), a.id]));
  const authorRowFor = (author) => {
    if (!author) return null;
    for (const part of String(author).split(/\s*&\s*/)) {
      const flipped = part.includes(",") ? part.split(",").map((x) => x.trim()).reverse().join(" ") : part;
      const hit = authorByName.get(norm(part)) || authorByName.get(norm(flipped));
      if (hit) return hit;
    }
    return null;
  };
  // New rows for unmatched files, on the Books board.
  const booksMod = bookMods.filter((m) => m.kind === "book").sort((a, b) => (b.fieldBindings?.length || 0) - (a.fieldBindings?.length || 0))[0];
  const board = rowDocs.find((r) => r.moduleId === booksMod.id)?.parentId;
  const sample = rowDocs.find((r) => r.moduleId === booksMod.id && r.fields?.[F.category]);
  for (const c of plan.creates) {
    const ext = `gdrive-book:${c.fileIds[0]}`;
    if (await Occurrence.findOne({ gridId, "meta.externalId": ext }).lean()) continue;
    const exts = [...new Set(c.fileIds.map((x) => files.find((f) => f.id === x).name.split(".").pop().toLowerCase()))];
    const fields = {};
    if (F.category && sample) fields[F.category] = sample.fields[F.category];
    if (F.owned) fields[F.owned] = { value: true, flow: "replace" };
    if (F.formats) fields[F.formats] = { value: exts.join(", "), flow: "replace" };
    if (F.size) fields[F.size] = { value: sizeLabel(c.fileIds), flow: "replace" };
    const authorId = authorRowFor(c.author);
    if (F.author && authorId) fields[F.author] = { value: authorId, flow: "replace" };
    const row = { id: crypto.randomUUID(), userId, gridId, moduleId: booksMod.id, targetId: booksMod.id, targetType: "module",
      parentId: board, label: c.label, fields: attach(fields, c.fileIds), occurrences: [],
      meta: { externalId: ext, mediaLibraryKey: `book|${norm(c.label).replace(/ /g, "")}`, mediaAuthor: c.author || null } };
    await Occurrence.create(row);
    await Occurrence.updateOne({ id: board }, { $push: { occurrences: row.id } });
  }
  log("done. Restart the server (pm2).");
}
