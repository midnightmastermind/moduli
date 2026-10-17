// 0412 — audio / video files put in Drive's "Moduli uploads" folder become file occurrences.
//
// User, 2026-10-17: *"i added a test video file and mp3 file to moduli uploads. could you put them into the app
// as file occurances so i can test those out"*. Each audio/video/image file sitting DIRECTLY in the connection's
// upload folder (not its subfolders: Books, the YYYY-MM upload shards) gets what an upload gets — an artifact
// module (`gdrive:<conn>:<fileId>`, kind from its mime), a display View, an occurrence homed in Files/<kind>.
// A file already some module points at is skipped, so a re-run only adds new ones. The file stays where it is.
// Reads the Drive listing live (needs SECRETS_KEY, i.e. run on prod); file names stay out of git.

import crypto from "node:crypto";
import Connection from "../models/Connection.js";
import { decryptCipherShape } from "../models/Secret.js";
import { refreshAccessToken } from "../services/googleOAuth.js";
import { mimeToKind, viewFieldsForKind } from "../utils/uploadKinds.js";
import { filesSubfolderForKind } from "../utils/filesFolder.js";

export const id = "0412-drive-media-files";
export const describe = "Audio/video/image files in Drive's Moduli uploads folder become file occurrences in Files/<kind>.";
export const touches = ["modules", "occurrences", "views"];

const MEDIA = new Set(["audio", "video", "image"]);

/** PURE. Which Drive files to add: media kinds only, not already referenced. */
export function planMediaFiles(files, { connectionId, existingRefs }) {
  return files
    .filter((f) => f.mimeType !== "application/vnd.google-apps.folder")
    .map((f) => ({ ...f, kind: mimeToKind(f.mimeType, f.name), fileRef: `gdrive:${connectionId}:${f.id}` }))
    .filter((f) => MEDIA.has(f.kind) && !existingRefs.has(f.fileRef));
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Folder, Grid, View } = models;
  const gid = String(gridId);
  const grid = await Grid.findById(gid).lean();
  const userId = String(grid.userId);
  const conn = await Connection.findOne({ userId, type: "gdrive" }).sort({ updatedAt: -1 }).lean();
  if (!conn?.config?.folderId) throw new Error("0412: no Google Drive connection with an upload folder");
  const token = (await refreshAccessToken(decryptCipherShape(conn.credentials))).accessToken;
  const q = encodeURIComponent(`'${conn.config.folderId}' in parents and trashed = false`);
  const res = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,size,mimeType)&pageSize=200`, { headers: { Authorization: `Bearer ${token}` } })).json();
  if (res.error) throw new Error(`0412: Drive listing failed: ${res.error.message}`);
  const existingRefs = new Set((await Module.find({ gridId: gid, fileRef: /^gdrive:/ }, { fileRef: 1 }).lean()).map((m) => m.fileRef));
  const plan = planMediaFiles(res.files || [], { connectionId: conn.id, existingRefs });

  const files = await Folder.findOne({ gridId: gid, name: "Files", "meta.protected": true }).lean();
  if (!files) throw new Error("0412: no protected Files folder");
  const homeOf = async (kind) => (await Folder.findOne({ gridId: gid, parentId: files.id, name: filesSubfolderForKind(kind) }).lean())?.id || files.id;
  for (const f of plan) log(`  + ${f.kind} ${f.name} (${Math.round((f.size || 0) / 1e6)} MB)`);
  log(`${plan.length} file(s) to add`);
  if (dryRun) return;

  for (const f of plan) {
    const home = await homeOf(f.kind);
    const modId = crypto.randomUUID(); const occId = crypto.randomUUID(); const viewId = crypto.randomUUID();
    await Module.create({ id: modId, userId, gridId: gid, role: "artifact", kind: f.kind, label: f.name, fileRef: f.fileRef,
      defaultDragMode: "copy", fieldBindings: [],
      meta: { mimeType: f.mimeType, originalName: f.name, uploadSize: Number(f.size) || null, uploadStatus: "ready", folderId: home, source: "drive-media" } });
    await View.create({ id: viewId, userId, gridId: gid, ...viewFieldsForKind(f.kind), layout: {} });
    await Occurrence.create({ id: occId, userId, gridId: gid, moduleId: modId, targetId: modId, targetType: "module", parentId: home, viewId, fields: {}, occurrences: [] });
  }
  const back = await Module.countDocuments({ gridId: gid, fileRef: { $in: plan.map((f) => f.fileRef) } });
  log(`written; ${back}/${plan.length} read back. Restart the server (pm2).`);
}
