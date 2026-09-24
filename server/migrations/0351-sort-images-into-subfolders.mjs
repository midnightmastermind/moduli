// server/migrations/0351-sort-images-into-subfolders.mjs
//
// Sort Files/Images into subfolders by what USES each image (user, 2026-09-24:
// "organize the files folder a little bit more like images/import images/people
// images/ingrediants … like images/books" — "put imports in the imports folder").
//
//   Files/Images/Books        a book's cover
//   Files/Images/People       a person's photo
//   Files/Images/Ingredients  an ingredient's picture
//   …one per Board Category (or Library) value that references images
//   Imports                   a picture an importer pulled out of an article
//   Files/Images              everything else stays where it is
//
// ── HOW AN IMAGE IS CLASSIFIED ─────────────────────────────────────────────
// 1. BY ITS REFERRERS. An image is used through a FIELD value on another row
//    (Poster / Files / a media binding) — 0051 measured 213 of poms grid's
//    images this way. Each referrer votes with its own `Board Category`
//    (else `Library`) value; most votes wins, ties alphabetical. Every string in
//    the referrer's field values is scanned, so a Files value with a `main`
//    counts too.
// 2. ELSE, AN IMPORT: embedded (a textmap `moduleEmbed`) in some document AND
//    its file is a remote URL. The importers never upload — they point at the
//    article's own image — while an image the user dropped into a doc is an
//    upload with a local or Drive ref, so it is left alone.
// 3. ELSE it stays in Files/Images.
//
// ── WHAT IT CANNOT BREAK ───────────────────────────────────────────────────
// It only rewrites `parentId` on occurrences whose parentId IS the Images
// folder, and only ever to a folder. Placements (a parent listing the image in
// its `occurrences[]`) and textmap embeds resolve by id and are untouched, so
// every picture keeps rendering where it did. `filesFolderIdSet` now covers the
// whole Files tree (same commit), so a file in Files/Images/Books is still "in
// Files" and removing it from a page unlinks that placement instead of deleting
// the file. The Imports folder is outside Files; the client already treats any
// folder-homed file as a placement there (ArtifactCard), so removing an import
// image from its article unlinks it the same way.
//
// Idempotent: a moved image no longer has the Images folder as its parent, so a
// re-run matches only what is still there; folders are found before created.
// The warm cache is authoritative for reads — restart pm2 after --apply.

import { FILES_FOLDER_NAME, IMPORTS_FOLDER_NAME } from "../utils/protectedFolders.js";
import { decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0351-sort-images-into-subfolders";
export const describe = "Moves images in Files/Images into subfolders by what uses them (Books, People, Ingredients, …) and imported article images into Imports. Only parentId changes; nothing is deleted.";
export const touches = ["occurrences", "folders"];

const IRREGULAR = {
  person: "People", people: "People", "tv show": "TV Shows", grocery: "Groceries",
  media: "Media", music: "Music",
};

/** "book" → "Books", "person" → "People", "tv show" → "TV Shows". */
export function categoryFolderName(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return null;
  if (IRREGULAR[v]) return IRREGULAR[v];
  const title = v.split(/\s+/).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
  if (/s$/i.test(title)) return title;
  if (/[^aeiou]y$/i.test(title)) return title.slice(0, -1) + "ies";
  return title + "s";
}

const readValue = (occ, fieldId) => {
  const v = fieldId ? occ?.fields?.[fieldId] : undefined;
  return v && typeof v === "object" && !Array.isArray(v) && "value" in v ? v.value : v;
};
const firstString = (v) => (Array.isArray(v) ? v.find(x => typeof x === "string" && x) : (typeof v === "string" ? v : null)) || null;

/** Every string anywhere in a field-value tree (bounded). */
function collectStrings(v, out, depth = 0) {
  if (depth > 4 || v == null) return;
  if (typeof v === "string") { out.add(v); return; }
  if (Array.isArray(v)) { for (const x of v) collectStrings(x, out, depth + 1); return; }
  if (typeof v === "object") for (const x of Object.values(v)) collectStrings(x, out, depth + 1);
}

function collectEmbeds(node, out, depth = 0) {
  if (!node || depth > 60) return;
  if (node.type === "moduleEmbed" && node.attrs?.occurrenceId) out.add(node.attrs.occurrenceId);
  if (Array.isArray(node.content)) for (const c of node.content) collectEmbeds(c, out, depth + 1);
}

const isRemote = (ref) => /^https?:\/\//i.test(String(ref || ""));

/**
 * PURE — the whole risk of this migration is the classification.
 * @returns {{ moves: Array<{occId, label, to: {kind:"category", name} | {kind:"imports"}}>, stay: number }}
 */
export function planImageSort({ occurrences, modulesById, imagesFolderId, boardCategoryFieldId, libraryFieldId, embeddedIds }) {
  const candidates = occurrences.filter(o =>
    o.parentId === imagesFolderId && modulesById.get(o.moduleId)?.role === "artifact");
  const candidateIds = new Set(candidates.map(o => o.id));

  // artifact occ id → Map<categoryValue, votes>
  const votes = new Map();
  for (const o of occurrences) {
    if (candidateIds.has(o.id)) continue;
    const category = firstString(readValue(o, boardCategoryFieldId)) || firstString(readValue(o, libraryFieldId));
    if (!category) continue;
    const strings = new Set();
    for (const v of Object.values(o.fields || {})) collectStrings(v, strings);
    for (const s of strings) {
      if (!candidateIds.has(s)) continue;
      if (!votes.has(s)) votes.set(s, new Map());
      const m = votes.get(s);
      m.set(category, (m.get(category) || 0) + 1);
    }
  }

  const moves = [];
  let stay = 0;
  for (const o of candidates) {
    const mod = modulesById.get(o.moduleId);
    const label = o.label || mod?.label || o.id;
    const v = votes.get(o.id);
    if (v && v.size) {
      const [winner] = [...v.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
      const name = categoryFolderName(winner[0]);
      if (name) { moves.push({ occId: o.id, label, to: { kind: "category", name } }); continue; }
    }
    if (embeddedIds.has(o.id) && isRemote(mod?.fileRef)) {
      moves.push({ occId: o.id, label, to: { kind: "imports" } });
      continue;
    }
    stay += 1;
  }
  return { moves, stay };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Manifest, Folder, Module, Occurrence, Field } = models;
  const manifest = await Manifest.findOne({ gridId, manifestType: "user" }).lean();
  if (!manifest?.rootFolderId) { log("no user manifest — nothing to do"); return; }
  const userId = manifest.userId;
  const rootId = manifest.rootFolderId;

  const folders = await Folder.find({ gridId, userId }).lean();
  const files = folders.find(f => f.parentId === rootId && f.name === FILES_FOLDER_NAME);
  const images = files && folders.find(f => f.parentId === files.id && f.name === "Images");
  if (!images) { log("no Files/Images folder — nothing to do"); return; }
  const imports = folders.find(f => f.parentId === rootId && f.name === IMPORTS_FOLDER_NAME);

  const fields = await Field.find({ gridId }).lean();
  const byName = (name) => {
    const hits = fields.filter(f => (f.name || "").toLowerCase() === name.toLowerCase() && f.type === "select");
    return hits.length === 1 ? hits[0].id : null;          // ambiguous → not used
  };
  const boardCategoryFieldId = byName("Board Category");
  const libraryFieldId = byName("Library");
  log(`Board Category field: ${boardCategoryFieldId ? "found" : "NOT found"} · Library field: ${libraryFieldId ? "found" : "not found"}`);

  const mods = await Module.find({ gridId }).lean();
  const modulesById = new Map(mods.map(m => [m.id, m]));
  const occs = await Occurrence.find({ gridId }).lean();

  const embeddedIds = new Set();
  for (const o of occs) {
    if (!o.textmap) continue;
    let tm = o.textmap;
    try { tm = decompressTextmap(tm); } catch { continue; }
    collectEmbeds(tm, embeddedIds);
  }

  const { moves, stay } = planImageSort({
    occurrences: occs, modulesById, imagesFolderId: images.id,
    boardCategoryFieldId, libraryFieldId, embeddedIds,
  });

  const byTarget = new Map();
  for (const m of moves) {
    const key = m.to.kind === "imports" ? `${IMPORTS_FOLDER_NAME} (root)` : `Files/Images/${m.to.name}`;
    if (!byTarget.has(key)) byTarget.set(key, []);
    byTarget.get(key).push(m.label);
  }
  log(`${moves.length} image(s) to move, ${stay} stay in Files/Images:`);
  for (const [key, labels] of [...byTarget.entries()].sort()) {
    log(`   ${key}: ${labels.length}  — ${labels.slice(0, 6).join(" | ")}${labels.length > 6 ? " …" : ""}`);
  }
  if (moves.some(m => m.to.kind === "imports") && !imports) {
    log("   ! no root Imports folder — import images will STAY in Files/Images");
  }
  if (dryRun) { log("DRY RUN — nothing written"); return; }

  const uid = () => globalThis.crypto?.randomUUID?.() || `fld-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const subIds = new Map();
  let order = 0;
  for (const name of [...new Set(moves.filter(m => m.to.kind === "category").map(m => m.to.name))].sort()) {
    const found = folders.find(f => f.parentId === images.id && f.name === name);
    if (found) { subIds.set(name, found.id); continue; }
    const doc = { id: uid(), userId, gridId, parentId: images.id, name, folderType: "normal", sortOrder: order++, meta: {} };
    await Folder.create(doc);
    subIds.set(name, doc.id);
    log(`CREATE folder Files/Images/${name}`);
  }

  let moved = 0;
  for (const m of moves) {
    const target = m.to.kind === "imports" ? imports?.id : subIds.get(m.to.name);
    if (!target) continue;
    // Guarded on the CURRENT parent, so a row the user moved since the read is left alone.
    const r = await Occurrence.updateOne({ id: m.occId, parentId: images.id }, { $set: { parentId: target } });
    moved += r.modifiedCount || 0;
  }
  log(`moved ${moved} image(s). Restart the server (pm2) so the warm cache serves the new folders.`);
}
