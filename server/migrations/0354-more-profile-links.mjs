// server/migrations/0354-more-profile-links.mjs
//
// The rest of the profile links on person cards (user, 2026-09-25: "keep going
// with the links"). 0353 did Instagram; this does:
//
//   Website       the value IS the address  → template "{value}"
//   Twitter / X   handle                    → https://x.com/{value}
//   LinkedIn      profile slug              → https://www.linkedin.com/in/{value}
//   Facebook      NEW field. The Facebook export carries no profile link or id,
//                 only a name, so this is a Facebook people SEARCH for that name.
//                 Filled on the people who came from Facebook (meta.externalId
//                 "fb:…"), with their name as the value.
//
// Each link field is shown only on people who have a value (the seeded person
// shape binds them hidden) — the same rule as 0353, reusing its planUnhide.
// Idempotent: templates already set are left alone, a Facebook value already
// present is never overwritten, and a binding is added only if missing.

import crypto from "node:crypto";
import { planUnhide } from "./0353-instagram-profile-links.mjs";

export const id = "0354-more-profile-links";
export const describe = "Adds profile links to Website, Twitter / X and LinkedIn, and a new Facebook field (a Facebook search for the person's name) on everyone imported from Facebook; each shows only on people who have a value.";
export const touches = ["fields", "modules", "occurrences"];

export const LINKS = [
  { name: "Website", template: "{value}" },
  { name: "Twitter / X", template: "https://x.com/{value}" },
  { name: "LinkedIn", template: "https://www.linkedin.com/in/{value}" },
];
export const FACEBOOK = { name: "Facebook", template: "https://www.facebook.com/search/people/?q={value}" };

/** PURE — Facebook people who still need a value and/or a visible binding. */
export function planFacebook({ occurrences, modulesById, fieldId }) {
  const setValue = [], addBinding = new Set(), unhide = new Set();
  for (const o of occurrences) {
    if (o.meta?.source !== "social-import" || !String(o.meta?.externalId || "").startsWith("fb:")) continue;
    const m = modulesById.get(o.moduleId);
    const name = String(m?.label || "").trim();
    if (!name) continue;
    if (!o.fields?.[fieldId]?.value) setValue.push({ id: o.id, value: name });
    const b = m.fieldBindings?.find(x => x?.fieldId === fieldId);
    if (!b) addBinding.add(m.id); else if (b.hidden) unhide.add(m.id);
  }
  return { setValue, addBinding: [...addBinding], unhide: [...unhide] };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Module, Occurrence } = models;
  const fields = await Field.find({ gridId }).lean();
  const textField = (name) => {
    const hits = fields.filter(f => (f.name || "").toLowerCase() === name.toLowerCase() && f.type === "text");
    return hits.length === 1 ? hits[0] : null;
  };

  // ── Existing link fields ──────────────────────────────────────────────────
  const plans = [];
  for (const spec of LINKS) {
    const field = textField(spec.name);
    if (!field) { log(`no single text field "${spec.name}" — skipped`); continue; }
    const occs = await Occurrence.find({ gridId, [`fields.${field.id}.value`]: { $nin: [null, ""] } })
      .select({ id: 1, moduleId: 1, fields: 1 }).lean();
    const mods = await Module.find({ gridId, id: { $in: [...new Set(occs.map(o => o.moduleId).filter(Boolean))] } })
      .select({ id: 1, fieldBindings: 1 }).lean();
    const toUnhide = planUnhide({ occurrences: occs, modulesById: new Map(mods.map(m => [m.id, m])), fieldId: field.id });
    const setTpl = field.meta?.linkTemplate !== spec.template;
    plans.push({ field, spec, toUnhide, setTpl });
    log(`${spec.name}: ${setTpl ? "SET link" : "link already set"} · ${occs.length} with a value · SHOW on ${toUnhide.length} person module(s)`);
  }

  // ── Facebook ──────────────────────────────────────────────────────────────
  const existingFb = textField(FACEBOOK.name);
  const fbId = existingFb?.id || crypto.randomUUID();
  const imported = await Occurrence.find({ gridId, "meta.source": "social-import" })
    .select({ id: 1, moduleId: 1, fields: 1, meta: 1 }).lean();
  const importedMods = await Module.find({ gridId, id: { $in: [...new Set(imported.map(o => o.moduleId).filter(Boolean))] } })
    .select({ id: 1, label: 1, fieldBindings: 1 }).lean();
  const fb = planFacebook({ occurrences: imported, modulesById: new Map(importedMods.map(m => [m.id, m])), fieldId: fbId });
  log(`Facebook: ${existingFb ? "field exists" : "CREATE field"} · fill ${fb.setValue.length} name(s) · add to ${fb.addBinding.length} card(s) · show on ${fb.unhide.length} more`);

  if (dryRun) { log("DRY RUN — nothing written"); return; }

  for (const { field, spec, toUnhide, setTpl } of plans) {
    if (setTpl) await Field.updateOne({ id: field.id }, { $set: { "meta.linkTemplate": spec.template } });
    for (const mid of toUnhide) {
      await Module.updateOne({ id: mid, "fieldBindings.fieldId": field.id }, { $set: { "fieldBindings.$.hidden": false } });
    }
  }

  if (!existingFb) {
    const userId = imported[0]?.userId || fields[0]?.userId;
    await Field.create({ id: fbId, userId, gridId, name: FACEBOOK.name, type: "text",
      inputEnabled: true, displayEnabled: false, meta: { linkTemplate: FACEBOOK.template } });
  } else if (existingFb.meta?.linkTemplate !== FACEBOOK.template) {
    await Field.updateOne({ id: fbId }, { $set: { "meta.linkTemplate": FACEBOOK.template } });
  }
  const now = new Date().toISOString();
  for (const { id: occId, value } of fb.setValue) {
    await Occurrence.updateOne({ id: occId }, { $set: { [`fields.${fbId}`]: { value, flow: "in", timestamp: now } } });
  }
  for (const mid of fb.addBinding) {
    const m = importedMods.find(x => x.id === mid);
    const order = Math.max(0, ...(m?.fieldBindings || []).map(b => b.order ?? 0)) + 1;
    await Module.updateOne({ id: mid, "fieldBindings.fieldId": { $ne: fbId } },
      { $push: { fieldBindings: { fieldId: fbId, role: "input", order } } });
  }
  for (const mid of fb.unhide) {
    await Module.updateOne({ id: mid, "fieldBindings.fieldId": fbId }, { $set: { "fieldBindings.$.hidden": false } });
  }
  log("done. Restart the server (pm2) so the warm cache serves it.");
}
