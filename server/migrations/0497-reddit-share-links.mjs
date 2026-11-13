// 0497 — saved Reddit SHARE links (`reddit.com/r/<sub>/s/<code>`) become the post they point to.
//
// User 2026-11-13: "look into the shared links and get the post id". A share link hides its post,
// and only a post link opens in the in-app browser (client helpers/embedUrl → embed.reddit.com).
// Each link was resolved once, from Reddit's own 301 (data/0497-reddit-share-links.mjs). Stored in
// two places on poms grid: the bookmark module's `fileRef` and the URL field value on its
// occurrence. Only an exact match of a listed share link is rewritten; anything else is untouched.
// New share links are expanded as they are saved (server utils/redditShareLink).
export const id = "0497-reddit-share-links";
export const describe = "Saved Reddit share links become the post they point to.";
export const touches = ["modules", "occurrences"];

import { SHARE_TO_POST } from "./data/0497-reddit-share-links.mjs";

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence } = models;
  const G = String(gridId);
  const shares = Object.keys(SHARE_TO_POST).filter((k) => SHARE_TO_POST[k]);
  const mods = await Module.find({ gridId: G, fileRef: { $in: shares } }).select("id fileRef").lean();
  const occs = await Occurrence.find({ gridId: G }).select("id fields").lean();
  const fieldWrites = [];
  for (const o of occs) {
    const set = {};
    for (const [fid, cell] of Object.entries(o.fields || {})) {
      if (cell && typeof cell.value === "string" && SHARE_TO_POST[cell.value]) set[`fields.${fid}.value`] = SHARE_TO_POST[cell.value];
    }
    if (Object.keys(set).length) fieldWrites.push({ id: o.id, set });
  }
  log(`  ${shares.length} resolved share links · ${mods.length} bookmark addresses · ${fieldWrites.length} field values to rewrite`);
  if (dryRun) { for (const m of mods.slice(0, 3)) log(`  e.g. ${m.fileRef} -> ${SHARE_TO_POST[m.fileRef]}`); return { modules: mods.length, fields: fieldWrites.length }; }
  for (const m of mods) await Module.updateOne({ gridId: G, id: m.id, fileRef: m.fileRef }, { $set: { fileRef: SHARE_TO_POST[m.fileRef], updatedAt: new Date() } });
  for (const w of fieldWrites) await Occurrence.updateOne({ gridId: G, id: w.id }, { $set: { ...w.set, updatedAt: new Date() } });
  const left = await Module.countDocuments({ gridId: G, fileRef: { $in: shares } });
  if (left) throw new Error(`0497: ${left} bookmark addresses still hold a share link`);
  return { modules: mods.length, fields: fieldWrites.length };
}
