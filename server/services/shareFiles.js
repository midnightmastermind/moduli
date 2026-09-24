// server/services/shareFiles.js
//
// A SHARED FILE, stored through the ONE uploader (services/artifactUpload.js)
// before any rule runs (spec §3: "files are uploaded before a rule runs, so a
// rule never handles a binary").
//
// IDEMPOTENT ON THE BYTES (spec §7: `sha256:<hash>`). The upload route makes a
// new placement every time — right for someone uploading on purpose, wrong for
// a share: sharing the same photo twice must not put it in Files twice. So a
// shared file's occurrence is stamped `meta.source: "share"` + its externalId,
// and a re-share of the same bytes on the same grid reuses that row.
import fs from "fs";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import { sha256OfFile } from "./artifactUpload.js";

export async function storeSharedFile({ file, userId, gridId, storeUploadedFile, mirror = null }) {
  const sha256 = await sha256OfFile(file.path);
  const externalId = `sha256:${sha256}`;

  const existing = await Occurrence.findOne({
    userId, gridId, "meta.source": "share", "meta.externalId": externalId,
  }).lean();
  if (existing) {
    try { fs.unlinkSync(file.path); } catch { /* already gone */ }
    const mod = await Module.findOne({ id: existing.moduleId, userId }).lean();
    return { occurrenceId: existing.id, fileRef: mod?.fileRef || null, sha256, reused: true };
  }

  const out = await storeUploadedFile({ file, userId, gridId });
  const meta = { ...(out.occurrence?.meta || {}), source: "share", externalId };
  await Occurrence.updateOne({ id: out.occurrence.id, userId }, { $set: { meta } });
  mirror?.("occurrence", { ...out.occurrence, meta });
  return { occurrenceId: out.occurrence.id, fileRef: out.fileRef, sha256, reused: false };
}
