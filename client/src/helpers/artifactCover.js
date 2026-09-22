// helpers/artifactCover.js
//
// Does a COVER stand in for this kind's own thumbnail?
//
// The rule is one sentence: **a kind that renders its own content never gives
// that up for a cover** — an image is its own picture, and a video/audio/pdf
// each have a real control or preview that a still would replace with something
// less useful. Everything else (a bookmark, an unknown upload) draws 📄 and is
// strictly better off with the cover.
//
// A helper rather than an export of ArtifactCard because the viewer's url-tile
// planner (`spreadBrowser`) asks the same question: when a cover stands in for
// a url-stored file, that url is not what the tile shows, so it is a second
// thing worth a browser of its own.
export function coverAppliesTo(kind, cover) {
  if (!cover) return false;
  return !["image", "video", "audio", "pdf"].includes(kind);
}
