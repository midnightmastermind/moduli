// A link that points straight at a media FILE (…/photo.jpg, …/clip.webm, …/doc.pdf) can be filed as
// an artifact that shows the file itself, not as a bookmark to a page. The artifact's fileRef IS the
// URL and `meta.external` says nothing was uploaded — the shape poms' Files/Examples samples carry and
// `resolveFileRef` already serves (an absolute URL passes through).
//
// Decided from the URL's PATH extension only: a page that happens to end in ".html" or carries no
// extension is a page, and fetching every pasted link to sniff its content type would be a network
// call per paste for the rare case.
const KINDS = [
  { kind: "image", re: /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i, mime: (e) => `image/${e === "jpg" ? "jpeg" : e === "svg" ? "svg+xml" : e}` },
  { kind: "video", re: /\.(mp4|webm|mov|m4v|ogv)$/i, mime: (e) => (e === "mov" ? "video/quicktime" : e === "ogv" ? "video/ogg" : `video/${e === "m4v" ? "mp4" : e}`) },
  { kind: "audio", re: /\.(mp3|wav|ogg|oga|m4a|flac)$/i, mime: (e) => (e === "mp3" ? "audio/mpeg" : e === "m4a" ? "audio/mp4" : e === "oga" ? "audio/ogg" : `audio/${e}`) },
  { kind: "pdf", re: /\.pdf$/i, mime: () => "application/pdf" },
];

/** { kind, mimeType, fileName } for a direct media URL, else null. */
export function externalFileOf(url) {
  let path;
  try { path = new URL(String(url || "").trim()).pathname; } catch { return null; }
  const fileName = decodeURIComponent(path.split("/").filter(Boolean).pop() || "");
  const ext = (fileName.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  if (!ext) return null;
  const hit = KINDS.find((k) => k.re.test(fileName));
  return hit ? { kind: hit.kind, mimeType: hit.mime(ext), fileName } : null;
}
