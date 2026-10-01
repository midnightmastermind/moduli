// 0378 — a picture lifted out of a document (0377) is named by the heading it
// sits under, not by its URL's file name.
//
// 0377 named each new image artifact by its alt text, and the pasted pages had
// none but "Image" — so it fell back to the URL's file name, and every caption
// read like "1*OuJfHWDdGrnZlwK52J2HnA.jpeg": the "random characters" the user
// keeps asking to be rid of. The nearest heading ABOVE the picture in its
// document ("1. Nigredo — Blackening") says what it is. A picture with no
// heading above it gets an empty label (the importer's own default), which
// hides the caption. Only modules 0377 created (meta.source "doc-image") whose
// label still looks like a file name are touched. Idempotent.

import { decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0378-doc-image-labels-from-headings";
export const describe = "Name 0377's image artifacts after the heading above them in their document (or nothing), instead of the URL's file name.";
export const touches = ["modules"];

const textOf = (n) => (n?.text || "") + (n?.content || []).map(textOf).join("");
export const looksLikeFileName = (l) => /\.(jpe?g|png|gif|webp|avif|svg)$/i.test(String(l || "").trim());

/** PURE: the text of the last heading before the embed of `occId`, or "". */
export function headingAbove(doc, occId) {
  let last = "", found = null;
  const walk = (n) => {
    if (found !== null || !n) return;
    if (n.type === "heading") last = textOf(n).trim();
    if (n.type === "moduleEmbed" && n.attrs?.occurrenceId === occId) { found = last; return; }
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return found ?? "";
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const gid = String(gridId);
  const mods = await Module.find({ gridId: gid, role: "artifact", kind: "image", "meta.source": "doc-image" }).lean();
  let renamed = 0;
  for (const m of mods) {
    if (!looksLikeFileName(m.label)) continue;
    const occ = await Occurrence.findOne({ moduleId: m.id, "meta.embeddedIn": { $exists: true } }).lean();
    const host = occ ? await Occurrence.findOne({ id: occ.meta.embeddedIn }, { textmap: 1 }).lean() : null;
    let label = "";
    try { if (host?.textmap) label = headingAbove(decompressTextmap(host.textmap), occ.id); } catch { /* keep "" */ }
    renamed++;
    if (!dryRun) await Module.updateOne({ id: m.id }, { $set: { label } });
  }
  log(`renamed ${renamed} image artifact(s) after the heading above them.`);
}
