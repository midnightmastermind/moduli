// helpers/fileRef.js
// Resolve an artifact `fileRef` to a renderable src URL.
//
// Backstory: artifact modules have historically stored a path
// relative to the user's upload directory (e.g. "kittens.jpg"),
// and renderers built `src = /uploads/${fileRef}` directly. The
// drag-to-import pipeline (docket #6.5) mints artifact modules
// pointing at REMOTE images (Wikipedia, etc.) — those refs are
// absolute URLs that must NOT be prefixed.
//
// One shared helper avoids the "did I remember to handle absolute
// URLs everywhere?" footgun. The detection is conservative: only
// recognized schemes (http/https/data/blob) and absolute paths
// (leading `/`) pass through; anything else is treated as a
// relative `/uploads/<X>` ref.
//
// Use this everywhere a fileRef is turned into an `<img src>` /
// `<video src>` / `<audio src>` / `<iframe src>` etc.
export function resolveFileRef(fileRef) {
  if (!fileRef) return null;
  if (/^(?:https?:|data:|blob:|\/)/i.test(fileRef)) return fileRef;
  return `/uploads/${fileRef}`;
}
