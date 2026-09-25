// server/migrations/0359-people-from-instagram-csv.mjs
//
// Instagram photos + full-name merges (user, 2026-09-25: "merge my instagram
// csv with names and images to my people section … also merge based on the full
// name too. so if i had a tclark instagram person and a tim clark facebook
// person … merge those two occurances … i mostly want the images linked on
// there for their cover photos" / "if the merged occurance has two images … add
// both of them to the record").
//
// The CSV is the user's Instagram following list scraped from the page
// (`text` = "<handle> · Follow <Display Name> Remove", `href` = the profile,
// `src` = the photo). It names other people, so it lives outside git and is
// read from PEOPLE_IG_CSV_PATH. It is the WHOLE following list; 0352 imported
// only the obvious people (celebrities and brands skipped), so a row that
// matches nobody is expected and is left alone — nothing new is created.
//
// ── WHO A ROW IS ─────────────────────────────────────────────────────────────
//   by handle   the Instagram card (`meta.externalId` "ig:<handle>", labelled
//               by its handle), or a card whose Instagram field holds it
//   by name     a Facebook card whose label is the same full name (normalized:
//               Unicode "bold" letters folded, accents and punctuation dropped),
//               or failing that the same first + last name (a middle name or
//               initial allowed). Two words at least, and exactly ONE card —
//               an ambiguous or one-word name is never matched by name.
// When both hit DIFFERENT cards, the Instagram card merges into the Facebook
// one with 0357's rules (empty fields filled, Found Via unioned, the Instagram
// binding shown), its pictures carried over, and the duplicate removed unless
// something outside the People board refers to it. A name-only match gains the
// handle.
//
// ── PHOTOS ───────────────────────────────────────────────────────────────────
// Downloaded, never linked: the CDN URLs expire (`oe=`). Stored like 0355 in
// uploads/user/<YYYY-MM>/ as an image artifact in Files/Images/People. A person
// with no picture gets it as their cover (the "media" field) and first in their
// files; a person who already has a different picture KEEPS their cover and
// gains this one in their files, so both are on the record. The same image
// (by sha256) is never added twice. Idempotent. Restart pm2 after --apply.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FILES_FOLDER_NAME } from "../utils/protectedFolders.js";
import { yearMonthShard } from "../utils/uploadKinds.js";
import { commonBindingField } from "./0355-people-photos-from-facebook.mjs";
import { mergeFields } from "./0357-merge-instagram-into-facebook-people.mjs";
import { decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0359-people-from-instagram-csv";
export const describe = "Reads the Instagram following CSV at PEOPLE_IG_CSV_PATH: merges each Instagram card into the Facebook friend with the same full name, gives name-matched Facebook friends their handle, and adds each matched person's Instagram photo (as the cover when they have none, otherwise alongside the existing one).";
export const touches = ["modules", "occurrences", "folders"];

const MAX_BYTES = 5 * 1024 * 1024;
const EXT_BY_TYPE = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

/** Minimal RFC-4180 CSV reader (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text) {
  const rows = []; let row = [], f = "", q = false;
  const t = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

export const normName = (s) => String(s || "").normalize("NFKC").normalize("NFD")
  .replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** CSV text -> [{ handle, name, src }]. */
export function readRows(text) {
  const [head, ...rest] = parseCsv(text);
  if (!head) return [];
  const col = Object.fromEntries(head.map((k, i) => [k.trim(), i]));
  const out = [];
  for (const r of rest) {
    const href = r[col.href] || "";
    const handle = (href.match(/instagram\.com\/([^/?#]+)/i) || [])[1];
    if (!handle) continue;
    let name = String(r[col.text] || "").normalize("NFKC").replace(/\b(Remove|Following|Follow)\s*$/, "").trim();
    if (name.toLowerCase().startsWith(handle.toLowerCase())) name = name.slice(handle.length);
    name = name.replace(/^\s*·\s*(Follow\s*)?/, "").trim();
    if (normName(name) === normName(handle)) name = "";
    out.push({ handle, name, src: r[col.src] || "" });
  }
  return out;
}

/**
 * PURE. Which card each row is, which Instagram cards merge into which
 * Facebook cards, and who gets which photo.
 * `people` are the social-import occurrences; `labelOf(occ)` their name.
 */
export function planRows({ rows, people, labelOf, igFieldId }) {
  const byHandle = new Map(), byName = new Map(), fbCards = [];
  const put = (m, k, o) => { if (!k) return; if (!m.has(k)) m.set(k, []); if (!m.get(k).includes(o)) m.get(k).push(o); };
  for (const o of people) {
    const ext = String(o.meta?.externalId || "");
    if (ext.startsWith("ig:")) put(byHandle, ext.slice(3).toLowerCase(), o);
    const hv = o.fields?.[igFieldId]?.value;
    if (typeof hv === "string" && hv) put(byHandle, hv.replace(/^@/, "").toLowerCase(), o);
    if (ext.startsWith("fb:")) { put(byName, normName(labelOf(o)), o); fbCards.push(o); }
  }
  const toks = (s) => normName(s).split(" ").filter(Boolean);
  const nameHit = (name) => {
    const t = toks(name);
    if (t.length < 2) return null;
    const exact = byName.get(t.join(" ")) || [];
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;
    const loose = fbCards.filter(o => { const l = toks(labelOf(o)); return l.length >= 2 && l[0] === t[0] && l[l.length - 1] === t[t.length - 1]; });
    return loose.length === 1 ? loose[0] : null;
  };

  const merges = [], handles = [], photos = [], unmatched = [];
  const seenTarget = new Set(), claimed = new Set();
  for (const r of rows) {
    const handle = r.handle.toLowerCase();
    const h = byHandle.get(handle) || [];
    let fb = r.name ? nameHit(r.name) : null;
    // A Facebook friend already linked to a DIFFERENT handle is someone else.
    const fbHandle = fb?.fields?.[igFieldId]?.value;
    if (fb && typeof fbHandle === "string" && fbHandle && fbHandle.replace(/^@/, "").toLowerCase() !== handle) fb = null;
    const igCard = h.find(o => String(o.meta?.externalId || "").startsWith("ig:")) || null;
    // One CSV row per person: a second handle claiming someone already
    // claimed this run (a person's business account, say) is left alone.
    if (fb && (seenTarget.has(fb.id) || claimed.has(fb.id))) fb = null;
    let target;
    if (fb && igCard && igCard.id !== fb.id) { merges.push({ ig: igCard, fb, handle: r.handle, name: r.name }); target = fb; }
    else if (h.length) target = fb && h.includes(fb) ? fb : h[0];
    else if (fb) { handles.push({ occ: fb, handle: r.handle }); target = fb; }
    else { unmatched.push(r); continue; }
    claimed.add(target.id);
    if (r.src && !seenTarget.has(target.id)) { seenTarget.add(target.id); photos.push({ occId: target.id, url: r.src, name: labelOf(target) || r.name || r.handle }); }
  }
  return { merges, handles, photos, unmatched };
}

async function download(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: "follow" });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const type = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!EXT_BY_TYPE[type]) return { error: `not an image (${type || "no type"})` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return { error: `bad size ${buf.length}` };
    return { buf, type };
  } catch (e) {
    return { error: e.name === "AbortError" ? "timed out" : e.message };
  } finally { clearTimeout(t); }
}

function collectStrings(v, into) {
  if (typeof v === "string") into.add(v);
  else if (Array.isArray(v)) v.forEach(x => collectStrings(x, into));
  else if (v && typeof v === "object") Object.values(v).forEach(x => collectStrings(x, into));
}

const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Field, Folder, Manifest } = models;
  const file = process.env.PEOPLE_IG_CSV_PATH;
  if (!file || !fs.existsSync(file)) throw new Error(`PEOPLE_IG_CSV_PATH is not set or the file is missing (${file || "unset"}) — nothing done`);
  const rows = readRows(fs.readFileSync(file, "utf8"));
  if (!rows.length) throw new Error("the CSV has no Instagram rows — nothing done");

  const fields = await Field.find({ gridId }).lean();
  const one = (name) => { const h = fields.filter(x => (x.name || "").toLowerCase() === name.toLowerCase()); return h.length === 1 ? h[0].id : null; };
  const f = { foundVia: one("Found Via"), relationship: one("Relationship"), notes: one("Person Notes"), instagram: fields.find(x => x.name === "Instagram" && x.type === "text")?.id || null };
  if (!f.instagram) { log("no Instagram text field — refusing"); return; }

  const people = await Occurrence.find({ gridId, "meta.source": "social-import" }).lean();
  if (!people.length) { log("no imported people on this grid"); return; }
  const mods = await Module.find({ gridId, id: { $in: [...new Set(people.map(o => o.moduleId))] } }).lean();
  const modulesById = new Map(mods.map(m => [m.id, m]));
  const labelOf = (o) => modulesById.get(o.moduleId)?.label || o.label || "";
  const mediaFieldId = commonBindingField(mods, "media");
  const filesFieldId = commonBindingField(mods, "files");
  if (!mediaFieldId) { log("no person binds a picture (media) field — refusing to guess which field holds a photo"); return; }
  const mediaOf = (o) => (modulesById.get(o.moduleId)?.fieldBindings || []).find(b => b?.role === "media")?.fieldId || mediaFieldId;
  const filesOf = (o) => (modulesById.get(o.moduleId)?.fieldBindings || []).find(b => b?.role === "files")?.fieldId || filesFieldId;

  const plan = planRows({ rows, people, labelOf, igFieldId: f.instagram });
  log(`${rows.length} CSV rows · ${plan.merges.length} Instagram card(s) to merge into a Facebook friend · ${plan.handles.length} Facebook friend(s) gain their handle · ${plan.photos.length} photo(s) · ${plan.unmatched.length} row(s) match nobody (left alone)`);
  for (const m of plan.merges.slice(0, 15)) log(`   merge ${m.handle} -> ${labelOf(m.fb)}`);
  if (plan.merges.length > 15) log(`   … and ${plan.merges.length - 15} more`);
  for (const x of plan.handles.slice(0, 15)) log(`   handle ${x.handle} -> ${labelOf(x.occ)}`);
  if (plan.handles.length > 15) log(`   … and ${plan.handles.length - 15} more`);

  // Existing pictures' hashes, so the same image is never added twice.
  const personArtIds = new Set();
  for (const o of people) for (const fid of [mediaOf(o), filesOf(o)]) if (fid) asList(o.fields?.[fid]?.value).forEach(v => typeof v === "string" && personArtIds.add(v));
  const artOccs = await Occurrence.find({ gridId, id: { $in: [...personArtIds] } }).select({ id: 1, moduleId: 1 }).lean();
  const artMods = new Map((await Module.find({ gridId, id: { $in: artOccs.map(a => a.moduleId) } }).select({ id: 1, meta: 1 }).lean()).map(m => [m.id, m]));
  const shaOfArt = new Map(artOccs.map(a => [a.id, artMods.get(a.moduleId)?.meta?.sha256 || null]));

  if (dryRun) {
    if (plan.photos[0]) {
      const probe = await download(plan.photos[0].url);
      log(`probe download of the first photo: ${probe.error ? `FAILED (${probe.error}) — the links may have expired` : `ok (${probe.buf.length} bytes, ${probe.type})`}`);
    }
    log("DRY RUN — nothing written");
    return;
  }

  // ── 1. Merges (0357's rules) + the pictures the Instagram card carried ──
  const all = await Occurrence.find({ gridId }).lean();
  const board = all.find(o => (o.occurrences || []).includes(plan.merges[0]?.fb.id));
  const refs = new Map();
  const bump = (i, by) => { if (!refs.has(i)) refs.set(i, []); refs.get(i).push(by); };
  for (const o of all) {
    const s = new Set(); collectStrings(o.fields || {}, s); s.forEach(i => bump(i, `field on ${o.id}`));
    if (o.id !== board?.id) (o.occurrences || []).forEach(i => bump(i, `listed by ${o.id}`));
    if (o.textmap) { try { const t = JSON.stringify(decompressTextmap(o.textmap)); for (const m of t.matchAll(/"occurrenceId":"([^"]+)"/g)) bump(m[1], `embedded in ${o.id}`); } catch { /* unreadable */ } }
  }
  const byId = new Map(people.map(o => [o.id, o]));
  const now = new Date().toISOString();
  let merged = 0, removed = 0;
  for (const m of plan.merges) {
    const fb = byId.get(m.fb.id), ig = m.ig;
    const set = mergeFields(fb, ig, f);
    const fbMedia = mediaOf(fb), fbFiles = filesOf(fb);
    const igPics = [...asList(ig.fields?.[mediaOf(ig)]?.value), ...asList(ig.fields?.[filesOf(ig)]?.value)].filter(v => typeof v === "string");
    const cover = fb.fields?.[fbMedia]?.value || igPics[0] || null;
    if (!fb.fields?.[fbMedia]?.value && cover) set[`fields.${fbMedia}`] = { value: cover, flow: "in", timestamp: now };
    delete set[`fields.${mediaOf(ig)}`]; delete set[`fields.${filesOf(ig)}`];
    if (fbFiles) {
      const list = [...new Set([...asList(fb.fields?.[fbFiles]?.value), ...igPics])];
      if (list.length) set[`fields.${fbFiles}`] = { value: list, main: cover || list[0], flow: "in", timestamp: now };
    }
    if (Object.keys(set).length) await Occurrence.updateOne({ gridId, id: fb.id }, { $set: set });
    // Keep the in-memory row current so the photo step sees the merged pictures.
    const next = { ...fb, fields: { ...fb.fields } };
    for (const [k, v] of Object.entries(set)) next.fields[k.slice("fields.".length)] = v;
    byId.set(fb.id, next);
    const mod = modulesById.get(fb.moduleId);
    if (mod && (mod.fieldBindings || []).some(b => b.fieldId === f.instagram && b.hidden)) {
      await Module.updateOne({ gridId, id: mod.id, "fieldBindings.fieldId": f.instagram }, { $set: { "fieldBindings.$.hidden": false } });
    } else if (mod && !(mod.fieldBindings || []).some(b => b.fieldId === f.instagram)) {
      await Module.updateOne({ gridId, id: mod.id }, { $push: { fieldBindings: { fieldId: f.instagram, role: "input" } } });
    }
    merged++;
    const outside = refs.get(ig.id) || [];
    if (outside.length) { log(`   kept ${m.handle}'s own card: ${outside[0]}`); continue; }
    if (board) await Occurrence.updateOne({ gridId, id: board.id }, { $pull: { occurrences: ig.id } });
    await Occurrence.deleteOne({ gridId, id: ig.id });
    if (!(await Occurrence.exists({ gridId, moduleId: ig.moduleId }))) await Module.deleteOne({ gridId, id: ig.moduleId });
    removed++;
  }

  // ── 2. Name-only matches gain their handle ──
  for (const h of plan.handles) {
    const o = byId.get(h.occ.id);
    if (o?.fields?.[f.instagram]?.value) continue;
    await Occurrence.updateOne({ gridId, id: o.id }, { $set: { [`fields.${f.instagram}`]: { value: h.handle, flow: "in", timestamp: now } } });
    const mod = modulesById.get(o.moduleId);
    if (mod && (mod.fieldBindings || []).some(b => b.fieldId === f.instagram && b.hidden)) {
      await Module.updateOne({ gridId, id: mod.id, "fieldBindings.fieldId": f.instagram }, { $set: { "fieldBindings.$.hidden": false } });
    } else if (mod && !(mod.fieldBindings || []).some(b => b.fieldId === f.instagram)) {
      await Module.updateOne({ gridId, id: mod.id }, { $push: { fieldBindings: { fieldId: f.instagram, role: "input" } } });
    }
  }

  // ── 3. Photos ──
  const manifest = await Manifest.findOne({ gridId, manifestType: "user" }).lean();
  const folders = manifest ? await Folder.find({ gridId, userId: manifest.userId }).lean() : [];
  const filesF = folders.find(x => x.parentId === manifest?.rootFolderId && x.name === FILES_FOLDER_NAME);
  const imagesF = filesF && folders.find(x => x.parentId === filesF.id && x.name === "Images");
  let peopleF = imagesF && folders.find(x => x.parentId === imagesF.id && x.name === "People");
  const userId = people[0].userId;
  if (imagesF && !peopleF) {
    peopleF = { id: crypto.randomUUID(), userId: manifest.userId, gridId, parentId: imagesF.id, name: "People", folderType: "normal", sortOrder: 0, meta: {} };
    await Folder.create(peopleF);
  }
  const uploadsRoot = fileURLToPath(new URL("../uploads/", import.meta.url));
  const shard = yearMonthShard();
  const dir = path.join(uploadsRoot, "user", shard);
  fs.mkdirSync(dir, { recursive: true });

  let covers = 0, added = 0, same = 0; const failed = [];
  const queue = [...plan.photos];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const occ = byId.get(job.occId);
      if (!occ) continue;
      const got = await download(job.url);
      if (got.error) { failed.push(`${job.name}: ${got.error}`); continue; }
      const sha = crypto.createHash("sha256").update(got.buf).digest("hex");
      const mediaFid = mediaOf(occ), filesFid = filesOf(occ);
      const have = [...asList(occ.fields?.[mediaFid]?.value), ...asList(filesFid ? occ.fields?.[filesFid]?.value : null)];
      if (have.some(a => shaOfArt.get(a) === sha)) { same++; continue; }
      const name = `ig-${sha.slice(0, 20)}.${EXT_BY_TYPE[got.type]}`;
      const dest = path.join(dir, name);
      if (!fs.existsSync(dest)) fs.writeFileSync(dest, got.buf);
      const artMod = crypto.randomUUID(), artOcc = crypto.randomUUID();
      await Module.create({ id: artMod, userId, gridId, label: job.name, role: "artifact", kind: "image",
        fileRef: `user/${shard}/${name}`,
        meta: { mimeType: got.type, sha256: sha, uploadSize: got.buf.length, originalName: `${job.name}.${EXT_BY_TYPE[got.type]}`, source: "instagram-photo" } });
      await Occurrence.create({ id: artOcc, userId, gridId, moduleId: artMod, targetId: artMod, targetType: "module",
        parentId: peopleF?.id || null, occurrences: [], fields: {} });
      shaOfArt.set(artOcc, sha);

      const cover = occ.fields?.[mediaFid]?.value || null;
      const set = {};
      if (!cover) { set[`fields.${mediaFid}`] = { value: artOcc, flow: "in", timestamp: now }; covers++; } else added++;
      if (filesFid) {
        const prev = asList(occ.fields?.[filesFid]?.value).filter(x => x !== artOcc);
        const list = cover ? [...(prev.includes(cover) ? prev : [cover, ...prev]), artOcc] : [artOcc, ...prev];
        set[`fields.${filesFid}`] = { value: list, main: cover || artOcc, flow: "in", timestamp: now };
      }
      await Occurrence.updateOne({ gridId, id: occ.id }, { $set: set });
      const mod = modulesById.get(occ.moduleId);
      const addBind = [];
      if (!(mod?.fieldBindings || []).some(b => b?.fieldId === mediaFid)) addBind.push({ fieldId: mediaFid, role: "media", hidden: true });
      if (filesFid && !(mod?.fieldBindings || []).some(b => b?.fieldId === filesFid)) addBind.push({ fieldId: filesFid, role: "files", hidden: true });
      if (addBind.length) await Module.updateOne({ gridId, id: occ.moduleId }, { $push: { fieldBindings: { $each: addBind } } });
      if (!mod?.meta?.mediaInline) await Module.updateOne({ gridId, id: occ.moduleId }, { $set: { "meta.mediaInline": true } });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);

  log(`merged ${merged} (removed ${removed} duplicate card(s)) · ${plan.handles.length} handle(s) added · photos: ${covers} new cover(s), ${added} added beside an existing picture, ${same} already there · ${failed.length} failed`);
  for (const x of failed.slice(0, 15)) log(`   failed: ${x}`);
  log("done. Restart the server (pm2) so the warm cache serves it.");
}
