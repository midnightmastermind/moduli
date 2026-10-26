// 0436 — the links in the Codex's bookmark LISTS become bookmarks on the Bookmarks board (user, 2026-10-26: "add those
// bookmarks to our bookmark board" → "Bookmark lists only"): the "… Bookmark Notes" pages and the two "bookmarks"
// pages under Documents/Archive/Codex/environment/bookmarks. Not the saved articles in that folder — their links are
// references inside the article, not things the user bookmarked.
//
// Each link is a bookmark row in the shape the board already holds (an artifact/bookmark module pointing at the URL,
// an occurrence listed by the board): named by its link text, else by its address. A URL already bookmarked anywhere
// on the grid, or already added by this migration, is skipped. meta.source = "codex-bookmark-lists" and
// meta.sourceNote = the page it came from, so the batch can be found (or removed) later.
import { randomUUID } from "node:crypto";
import { decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0436-codex-bookmark-lists-to-board";
export const describe = "Adds the links in the Codex's '… Bookmark Notes' / 'bookmarks' pages to the Bookmarks board as bookmark rows (skips URLs already bookmarked). Deletes nothing.";
export const touches = ["modules", "occurrences"];

const BOARD = "870qduan9r";
const LIST_PAGE = /bookmark notes$|^bookmarks( 1)?$/i;

/** Every link in a textmap, with the words it is on: marks first, then bare URLs in the text. Pure. */
export function linksIn(doc) {
  const out = [];
  const walk = (n, words) => {
    if (!n) return;
    if (n.type === "text") {
      const href = (n.marks || []).find((m) => m.type === "link" && m.attrs?.href)?.attrs.href;
      if (href) out.push({ url: href, text: n.text || "" });
      else for (const u of String(n.text || "").match(/https?:\/\/[^\s)\]>"'<]+/g) || []) out.push({ url: u, text: "" });
      return;
    }
    for (const c of n.content || []) walk(c, words);
  };
  walk(doc);
  return out;
}

/** The address as a bookmark keys it: trailing punctuation off, no trailing slash. Pure. */
export const urlKey = (u) => String(u || "").trim().replace(/[.,;:!]+$/, "").replace(/\/$/, "");

/** A bookmark's name: its link text when that says something, else host + path. Pure. */
export function bookmarkLabel(url, text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t && !/^https?:\/\//i.test(t) && t.length > 2) return t.slice(0, 200);
  try { const u = new URL(url); return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "")).slice(0, 200); } catch { return String(url).slice(0, 200); }
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Folder, Grid } = models;
  const grid = await Grid.findById(gridId).lean();
  const userId = String(grid.userId);
  const board = await Occurrence.findOne({ gridId, id: BOARD }).lean();
  if (!board) { log("  REFUSED: the Bookmarks board is not on this grid"); throw new Error("no board"); }
  const folders = await Folder.find({ gridId }).lean();
  const byId = new Map(folders.map((f) => [f.id, f]));
  const pathOf = (fid) => { const p = []; let f = byId.get(fid); while (f) { p.unshift(f.name); f = byId.get(f.parentId); } return p.join("/"); };
  const root = folders.find((f) => f.name === "bookmarks" && /Codex\/environment\/bookmarks$/.test(pathOf(f.id)));
  if (!root) { log("  REFUSED: no Codex/environment/bookmarks folder"); throw new Error("no folder"); }
  const under = new Set([root.id]);
  for (let grew = true; grew;) { grew = false; for (const f of folders) if (under.has(f.parentId) && !under.has(f.id)) { under.add(f.id); grew = true; } }

  const pages = await Occurrence.find({ gridId, parentId: { $in: [...under] } }).lean();
  const pageMods = new Map((await Module.find({ gridId, id: { $in: pages.map((p) => p.moduleId) } }).lean()).map((m) => [m.id, m]));
  const listPages = pages.filter((p) => { const m = pageMods.get(p.moduleId); return m?.kind !== "folder" && LIST_PAGE.test((p.label || m?.label || "").trim()); });

  const have = new Set((await Module.find({ gridId, kind: "bookmark" }).select("fileRef").lean()).map((m) => urlKey(m.fileRef)));
  const plan = [];
  for (const p of listPages) {
    const note = p.label || pageMods.get(p.moduleId)?.label || "Bookmarks";
    // The page and everything in it.
    const seen = new Set(); const stack = [p.id];
    while (stack.length) {
      const oid = stack.pop(); if (seen.has(oid)) continue; seen.add(oid);
      const o = await Occurrence.findOne({ gridId, id: oid }).select("textmap occurrences meta").lean();
      if (!o) continue;
      if (o.textmap) { let tm; try { tm = decompressTextmap(o.textmap); } catch { tm = null; }
        for (const l of linksIn(tm)) {
          const k = urlKey(l.url); if (!/^https?:\/\//i.test(k) || have.has(k)) continue;
          have.add(k); plan.push({ url: k, label: bookmarkLabel(k, l.text), note });
        } }
      const chip = o.meta?.link?.url || o.meta?.link?.href;
      if (chip) { const k = urlKey(chip); if (/^https?:\/\//i.test(k) && !have.has(k)) { have.add(k); plan.push({ url: k, label: bookmarkLabel(k, ""), note }); } }
      for (const k of o.occurrences || []) stack.push(k);
    }
  }
  const perNote = {}; for (const b of plan) perNote[b.note] = (perNote[b.note] || 0) + 1;
  log(`  ${listPages.length} bookmark-list pages · ${plan.length} new bookmarks`);
  for (const [n, c] of Object.entries(perNote)) log(`    ${String(c).padStart(4)}  ${n}`);
  log(`  e.g. ${plan.slice(0, 5).map((b) => `"${b.label}"`).join(", ")}`);
  if (dryRun || !plan.length) return;

  const now = new Date();
  const mods = [], occs = [];
  for (const b of plan) {
    const mid = randomUUID(), oid = randomUUID();
    mods.push({ id: mid, userId, gridId, role: "artifact", kind: "bookmark", label: b.label, fileRef: b.url, meta: { external: true }, createdAt: now, updatedAt: now });
    occs.push({ id: oid, userId, gridId, moduleId: mid, parentId: BOARD, label: b.label, fields: {}, occurrences: [], hidden: false,
      meta: { url: b.url, source: "codex-bookmark-lists", sourceNote: b.note, externalId: `codex-bookmark:${b.url}` }, createdAt: now, updatedAt: now });
  }
  await Module.insertMany(mods);
  await Occurrence.insertMany(occs);
  await Occurrence.updateOne({ gridId, id: BOARD }, { $push: { occurrences: { $each: occs.map((o) => o.id) } }, $set: { updatedAt: now } });
  log(`  applied: ${occs.length} bookmarks on the board. RESTART pm2.`);
}
