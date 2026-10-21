// client/src/helpers/fileKind.js
// Mirrors server/utils/uploadKinds.js mimeToKind. Keep these in sync if the server changes.

const CODE_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".py", ".sh", ".bash",
  ".json", ".yaml", ".yml", ".toml",
  ".css", ".html", ".xml", ".sql",
  ".go", ".rs", ".c", ".cpp", ".h",
  ".rb", ".php", ".swift", ".kt",
]);

// Mirrors server/utils/uploadKinds.js EBOOK_*: a book file opens in the book reader.
const EBOOK_EXTENSIONS = new Set([".epub", ".mobi", ".azw", ".azw3", ".kf8"]);
const EBOOK_MIMES = new Set(["application/epub+zip", "application/x-mobipocket-ebook", "application/vnd.amazon.ebook", "application/vnd.amazon.mobi8-ebook"]);

// A 3D model (the VR office's decor, user 2026-10-21) — as "markdown" a binary
// .glb would open in the note editor. .glb is one self-contained file.
export const MODEL_EXTENSIONS = new Set([".glb", ".gltf"]);
const MODEL_MIMES = new Set(["model/gltf-binary", "model/gltf+json"]);
export function mimeToKind(mime, filename = "") {
  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  const ext = filename.includes(".") ? "." + filename.split(".").pop().toLowerCase() : "";
  if (EBOOK_MIMES.has(mime) || EBOOK_EXTENSIONS.has(ext)) return "ebook";
  if (MODEL_MIMES.has(mime) || MODEL_EXTENSIONS.has(ext)) return "model";
  if (CODE_EXTENSIONS.has(ext)) return "code";
  return "markdown";
}
