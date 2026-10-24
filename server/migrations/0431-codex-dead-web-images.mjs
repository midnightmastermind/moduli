/**
 * 0431 — the codex notes' web pictures that no longer load. Of 244 distinct web images in the codex, 69 answered
 * 404 / 403 / 400 (checked 2026-10-24 with the app's Referer). Each was looked up again: the original address behind a
 * wp.com image proxy, then the Internet Archive; 20 were found and copied into uploads/user/codex (uploaded before
 * --apply). The map (dead url -> uploaded path, or null) is CODEX_DEAD_IMAGES (a JSON file, outside git); a node whose
 * url maps to null is removed — it can only ever show as broken. Other web images are left alone.
 */
import fs from "node:fs";
import { decompressTextmap, compressTextmap } from "../utils/textmapCompression.js";

export const id = "0431-codex-dead-web-images";
export const describe = "Replace the codex notes' dead web images with archived copies, or remove them.";
export const touches = ["occurrences"];

/** Rewrite image nodes whose src is in `map` (string = new src, null = remove). Pure. */
export function applyDeadMap(doc, map) {
  let changed = 0, dropped = 0;
  const walk = (node) => {
    if (!node || typeof node !== "object" || !Array.isArray(node.content)) return node;
    const content = [];
    for (const k of node.content) {
      const src = k?.type === "image" ? k.attrs?.src : null;
      if (src && Object.prototype.hasOwnProperty.call(map, src)) {
        if (map[src]) { content.push({ ...k, attrs: { ...k.attrs, src: map[src] } }); changed++; } else dropped++;
        continue;
      }
      content.push(walk(k));
    }
    return { ...node, content };
  };
  return { doc: walk(doc), changed, dropped };
}

export async function up({ gridId, models, log, dryRun }) {
  const file = process.env.CODEX_DEAD_IMAGES;
  if (!file || !fs.existsSync(file)) throw new Error("set CODEX_DEAD_IMAGES to the dead-image map");
  const map = JSON.parse(fs.readFileSync(file, "utf8"));
  const { Occurrence } = models;
  const pages = await Occurrence.find({ gridId, "meta.codexFullPath": { $exists: true } }, { occurrences: 1 }).lean();
  const docs = await Occurrence.find({ gridId, id: { $in: pages.flatMap((p) => p.occurrences || []) } }, { id: 1, textmap: 1 }).lean();
  let changed = 0, dropped = 0; const writes = [];
  for (const d of docs) {
    if (!d.textmap) continue;
    const res = applyDeadMap(decompressTextmap(d.textmap), map);
    if (!res.changed && !res.dropped) continue;
    changed += res.changed; dropped += res.dropped;
    writes.push({ updateOne: { filter: { id: d.id, gridId }, update: { $set: { textmap: compressTextmap(res.doc), updatedAt: new Date() } } } });
  }
  log(`  ${writes.length} doc(s) · ${changed} image(s) pointed at archived copies · ${dropped} removed`);
  if (dryRun) { log("  (dry run)"); return; }
  for (let i = 0; i < writes.length; i += 200) await Occurrence.bulkWrite(writes.slice(i, i + 200), { ordered: false });
  log("  done. Restart the server (warm cache).");
}
