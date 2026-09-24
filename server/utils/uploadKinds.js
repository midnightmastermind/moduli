// server/utils/uploadKinds.js
//
// How an uploaded file is classified and where it is stored — shared by
// `server.js`'s upload/import routes and `services/artifactUpload.js`. Moved
// verbatim out of server.js (2026-09-24) so the share path's upload uses the
// same rules.

const CODE_EXTENSIONS = new Set([".js",".jsx",".ts",".tsx",".py",".sh",".bash",".json",".yaml",".yml",".toml",".css",".html",".xml",".sql",".go",".rs",".c",".cpp",".h",".rb",".php",".swift",".kt"]);
const CALENDAR_EXTENSIONS = new Set([".ics", ".ical", ".ifb", ".vcs"]);
export function mimeToKind(mime, filename = "") {
  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  const ext = filename.includes(".") ? "." + filename.split(".").pop().toLowerCase() : "";
  if (CODE_EXTENSIONS.has(ext)) return "code";
  // A calendar file is data, not a note: as "markdown" it opened in the note
  // editor, which runs its lines together, and saving there would rewrite the
  // invite. The code viewer shows it read-only, exactly as sent (2026-09-24).
  if (mime === "text/calendar" || CALENDAR_EXTENSIONS.has(ext)) return "code";
  return "markdown";
}
// Derives the panel-display View fields from the artifact module's kind.
// Keeps the existing artifact-panel path working: drag artifact onto empty grid cell
// → View is consulted for rendering. In containers, ArtifactCard reads `kind` directly.
export function viewFieldsForKind(kind) {
  if (["image", "video", "audio", "pdf"].includes(kind)) return { viewType: "display", artifactType: kind };
  if (kind === "code") return { viewType: "code", artifactType: null };
  return { viewType: "markdown", artifactType: null };
}

// Year-month upload sharding (files/artifact audit gap #18). New uploads
// land in `uploads/user/YYYY-MM/` so the leaf directory listing stays
// manageable over long horizons. Existing flat files keep working since
// `resolveFileRef` and the Express static mount both serve nested paths
// — see `scripts/shardExistingUploads.js` for the one-off migration.
export function yearMonthShard(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
