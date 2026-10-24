/**
 * 0430 — the codex notes' pictures: the Notion export's images were local files, so 0429 imported links to paths
 * that exist only on the user's machine (673 image links, every one broken in the app — user 2026-10-24: "a ton of
 * pages in my notes that have broken image links").
 *
 * For each page 0429 made (`meta.codexFullPath`), every `image` node in its doc container's text whose src is not a
 * web address is resolved against the note's own folder (URI-decoded). Notion names a folder after its page, and a
 * page title with "(" ")" cuts the markdown link short, so when the src does not name a file the alt is tried, then
 * the file's NAME anywhere under the note's folder. A found file is copied to CODEX_IMAGE_STAGE as
 * `codex-<sha16>.<ext>` and the node's src becomes `/uploads/user/codex/<that>`; the stage is copied to the server's
 * uploads BEFORE --apply. An image that cannot be found is removed from the page (it can only ever show as broken).
 *
 * The dry run stages the files too (outside the database), so they can be uploaded before anything points at them.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { decompressTextmap, compressTextmap } from "../utils/textmapCompression.js";
import { CODEX_FULL_ROOT } from "./0429-codex-full-light.mjs";

export const id = "0430-codex-local-images";
export const describe = "Point the codex notes' local image links at uploaded copies (drop the ones with no file).";
export const touches = ["occurrences"];

export const STAGE = process.env.CODEX_IMAGE_STAGE || "/tmp/codex-images";
export const URL_PREFIX = "/uploads/user/codex/";
const IMG = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

/** Every image file under `dir`, by lower-cased file name. */
function imagesUnder(dir, cache) {
  if (cache.has(dir)) return cache.get(dir);
  const out = new Map();
  const walk = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (IMG.test(e.name) && !out.has(e.name.toLowerCase())) out.set(e.name.toLowerCase(), p);
    }
  };
  walk(dir);
  cache.set(dir, out);
  return out;
}

/** The local file an image node names, or null. `noteDir` is the note's folder. Exported for tests. */
export function resolveLocalImage({ src, alt }, noteDir, cache = new Map()) {
  for (const raw of [src, alt]) {
    if (!raw || /^[a-z]+:/i.test(raw)) continue;
    const p = path.resolve(noteDir, safeDecode(raw));
    if (p.startsWith(noteDir) && IMG.test(p) && fs.existsSync(p)) return p;
  }
  for (const raw of [src, alt]) {
    if (!raw || /^[a-z]+:/i.test(raw)) continue;
    const name = path.basename(safeDecode(raw)).toLowerCase();
    if (!IMG.test(name)) continue;
    const hit = imagesUnder(noteDir, cache).get(name);
    if (hit) return hit;
  }
  return null;
}

/** Rewrite a doc's local image nodes with `map(node) -> src | null` (null = remove). Pure. Returns { doc, changed, dropped }. */
export function rewriteImages(doc, map) {
  let changed = 0, dropped = 0;
  const walk = (node) => {
    if (!node || typeof node !== "object") return node;
    if (!Array.isArray(node.content)) return node;
    const content = [];
    for (const k of node.content) {
      if (k?.type === "image" && k.attrs?.src && !/^(https?:|data:|\/uploads\/)/i.test(k.attrs.src)) {
        const to = map(k.attrs);
        if (to) { content.push({ ...k, attrs: { ...k.attrs, src: to } }); changed++; } else dropped++;
        continue;
      }
      content.push(walk(k));
    }
    return { ...node, content };
  };
  return { doc: walk(doc), changed, dropped };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence } = models;
  const pages = await Occurrence.find({ gridId, "meta.codexFullPath": { $exists: true } }, { id: 1, occurrences: 1, "meta.codexFullPath": 1 }).lean();
  const docIds = pages.flatMap((p) => p.occurrences || []);
  const docs = await Occurrence.find({ gridId, id: { $in: docIds } }, { id: 1, textmap: 1 }).lean();
  const docById = new Map(docs.map((d) => [d.id, d]));
  fs.mkdirSync(STAGE, { recursive: true });
  const cache = new Map();
  let changed = 0, dropped = 0, pagesTouched = 0, staged = 0;
  const writes = [];
  for (const p of pages) {
    const noteDir = path.dirname(path.join(CODEX_FULL_ROOT, p.meta.codexFullPath));
    for (const did of p.occurrences || []) {
      const d = docById.get(did);
      if (!d?.textmap) continue;
      const tm = decompressTextmap(d.textmap);
      const res = rewriteImages(tm, (attrs) => {
        const file = resolveLocalImage(attrs, noteDir, cache);
        if (!file) return null;
        const buf = fs.readFileSync(file);
        const name = `codex-${crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16)}${path.extname(file).toLowerCase()}`;
        const dest = path.join(STAGE, name);
        if (!fs.existsSync(dest)) { fs.writeFileSync(dest, buf); staged++; }
        return URL_PREFIX + name;
      });
      if (!res.changed && !res.dropped) continue;
      changed += res.changed; dropped += res.dropped; pagesTouched++;
      writes.push({ updateOne: { filter: { id: d.id, gridId }, update: { $set: { textmap: compressTextmap(res.doc), updatedAt: new Date() } } } });
    }
  }
  log(`  ${pages.length} codex pages · ${pagesTouched} with local images · ${changed} pointed at uploads · ${dropped} with no file (removed)`);
  log(`  ${staged} new file(s) staged in ${STAGE} — copy them to the server's uploads/user/codex BEFORE --apply`);
  if (dryRun) { log("  (dry run — nothing written to the database)"); return; }
  for (let i = 0; i < writes.length; i += 200) await Occurrence.bulkWrite(writes.slice(i, i + 200), { ordered: false });
  log(`  done — ${writes.length} doc(s) rewritten. Restart the server (warm cache).`);
}
