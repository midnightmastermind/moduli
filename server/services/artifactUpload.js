// server/services/artifactUpload.js
//
// THE ONE WAY A FILE BECOMES AN ARTIFACT (Module + Occurrence + View).
//
// Moved VERBATIM out of `server.js`'s `POST /api/artifacts/upload` so the share
// route (`POST /api/v1/share`) uploads a shared photo/video/file through the
// SAME code — content-hash dedup, year-month sharding, EXIF, thumbnails, the
// Files/<kind> home folder, the warm-cache mirror and the broadcasts — rather
// than a second uploader (share plan, Global Constraints: "neither router may
// own a handler"). Only the request/response edges changed: `req.file` is
// `file`, and the JSON the route used to send is RETURNED (plus `sha256`,
// which the share path keys a re-share on).
//
// Dependencies the upload needs from the server's closure (the uploads dir,
// the warm-cache peek, the home-folder rule, sockets) are injected by
// `makeArtifactUploader`, so this module has no import-time side effects.
import path from "path";
import fs from "fs";
import crypto from "crypto";
import ExifReader from "exifreader";
import sharp from "sharp";
import { nanoid } from "nanoid";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import View from "../models/View.js";
import { mimeToKind, viewFieldsForKind } from "../utils/uploadKinds.js";
import { makeStorageRegistry } from "./storage/index.js";

// SHA-256 content hash for upload dedup (files/artifact audit gap #3). Streamed
// so 50MB uploads don't load into RAM. Returns a 64-char hex string.
export function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

// EXIF + dimensions for image uploads (files audit gap #12). Returns
// `{ width, height, exif }` or null on any failure — the upload itself
// shouldn't fail just because metadata extraction did. Reads the full
// file into a Buffer (capped at 50MB by multer; ExifReader's parser
// only inspects header bytes regardless of total size). Sanitizes EXIF
// to plain `{ tagName: description }` so Mongo can persist it under
// Module.meta.exif without nested-object headaches.
const EXIF_INTEREST = [
  "DateTimeOriginal", "DateTime", "CreateDate",
  "Make", "Model", "LensModel",
  "FNumber", "ExposureTime", "ISOSpeedRatings", "FocalLength",
  "Orientation",
  "GPSLatitude", "GPSLongitude", "GPSAltitude",
];
export function extractImageMetadata(filePath, mimeType) {
  if (!mimeType?.startsWith("image/")) return null;
  try {
    const buffer = fs.readFileSync(filePath);
    const tags = ExifReader.load(buffer, { expanded: false });
    const out = {};
    // ExifReader keys are tag names; values shape `{description, value}`.
    for (const key of EXIF_INTEREST) {
      const t = tags[key];
      if (t && (t.description != null || t.value != null)) {
        out[key] = t.description ?? (Array.isArray(t.value) ? t.value.join(",") : String(t.value));
      }
    }
    // Width / height live on different tags depending on the format.
    // Prefer `Image Width` / `Image Height` (JPEG/TIFF), fall back to
    // PixelXDimension / PixelYDimension (EXIF block), then `ImageWidth`.
    const width = Number(
      tags["Image Width"]?.value ?? tags["PixelXDimension"]?.value ?? tags["ImageWidth"]?.value ?? NaN
    );
    const height = Number(
      tags["Image Height"]?.value ?? tags["PixelYDimension"]?.value ?? tags["ImageHeight"]?.value ?? NaN
    );
    return {
      width: Number.isFinite(width) ? width : null,
      height: Number.isFinite(height) ? height : null,
      exif: Object.keys(out).length ? out : null,
    };
  } catch {
    return null;
  }
}

export function makeArtifactUploader({ uploadsDir, routeCache, homeFolderForUpload, io, userRoom, storage = null }) {
  // WHERE the bytes go is the storage registry's decision (services/storage);
  // everything below it — hash, dedup, EXIF, thumbnails, records — is backend-blind.
  const registry = storage || makeStorageRegistry({ uploadsDir });
  const urlForRef = (ref) => registry.backendForRef(ref)?.urlFor(ref) ?? `/uploads/${ref}`;
  // Image thumbnails via sharp (files audit gap #4). Writes
  // `<sha256>-256.webp` + `<sha256>-1024.webp` into uploads/thumbnails/.
  // WebP for compression (~30% smaller than JPEG at comparable quality).
  // Idempotent: if a thumb already exists for this sha (dedup hit /
  // re-mirror / rerun), skip the regeneration. Returns `{ thumb256, thumb1024 }`
  // as POSIX-style relative refs (resolvable via `/uploads/<ref>`), or null
  // when the source isn't a supportable image. SVG / GIF / non-image types
  // return null — sharp's raster pipeline doesn't preserve their semantics.
  const THUMB_SUPPORTED = /^image\/(jpeg|jpg|png|webp|tiff|avif|heic|heif)$/i;
  async function generateImageThumbnails(srcPath, sha256, mimeType) {
    if (!sha256 || !mimeType || !THUMB_SUPPORTED.test(mimeType)) return null;
    const ref256 = `thumbnails/${sha256}-256.webp`;
    const ref1024 = `thumbnails/${sha256}-1024.webp`;
    const path256 = path.join(uploadsDir, ref256);
    const path1024 = path.join(uploadsDir, ref1024);
    const need256 = !fs.existsSync(path256);
    const need1024 = !fs.existsSync(path1024);
    if (!need256 && !need1024) return { thumb256: ref256, thumb1024: ref1024 };
    try {
      if (need256) {
        // `withoutEnlargement` keeps tiny source images at their native size
        // instead of upscaling. quality 78 is the sweet-spot for thumbnails.
        await sharp(srcPath).rotate().resize({ width: 256, withoutEnlargement: true }).webp({ quality: 78 }).toFile(path256);
      }
      if (need1024) {
        await sharp(srcPath).rotate().resize({ width: 1024, withoutEnlargement: true }).webp({ quality: 82 }).toFile(path1024);
      }
      return { thumb256: ref256, thumb1024: ref1024 };
    } catch {
      // Cleanup any partially-written file so a future retry isn't blocked.
      try { if (need256 && fs.existsSync(path256)) fs.unlinkSync(path256); } catch { /* ignore */ }
      try { if (need1024 && fs.existsSync(path1024)) fs.unlinkSync(path1024); } catch { /* ignore */ }
      return null;
    }
  }

  /**
   * Store one uploaded file (a multer file: { path, originalname, mimetype, size })
   * as an artifact. Returns { module, occurrence, fileRef, url, dedup?, sha256 }.
   * The temp file at `file.path` is moved (or removed, on a dedup hit).
   */
  async function storeUploadedFile({
    file, userId, gridId, parentFolderId, manifestId,
    moduleId: moduleIdIn = null, occurrenceId: occurrenceIdIn = null,
  }) {
    if (!userId || !file) throw new Error("Missing userId or file");
    // Use supplied IDs if present (optimistic flow), otherwise generate fresh ones.
    const moduleId = moduleIdIn || nanoid();
    const occurrenceId = occurrenceIdIn || nanoid();

    // ── Content-hash dedup (files audit gap #3) ──
    // Compute SHA-256 BEFORE the rename so we can short-circuit the file
    // move + new-module mint when the user already has an artifact module
    // for this exact bytes. External-URL fileRefs (Wikipedia drops etc.)
    // are filtered out — they can't dedup against local uploads.
    const sha256 = await sha256OfFile(file.path);
    const dedupCandidate = await Module.findOne({
      userId,
      role: "artifact",
      "meta.sha256": sha256,
      fileRef: { $not: /^(https?:|data:|blob:)/i },
    }).lean();

    if (dedupCandidate && dedupCandidate.id !== moduleId) {
      // Dedup hit: skip the file write, reuse the existing module.
      // Tear down the multer temp file (rename never happened).
      try { fs.unlinkSync(file.path); } catch { /* ignore */ }

      // If the optimistic flow already inserted a placeholder Module
      // (via the `create_module` socket emit that fires alongside the
      // /api/artifacts/upload call), strip it now — the occurrence is
      // about to re-point at the dedup candidate's module.
      const placeholderMod = await Module.findOne({ id: moduleId, userId });
      if (placeholderMod) {
        await Module.deleteOne({ id: moduleId });
        const cache = routeCache(userId, gridId);
        if (cache) delete cache.modulesById[moduleId];
        io.to(userRoom(userId)).emit("module_deleted", moduleId);
      }

      // Wire (or rewire) the occurrence to point at the existing module.
      const existingOcc = await Occurrence.findOne({ id: occurrenceId });
      const occDoc = existingOcc
        ? { ...existingOcc.toObject(), moduleId: dedupCandidate.id }
        : {
            id: occurrenceId, userId, gridId: gridId || null,
            moduleId: dedupCandidate.id,
            // Kind comes from the module we deduped ONTO — the bytes are the
            // same file, so it belongs in the same subfolder as the original.
            parentId: await homeFolderForUpload({
              userId, gridId, parentFolderId, kind: dedupCandidate.kind,
            }),
            textmap: null,
          };
      if (!existingOcc) {
        // Reuse a single View per module-kind for the new occurrence so
        // the artifact-panel display path still works (same shape the
        // non-dedup branch emits below).
        const { viewType, artifactType } = viewFieldsForKind(dedupCandidate.kind);
        const artifactViewId = nanoid();
        const artifactView = new View({ id: artifactViewId, userId, gridId: gridId || null, viewType, artifactType, layout: {} });
        await artifactView.save();
        occDoc.viewId = artifactViewId;
      }
      await Occurrence.findOneAndUpdate({ id: occurrenceId }, occDoc, { upsert: true });

      const occObj = await Occurrence.findOne({ id: occurrenceId }).lean();
      const cache = routeCache(userId, gridId);
      if (cache) cache.occurrencesById[occObj.id] = occObj;
      if (existingOcc) {
        io.to(userRoom(userId)).emit("occurrence_updated", occObj);
      } else {
        io.to(userRoom(userId)).emit("occurrence_created", occObj);
      }
      io.to(userRoom(userId)).emit("artifact_created", { moduleId: dedupCandidate.id, occurrenceId, fileRef: dedupCandidate.fileRef });
      return { sha256,
        module: dedupCandidate,
        occurrence: occObj,
        fileRef: dedupCandidate.fileRef,
        url: urlForRef(dedupCandidate.fileRef),
        dedup: true,
      };
    }

    const kind = mimeToKind(file.mimetype, file.originalname);
    const { viewType, artifactType } = viewFieldsForKind(kind);

    // Metadata and thumbnails are read from the TEMP file, before the bytes go
    // to their backend — a remote backend (Drive) leaves nothing local to read.
    // EXIF + dimensions (audit gap #12) and sha256-keyed thumbnails (gap #4);
    // thumbnails always stay on the server (small, and they make grids load fast).
    const imageMeta = extractImageMetadata(file.path, file.mimetype);
    const thumbs = await generateImageThumbnails(file.path, sha256, file.mimetype);

    const backend = await registry.backendForUpload(userId);
    const { ref: fileRef } = await backend.put({
      tmpPath: file.path, name: file.filename, mime: file.mimetype, size: file.size, userId,
    });

    const existingMod = await Module.findOne({ id: moduleId });
    const isUpdate = !!existingMod;

    const moduleDoc = {
      id: moduleId, userId, gridId: gridId || null,
      role: "artifact", kind,
      label: existingMod?.label || file.originalname,
      fileRef, defaultDragMode: "copy",
      meta: {
        ...(existingMod?.meta || {}),
        mimeType: file.mimetype,
        originalName: file.originalname,
        // Persist size so it survives reloads — the client-side
        // placeholder stamps this too, but rebuilding meta fresh
        // here would have wiped it (see file/artifact docket #5).
        uploadSize: file.size,
        // Content-hash stamped on every new module so subsequent uploads
        // of the same bytes can short-circuit via the dedup branch above.
        sha256,
        // Image-only: width / height / exif from ExifReader. All three
        // are nullable when the file isn't an image or the parse fails;
        // omit-when-null keeps non-image modules' meta unchanged.
        ...(imageMeta?.width != null  ? { width:  imageMeta.width  } : {}),
        ...(imageMeta?.height != null ? { height: imageMeta.height } : {}),
        ...(imageMeta?.exif         ? { exif: imageMeta.exif } : {}),
        // Sharp thumbnail refs — sha256-keyed paths under uploads/thumbnails/.
        // Resolves via the same /uploads/ static mount as the original.
        // Null for non-image or unsupported formats (SVG / GIF / etc.).
        ...(thumbs?.thumb256  ? { thumb256:  thumbs.thumb256  } : {}),
        ...(thumbs?.thumb1024 ? { thumb1024: thumbs.thumb1024 } : {}),
        folderId: parentFolderId || existingMod?.meta?.folderId || null,
        uploadStatus: "ready",
      },
    };
    await Module.findOneAndUpdate({ id: moduleId }, moduleDoc, { upsert: true });

    const existingOcc = await Occurrence.findOne({ id: occurrenceId });
    const occDoc = existingOcc
      ? { ...existingOcc.toObject(), moduleId }
      : {
          id: occurrenceId, userId, gridId: gridId || null,
          moduleId,
          parentId: await homeFolderForUpload({ userId, gridId, parentFolderId, kind }),
          textmap: kind === "markdown" ? { type: "doc", content: [] } : null,
        };
    if (!existingOcc) {
      const artifactViewId = nanoid();
      const artifactView = new View({ id: artifactViewId, userId, gridId: gridId || null, viewType, artifactType, layout: {} });
      await artifactView.save();
      occDoc.viewId = artifactViewId;
    }
    await Occurrence.findOneAndUpdate({ id: occurrenceId }, occDoc, { upsert: true });

    if (manifestId) {
      const manifestView = await View.findOne({ manifestId, userId });
      if (manifestView) {
        manifestView.activeOccurrenceId = occurrenceId;
        await manifestView.save();
        const vc = { ...manifestView.toObject(), id: manifestView.id };
        const cache = routeCache(userId, gridId);
        if (cache) cache.viewsById[vc.id] = vc;
        io.to(userRoom(userId)).emit("view_updated", vc);
      }
    }

    const modObj = await Module.findOne({ id: moduleId }).lean();
    const occObj = await Occurrence.findOne({ id: occurrenceId }).lean();
    const cache = routeCache(userId, gridId);
    if (cache) {
      cache.modulesById[modObj.id] = modObj;
      cache.occurrencesById[occObj.id] = occObj;
    }

    if (isUpdate) {
      io.to(userRoom(userId)).emit("module_updated", modObj);
    } else {
      io.to(userRoom(userId)).emit("module_created", modObj);
      io.to(userRoom(userId)).emit("occurrence_created", occObj);
    }
    io.to(userRoom(userId)).emit("artifact_created", { moduleId, occurrenceId, fileRef });
    // Serve under /uploads/; the legacy /artifacts/ mount was removed
    // in March 2026 (see server/CLAUDE.md). The url field is purely
    // informational — clients resolve via helpers/fileRef.resolveFileRef.
    return { sha256,  module: modObj, occurrence: occObj, fileRef, url: backend.urlFor(fileRef) };
  }

  /**
   * A file already on the server's disk (a folder connection) becomes an
   * artifact through the SAME path as an upload (audit A4 — the connection
   * import used to be a hand-copied second uploader with no dedup, EXIF or
   * thumbnails). The source is COPIED to a temp file first; it is never moved.
   */
  async function storeFileFromPath({ srcPath, originalName, mimeType, ...rest }) {
    const ext = path.extname(originalName || srcPath);
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const tmp = path.join(uploadsDir, filename);
    fs.copyFileSync(srcPath, tmp);
    const size = fs.statSync(tmp).size;
    return storeUploadedFile({ ...rest, file: { path: tmp, filename, originalname: originalName, mimetype: mimeType, size } });
  }

  /**
   * A bare file with no artifact record (an image picked as a FIELD value —
   * a person's photo, a poster). Same backend choice as every upload.
   */
  async function storeBareFile({ file, userId }) {
    const backend = await registry.backendForUpload(userId);
    const { ref } = await backend.put({ tmpPath: file.path, name: file.filename, mime: file.mimetype, size: file.size, userId });
    return { fileRef: ref, url: backend.urlFor(ref) };
  }

  return { storeUploadedFile, storeFileFromPath, storeBareFile, generateImageThumbnails, storage: registry };
}
