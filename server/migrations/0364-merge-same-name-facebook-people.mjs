// server/migrations/0364-merge-same-name-facebook-people.mjs
//
// Three names had TWO Facebook-friend cards each (the export listed the name
// twice, so 0352 minted `fb:<name>` and `fb:<name>#2`), and 0363 skipped them
// as ambiguous. User, 2026-09-25: "merge mark, jessey and corinna with each
// other just pic one link". The list — which cards, which profile link, which
// About details — is chosen by hand and read from PEOPLE_FB_MERGE_PATH (outside
// git, it names people):
//
//   { merges: [{ names: ["fb:X", "fb:X#2"], profile_url, about: { birthday, birth_year, … } }] }
//
// Per merge: the card with the OLDER "Facebook Friends Since" is kept; the other
// card's values fill its empty fields (0357's rules — Found Via unioned); the
// earlier friends-since date wins; the duplicate is removed from the board and
// deleted, unless something else refers to it. Then 0363's fill rules apply the
// chosen About details and profile link (empty fields only). Restart pm2 after.

import fs from "node:fs";
import { mergeFields } from "./0357-merge-instagram-into-facebook-people.mjs";
import { valuesFor } from "./0363-facebook-about-into-people.mjs";

export const id = "0364-merge-same-name-facebook-people";
export const describe = "Merges the listed pairs of same-name Facebook friend cards (PEOPLE_FB_MERGE_PATH) into one card each, with one chosen profile link and its About details.";
export const touches = ["modules", "occurrences"];

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Field } = models;
  const file = process.env.PEOPLE_FB_MERGE_PATH;
  if (!file || !fs.existsSync(file)) throw new Error(`PEOPLE_FB_MERGE_PATH is not set or the file is missing (${file || "unset"}) — nothing done`);
  const merges = JSON.parse(fs.readFileSync(file, "utf8"))?.merges || [];

  const fields = await Field.find({ gridId }).lean();
  const id1 = (n) => { const h = fields.filter(x => (x.name || "").toLowerCase() === n.toLowerCase()); return h.length === 1 ? h[0].id : null; };
  const f = {
    birthday: id1("Birthday"), city: id1("City"), hometown: id1("Hometown"),
    relationshipStatus: id1("Relationship Status"), languages: id1("Languages"), gender: id1("Gender"),
    notes: id1("Person Notes"), facebook: id1("Facebook"),
    since: id1("Facebook Friends Since"), howMet: id1("How We Met"),
    foundVia: id1("Found Via"), relationship: id1("Relationship"),
    instagram: fields.find(x => x.name === "Instagram" && x.type === "text")?.id || null,
  };
  const missing = ["birthday", "city", "hometown", "facebook", "since"].filter(k => !f[k]);
  if (missing.length) { log(`missing fields: ${missing.join(", ")} — run 0363 first; refusing`); return; }

  for (const m of merges) {
    const cards = await Occurrence.find({ gridId, "meta.source": "social-import", "meta.externalId": { $in: m.names } }).lean();
    if (cards.length !== 2) { log(`   ${m.names[0]}: found ${cards.length} card(s), expected 2 — skipped`); continue; }
    const since = (o) => o.fields?.[f.since]?.value || "9999";
    const [keep, dup] = [...cards].sort((a, b) => since(a).localeCompare(since(b)));

    const set = mergeFields(keep, dup, f);               // dup fills keep's empty fields; Found Via unioned
    // The earlier friendship is kept; its "How We Met" line goes with it.
    delete set[`fields.${f.since}`]; if (f.howMet) delete set[`fields.${f.howMet}`];
    const merged = { ...keep, fields: { ...keep.fields } };
    for (const [k, v] of Object.entries(set)) merged.fields[k.slice(7)] = v;
    const about = valuesFor(merged, { ...m.about, profile_url: m.profile_url }, f);
    const now = new Date().toISOString();
    for (const [fid, v] of Object.entries(about)) set[`fields.${fid}`] = { ...(merged.fields[fid] || { flow: "in" }), value: v, timestamp: now };

    const refs = await Occurrence.countDocuments({ gridId, occurrences: dup.id });
    log(`   ${m.names[0].slice(3)}: keep ${keep.meta.externalId} (since ${since(keep)}), remove ${dup.meta.externalId} · link ${m.profile_url} · ${Object.keys(set).length} field(s)`);
    if (dryRun) continue;

    if (Object.keys(set).length) await Occurrence.updateOne({ gridId, id: keep.id }, { $set: set });
    const mod = await Module.findOne({ gridId, id: keep.moduleId }).lean();
    if (mod) {
      const next = (mod.fieldBindings || []).map(b => (set[`fields.${b.fieldId}`] && b.hidden && b.role === "input" ? { ...b, hidden: false } : b));
      let order = Math.max(0, ...next.map(b => b.order ?? 0)) + 1;
      for (const k of Object.keys(set)) { const fid = k.slice(7); if (!next.some(b => b.fieldId === fid)) next.push({ fieldId: fid, role: "input", order: order++ }); }
      await Module.updateOne({ gridId, id: mod.id }, { $set: { fieldBindings: next } });
    }
    // Remove the duplicate: unlisted from its board, then deleted (its module
    // too when nothing else places it).
    await Occurrence.updateMany({ gridId, occurrences: dup.id }, { $pull: { occurrences: dup.id } });
    await Occurrence.deleteOne({ gridId, id: dup.id });
    if (!(await Occurrence.exists({ gridId, moduleId: dup.moduleId }))) await Module.deleteOne({ gridId, id: dup.moduleId });
    if (refs > 1) log(`      note: the duplicate was listed in ${refs} places; unlisted from all`);
  }
  log(dryRun ? "DRY RUN — nothing written" : "done. Restart the server (pm2) so the warm cache serves it.");
}
