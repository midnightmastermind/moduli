// vr/shelfItems.js — what a shelf holds: its saved query, answered by the same
// code an occurrence feed uses (`resolveFeedItems`), turned into the things the
// VR office draws. Pure; no copies are made.
//
// Each item: { id, rowId, title, cover, fileId, fileKind }
//   rowId   the occurrence the query matched
//   id      what pointing at it opens: the row's readable/playable file when it
//           has one of the shelf's kind, else the row itself
//   cover   a picture url for the sleeve / spine / case, or null
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

export function shelfItems(shelf, { grid, occurrencesById, modulesById } = {}) {
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
    if (mod?.role === "artifact" && wanted.includes(mod.kind)) file = { id: occ.id, kind: mod.kind };
    else {
      const f = filesOf(occ, ctx).find((e) => wanted.includes(e.kind));
      if (f) file = { id: f.occ.id, kind: f.kind };
    }
    out.push({
      id: file?.id || occ.id,
      rowId: occ.id,
      title,
      cover: coverUrl(occ, mod, primaryMediaOf(occ, ctx)),
      fileId: file?.id || null,
      fileKind: file?.kind || null,
    });
  }
  return out;
}
