// server/migrations/0357-merge-instagram-into-facebook-people.mjs
//
// One person, both links (user, 2026-09-25: "make sure i have both links to
// instagram and facebook (if they have both), use your best discretion").
//
// 0352 merged a Facebook friend and an Instagram account only on an EXACT name
// match, so just 3 people carried both. 62 Instagram accounts were imported as
// separate people with a "possibly the same person as Facebook friend X" note.
// The pairs were checked against the handle (every one of the 62 contains the
// friend's first + last name) plus 6 more matched by handle alone
// (c/g + surname, first-initial + surname); doubtful ones (a different first
// name, a nickname) were left out. The list is built outside git — it names
// people — and read from PEOPLE_PAIRS_PATH:
//
//   { version: 1, pairs: [{ igExternalId, fbExternalId, instagram, facebookName }] }
//
// For each pair, the Facebook person gains what the Instagram row knew and
// lacked: every field that is empty on the Facebook row (the handle, Instagram
// Following Since, …), Found Via UNIONED (minus "unconfirmed" — pairing is the
// confirmation), and Relationship raised to "close friend" when the Instagram
// row said so. The "possibly the same person" note is not carried. The
// Instagram binding is un-hidden so the ↗ link shows. The Instagram-only
// duplicate is then deleted — unless anything outside the People board refers
// to it (a field value, a document embed, another list), in which case it is
// kept and named in the log. Idempotent. Restart pm2 after --apply.

import { decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0357-merge-instagram-into-facebook-people";
export const describe = "Merges each Instagram-only person listed in PEOPLE_PAIRS_PATH into the matching Facebook friend (handle, dates, Found Via), so that card links to both profiles, then removes the duplicate Instagram-only card unless something else refers to it.";
export const touches = ["modules", "occurrences"];

const empty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);
const POSSIBLY = /^Possibly the same person as Facebook friend/i;

/**
 * PURE. `fb`/`ig` are the two occurrences; `f` maps foundVia / relationship /
 * notes / instagram to field ids. Returns the `$set` for the Facebook row.
 */
export function mergeFields(fb, ig, f) {
  const set = {};
  for (const [fid, cell] of Object.entries(ig.fields || {})) {
    const v = cell?.value;
    if (empty(v) || fid === f.foundVia || fid === f.relationship) continue;
    if (fid === f.notes && typeof v === "string" && POSSIBLY.test(v)) continue;
    if (!empty(fb.fields?.[fid]?.value)) continue;
    set[`fields.${fid}`] = { ...cell };
  }
  if (f.foundVia) {
    const a = [].concat(fb.fields?.[f.foundVia]?.value || []), b = [].concat(ig.fields?.[f.foundVia]?.value || []);
    const u = [...new Set([...a, ...b])].filter(x => x !== "unconfirmed");
    if (JSON.stringify(u) !== JSON.stringify(a)) set[`fields.${f.foundVia}`] = { ...(fb.fields?.[f.foundVia] || { flow: "in" }), value: u };
  }
  if (f.relationship && ig.fields?.[f.relationship]?.value === "close friend" && fb.fields?.[f.relationship]?.value !== "close friend") {
    set[`fields.${f.relationship}`] = { ...(fb.fields?.[f.relationship] || { flow: "in" }), value: "close friend" };
  }
  return set;
}

function collectStrings(v, into) {
  if (typeof v === "string") into.add(v);
  else if (Array.isArray(v)) v.forEach(x => collectStrings(x, into));
  else if (v && typeof v === "object") Object.values(v).forEach(x => collectStrings(x, into));
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Field } = models;
  const path = process.env.PEOPLE_PAIRS_PATH;
  const fs = await import("node:fs");
  if (!path || !fs.existsSync(path)) throw new Error(`PEOPLE_PAIRS_PATH is not set or the file is missing (${path || "unset"}) — nothing done`);
  const pairs = JSON.parse(fs.readFileSync(path, "utf8"))?.pairs || [];
  if (!pairs.length) throw new Error("the pairs file lists no pairs — nothing done");

  const fields = await Field.find({ gridId }).lean();
  const one = (name) => { const h = fields.filter(x => (x.name || "").toLowerCase() === name.toLowerCase()); return h.length === 1 ? h[0].id : null; };
  const f = { foundVia: one("Found Via"), relationship: one("Relationship"), notes: one("Person Notes"), instagram: fields.find(x => x.name === "Instagram" && x.type === "text")?.id || null };
  if (!f.instagram) { log("no Instagram text field — refusing"); return; }

  const all = await Occurrence.find({ gridId }).lean();
  const byExt = new Map(all.filter(o => o.meta?.source === "social-import").map(o => [o.meta.externalId, o]));
  const board = all.find(o => (o.occurrences || []).some(id => byExt.get(pairs[0].fbExternalId)?.id === id));

  // Who refers to an occurrence, outside the People board's own list.
  const refs = new Map();
  const bump = (id, by) => { if (!refs.has(id)) refs.set(id, []); refs.get(id).push(by); };
  for (const o of all) {
    const s = new Set(); collectStrings(o.fields || {}, s); s.forEach(id => bump(id, `field on ${o.id}`));
    if (o.id !== board?.id) (o.occurrences || []).forEach(id => bump(id, `listed by ${o.id}`));
    if (o.textmap) {
      try { const t = JSON.stringify(decompressTextmap(o.textmap)); for (const m of t.matchAll(/"occurrenceId":"([^"]+)"/g)) bump(m[1], `embedded in ${o.id}`); } catch { /* unreadable textmap: not a reference we can see */ }
    }
  }

  const merges = [], missing = [];
  for (const p of pairs) {
    const fb = byExt.get(p.fbExternalId), ig = byExt.get(p.igExternalId);
    if (!fb) { missing.push(`${p.facebookName} (Facebook row not found)`); continue; }
    if (!ig) continue; // already merged on an earlier run
    merges.push({ p, fb, ig, set: mergeFields(fb, ig, f), keptBecause: refs.get(ig.id) || null });
  }
  log(`${pairs.length} pairs · ${merges.length} to merge · ${pairs.length - merges.length - missing.length} already merged · ${missing.length} missing`);
  for (const m of merges.slice(0, 12)) log(`   ${m.p.instagram} -> ${m.p.facebookName}${m.keptBecause ? "   (duplicate KEPT: " + m.keptBecause[0] + ")" : ""}`);
  if (merges.length > 12) log(`   … and ${merges.length - 12} more`);
  for (const x of missing) log(`   missing: ${x}`);
  if (dryRun) { log("DRY RUN — nothing written"); return; }

  const mods = new Map((await Module.find({ gridId, id: { $in: merges.map(m => m.fb.moduleId) } }).lean()).map(m => [m.id, m]));
  let removed = 0;
  for (const m of merges) {
    if (Object.keys(m.set).length) await Occurrence.updateOne({ gridId, id: m.fb.id }, { $set: m.set });
    const mod = mods.get(m.fb.moduleId);
    if (mod && (mod.fieldBindings || []).some(b => b.fieldId === f.instagram && b.hidden)) {
      await Module.updateOne({ gridId, id: mod.id, "fieldBindings.fieldId": f.instagram }, { $set: { "fieldBindings.$.hidden": false } });
    } else if (mod && !(mod.fieldBindings || []).some(b => b.fieldId === f.instagram)) {
      await Module.updateOne({ gridId, id: mod.id }, { $push: { fieldBindings: { fieldId: f.instagram, role: "input" } } });
    }
    if (m.keptBecause) continue;
    if (board) await Occurrence.updateOne({ gridId, id: board.id }, { $pull: { occurrences: m.ig.id } });
    await Occurrence.deleteOne({ gridId, id: m.ig.id });
    if (!(await Occurrence.exists({ gridId, moduleId: m.ig.moduleId }))) await Module.deleteOne({ gridId, id: m.ig.moduleId });
    removed++;
  }
  log(`merged ${merges.length} · removed ${removed} duplicate Instagram-only card(s). Restart the server (pm2) so the warm cache serves it.`);
}
