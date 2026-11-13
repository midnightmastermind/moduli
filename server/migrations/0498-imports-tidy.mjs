// 0498 — Imports tidy-up (user 2026-11-13).
//   1. A row filed UNDER a folder's page (role page, kind folder) is moved into that folder. A folder
//      page draws the rows whose parentId IS its folder, so these were listed and never shown — the
//      image saved to Imports through a preset "didnt add it" (fixed going forward in
//      services/manualPlacement.folderForDestination).
//   2. "move all the images from imports and put it in images, that are part of an occurance (like the
//      eminem ones)": an image in Imports that a text embeds, a row lists or a field names → Files/Images.
//      Only parentId changes; embeds and listings resolve by occurrence id.
//   3. "move Imports then to the root folder": the protected Imports folder → the manifest's root.
export const id = "0498-imports-tidy";
export const describe = "Rows under folder pages into their folder; used Imports images into Images; Imports to the root.";
export const touches = ["occurrences", "folders"];

import { decompressTextmap } from "../utils/textmapCompression.js";

export async function up({ gridId, models, log, dryRun }) {
  const { Grid, Module, Occurrence, Folder, Manifest } = models;
  const G = String(gridId);
  const grid = await Grid.findById(gridId).lean();
  const manifest = await Manifest.findOne({ id: grid.manifestId }).lean();
  const rootId = manifest?.rootFolderId;
  if (!rootId) throw new Error("0498: no root folder");
  const imports = await Folder.findOne({ gridId: G, name: "Imports", "meta.protected": true }).lean();
  if (!imports) throw new Error("0498: no protected Imports folder");
  const files = await Folder.findOne({ gridId: G, name: "Files", "meta.protected": true }).lean();
  const images = files && await Folder.findOne({ gridId: G, name: "Images", parentId: files.id }).lean();
  if (!images) throw new Error("0498: no Files/Images folder");

  const occs = await Occurrence.find({ gridId: G }).select("id moduleId parentId occurrences textmap fields").lean();
  const mods = new Map((await Module.find({ gridId: G }).select("id role kind").lean()).map((m) => [m.id, m]));
  const isFolderPage = (o) => { const m = mods.get(o.moduleId); return m?.role === "page" && m?.kind === "folder"; };

  // 1
  const fpById = new Map(occs.filter(isFolderPage).map((o) => [o.id, o]));
  const misfiled = occs.filter((o) => fpById.has(o.parentId) && fpById.get(o.parentId).parentId);
  // 2
  const used = new Set();
  for (const o of occs) {
    for (const c of o.occurrences || []) used.add(c);
    if (o.textmap) { let t; try { t = typeof o.textmap === "string" ? decompressTextmap(o.textmap) : o.textmap; } catch {}
      for (const m of JSON.stringify(t || "").matchAll(/"occurrenceId":"([^"]+)"/g)) used.add(m[1]); }
    for (const c of Object.values(o.fields || {})) for (const x of [].concat(c?.value || [])) if (typeof x === "string") used.add(x);
  }
  const misfiledIds = new Set(misfiled.map((o) => o.id));
  const toImages = occs.filter((o) => o.parentId === imports.id && !misfiledIds.has(o.id) && !fpById.has(o.id)
    && mods.get(o.moduleId)?.role === "artifact" && mods.get(o.moduleId)?.kind === "image"
    && [...fpById.values()].every((fp) => !(fp.occurrences || []).includes(o.id) || false) && used.has(o.id));

  log(`  1. ${misfiled.length} rows under a folder page -> their folder`);
  log(`  2. ${toImages.length} used images Imports -> Files/Images (${images.id})`);
  log(`  3. Imports (${imports.id}) ${imports.parentId === rootId ? "already at the root" : `from ${imports.parentId} -> root ${rootId}`}`);
  if (dryRun) return { misfiled: misfiled.length, images: toImages.length };

  for (const o of misfiled) {
    const fp = fpById.get(o.parentId);
    await Occurrence.updateOne({ gridId: G, id: o.id, parentId: fp.id }, { $set: { parentId: fp.parentId, updatedAt: new Date() } });
    await Occurrence.updateOne({ gridId: G, id: fp.id }, { $pull: { occurrences: o.id }, $set: { updatedAt: new Date() } });
  }
  for (const o of toImages) await Occurrence.updateOne({ gridId: G, id: o.id, parentId: imports.id }, { $set: { parentId: images.id, updatedAt: new Date() } });
  if (imports.parentId !== rootId) await Folder.updateOne({ gridId: G, id: imports.id }, { $set: { parentId: rootId, updatedAt: new Date() } });
  return { misfiled: misfiled.length, images: toImages.length };
}
