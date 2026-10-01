// 0377 — every picture inside a document becomes an image ARTIFACT.
//
// User, 2026-10-01: *"look at my notes, like the philosophers stone document.
// the images in there arent artifacts, we need to sweep the pages and make sure
// all images are artifacts"*. Pasted article content left plain TipTap `image`
// nodes (a bare <img src>) in 9 documents — 29 pictures, all remote URLs, all on
// their own line. An artifact is what the rest of the app can see: it can be
// opened, covered, moved, searched, and it lives in the tree.
//
// Each `image` node becomes a `moduleEmbed` of an artifact, in the same spot.
// The artifact is shaped exactly as the markdown importer makes one
// (role "artifact", kind "image", fileRef = the URL, label = alt) and homed in
// Imports, where 0351 files every remote picture embedded in a document. A URL
// that already has an image artifact on this grid REUSES that module; each
// placement gets its own occurrence. Nothing is deleted. Idempotent: a
// converted document has no `image` nodes left.

import { compressTextmap, decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0377-doc-images-become-artifacts";
export const describe = "Replace plain image nodes in documents with embeds of image artifacts (reusing an existing artifact for the same URL), homed in Imports. Deletes nothing.";
export const touches = ["occurrences", "modules"];

const uid = () => Math.random().toString(36).slice(2, 12);
const labelFor = (src, alt) => {
  if (alt && alt.trim() && alt.trim().toLowerCase() !== "image") return alt.trim();
  try { return decodeURIComponent(new URL(src).pathname.split("/").pop() || "Image"); } catch { return "Image"; }
};

/** PURE: replace image nodes via `toOccId(src, alt)`; returns { doc, count }. */
export function replaceImages(doc, toOccId) {
  let count = 0;
  const walk = (n) => {
    if (!n || typeof n !== "object") return n;
    if (n.type === "image" && n.attrs?.src) { count++; return { type: "moduleEmbed", attrs: { occurrenceId: toOccId(n.attrs.src, n.attrs.alt || "") } }; }
    return Array.isArray(n.content) ? { ...n, content: n.content.map(walk) } : n;
  };
  return { doc: walk(doc), count };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Folder } = models;
  const gid = String(gridId);
  const imports = await Folder.findOne({ gridId: gid, name: "Imports" }).lean();
  if (!imports) throw new Error("no Imports folder on this grid");
  const existing = new Map((await Module.find({ gridId: gid, role: "artifact", kind: "image", fileRef: { $regex: "^https?:" } }, { id: 1, fileRef: 1 }).lean()).map((m) => [m.fileRef, m.id]));
  let docs = 0, images = 0, reused = 0, created = 0;
  const cursor = Occurrence.find({ gridId: gid, textmap: { $ne: null } }, { id: 1, userId: 1, textmap: 1 }).lean().cursor();
  for await (const host of cursor) {
    let tm; try { tm = decompressTextmap(host.textmap); } catch { continue; }
    if (!JSON.stringify(tm).includes('"type":"image"')) continue;
    const newMods = [], newOccs = [];
    const { doc, count } = replaceImages(tm, (src, alt) => {
      let moduleId = existing.get(src);
      if (moduleId) reused++;
      else { moduleId = uid(); existing.set(src, moduleId); created++; newMods.push({ id: moduleId, userId: host.userId, gridId: gid, role: "artifact", kind: "image", label: labelFor(src, alt), fileRef: src, fieldBindings: [], meta: { source: "doc-image" } }); }
      const occId = uid();
      newOccs.push({ id: occId, userId: host.userId, gridId: gid, moduleId, parentId: imports.id, fields: {}, occurrences: [], meta: { embeddedIn: host.id } });
      return occId;
    });
    if (!count) continue;
    docs++; images += count;
    if (dryRun) continue;
    if (newMods.length) await Module.insertMany(newMods);
    await Occurrence.insertMany(newOccs);
    await Occurrence.updateOne({ id: host.id }, { $set: { textmap: compressTextmap(doc) } });
  }
  log(`${images} image(s) in ${docs} document(s): ${created} new artifact(s), ${reused} reused an existing one.`);
}
