// server/migrations/0366-merge-duplicate-people.mjs
//
// People who ended up on the board twice (or three times) under different
// names — "BornpowerAllah DS" and "Born Power", two cards for one person with
// two Instagram accounts. User, 2026-09-26: "do a sweep of people. theres a ton
// of duplicates with like labels"; the groups were proposed and the uncertain
// ones left out at the user's call ("keep the unsure ones untouched"). The list
// names people, so it lives outside git: PEOPLE_DUP_GROUPS_PATH =
//   { groups: [{ names: [...], ids: [occurrenceId, ...] }] }
//
// Per group: KEEP the card holding the most values. Every other card:
//   - fills the kept card's EMPTY fields (0357's mergeFields: Found Via unioned,
//     "close friend" kept), and list values (Files) are unioned;
//   - a second Instagram handle is not lost: it is added to Person Notes as
//     "Also on Instagram: @handle";
//   - anything else that names it in a field (a task's People pick — "Text
//     Terrell" named the empty Terrell card) is REPOINTED to the kept card;
//   - is then unlisted and deleted. Its module goes too when nothing else
//     places it.
// The kept card's module gains a (visible) binding for any field it now holds.
// Restart pm2 after --apply.

import fs from "node:fs";
import { mergeFields } from "./0357-merge-instagram-into-facebook-people.mjs";

export const id = "0366-merge-duplicate-people";
export const describe = "Merges the listed groups of duplicate People cards (PEOPLE_DUP_GROUPS_PATH) into the fullest card of each group.";
export const touches = ["modules", "occurrences"];

const filled = (v) => v != null && v !== "" && !(Array.isArray(v) && !v.length);
const count = (o) => Object.values(o.fields || {}).filter((c) => filled(c?.value)).length;

/** PURE. `fields` with every occurrence of `fromId` replaced by `toId` (deduped in lists). */
export function repointFields(fields, fromId, toId) {
  const out = {};
  for (const [fid, cell] of Object.entries(fields || {})) {
    const v = cell?.value;
    if (v === fromId) out[fid] = { ...cell, value: toId };
    else if (Array.isArray(v) && v.includes(fromId)) out[fid] = { ...cell, value: [...new Set(v.map((x) => (x === fromId ? toId : x)))] };
  }
  return out;
}

/** PURE. The $set that folds `dup` into `keep`. */
export function planMerge(keep, dup, f) {
  const set = mergeFields(keep, dup, f);
  // Lists other than Found Via (e.g. Files): union, never drop a picture.
  for (const [fid, cell] of Object.entries(dup.fields || {})) {
    if (fid === f.foundVia || !Array.isArray(cell?.value)) continue;
    const a = [].concat(keep.fields?.[fid]?.value || []);
    const u = [...new Set([...a, ...cell.value])];
    if (a.length && u.length !== a.length) set[`fields.${fid}`] = { ...(keep.fields?.[fid] || cell), value: u };
  }
  // A second Instagram handle goes into the notes rather than being dropped.
  const ki = keep.fields?.[f.instagram]?.value, di = dup.fields?.[f.instagram]?.value;
  if (f.notes && filled(ki) && filled(di) && String(ki).toLowerCase() !== String(di).toLowerCase()) {
    const cur = set[`fields.${f.notes}`]?.value ?? keep.fields?.[f.notes]?.value ?? "";
    const line = `Also on Instagram: @${String(di).replace(/^@/, "")}`;
    if (!String(cur).includes(line)) {
      set[`fields.${f.notes}`] = { ...(keep.fields?.[f.notes] || { flow: "in" }), value: cur ? `${cur}\n${line}` : line };
    }
  }
  return set;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Field } = models;
  const file = process.env.PEOPLE_DUP_GROUPS_PATH;
  if (!file || !fs.existsSync(file)) throw new Error(`PEOPLE_DUP_GROUPS_PATH is not set or the file is missing (${file || "unset"}) — nothing done`);
  const groups = JSON.parse(fs.readFileSync(file, "utf8"))?.groups || [];

  const fields = await Field.find({ gridId }).lean();
  const one = (n) => { const h = fields.filter((x) => (x.name || "").toLowerCase() === n.toLowerCase()); return h.length === 1 ? h[0].id : null; };
  const f = { foundVia: one("Found Via"), relationship: one("Relationship"), notes: one("Person Notes"),
    instagram: fields.find((x) => x.name === "Instagram" && x.type === "text")?.id || null };
  if (!f.instagram || !f.notes) { log("missing Instagram or Person Notes field — refusing"); return; }

  const all = await Occurrence.find({ gridId }).lean();
  const byId = new Map(all.map((o) => [o.id, o]));
  // Who refers to a card by id, outside the list that holds it.
  const refsTo = (id) => all.filter((o) => o.id !== id && !(o.occurrences || []).includes(id) && JSON.stringify(o.fields || {}).includes(id)).map((o) => o.id);

  let merged = 0, kept = 0;
  const now = new Date().toISOString();
  for (const g of groups) {
    const cards = (g.ids || []).map((id) => byId.get(id)).filter(Boolean);
    if (cards.length < 2) { log(`   ${g.names.join(" / ")}: ${cards.length} card(s) found — skipped`); continue; }
    const [keep, ...dups] = [...cards].sort((a, b) => count(b) - count(a));
    let cur = { ...keep, fields: { ...keep.fields } };
    const set = {};
    for (const d of dups) {
      const s = planMerge(cur, d, f);
      Object.assign(set, s);
      for (const [k, v] of Object.entries(s)) cur.fields[k.slice(7)] = v;
    }
    const blocked = dups.map((d) => ({ d, refs: refsTo(d.id) }));
    log(`   ${g.names.join(" / ")}: keep ${keep.id.slice(0, 8)} (${count(keep)} values) · fold in ${dups.length} · ${Object.keys(set).length} field(s)` +
      blocked.filter((b) => b.refs.length).map((b) => ` · ${b.refs.length} reference(s) to ${b.d.id.slice(0, 8)} repointed`).join(""));
    if (dryRun) continue;

    if (Object.keys(set).length) {
      for (const k of Object.keys(set)) if (set[k] && typeof set[k] === "object" && !set[k].timestamp) set[k] = { ...set[k], timestamp: now };
      await Occurrence.updateOne({ gridId, id: keep.id }, { $set: set });
      const mod = await Module.findOne({ gridId, id: keep.moduleId }).lean();
      if (mod) {
        let next = (mod.fieldBindings || []).map((b) => (set[`fields.${b.fieldId}`] && b.hidden && b.role === "input" ? { ...b, hidden: false } : b));
        let order = Math.max(0, ...next.map((b) => b.order ?? 0)) + 1;
        for (const k of Object.keys(set)) { const fid = k.slice(7); if (!next.some((b) => b.fieldId === fid)) next.push({ fieldId: fid, role: "input", order: order++ }); }
        await Module.updateOne({ gridId, id: mod.id }, { $set: { fieldBindings: next } });
      }
    }
    for (const { d, refs } of blocked) {
      for (const rid of refs) {
        const r = byId.get(rid);
        const patch = repointFields(r?.fields, d.id, keep.id);
        const $set = Object.fromEntries(Object.entries(patch).map(([fid, cell]) => [`fields.${fid}`, cell]));
        if (Object.keys($set).length) await Occurrence.updateOne({ gridId, id: rid }, { $set });
        else kept++;
      }
      if (refs.some((rid) => !Object.keys(repointFields(byId.get(rid)?.fields, d.id, keep.id)).length)) continue;
      await Occurrence.updateMany({ gridId, occurrences: d.id }, { $pull: { occurrences: d.id } });
      await Occurrence.deleteOne({ gridId, id: d.id });
      if (!(await Occurrence.exists({ gridId, moduleId: d.moduleId }))) await Module.deleteOne({ gridId, id: d.moduleId });
      merged++;
    }
  }
  log(dryRun ? "DRY RUN — nothing written" : `merged away ${merged} card(s)${kept ? `, kept ${kept} still referenced` : ""}. Restart the server (pm2).`);
}
