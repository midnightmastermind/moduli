// services/storage/local.js — the "Server" storage backend: the server's own
// disk, exactly as uploads have always been stored (uploads/user/YYYY-MM/…).
//
// A storage backend owns WHERE an uploaded file's bytes live; everything else
// (hash, dedup, EXIF, thumbnails, the module/occurrence records) stays in
// services/artifactUpload.js. Interface (plan 2026-09-24-connections-storage-gdrive §2.1):
//   put({ tmpPath, name })  -> { ref }     moves the temp file in; ref = fileRef
//   open(ref, { start, end }) -> { stream, size } | null
//   remove(ref)             -> boolean
//   urlFor(ref)             -> the URL a browser loads it from
//   owns(ref)               -> does this ref belong to this backend?
//   health()                -> { ok, message }
import fs from "fs";
import path from "path";
import { yearMonthShard } from "../../utils/uploadKinds.js";
import { resolveInside } from "../../utils/safePath.js";

// Any ref that is not an absolute URL and not another backend's scheme
// ("gdrive:…") is a server ref — which is every fileRef written before
// storage backends existed, so nothing needs migrating.
const FOREIGN = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export function makeLocalBackend({ uploadsDir }) {
  const pathOf = (ref) => resolveInside(uploadsDir, String(ref || "").replace(/^\/?uploads\//, ""));
  return {
    id: "server",
    type: "server",
    name: "Server",
    owns: (ref) => typeof ref === "string" && !!ref && !FOREIGN.test(ref),

    async put({ tmpPath, name }) {
      const shard = yearMonthShard();
      const dir = path.join(uploadsDir, "user", shard);
      fs.mkdirSync(dir, { recursive: true });
      const base = path.basename(name || tmpPath);
      fs.renameSync(tmpPath, path.join(dir, base));
      return { ref: `user/${shard}/${base}` };
    },

    async open(ref, { start, end } = {}) {
      const p = pathOf(ref);
      if (!p || !fs.existsSync(p)) return null;
      const size = fs.statSync(p).size;
      const opts = start != null ? { start, end: end ?? size - 1 } : {};
      return { stream: fs.createReadStream(p, opts), size };
    },

    async remove(ref) {
      const p = pathOf(ref);
      if (!p || !fs.existsSync(p)) return false;
      fs.unlinkSync(p);
      return true;
    },

    urlFor: (ref) => `/uploads/${ref}`,

    async health() {
      try { fs.accessSync(uploadsDir, fs.constants.W_OK); return { ok: true, message: "writable" }; }
      catch (e) { return { ok: false, message: e.message }; }
    },
  };
}
