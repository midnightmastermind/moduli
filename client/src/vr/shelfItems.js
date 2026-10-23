// vr/shelfItems.js — what a shelf holds: its saved query, answered by the same
// code an occurrence feed uses (`resolveFeedItems`), turned into the things the
// VR office draws. Pure; no copies are made.
//
// Each item: { id, rowId, title, cover, fileId, fileKind, src }
//   rowId   the occurrence the query matched
//   id      what pointing at it opens: the row's readable/playable file when it
//           has one of the shelf's kind, else the row itself
//   cover   a picture url for the sleeve / spine / case, or null
//   src     the readable/playable file's url (a record player plays it, a VHS player runs it on a screen), or null
import { resolveFeedItems } from "../state/selectors";
import { filesOf, primaryMediaOf } from "../helpers/occurrenceMedia";
import { occurrenceDisplayLabel } from "../helpers/occurrenceLabel";
import { resolveFileRef } from "../helpers/fileRef";

// Which file kinds an asset can use (the reader for books, the player for
// records and tapes — plan §3-§5).
export const FILE_KINDS_FOR_ASSET = {
  book: ["pdf", "ebook"],
  record: ["audio"],
  vhs: ["video"],
};

function coverUrl(occ, mod, media) {
  if (media?.src && (media.kind === "image" || !media.kind)) return media.src;
  for (const c of [occ?.meta?.cover, mod?.meta?.cover]) {
    if (typeof c === "string" && c) return resolveFileRef(c);
    if (c && typeof c === "object" && typeof c.url === "string") return resolveFileRef(c.url);
  }
  return null;
}

/** Every folder under `rootId` (itself included). */
function folderTree(rootId, foldersById) {
  const kids = new Map();
  for (const f of Object.values(foldersById || {})) {
    if (!f?.parentId) continue;
    if (!kids.has(f.parentId)) kids.set(f.parentId, []);
    kids.get(f.parentId).push(f.id);
  }
  const out = new Set([rootId]);
  const stack = [rootId];
  while (stack.length) for (const k of kids.get(stack.pop()) || []) if (!out.has(k)) { out.add(k); stack.push(k); }
  return out;
}

/**
 * A folder shelf: every page homed in the folder or any folder under it, by title — a doc page is its own book,
 * opened by pointing at it. The folder's own folder page (kind "folder") is not a book. Files of the shelf's kind are
 * on it too (a VHS shelf holds the folder's videos, a record crate its audio), so the players have something to play.
 */
export function folderShelfItems(rootId, { grid, occurrencesById, modulesById, foldersById, asset = "book" } = {}) {
  const fileKinds = FILE_KINDS_FOR_ASSET[asset] || [];
  if (!rootId || !occurrencesById) return [];
  const under = folderTree(rootId, foldersById);
  const gridId = grid?._id || grid?.id || null;
  const out = [];
  for (const occ of Object.values(occurrencesById)) {
    if (!occ?.parentId || !under.has(occ.parentId)) continue;
    if (gridId && occ.gridId && occ.gridId !== gridId) continue;
    const mod = modulesById?.[occ.moduleId];
    const isFile = mod?.role === "artifact" && fileKinds.includes(mod.kind);
    if (!isFile && (mod?.role !== "page" || mod.kind === "folder")) continue;
    const title = (occurrenceDisplayLabel(occ, mod) || mod?.meta?.originalName || "").trim();
    if (!title) continue;
    out.push({
      id: occ.id, rowId: occ.id, title, cover: coverUrl(occ, mod, null),
      fileId: isFile ? occ.id : null, fileKind: isFile ? mod.kind : null,
      src: isFile && mod.fileRef ? resolveFileRef(mod.fileRef) : null,
    });
  }
  // Up to 3,000: a Documents shelf holds the whole codex (~2,500 notes).
  return out.sort((a, b) => a.title.localeCompare(b.title)).slice(0, 3000);
}

export function shelfItems(shelf, { grid, occurrencesById, modulesById, foldersById } = {}) {
  if (shelf?.folderId) return folderShelfItems(shelf.folderId, { grid, occurrencesById, modulesById, foldersById, asset: shelf.asset });
  if (!shelf?.feed || !occurrencesById) return [];
  // A shelf nobody has given a query yet holds NOTHING. A feed with no
  // conditions and no scope means "every row on the grid" (a real feed shape),
  // which on a fresh shelf filled it with 200 random rows (seen in a browser).
  const hasQuery = (Array.isArray(shelf.feed.conditions) && shelf.feed.conditions.length > 0) || !!shelf.feed.scope;
  if (!hasQuery) return [];
  const owner = { id: shelf.id, gridId: grid?._id || grid?.id || null, feed: { ...shelf.feed, enabled: true } };
  const rows = resolveFeedItems(owner, { occurrencesById, modulesById });
  const wanted = FILE_KINDS_FOR_ASSET[shelf.asset] || [];
  const ctx = { occurrencesById, modulesById };
  const out = [];
  for (const { occurrence: occ, module } of rows) {
    const mod = module || modulesById?.[occ.moduleId];
    const title = (occurrenceDisplayLabel(occ, mod) || mod?.meta?.originalName || "").trim();
    if (!title) continue;
    let file = null;
    if (mod?.role === "artifact" && wanted.includes(mod.kind)) file = { id: occ.id, kind: mod.kind, ref: mod.fileRef };
    else {
      const f = filesOf(occ, ctx).find((e) => wanted.includes(e.kind));
      if (f) file = { id: f.occ.id, kind: f.kind, ref: modulesById?.[f.occ.moduleId]?.fileRef };
    }
    out.push({
      id: file?.id || occ.id,
      rowId: occ.id,
      title,
      cover: coverUrl(occ, mod, primaryMediaOf(occ, ctx)),
      fileId: file?.id || null,
      fileKind: file?.kind || null,
      src: file?.ref ? resolveFileRef(file.ref) : null,
    });
  }
  return out;
}
