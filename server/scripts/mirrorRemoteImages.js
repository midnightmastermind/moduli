// scripts/mirrorRemoteImages.js
//
// Walks every artifact Module whose `fileRef` is an absolute URL
// (http/https), downloads the bytes into local `uploads/user/YYYY-MM/`,
// recomputes SHA-256, dedups against existing local modules, and
// rewrites `Module.fileRef` to the local path. Idempotent: rerun-safe
// (modules already mirrored carry `meta.external: false` and are skipped).
//
// Files/audit docket §8 gap #22. Wikipedia / external-source artifacts
// currently hotlink — if the source URL 404s the image disappears. This
// converts them to first-class local artifacts that share the dedup /
// shard / cleanup machinery with drag-drop uploads.
//
// Usage:
//   node --env-file=.env server/scripts/mirrorRemoteImages.js                  # dry-run
//   node --env-file=.env server/scripts/mirrorRemoteImages.js --apply          # actually download + rewrite
//   node --env-file=.env server/scripts/mirrorRemoteImages.js --apply --max=10 # cap how many to mirror
//
// Safety:
//   - 25MB per-file cap (skips with warning above that)
//   - 30s per-request timeout
//   - 250ms inter-request delay (polite to source servers)
//   - Atomic-ish: file write happens first; DB update only after file is on disk.
//     Failed downloads leave the Module's fileRef untouched.

import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import Module from "../models/Module.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.resolve(__dirname, "..", "uploads");

const args = new Set(process.argv.slice(2));
const maxArg = process.argv.find(a => a.startsWith("--max="));
const MAX = maxArg ? Number(maxArg.split("=")[1]) : Infinity;
const DO_APPLY = args.has("--apply");

const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const POLITE_DELAY_MS = 250;

if (!process.env.MONGO_URI) {
  console.error("MONGO_URI missing. Run with `node --env-file=.env ...`");
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI);

// Mirror server.js's yearMonthShard — local copy so the script has no
// dependency on importing the running server.
function yearMonthShard(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// Pick a sensible filename + extension from the URL + content-type.
// Prefer URL-path extension because Wikipedia URLs encode it cleanly;
// fall back to a content-type lookup for image/jpeg etc.
const MIME_EXT = {
  "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png",
  "image/gif": ".gif", "image/webp": ".webp", "image/svg+xml": ".svg",
  "video/mp4": ".mp4", "video/webm": ".webm",
  "audio/mpeg": ".mp3", "audio/ogg": ".ogg", "audio/wav": ".wav",
  "application/pdf": ".pdf",
};
function pickExtension(url, contentType) {
  try {
    const u = new URL(url);
    const fromPath = path.extname(u.pathname);
    if (fromPath && fromPath.length <= 6) return fromPath.toLowerCase();
  } catch { /* ignore */ }
  const ct = (contentType || "").split(";")[0].trim().toLowerCase();
  return MIME_EXT[ct] || ".bin";
}

async function downloadToFile(url, destPath) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": "Moduli-Mirror/1.0 (admin script)" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const lenHeader = Number(res.headers.get("content-length") || "0");
    if (lenHeader > MAX_BYTES) throw new Error(`Content-Length ${lenHeader} > ${MAX_BYTES}`);
    const ct = res.headers.get("content-type") || "";
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) throw new Error(`Body bytes ${buf.byteLength} > ${MAX_BYTES}`);
    fs.writeFileSync(destPath, buf);
    const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
    return { bytes: buf.byteLength, sha256, contentType: ct };
  } finally {
    clearTimeout(timer);
  }
}

const remoteMods = await Module.find({
  role: "artifact",
  fileRef: { $regex: /^https?:\/\//i },
  $or: [{ "meta.external": { $ne: false } }, { "meta.external": { $exists: false } }],
}).lean();

console.log(`Remote artifact modules:                    ${remoteMods.length}`);
console.log(`Per-file cap:                               ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB`);
console.log(`Mode:                                       ${DO_APPLY ? "APPLY" : "dry-run"}${MAX < Infinity ? `  (max ${MAX})` : ""}\n`);

let mirrored = 0;
let dedupHits = 0;
let skipped = 0;
let failed = 0;
let bytesDownloaded = 0;

for (const mod of remoteMods) {
  if (mirrored + dedupHits + failed >= MAX) break;
  const url = mod.fileRef;

  if (!DO_APPLY) {
    console.log(`  [plan]    ${mod.id.slice(0, 8)}…  ${url}`);
    continue;
  }

  const shard = yearMonthShard();
  const subdir = path.join(uploadsDir, "user", shard);
  fs.mkdirSync(subdir, { recursive: true });

  // Use a probe filename for the initial write; if dedup-against-existing
  // hits we delete it and reuse the existing fileRef. If we keep it, we
  // rename to match the server's `${ts}-${rnd}.<ext>` convention so the
  // file aligns with everything else.
  const tmpName = `mirror-tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tmpPath = path.join(subdir, tmpName);

  try {
    const { bytes, sha256, contentType } = await downloadToFile(url, tmpPath);
    bytesDownloaded += bytes;

    // Dedup against any existing local module for this user with same sha.
    // (Future uploads of this same image — drag-drop OR mirror — already
    // route through the dedup branch in /api/artifacts/upload; this lookup
    // is the migration-time equivalent.)
    const dedup = await Module.findOne({
      userId: mod.userId,
      role: "artifact",
      "meta.sha256": sha256,
      fileRef: { $not: /^(https?:|data:|blob:)/i },
    }).select("id fileRef").lean();

    if (dedup) {
      fs.unlinkSync(tmpPath);
      await Module.updateOne(
        { id: mod.id },
        {
          $set: {
            fileRef: dedup.fileRef,
            "meta.external": false,
            "meta.sha256": sha256,
            "meta.mirroredFromUrl": url,
            "meta.dedupTargetId": dedup.id,
          },
        }
      );
      console.log(`  [dedup]   ${mod.id.slice(0, 8)}… → ${dedup.fileRef}  (${(bytes / 1024).toFixed(1)} KB downloaded, then dropped)`);
      dedupHits++;
    } else {
      const ext = pickExtension(url, contentType);
      const finalName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      const finalPath = path.join(subdir, finalName);
      fs.renameSync(tmpPath, finalPath);
      const newRef = `user/${shard}/${finalName}`;
      await Module.updateOne(
        { id: mod.id },
        {
          $set: {
            fileRef: newRef,
            "meta.external": false,
            "meta.sha256": sha256,
            "meta.uploadSize": bytes,
            "meta.mimeType": (contentType || "").split(";")[0].trim() || mod.meta?.mimeType || null,
            "meta.mirroredFromUrl": url,
          },
        }
      );
      console.log(`  [mirror]  ${mod.id.slice(0, 8)}… → ${newRef}  (${(bytes / 1024).toFixed(1)} KB)`);
      mirrored++;
    }
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    console.log(`  [fail]    ${mod.id.slice(0, 8)}…  ${url}  — ${err.message}`);
    failed++;
  }

  if (POLITE_DELAY_MS > 0) await new Promise(r => setTimeout(r, POLITE_DELAY_MS));
}

const fmtMB = (b) => `${(b / 1024 / 1024).toFixed(2)} MB`;
console.log("");
console.log(`Mirrored (new local file):                  ${mirrored}`);
console.log(`Dedup hits (linked to existing local):      ${dedupHits}`);
console.log(`Failed:                                     ${failed}`);
console.log(`Skipped (already mirrored / out of scope):  ${skipped}`);
console.log(`Total bytes downloaded:                     ${fmtMB(bytesDownloaded)}`);
if (!DO_APPLY && remoteMods.length > 0) {
  console.log(`\nRe-run with --apply to mirror ${Math.min(remoteMods.length, MAX === Infinity ? remoteMods.length : MAX)} module(s).`);
}

await mongoose.disconnect();
