// server/services/shareStageFiles.js
//
// A shared FILE, parked with its stage (user, 2026-09-30: "i dont want anything
// going through auto unless i express that in the dropdown (so images, other
// things, etc, not just links)"). A stage used to hold JSON only, so a photo
// shared from the phone skipped the placement window and went straight through
// the rules. Now its bytes wait here until Clip is pressed.
//
// NOT under uploads/: that folder is served statically, and a parked file is
// nobody's yet — it is read back only through the stage KEY
// (GET /share/stage/:id/file). Swept once its stage can no longer be used.
import fs from "node:fs";
import path from "node:path";
import { STAGE_TTL_MS } from "./shareStage.js";

export const STAGE_FILES_DIR = path.join(import.meta.dirname, "..", "share-stage");
// The stage dies at STAGE_TTL_MS; a little longer so a Clip pressed in the last
// second still finds its file.
const KEEP_MS = STAGE_TTL_MS + 5 * 60 * 1000;

/** Move multer's upload into the stage folder; the descriptor rides in the payload. */
export function parkStagedFile(file, { dir = STAGE_FILES_DIR } = {}) {
  if (!file?.path) return null;
  fs.mkdirSync(dir, { recursive: true });
  const filename = file.filename || path.basename(file.path);
  const dest = path.join(dir, filename);
  fs.renameSync(file.path, dest);
  return { path: dest, filename, originalname: file.originalname || filename, mimetype: file.mimetype || "application/octet-stream", size: file.size ?? null };
}

/** The payload as the WINDOW may see it: never a server path. */
export function publicStagePayload(payload = {}) {
  if (!payload?.file) return payload;
  const { path: _p, ...file } = payload.file;
  return { ...payload, file };
}

/** The parked file as the share handler's `firstFile`, or null when it is gone. */
export function stagedFileForShare(payload = {}) {
  const f = payload?.file;
  if (!f?.path || !fs.existsSync(f.path)) return null;
  return { path: f.path, filename: f.filename, originalname: f.originalname, mimetype: f.mimetype, size: f.size };
}

/** Delete parked files older than any stage that could still use them. */
export function sweepStagedFiles({ dir = STAGE_FILES_DIR, now = Date.now() } = {}) {
  let removed = 0;
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return 0; }
  for (const n of names) {
    const p = path.join(dir, n);
    try {
      if (now - fs.statSync(p).mtimeMs > KEEP_MS) { fs.unlinkSync(p); removed++; }
    } catch { /* raced with a commit — fine */ }
  }
  return removed;
}
