// helpers/spreadBrowser.js
//
// THE VIEWER SHOWS FILES *AND* URLS (user, 2026-09-11: *"if the occurances has
// a url, ... merge the browser occurance in its files (so the viewer can pick
// it up)"*, then *"only merge it into files when its in the viewer (viewer
// shows files and urls)"*).
//
// Two sentences, and the second one is the constraint. The owner's own Files
// FIELD is never written: a row's attachments are what the user attached, and
// silently adding a browser to 6,626 of them would be this app editing the
// user's data to make its own viewer look right. The browser lives on the
// SPREAD PAGE instead — the overlay-only container `ArtifactSpreadHost` mints
// on first open, parented to nothing and listed in no manifest, whose whole
// documented purpose is that *"these pages would exist only in this overlay"*.
//
// So: minted lazily, once, for an occurrence whose viewer you actually open.
// Not 6,626 rows up front.
//
// ── WHY `from` IS THE GATE, AND NOT `hasViewableUrl` ──────────────────────
//
// Measured over the live grid's own 21,415 occurrences through the REAL
// resolver rather than a re-implementation of it:
//
//     8,135 carry a viewable url
//       4,078  song      from:field     a Spotify page  -> a SECOND thing
//       1,467  bookmark  from:field     the article     -> a SECOND thing
//         709  textblock from:link      a link chip     -> a SECOND thing
//         362  album/artist/instance    from:field      -> a SECOND thing
//       1,507  image     from:fileRef   the url IS THE PICTURE
//           2  video/pdf from:fileRef   the url IS THE FILE
//
// An artifact stored BY URL has `fileRef` as its address, so `occurrenceUrl`
// reports it — and framing it would render the very picture the file tile is
// already rendering. That is the duplicate-poster shape `filesOf`'s own header
// warns about, reached from a new direction. `from:"fileRef"` is exactly the
// 1,509 rows where the url is not a destination, and it is already reported,
// so nothing here has to guess.
//
// NOTHING LEARNS WHAT A BOOKMARK IS. The rule is "this row points somewhere
// that is not itself" — `noDomainKnowledge.test.js` fails the build otherwise.
import { occurrenceUrl } from "./occurrenceUrl";

/** The host part of a url, for naming the tile. Falls back to the whole url. */
export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url || ""; }
}

/**
 * The url currently behind a minted browser occurrence. Read from the SAME
 * places `addBookmarkOccurrence` writes it, so "has it drifted" is asked of the
 * thing that was written rather than of a convention.
 */
function urlOfBrowser(occ, modulesById) {
  return occ?.meta?.url || modulesById?.[occ?.moduleId]?.fileRef || null;
}

/**
 * What the spread needs to do about the owner's url.
 *
 * @returns {null | {
 *   url: string, label: string,
 *   mint?: true,            // no browser exists yet
 *   retargetId?: string,    // one exists and points somewhere else
 *   dropId?: string,        // a recorded id whose occurrence is gone
 * }}
 *
 * PURE and exported because mounting the host needs the whole grid store, and
 * because this is the same seam `planSpreadSync` had to be pulled out of after
 * an effect that could not say "nothing left to do" about its own output span
 * forever (React #185, blank app).
 *
 * Its invariant is the same one: **feed the result back in and it must return
 * null.** A mint that keeps reporting "mint" is an unbounded row factory.
 */
export function planSpreadBrowser({
  owner, module = null, fieldsById = {}, spreadOcc = null,
  occurrencesById = {}, modulesById = {},
} = {}) {
  const hit = owner ? occurrenceUrl(owner, { module, fieldsById }) : null;

  // The url IS the file — see the header. Nothing to add.
  if (!hit || hit.from === "fileRef") return null;

  const url = hit.url;
  const label = hostOf(url) || "Browser";

  const recordedId = spreadOcc?.meta?.browserOccId || null;
  const existing = recordedId ? occurrencesById?.[recordedId] : null;

  // Recorded, but the occurrence is gone — deleted from the spread, or swept.
  // Minting a replacement WITHOUT saying so would leave the dead id listed in
  // the page: the dangling-child-ref class this repo has swept five times.
  if (recordedId && !existing) return { url, label, mint: true, dropId: recordedId };

  if (!existing) return { url, label, mint: true };

  // The owner's url can be edited — a Place's Website, a bookmark's address.
  // A tile still pointing at the old one is wrong data, not merely stale.
  return urlOfBrowser(existing, modulesById) === url
    ? null
    : { url, label, retargetId: recordedId };
}
