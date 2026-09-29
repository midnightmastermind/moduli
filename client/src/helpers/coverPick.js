// helpers/coverPick.js — "choose a cover" for one placement, in ONE place.
//
// A media instance (a movie, a book, a bookmark) draws its picture from
// `occurrence.meta.cover`. The module is SHARED across rows of a kind (993 movie
// rows, one "Movie" module), so the cover is per PLACEMENT — see ArtifactCard's
// `coverSrc`. Until 2026-09-29 nothing in the app could set it on an instance
// card: an instance that arrived without one (a share of an IMDb link) showed
// its own title where the picture goes, with no way to change it (user:
// "i cant add a new image to it via the share or via the app ui"). Page cards
// had a bare `window.prompt` for a URL.
//
// Both now call `openCoverPicker`, which opens the app's image picker
// (Search / Upload / URL) seeded with the title and a kind hint.
import { openImagePicker } from "../ui/ImagePickerMenu";
import * as CommitHelpers from "./CommitHelpers";

export { coverSearchQuery } from "./coverQuery";
import { coverSearchQuery } from "./coverQuery";

// The meta to write. A url sets the cover; an empty value REMOVES the key
// (a stored null would still read as "has a cover key" to anything that checks
// `"cover" in meta`). Every other key on meta is kept.
export function coverMetaPatch(meta, url) {
  const next = { ...(meta || {}) };
  const clean = typeof url === "string" ? url.trim() : "";
  if (clean) next.cover = clean;
  else delete next.cover;
  return next;
}

// Write the cover through the ONE write path, reading the occurrence's meta at
// WRITE time (`getOccurrence`) — the picker is open for as long as the user
// likes, and a snapshot taken when it opened could overwrite meta that changed
// meanwhile.
export function setCover({ getOccurrence, dispatch, socket }, url) {
  const occ = getOccurrence?.();
  if (!occ?.id) return false;
  CommitHelpers.updateOccurrence({
    dispatch, socket,
    occurrence: { id: occ.id, meta: coverMetaPatch(occ.meta, url) },
    emit: true,
  });
  return true;
}

export function openCoverPicker({ getOccurrence, module, dispatch, socket }) {
  const occ = getOccurrence?.();
  if (!occ?.id) return false;
  const label = (occ.label || module?.label || "").trim();
  openImagePicker({
    query: coverSearchQuery({ label, kind: module?.kind }),
    title: `Cover — ${label || "untitled"}`,
    onPick: (url) => setCover({ getOccurrence, dispatch, socket }, url),
  });
  return true;
}
