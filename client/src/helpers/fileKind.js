// client/src/helpers/fileKind.js
// Mirrors server/server.js mimeToKind. Keep these in sync if the server changes.

const CODE_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".py", ".sh", ".bash",
  ".json", ".yaml", ".yml", ".toml",
  ".css", ".html", ".xml", ".sql",
  ".go", ".rs", ".c", ".cpp", ".h",
  ".rb", ".php", ".swift", ".kt",
]);

export function mimeToKind(mime, filename = "") {
  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  const ext = filename.includes(".") ? "." + filename.split(".").pop().toLowerCase() : "";
  if (CODE_EXTENSIONS.has(ext)) return "code";
  return "markdown";
}
