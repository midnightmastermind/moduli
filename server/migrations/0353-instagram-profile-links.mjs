// server/migrations/0353-instagram-profile-links.mjs
//
// Each person with an Instagram handle gets a link to their profile on their card
// (user, 2026-09-25: "put the link on their thing").
//
// 1. The Instagram field gets `meta.linkTemplate = "https://www.instagram.com/{value}"`.
//    The client (helpers/fieldLink) shows an open-in-new-tab link beside any text
//    field that carries a template, so the stored value stays the plain handle.
// 2. The seeded person shape binds Instagram HIDDEN, so the link would never show.
//    It is un-hidden on the modules of people who actually HAVE a handle — people
//    without one keep it hidden rather than showing an empty pill.
//
// Idempotent: a template already set is left alone, and only hidden bindings flip.

export const id = "0353-instagram-profile-links";
export const describe = "Gives the Instagram field a profile-link template and shows the Instagram field on every person who has a handle, so each card links to their Instagram profile.";
export const touches = ["fields", "modules"];

export const IG_TEMPLATE = "https://www.instagram.com/{value}";

/** PURE — which bindings to un-hide: modules whose occurrence carries a handle. */
export function planUnhide({ occurrences, modulesById, fieldId }) {
  const withHandle = new Set();
  for (const o of occurrences) {
    const v = o.fields?.[fieldId]?.value;
    if (typeof v === "string" && v.trim().replace(/^@+/, "")) withHandle.add(o.moduleId);
  }
  const moduleIds = [];
  for (const mid of withHandle) {
    const m = modulesById.get(mid);
    if (m?.fieldBindings?.some(b => b?.fieldId === fieldId && b.hidden)) moduleIds.push(mid);
  }
  return moduleIds;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Module, Occurrence } = models;
  const hits = (await Field.find({ gridId }).lean())
    .filter(f => (f.name || "").toLowerCase() === "instagram" && f.type === "text");
  if (hits.length !== 1) { log(`found ${hits.length} text fields named "Instagram" — refusing to guess`); return; }
  const field = hits[0];

  const hasTemplate = field.meta?.linkTemplate === IG_TEMPLATE;
  log(hasTemplate ? "Instagram field already links to profiles" : "SET Instagram field link template");

  const occurrences = await Occurrence.find({ gridId, [`fields.${field.id}.value`]: { $nin: [null, ""] } })
    .select({ id: 1, moduleId: 1, fields: 1 }).lean();
  const mods = await Module.find({ gridId, id: { $in: [...new Set(occurrences.map(o => o.moduleId).filter(Boolean))] } })
    .select({ id: 1, fieldBindings: 1 }).lean();
  const modulesById = new Map(mods.map(m => [m.id, m]));
  const toUnhide = planUnhide({ occurrences, modulesById, fieldId: field.id });
  log(`${occurrences.length} occurrence(s) carry a handle · SHOW the Instagram field on ${toUnhide.length} person module(s)`);

  if (dryRun) { log("DRY RUN — nothing written"); return; }
  if (!hasTemplate) {
    await Field.updateOne({ id: field.id }, { $set: { "meta.linkTemplate": IG_TEMPLATE } });
  }
  let changed = 0;
  for (const mid of toUnhide) {
    const r = await Module.updateOne(
      { id: mid, "fieldBindings.fieldId": field.id },
      { $set: { "fieldBindings.$.hidden": false } });
    changed += r.modifiedCount || 0;
  }
  log(`done: ${changed} module(s) now show Instagram. Restart the server (pm2) so the warm cache serves it.`);
}
