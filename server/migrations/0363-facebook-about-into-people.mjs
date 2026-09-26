// server/migrations/0363-facebook-about-into-people.mjs
//
// What each Facebook friend's About → Personal details shows, onto the People
// board (user, 2026-09-25: "follow the links … see if we can grab extra info
// like birthdays" → a one-off browser extension read every friend's Personal
// details into a CSV, cleaned into PEOPLE_FB_ABOUT_PATH — outside git, it
// names people).
//
// Columns read: name, profile_url, birthday ("July 4"), birth_year, current_city,
// hometown, relationship (Facebook's status line), family, gender, languages.
//
// MATCH: an imported Facebook person (`fb:` externalId) whose label — or whose
// Facebook field value, the name 0354 wrote for its search link — is the same
// name (case/accents/punctuation folded), or the same first + last name. Exactly
// one person or none: an ambiguous name is reported, never guessed. Unmatched
// friends are listed, not added (user's choice).
//
// FILL ONLY WHAT IS EMPTY:
//   Birthday (date)              when the year is known   YYYY-MM-DD
//   Birthday (month/day) (text)  when it is not           "July 4" — nothing invented
//   City · Hometown · Relationship Status · Languages (text) · Gender (select,
//     mapped onto its options: male / female / non-binary / other)
//   Person Notes                 "Family: …" added as a line (kept if there already)
//   Facebook                     their real profile link. The field's link
//                                template becomes `{value}`, and every person NOT
//                                matched keeps a working link: their name becomes
//                                the full search URL it used to build.
// `Relationship` is untouched — it is how they relate to YOU (friend / close
// friend), not their status. New fields are created by name when missing; a
// field that gets a value is bound (and shown) on that person. Restart pm2 after.

import crypto from "node:crypto";
import fs from "node:fs";
import { parseCsv } from "./0359-people-from-instagram-csv.mjs";

export const id = "0363-facebook-about-into-people";
export const describe = "Fills each matched Facebook friend's empty person fields from the About-page CSV at PEOPLE_FB_ABOUT_PATH (birthday, city, hometown, relationship status, gender, languages, family in notes) and switches the Facebook field to real profile links.";
export const touches = ["modules", "occurrences", "fields"];

export const NEW_TEXT_FIELDS = ["Birthday (month/day)", "Hometown", "Relationship Status", "Languages"];
const MONTH = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

export const fold = (s) => String(s ?? "").normalize("NFKC").normalize("NFD")
  .replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function isoBirthday(day, year) {
  const m = String(day || "").match(/^([A-Za-z]+) (\d{1,2})$/);
  if (!m || !/^\d{4}$/.test(String(year || "")) || !MONTH[m[1].toLowerCase()]) return null;
  return `${year}-${String(MONTH[m[1].toLowerCase()]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
}

export function genderOption(g) {
  const v = String(g || "").trim().toLowerCase();
  if (!v) return null;
  if (v === "male" || v === "man") return "male";
  if (v === "female" || v === "woman") return "female";
  if (/non.?binary|nonbinary|enby/.test(v)) return "non-binary";
  return "other";
}

/**
 * PURE. Rows → `{ matches: [{ occ, row }], unmatched: [row], ambiguous: [row] }`.
 * `people` are the fb: people; `labelOf(occ)`; `fbValueOf(occ)` the Facebook field.
 */
export function matchRows({ rows, people, labelOf, fbValueOf }) {
  const exact = new Map(), loose = new Map();
  const put = (m, k, o) => { if (!k) return; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(o); };
  for (const o of people) {
    for (const n of [labelOf(o), fbValueOf(o)]) {
      const f = fold(n); if (!f) continue;
      put(exact, f, o);
      const t = f.split(" "); if (t.length >= 2) put(loose, `${t[0]} ${t[t.length - 1]}`, o);
    }
  }
  const matches = [], unmatched = [], ambiguous = [], taken = new Set();
  for (const row of rows) {
    const f = fold(row.name);
    if (!f) continue;
    let hits = exact.get(f);
    if (!hits) { const t = f.split(" "); hits = t.length >= 2 ? loose.get(`${t[0]} ${t[t.length - 1]}`) : null; }
    if (!hits) { unmatched.push(row); continue; }
    if (hits.size !== 1) { ambiguous.push(row); continue; }
    const occ = [...hits][0];
    if (taken.has(occ.id)) { ambiguous.push(row); continue; }
    taken.add(occ.id);
    matches.push({ occ, row });
  }
  return { matches, unmatched, ambiguous };
}

/** PURE. The field values one matched person gains (only where empty). */
export function valuesFor(occ, row, f) {
  const cur = (fid) => occ.fields?.[fid]?.value;
  const empty = (fid) => fid && (cur(fid) == null || cur(fid) === "" || (Array.isArray(cur(fid)) && !cur(fid).length));
  const set = {};
  const put = (fid, v) => { if (fid && v && empty(fid)) set[fid] = v; };
  const iso = isoBirthday(row.birthday, row.birth_year);
  if (iso) put(f.birthday, iso);
  else if (row.birthday && empty(f.birthday)) put(f.birthdayMonthDay, row.birthday);
  put(f.city, row.current_city);
  put(f.hometown, row.hometown);
  put(f.relationshipStatus, row.relationship);
  put(f.languages, row.languages);
  put(f.gender, genderOption(row.gender));
  if (row.family && f.notes) {
    const notes = String(cur(f.notes) || "");
    if (!/(^|\n)Family: /.test(notes)) set[f.notes] = notes ? `${notes}\nFamily: ${row.family}` : `Family: ${row.family}`;
  }
  if (f.facebook && row.profile_url && !/^https?:\/\/[^/]*facebook\.com\/(?!search)/i.test(String(cur(f.facebook) || ""))) {
    set[f.facebook] = row.profile_url;
  }
  return set;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Field } = models;
  const file = process.env.PEOPLE_FB_ABOUT_PATH;
  if (!file || !fs.existsSync(file)) throw new Error(`PEOPLE_FB_ABOUT_PATH is not set or the file is missing (${file || "unset"}) — nothing done`);
  const [head, ...body] = parseCsv(fs.readFileSync(file, "utf8"));
  const rows = body.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));

  const fields = await Field.find({ gridId }).lean();
  const byName = (n) => { const h = fields.filter(x => (x.name || "").toLowerCase() === n.toLowerCase()); return h.length === 1 ? h[0] : null; };
  const f = {
    birthday: byName("Birthday")?.id, city: byName("City")?.id, gender: byName("Gender")?.id,
    notes: byName("Person Notes")?.id, facebook: byName("Facebook")?.id,
  };
  const missing = Object.entries(f).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) { log(`missing or ambiguous fields: ${missing.join(", ")} — refusing`); return; }

  const people = await Occurrence.find({ gridId, "meta.source": "social-import", "meta.externalId": /^fb:/ }).lean();
  const mods = new Map((await Module.find({ gridId, id: { $in: [...new Set(people.map(o => o.moduleId))] } }).lean()).map(m => [m.id, m]));
  const labelOf = (o) => mods.get(o.moduleId)?.label || o.label || "";
  const fbValueOf = (o) => o.fields?.[f.facebook]?.value || "";
  const { matches, unmatched, ambiguous } = matchRows({ rows, people, labelOf, fbValueOf });

  const newIds = {};
  for (const name of NEW_TEXT_FIELDS) newIds[name] = byName(name)?.id || null;
  f.birthdayMonthDay = newIds["Birthday (month/day)"] || "__new_Birthday (month/day)";
  f.hometown = newIds["Hometown"] || "__new_Hometown";
  f.relationshipStatus = newIds["Relationship Status"] || "__new_Relationship Status";
  f.languages = newIds["Languages"] || "__new_Languages";

  const plans = matches.map(({ occ, row }) => ({ occ, row, set: valuesFor(occ, row, f) })).filter(p => Object.keys(p.set).length);
  const count = (fid) => plans.filter(p => p.set[fid]).length;
  log(`${rows.length} CSV rows · ${matches.length} matched · ${unmatched.length} not on the board · ${ambiguous.length} ambiguous (skipped)`);
  log(`fills: birthday ${count(f.birthday)} · birthday (month/day) ${count(f.birthdayMonthDay)} · city ${count(f.city)} · hometown ${count(f.hometown)} · relationship status ${count(f.relationshipStatus)} · gender ${count(f.gender)} · languages ${count(f.languages)} · family note ${count(f.notes)} · facebook profile link ${count(f.facebook)}`);
  for (const r of ambiguous.slice(0, 15)) log(`   ambiguous: ${r.name}`);
  log(`   not on the board: ${unmatched.slice(0, 25).map(r => r.name).join(", ")}${unmatched.length > 25 ? ` … +${unmatched.length - 25}` : ""}`);
  const convert = people.filter(o => { const v = fbValueOf(o); return v && !/^https?:/i.test(v) && !plans.some(p => p.occ.id === o.id && p.set[f.facebook]); });
  log(`Facebook field → real links; ${convert.length} unmatched people keep a working search link`);
  if (dryRun) { log("DRY RUN — nothing written"); return; }

  const userId = people[0]?.userId;
  for (const name of NEW_TEXT_FIELDS) {
    if (newIds[name]) continue;
    const fid = crypto.randomUUID();
    await Field.create({ id: fid, userId, gridId, name, type: "text", inputEnabled: true, displayEnabled: false, meta: {} });
    const key = { "Birthday (month/day)": "birthdayMonthDay", Hometown: "hometown", "Relationship Status": "relationshipStatus", Languages: "languages" }[name];
    for (const p of plans) if (p.set[f[key]] !== undefined) { p.set[fid] = p.set[f[key]]; delete p.set[f[key]]; }
    f[key] = fid;
    log(`CREATE field "${name}"`);
  }
  await Field.updateOne({ gridId, id: f.facebook }, { $set: { "meta.linkTemplate": "{value}" } });

  const now = new Date().toISOString();
  for (const p of plans) {
    const $set = Object.fromEntries(Object.entries(p.set).map(([fid, v]) => [`fields.${fid}`, { ...(p.occ.fields?.[fid] || { flow: "in" }), value: v, timestamp: now }]));
    await Occurrence.updateOne({ gridId, id: p.occ.id }, { $set });
    const mod = mods.get(p.occ.moduleId);
    if (!mod) continue;
    const next = (mod.fieldBindings || []).map(b => (p.set[b.fieldId] && b.hidden && b.role !== "media" && b.role !== "files" ? { ...b, hidden: false } : b));
    let order = Math.max(0, ...next.map(b => b.order ?? 0)) + 1;
    for (const fid of Object.keys(p.set)) if (!next.some(b => b.fieldId === fid)) next.push({ fieldId: fid, role: "input", order: order++ });
    if (JSON.stringify(next) !== JSON.stringify(mod.fieldBindings || [])) {
      await Module.updateOne({ gridId, id: mod.id }, { $set: { fieldBindings: next } });
      mod.fieldBindings = next;   // a module shared by two people is updated once, then extended
    }
  }
  for (const o of convert) {
    await Occurrence.updateOne({ gridId, id: o.id }, { $set: { [`fields.${f.facebook}.value`]: `https://www.facebook.com/search/people/?q=${encodeURIComponent(fbValueOf(o))}` } });
  }
  log(`updated ${plans.length} people · ${convert.length} search links kept working. Restart the server (pm2).`);
}
