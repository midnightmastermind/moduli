// 0500 — a Reddit bookmark named "reddit.com" or by the post's age ("5 yr. ago") takes the title its address carries.
// Reddit refuses the server's fetch, so those bookmarks never learned a title (utils/titleFromUrl.js). Only those two
// junk shapes are renamed; a name the user or the page gave is left. The placement's own label is renamed only when
// it holds the same junk.
export const id = "0500-reddit-bookmark-names";
export const describe = "Reddit bookmarks named 'reddit.com' or by age take the post title from their address.";
export const touches = ["modules", "occurrences"];

import { titleFromUrl } from "../utils/titleFromUrl.js";

export const isJunkName = (s) => !s || /^(www\.)?reddit\.com$/i.test(s.trim()) || /^\d+\s*(yr|mo|wk|d|hr|min)s?\.?\s+ago$/i.test(s.trim());

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence } = models;
  const G = String(gridId);
  const mods = await Module.find({ gridId: G, kind: "bookmark", fileRef: /reddit\.com/i }).select("id label fileRef").lean();
  const plan = mods.filter((m) => isJunkName(m.label)).map((m) => ({ id: m.id, from: m.label, to: titleFromUrl(m.fileRef) })).filter((p) => p.to);
  log(`  ${mods.length} Reddit bookmarks · ${plan.length} to rename`);
  for (const p of plan) log(`  "${p.from}" -> "${p.to}"`);
  if (dryRun || !plan.length) return { planned: plan.length };
  for (const p of plan) {
    await Module.updateOne({ gridId: G, id: p.id }, { $set: { label: p.to, updatedAt: new Date() } });
    const occs = await Occurrence.find({ gridId: G, moduleId: p.id }).select("id label").lean();
    for (const o of occs) if (o.label != null && isJunkName(o.label)) await Occurrence.updateOne({ gridId: G, id: o.id }, { $set: { label: null, updatedAt: new Date() } });
  }
  return { renamed: plan.length };
}
