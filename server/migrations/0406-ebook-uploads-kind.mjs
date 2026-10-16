// server/migrations/0406-ebook-uploads-kind.mjs
//
// User 2026-10-16: "i cant access dungeon crawler carls epub either after uploading it." The upload
// classifier knew no book kinds, so an uploaded .epub / .mobi / .azw / .azw3 was stored as
// kind "markdown" and opened in the note editor. The classifier is fixed (utils/uploadKinds.js);
// this repairs files already uploaded: their module kind becomes "ebook", and the page that fronts
// one (meta.artifactPage) gets the book viewer.
//
// Scoped by what the FILE is (its stored mime or original name), never by a title. Idempotent.

import { EBOOK_EXTENSIONS } from "../utils/uploadKinds.js";

export const id = "0406-ebook-uploads-kind";
export const describe = "Uploaded e-book files stored as kind 'markdown' become kind 'ebook'; their artifact page opens the book viewer. Deletes nothing.";
export const touches = ["modules", "views"];

const EBOOK_MIMES = new Set(["application/epub+zip", "application/x-mobipocket-ebook", "application/vnd.amazon.ebook", "application/vnd.amazon.mobi8-ebook"]);

/** Is this artifact module an e-book file stored under another kind? (PURE) */
export function isMisfiledEbook(mod) {
  if (!mod || mod.role !== "artifact" || mod.kind === "ebook") return false;
  const name = String(mod.meta?.originalName || "");
  const ext = name.includes(".") ? "." + name.split(".").pop().toLowerCase() : "";
  return EBOOK_MIMES.has(mod.meta?.mimeType) || EBOOK_EXTENSIONS.has(ext);
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, View } = models;
  const mods = (await Module.find({ gridId, role: "artifact", kind: { $ne: "ebook" } }).lean()).filter(isMisfiledEbook);
  log(`${mods.length} e-book file(s) stored under another kind: ${mods.map((m) => `${m.kind} "${String(m.meta?.originalName).slice(0, 60)}"`).join("; ")}`);
  if (!mods.length) return;
  const occs = await Occurrence.find({ gridId, moduleId: { $in: mods.map((m) => m.id) } }, { id: 1 }).lean();
  const pages = await Occurrence.find({ gridId, "meta.artifactPage": { $in: occs.map((o) => o.id) } }, { id: 1, viewId: 1 }).lean();
  const viewIds = pages.map((p) => p.viewId).filter(Boolean);
  log(`${pages.length} artifact page(s), ${viewIds.length} view(s) to point at the book viewer`);
  if (dryRun) return;
  await Module.updateMany({ gridId, id: { $in: mods.map((m) => m.id) } }, { $set: { kind: "ebook" } });
  if (viewIds.length) await View.updateMany({ id: { $in: viewIds } }, { $set: { viewType: "display", artifactType: "ebook" } });
  const back = await Module.countDocuments({ gridId, id: { $in: mods.map((m) => m.id) }, kind: "ebook" });
  log(`read back: ${back} of ${mods.length} now kind ebook`);
  if (back !== mods.length) throw new Error("not every module was repaired");
}
