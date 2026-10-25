/**
 * 0432 — codex pages that are database ENTRIES, not notes, become one list per group; the pages go.
 *
 * User, 2026-10-24: "go through the codex and only keep notes, if it looks like nodes like people, books, etc, left
 * over from notion or obsidian, lets delete them" · "we just have alot of images and notes that are entries in a list
 * of some sort". Asked which groups (census 2026-10-24): Inventory rows, Martial arts stubs, Grocery/budget rows,
 * Tiny-home parts — "condense all of these in lists on a doc page"; and delete the pages that hold nothing; keep the
 * day logs (they are notes).
 *
 * An ENTRY is a page in one of GROUPS whose whole text is at most ENTRY_MAX_CHARS and reads as property lines
 * ("Author: Ivan Savov", "Box: On me", "Created: June 12, 2019"). Each group gets ONE page in its folder,
 * "<folder> — list": a doc container with a section per source subfolder and a bullet per entry (title, its
 * properties, its pictures, and "on <board>" when a board row of the same name exists). Then the entry pages go, with
 * the doc containers and blocks under them. An EMPTY page (no text, no picture, nothing under its container) goes too,
 * anywhere in the codex. Re-runnable: a group whose list page exists is not listed twice (the entries are already
 * gone by then).
 */
import { decompressTextmap, compressTextmap } from "../utils/textmapCompression.js";

export const id = "0432-codex-entries-to-lists";
export const describe = "Condense codex database-entry pages into one list page per group and delete them (and empty pages).";
export const touches = ["occurrences", "modules"];

export const GROUPS = ["environment/inventory", "interests/martial_arts", "financials/go_through", "interests/tiny_home"];
export const ENTRY_MAX_CHARS = 260;

const textOf = (n) => (!n ? "" : (n.text || "") + (n.content || []).map(textOf).join(n.type === "doc" || n.type === "bulletList" ? "\n" : ""));
const imagesOf = (n, out = []) => { if (!n) return out; if (n.type === "image" && n.attrs?.src) out.push(n); for (const k of n.content || []) imagesOf(k, out); return out; };

/** The lines of a note's text (one per block). Pure. */
export function noteLines(doc) {
  const lines = [];
  const walk = (n) => {
    if (!n) return;
    if (["paragraph", "heading", "codeBlock"].includes(n.type)) { const t = textOf(n).replace(/\s+/g, " ").trim(); if (t) lines.push(t); return; }
    for (const k of n.content || []) walk(k);
  };
  walk(doc);
  return lines;
}

/** "properties" | "created-only" | "empty" | null — what kind of non-note a page's text is. Pure. */
export function classifyEntry(lines, { images = 0, hasChildren = false } = {}) {
  const text = lines.join(" ").trim();
  if (!text) return images || hasChildren ? null : "empty";
  if (text.length > ENTRY_MAX_CHARS) return null;
  if (/^Created: \w+ \d{1,2}, \d{4}/.test(text) && text.length < 40) return "created-only";
  const keys = (text.match(/(?:^|\s)([A-Z#][\w&()'’/-]{0,24}(?: [A-Z0-9][\w&()'’/-]{0,20}){0,2}|\d+):\s/g) || []).length;
  const words = text.split(/\s+/).length;
  if (keys >= 1 && /^([A-Z#][\w #&()'’/-]{0,30}|\d+): /.test(text) && keys * 6 >= words) return "properties";
  return null;
}

/** Which group a codex path belongs to, and its subsection (the folders under the group). Pure. */
export function groupOf(relPath) {
  const dir = String(relPath || "").split("/").slice(0, -1).join("/");
  for (const g of GROUPS) if (dir === g || dir.startsWith(g + "/")) return { group: g, section: dir.slice(g.length + 1) };
  return null;
}

/** The list doc for one group: a heading per section and a bullet per entry. Pure. */
export function listDoc(title, entries) {
  const bySection = new Map();
  for (const e of entries) { const k = e.section || ""; if (!bySection.has(k)) bySection.set(k, []); bySection.get(k).push(e); }
  const content = [{ type: "paragraph", content: [{ type: "text", text: `${entries.length} entries condensed from the codex (one page each before).` }] }];
  for (const [section, list] of [...bySection.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (section) content.push({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: section.split("/").join(" › ") }] });
    const items = list.sort((a, b) => a.title.localeCompare(b.title)).map((e) => {
      const line = [{ type: "text", text: e.title || "Untitled", marks: [{ type: "bold" }] }];
      const props = e.lines.filter((l) => l !== e.title).join(" · ");
      if (props) line.push({ type: "text", text: " — " + props });
      if (e.board) line.push({ type: "text", text: ` (on ${e.board})`, marks: [{ type: "italic" }] });
      return { type: "listItem", content: [{ type: "paragraph", content: line }, ...e.images] };
    });
    content.push({ type: "bulletList", content: items });
  }
  return { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] }, ...content] };
}

const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Occurrence, Module, Folder } = models;
  const userId = grid?.userId;
  const pages = await Occurrence.find({ gridId, "meta.codexFullPath": { $exists: true } }).lean();
  const docIds = pages.flatMap((p) => p.occurrences || []);
  const docs = new Map((await Occurrence.find({ gridId, id: { $in: docIds } }).lean()).map((d) => [d.id, d]));
  const folders = new Map((await Folder.find({ gridId }).lean()).map((f) => [String(f.id || f._id), f]));

  // Board rows by name (not codex pages), and the board each sits on — so an entry can say where it lives now.
  const codexIds = new Set([...pages.map((p) => p.id), ...docIds]);
  const allOccs = await Occurrence.find({ gridId }, { id: 1, label: 1, moduleId: 1, parentId: 1 }).lean();
  const occById = new Map(allOccs.map((o) => [o.id, o]));
  const mods = new Map((await Module.find({ gridId }, { id: 1, label: 1, role: 1 }).lean()).map((m) => [m.id, m]));
  const boardOf = new Map();
  for (const o of allOccs) {
    if (codexIds.has(o.id)) continue;
    const m = mods.get(o.moduleId); if (!m || !["instance", "artifact"].includes(m.role)) continue;
    const t = norm(o.label || m.label); if (t.length < 3 || boardOf.has(t)) continue;
    const parent = occById.get(o.parentId);
    const pl = parent && (parent.label || mods.get(parent.moduleId)?.label);
    if (pl) boardOf.set(t, pl);
  }

  const groups = new Map(); // group -> { folderId, entries: [] }
  const doomed = []; // page ids
  let empty = 0;
  for (const p of pages) {
    const doc = docs.get((p.occurrences || [])[0]);
    let tm = doc?.textmap; try { tm = decompressTextmap(tm); } catch { /* raw */ }
    const lines = noteLines(tm);
    const images = imagesOf(tm);
    const kind = classifyEntry(lines, { images: images.length, hasChildren: (doc?.occurrences || []).length > 0 || (p.occurrences || []).length > 1 });
    if (!kind) continue;
    if (kind === "empty") { doomed.push(p); empty++; continue; }
    const g = groupOf(p.meta.codexFullPath);
    if (!g) continue;
    const title = p.label || mods.get(p.moduleId)?.label || "Untitled";
    if (!groups.has(g.group)) groups.set(g.group, { folderId: null, entries: [] });
    const G = groups.get(g.group);
    // The list page goes in the group's own folder: the shallowest folder an entry of it sits in.
    const depth = (fid) => { let n = 0; for (let f = folders.get(fid); f && n < 40; f = folders.get(String(f.parentId))) n++; return n; };
    if (!G.folderId || depth(p.parentId) < depth(G.folderId)) G.folderId = p.parentId;
    G.entries.push({ title, lines: kind === "created-only" ? [] : lines, images, section: g.section, board: boardOf.get(norm(title)) || null });
    doomed.push(p);
  }

  const rows = [...groups.entries()].map(([g, G]) => ({ group: g, entries: G.entries.length, onBoards: G.entries.filter((e) => e.board).length, folder: folders.get(G.folderId)?.name }));
  console.table(rows);
  log(`  entry pages ${doomed.length - empty} in ${groups.size} groups · empty pages ${empty} · pages kept ${pages.length - doomed.length}`);

  // What goes: each doomed page, its doc container(s), and everything listed under them that nothing else lists.
  const listedBy = new Map();
  for (const o of await Occurrence.find({ gridId, occurrences: { $exists: true, $ne: [] } }, { id: 1, occurrences: 1 }).lean()) {
    for (const k of o.occurrences) { if (!listedBy.has(k)) listedBy.set(k, []); listedBy.get(k).push(o.id); }
  }
  const gone = new Set(doomed.map((p) => p.id));
  let frontier = doomed.flatMap((p) => p.occurrences || []);
  while (frontier.length) {
    const next = [];
    const batch = await Occurrence.find({ gridId, id: { $in: frontier } }, { id: 1, occurrences: 1 }).lean();
    for (const o of batch) {
      if (gone.has(o.id)) continue;
      if ((listedBy.get(o.id) || []).some((l) => !gone.has(l))) continue; // listed somewhere that stays
      gone.add(o.id); next.push(...(o.occurrences || []));
    }
    frontier = next;
  }
  const goneOccs = await Occurrence.find({ gridId, id: { $in: [...gone] } }, { id: 1, moduleId: 1 }).lean();
  const goneMods = new Set(goneOccs.map((o) => o.moduleId).filter(Boolean));
  // A module still placed elsewhere stays.
  for (const o of await Occurrence.find({ gridId, moduleId: { $in: [...goneMods] }, id: { $nin: [...gone] } }, { moduleId: 1 }).lean()) goneMods.delete(o.moduleId);
  log(`  rows to delete: ${gone.size} occurrences, ${goneMods.size} modules · list pages to make: ${groups.size}`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  for (const [g, G] of groups) {
    const fname = folders.get(G.folderId)?.name || g.split("/").pop();
    const title = `${fname} — list`;
    if (await Occurrence.findOne({ gridId, "meta.codexEntryList": g }).lean()) { log(`  ${g}: list page exists, not made again`); continue; }
    const pageMod = uid(); const pageOcc = uid(); const docMod = uid(); const docOcc = uid();
    await Module.insertMany([
      { id: pageMod, userId, gridId, role: "page", kind: "board", label: title, meta: {} },
      { id: docMod, userId, gridId, role: "container", kind: "doc", label: title, meta: { headingLevel: 1 } },
    ]);
    await Occurrence.insertMany([
      { id: pageOcc, userId, gridId, moduleId: pageMod, targetId: pageMod, targetType: "module", parentId: G.folderId,
        occurrences: [docOcc], iteration: { mode: "persistent" }, fields: {}, sortOrder: -0.5, meta: { codexEntryList: g } },
      { id: docOcc, userId, gridId, moduleId: docMod, targetId: docMod, targetType: "module", parentId: pageOcc,
        occurrences: [], iteration: { mode: "persistent" }, fields: {}, meta: {}, textmap: compressTextmap(listDoc(title, G.entries)) },
    ]);
    log(`  ${g}: "${title}" with ${G.entries.length} entries`);
  }
  await Occurrence.updateMany({ gridId, occurrences: { $in: [...gone] } }, { $pull: { occurrences: { $in: [...gone] } } });
  const d1 = await Occurrence.deleteMany({ gridId, id: { $in: [...gone] } });
  const d2 = await Module.deleteMany({ gridId, id: { $in: [...goneMods] } });
  log(`  deleted ${d1.deletedCount} occurrences, ${d2.deletedCount} modules. Restart the server (warm cache).`);
}
