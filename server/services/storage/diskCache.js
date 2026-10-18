// services/storage/diskCache.js — a server-disk copy of streamed media, so a video or song kept in
// Drive plays like a local file after its first open.
//
// WHY (measured 2026-10-17, a 200 MB phone mp4 in Drive): every byte-range request the /files proxy
// forwards costs Drive ~0.7s before the first byte, while the transfer itself runs at ~75 MB/s. A
// browser playing a video makes MANY range requests — and that file keeps its index ("moov") at the
// END, behind 200 MB of frames, so the player reads the start, jumps to the end, then comes back.
// Each jump paid the 0.7s again. From disk a range answers at once.
//
// How: the first open of an audio/video file is answered straight from the backend (as before) and
// starts ONE background download of the whole file into `<dir>/<key>.part`, renamed when complete.
// Later opens of that ref read the disk copy. Least-recently-used copies are deleted past `maxBytes`.
// Nothing else changes: other kinds, and anything over `maxFileBytes`, always stream from the backend.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { pipeline } from "stream/promises";

// Books too (2026-10-18): a pdf is read by range requests like a video, and an e-book is fetched whole
// on every open — from Drive each answer is ~0.7s late. Images stay out (small, and thumbnails exist).
const MEDIA = /^(video|audio)\/|^application\/(pdf|epub\+zip|x-mobipocket-ebook|vnd\.amazon\.(ebook|mobi8-ebook))$/;
export const cacheKey = (ref) => crypto.createHash("sha1").update(String(ref)).digest("hex");

/** PURE. Which cached entries to delete so the total fits `maxBytes` (oldest access first). */
export function planEviction(entries, maxBytes) {
  let total = entries.reduce((n, e) => n + e.size, 0);
  const out = [];
  for (const e of [...entries].sort((a, b) => a.atime - b.atime)) {
    if (total <= maxBytes) break;
    out.push(e.key); total -= e.size;
  }
  return out;
}

export function withDiskCache(backend, { dir, maxBytes = 5e9, maxFileBytes = 2e9, now = () => Date.now() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const filling = new Map();       // key -> promise
  const fileOf = (k) => path.join(dir, `${k}.bin`);
  const metaOf = (k) => path.join(dir, `${k}.json`);

  function readMeta(k) {
    try { return JSON.parse(fs.readFileSync(metaOf(k), "utf8")); } catch { return null; }
  }

  function evict() {
    const entries = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const key = f.slice(0, -5); const m = readMeta(key);
      if (m && fs.existsSync(fileOf(key))) entries.push({ key, size: m.size, atime: m.atime || 0 });
    }
    for (const key of planEviction(entries, maxBytes)) {
      try { fs.unlinkSync(fileOf(key)); fs.unlinkSync(metaOf(key)); } catch { /* ignore */ }
    }
  }

  function fill(ref, key, mime) {
    if (filling.has(key)) return filling.get(key);
    const part = path.join(dir, `${key}.part`);
    const p = (async () => {
      const file = await backend.open(ref, {});
      if (!file?.stream) return;
      await pipeline(file.stream, fs.createWriteStream(part));
      const size = fs.statSync(part).size;
      if (file.size != null && size !== file.size) throw new Error(`short download ${size}/${file.size}`);
      fs.renameSync(part, fileOf(key));
      fs.writeFileSync(metaOf(key), JSON.stringify({ ref, size, mime, atime: now() }));
      evict();
    })().catch((e) => { try { fs.unlinkSync(part); } catch { /* ignore */ } console.warn("[disk cache] fill failed:", e.message); })
      .finally(() => filling.delete(key));
    filling.set(key, p);
    return p;
  }

  return {
    ...backend,
    type: backend.type,
    _filling: filling,
    async open(ref, { start, end } = {}) {
      const key = cacheKey(ref);
      const meta = readMeta(key);
      if (meta && fs.existsSync(fileOf(key))) {
        fs.writeFileSync(metaOf(key), JSON.stringify({ ...meta, atime: now() }));
        const size = meta.size;
        const s = start ?? 0; const e = Math.min(end ?? size - 1, size - 1);
        const ranged = start != null;
        return {
          stream: fs.createReadStream(fileOf(key), { start: s, end: e }),
          size, length: e - s + 1, mime: meta.mime,
          contentRange: ranged ? `bytes ${s}-${e}/${size}` : null,
          status: ranged ? 206 : 200,
        };
      }
      const file = await backend.open(ref, { start, end });
      if (file && MEDIA.test(file.mime || "") && file.size && file.size <= maxFileBytes) fill(ref, key, file.mime);
      return file;
    },
  };
}
