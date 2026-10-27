// vr/officeState.js — what the headset draws, as plain data: the shelves (with each one's place in its folders), the
// screens, the decor, the bookmarks bar. Pure — no React, no browser — so the server runs the same code
// (vr/officeCore.js, bundled to server/generated/officeCore.mjs) and the control panel need not load the grid.
import { readOffice } from "./officeConfig.js";
import { shelfItems, folderShelfView, albumShelfItems, musicShelfView } from "./shelfItems.js";
import { occurrenceDisplayLabel } from "../helpers/occurrenceLabel";
import { decorLibrary } from "./decorLibrary.js";
import { sortOrderForDrop, sortOrderAtEnd } from "../helpers/treeOrder.js";

/** How many bookmarks a browser screen's bar shows (the board's first ones — a new one goes to the top). */
export const BOOKMARK_BAR_MAX = 40;

/** The Bookmarks board's container (the one named Bookmarks holding the most bookmarks), or null. Pure. */
export function findBookmarksBoard({ occurrencesById, modulesById }) {
  let best = null; let bestCount = -1;
  for (const occ of Object.values(occurrencesById || {})) {
    const mod = modulesById?.[occ?.moduleId];
    if (mod?.role !== "container" || (occ.label || mod.label) !== "Bookmarks") continue;
    const count = (occ.occurrences || []).filter((id) => modulesById?.[occurrencesById[id]?.moduleId]?.kind === "bookmark").length;
    if (count > bestCount) { best = occ; bestCount = count; }
  }
  return best;
}

/** The bookmarks bar: the bookmarks saved from a browser screen's ☆ (`meta.browserBar`), newest first, as
 *  { title, url }. Not the whole board — the user: "i dont need all my bookmarks on the browser screen, just the new
 *  ones i add". Pure. */
export function bookmarkBar({ occurrencesById, modulesById }) {
  const board = findBookmarksBoard({ occurrencesById, modulesById });
  const out = [];
  for (const id of board?.occurrences || []) {
    const occ = occurrencesById[id]; const mod = modulesById?.[occ?.moduleId];
    if (mod?.kind !== "bookmark" || !occ.meta?.browserBar) continue;
    const url = occ.meta?.url || mod.fileRef;
    if (!url) continue;
    out.push({ title: (occ.label || mod.label || url).slice(0, 60), url });
    if (out.length >= BOOKMARK_BAR_MAX) break;
  }
  return out;
}

/** What the headset draws, as plain data. Pure, so it can be tested. */
export function nativeOfficeState({ grid, occurrencesById, modulesById, foldersById, shelfAt = {}, origin = "" }, pageLabel = null) {
  // A screen's page is named the way the panel names it: the page's own label, else its module's.
  pageLabel = pageLabel || ((id) => { const o = occurrencesById?.[id]; return o ? (o.label || modulesById?.[o.moduleId]?.label || "Page") : null; });
  const office = readOffice(grid);
  const ctx = { grid, occurrencesById, modulesById, foldersById };
  const wire = (i) => ({
    id: i.id, rowId: i.rowId || null, title: i.title, cover: i.cover, src: i.src || null, kind: i.fileKind || null,
    url: i.url || null, folder: !!i.folder, count: i.count || 0, spotify: i.spotify || null,
    album: !!i.album, mini: !!i.mini,
  });
  return {
    type: "state",
    gridId: String(grid?._id || grid?.id || ""),
    origin,
    shelves: office.shelves.map((s) => {
      // An album opened on this shelf ("album:<row>|<where the shelf was>"): its songs as mini records, ⬆ goes back.
      const at = shelfAt[s.id];
      if (typeof at === "string" && at.startsWith("album:")) {
        const albumId = at.slice(6).split("|")[0];
        const album = occurrencesById?.[albumId];
        const title = album ? (occurrenceDisplayLabel(album, modulesById?.[album.moduleId]) || "Album") : "Album";
        // Its songs A–Z on the shelf (the record player still plays them in track order).
        const songs = albumShelfItems(albumId, ctx).sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
        const prev = at.split("|")[1] || "";
        const artist = prev.startsWith("artist:") ? [prev.slice(7)] : [];
        return { id: s.id, title: s.title, asset: s.asset, items: songs.map(wire), path: [s.title, ...artist, title], canUp: true };
      }
      if (s.folderId) {
        // A folder shelf is a tree in the headset: its subfolders are books you open (and come back up from).
        const v = folderShelfView(s.folderId, shelfAt[s.id], { ...ctx, asset: s.asset });
        // `folderable`: a new folder can be made where the shelf stands (its ＋📁 button).
        return { id: s.id, title: s.title, asset: s.asset, items: v.items.map(wire), path: v.path.map((p) => p.title), canUp: v.canUp, folderable: true };
      }
      if (s.asset === "record") {
        // A record crate is artists → albums → songs, A–Z.
        const v = musicShelfView(s, at, ctx);
        return { id: s.id, title: s.title, asset: s.asset, items: v.items.map(wire), path: v.path, canUp: v.canUp };
      }
      return { id: s.id, title: s.title, asset: s.asset, items: shelfItems(s, ctx).map(wire), path: [], canUp: false };
    }),
    screens: office.screens.map((s) => ({
      id: s.id, source: s.source, pageOccId: s.pageOccId || null,
      label: s.source === "grid" ? "The grid" : (s.pageOccId ? pageLabel(s.pageOccId) || "Missing page" : "No page chosen"),
    })),
    decor: decorLibrary({ grid, occurrencesById, modulesById }).map((d) => ({ key: d.key, title: d.title, src: d.src || null })),
    layout: grid?.meta?.vrLayout || null,
    bookmarks: bookmarkBar({ occurrencesById, modulesById }),
  };
}

/** The Day Page in use: a page named "Day Page" that is not inside the Templates folder. Pure. */
export function findDayPage({ occurrencesById, modulesById, foldersById } = {}) {
  const inTemplates = (folderId) => {
    let f = foldersById?.[folderId]; let n = 0;
    while (f && n++ < 30) { if (f.name === "Templates") return true; f = foldersById?.[f.parentId]; }
    return false;
  };
  for (const occ of Object.values(occurrencesById || {})) {
    const mod = modulesById?.[occ?.moduleId];
    if (mod?.role !== "page" || (occ.label || mod.label) !== "Day Page") continue;
    if (occ.parentId && inTemplates(occ.parentId)) continue;
    return occ.id;
  }
  return null;
}

/** The Notes folder (the one inside Documents when there are several), or null. Pure. */
export function findNotesFolder(foldersById) {
  const all = Object.values(foldersById || {});
  const notes = all.filter((f) => f?.name === "Notes");
  return (notes.find((f) => foldersById[f.parentId]?.name === "Documents") || notes[0] || null)?.id || null;
}


/**
 * A book let go on its folder shelf: before / after another book (the file tree's order), or onto a folder book
 * (filed inside it). The page moves as [{ id, folder, sortOrder }], in order. Ties (pages never ordered are all 0)
 * are numbered in the order shown first, or a midpoint lands nowhere. Pure.
 */
export function planShelfReorder({ shelf, at, id, targetId, edge }, { occurrencesById, modulesById, foldersById }) {
  if (!shelf?.folderId || !occurrencesById?.[id]) return [];
  const ctx = { occurrencesById, modulesById, foldersById, asset: shelf.asset };
  const here = folderShelfView(shelf.folderId, at, ctx).at || shelf.folderId;
  const pagesIn = (folderId) => Object.values(occurrencesById).filter((o) => o?.parentId === folderId && o.id !== id
    && ["page", "artifact"].includes(modulesById?.[o.moduleId]?.role) && modulesById?.[o.moduleId]?.kind !== "folder");
  // Let go on the shelf but on no book: filed where the shelf stands now (a folder opened while carrying it).
  if (edge === "end") return [{ id, folder: here, sortOrder: sortOrderAtEnd(pagesIn(here)) }];
  if (String(targetId || "").startsWith("folder:")) {
    const dest = String(targetId).slice(7);
    return [{ id, folder: dest, sortOrder: sortOrderAtEnd(pagesIn(dest)) }];
  }
  const moves = [];
  const title = (o) => (o.label || modulesById?.[o.moduleId]?.label || "");
  let sibs = pagesIn(here).sort((a, b) => ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || title(a).localeCompare(title(b)));
  if (new Set(sibs.map((o) => o.sortOrder ?? 0)).size < sibs.length) {
    sibs = sibs.map((o, i) => { moves.push({ id: o.id, folder: here, sortOrder: i }); return { ...o, sortOrder: i }; });
  }
  moves.push({ id, folder: here, sortOrder: sortOrderForDrop(sibs, targetId, edge === "before" ? "top" : "bottom", id) });
  return moves;
}

/**
 * A folder book carried on its shelf: into another folder book (`edge` "into"), or let go anywhere else on the shelf
 * (it goes into the folder the shelf stands in — folders sit by name, so there is no position to keep). Returns the
 * folder with its new parent, or null for no move (same place, into itself or a folder inside it, outside the shelf).
 * Pure.
 */
export function planFolderMove({ shelf, at, id, targetId, edge }, { occurrencesById, modulesById, foldersById }) {
  const folderId = String(id || "").replace(/^folder:/, "");
  const folder = foldersById?.[folderId];
  if (!shelf?.folderId || !folder) return null;
  const here = folderShelfView(shelf.folderId, at, { occurrencesById, modulesById, foldersById, asset: shelf.asset }).at || shelf.folderId;
  const dest = edge === "into" && String(targetId || "").startsWith("folder:") ? String(targetId).slice(7) : here;
  if (!foldersById?.[dest] || dest === folder.parentId) return null;
  for (let f = dest, n = 0; f && n < 64; n++, f = foldersById?.[f]?.parentId) if (f === folderId) return null;
  return { ...folder, parentId: dest };
}
