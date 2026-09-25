// server/migrations/0355-people-photos-from-facebook.mjs
//
// Profile photos for the people 0352 imported from Facebook (user, 2026-09-25:
// "can you map these images to my people"). The user collected each friend's
// photo URL from their own friends list; the file is built outside git (names
// are other people's data) and read from PEOPLE_PHOTOS_PATH:
//
//   { version: 1, photos: [{ externalId, name, url, wasName? }] }
//
// externalId is 0352's (`fb:<name>`), so the match is exact, never by label.
//
// ── THE BYTES ARE DOWNLOADED, NOT LINKED ─────────────────────────────────────
// The URLs are signed Facebook CDN links that EXPIRE (the `oe=` parameter —
// the earliest in the file lapses 2026-09-29). Storing the URL as the fileRef
// would render for a few days and then break on every card at once. So each
// photo is fetched here and written to uploads/user/<YYYY-MM>/, exactly where
// an upload lands; the fileRef names the local file.
//
// ── WHAT EACH PERSON GETS ────────────────────────────────────────────────────
// An image artifact homed in Files/Images/People (created if missing), set as
// the person's picture: the field their module binds with role "media" (bound,
// hidden, from the board's most common media field when missing) and prepended
// to the role "files" field. A person who already has a picture is SKIPPED —
// a photo the user chose is never replaced.
//
// ── NAME REPAIR ──────────────────────────────────────────────────────────────
// Facebook's export writes UTF-8 bytes as Latin-1 escapes, so 0352 stored six
// names as mojibake ("InÃªs", "Ray Petersen (ç\u0099½…)"). Where the stored
// label is still exactly the broken form (`wasName`), the label and Name value
// are corrected. externalId is left as it was — it is an identity, not a label.
//
// Idempotent. A failed download (expired or unreachable URL) is reported and
// skipped; a re-run retries only those. Restart pm2 after --apply.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FILES_FOLDER_NAME } from "../utils/protectedFolders.js";
import { yearMonthShard } from "../utils/uploadKinds.js";

export const id = "0355-people-photos-from-facebook";
export const describe = "Downloads each Facebook friend's profile photo listed in PEOPLE_PHOTOS_PATH, stores it as an image in Files/Images/People and sets it as that person's picture (people who already have one are skipped); also repairs 6 mojibake names from the Facebook export.";
export const touches = ["modules", "occurrences", "folders"];

const MAX_BYTES = 5 * 1024 * 1024;
const EXT_BY_TYPE = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

const fieldVal = (o, fid) => (fid ? o?.fields?.[fid]?.value : undefined);
const hasValue = (v) => (Array.isArray(v) ? v.length > 0 : v != null && v !== "");

/** The field id most people on the board bind with `role`, or null. */
export function commonBindingField(modules, role) {
  const counts = new Map();
  for (const m of modules) {
    const b = (m?.fieldBindings || []).find(x => x?.role === role && x.fieldId);
    if (b) counts.set(b.fieldId, (counts.get(b.fieldId) || 0) + 1);
  }
  let best = null, n = 0;
  for (const [fid, c] of counts) if (c > n) { best = fid; n = c; }
  return best;
}

/**
 * PURE — which people get a photo, and which names are repaired.
 * `occurrences` are the social-import people; `modulesById` a Map.
 */
export function planPhotos({ photos, occurrences, modulesById, mediaFieldId }) {
  const byExt = new Map();
  for (const o of occurrences) if (o?.meta?.externalId) byExt.set(o.meta.externalId, o);
  const fetches = [], renames = [];
  let notFound = 0, alreadyHas = 0;
  for (const p of photos || []) {
    if (!p?.externalId || !p?.url) continue;
    const o = byExt.get(p.externalId);
    if (!o) { notFound++; continue; }
    const m = modulesById.get(o.moduleId);
    if (p.wasName && p.name && m?.label === p.wasName) renames.push({ occId: o.id, modId: m.id, from: p.wasName, to: p.name });
    const own = (m?.fieldBindings || []).find(b => b?.role === "media")?.fieldId || mediaFieldId;
    if (hasValue(fieldVal(o, own))) { alreadyHas++; continue; }
    fetches.push({ occId: o.id, modId: o.moduleId, name: p.name || m?.label || "", url: p.url });
  }
  return { fetches, renames, notFound, alreadyHas };
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

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Folder, Manifest } = models;
  const file = process.env.PEOPLE_PHOTOS_PATH;
  if (!file || !fs.existsSync(file)) {
    throw new Error(`PEOPLE_PHOTOS_PATH is not set or the file is missing (${file || "unset"}) — nothing done`);
  }
  const photos = JSON.parse(fs.readFileSync(file, "utf8"))?.photos || [];
  if (!photos.length) throw new Error("the photos file lists no photos — nothing done");

  const people = await Occurrence.find({ gridId, "meta.source": "social-import" }).lean();
  if (!people.length) { log("no imported people on this grid — run 0352 first"); return; }
  const mods = await Module.find({ gridId, id: { $in: [...new Set(people.map(o => o.moduleId))] } }).lean();
  const modulesById = new Map(mods.map(m => [m.id, m]));
  const mediaFieldId = commonBindingField(mods, "media");
  const filesFieldId = commonBindingField(mods, "files");
  if (!mediaFieldId) { log("no person binds a picture (media) field — refusing to guess which field holds a photo"); return; }

  const plan = planPhotos({ photos, occurrences: people, modulesById, mediaFieldId });
  log(`${photos.length} photos in the file · ${plan.fetches.length} to download · ${plan.alreadyHas} people already have a picture · ${plan.notFound} not on this grid · ${plan.renames.length} name(s) to repair`);
  for (const r of plan.renames) log(`   rename "${r.from}" -> "${r.to}"`);

  // Folder: Files/Images/People.
  const manifest = await Manifest.findOne({ gridId, manifestType: "user" }).lean();
  const folders = manifest ? await Folder.find({ gridId, userId: manifest.userId }).lean() : [];
  const filesF = folders.find(f => f.parentId === manifest?.rootFolderId && f.name === FILES_FOLDER_NAME);
  const imagesF = filesF && folders.find(f => f.parentId === filesF.id && f.name === "Images");
  let peopleF = imagesF && folders.find(f => f.parentId === imagesF.id && f.name === "People");
  log(`home: ${peopleF ? "Files/Images/People" : imagesF ? "Files/Images/People (will be created)" : "no Files/Images folder — photos will have no folder"}`);

  if (dryRun) {
    if (plan.fetches[0]) {
      const probe = await download(plan.fetches[0].url);
      log(`probe download of the first photo: ${probe.error ? `FAILED (${probe.error}) — the links may have expired` : `ok (${probe.buf.length} bytes, ${probe.type})`}`);
    }
    log("DRY RUN — nothing written");
    return;
  }

  const userId = people[0].userId;
  if (imagesF && !peopleF) {
    peopleF = { id: crypto.randomUUID(), userId: manifest.userId, gridId, parentId: imagesF.id, name: "People", folderType: "normal", sortOrder: 0, meta: {} };
    await Folder.create(peopleF);
    log("CREATE folder Files/Images/People");
  }

  const uploadsRoot = fileURLToPath(new URL("../uploads/", import.meta.url));
  const shard = yearMonthShard();
  const dir = path.join(uploadsRoot, "user", shard);
  fs.mkdirSync(dir, { recursive: true });

  // Name repairs first — they need no network.
  for (const r of plan.renames) {
    const occ = people.find(o => o.id === r.occId);
    const set = {};
    for (const [fid, cell] of Object.entries(occ?.fields || {})) if (cell?.value === r.from) set[`fields.${fid}.value`] = r.to;
    await Module.updateOne({ gridId, id: r.modId, label: r.from }, { $set: { label: r.to } });
    if (Object.keys(set).length) await Occurrence.updateOne({ gridId, id: r.occId }, { $set: set });
  }

  let done = 0; const failed = [];
  const now = new Date().toISOString();
  const queue = [...plan.fetches];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const got = await download(job.url);
      if (got.error) { failed.push(`${job.name}: ${got.error}`); continue; }
      const sha = crypto.createHash("sha256").update(got.buf).digest("hex");
      const name = `fb-${sha.slice(0, 20)}.${EXT_BY_TYPE[got.type]}`;
      const dest = path.join(dir, name);
      if (!fs.existsSync(dest)) fs.writeFileSync(dest, got.buf);
      const artMod = crypto.randomUUID(), artOcc = crypto.randomUUID();
      await Module.create({ id: artMod, userId, gridId, label: job.name, role: "artifact", kind: "image",
        fileRef: `user/${shard}/${name}`,
        meta: { mimeType: got.type, sha256: sha, uploadSize: got.buf.length, originalName: `${job.name}.${EXT_BY_TYPE[got.type]}`, source: "facebook-photo" } });
      await Occurrence.create({ id: artOcc, userId, gridId, moduleId: artMod, targetId: artMod, targetType: "module",
        parentId: peopleF?.id || null, occurrences: [], fields: {} });

      const mod = modulesById.get(job.modId);
      const mediaFid = (mod?.fieldBindings || []).find(b => b?.role === "media")?.fieldId || mediaFieldId;
      const filesFid = (mod?.fieldBindings || []).find(b => b?.role === "files")?.fieldId || filesFieldId;
      const occ = people.find(o => o.id === job.occId);
      const set = { [`fields.${mediaFid}`]: { value: artOcc, flow: "in", timestamp: now } };
      if (filesFid) {
        const prev = fieldVal(occ, filesFid);
        const list = Array.isArray(prev) ? prev : prev ? [prev] : [];
        set[`fields.${filesFid}`] = { value: [artOcc, ...list.filter(x => x !== artOcc)], main: artOcc, flow: "in", timestamp: now };
      }
      await Occurrence.updateOne({ gridId, id: job.occId }, { $set: set });
      const addBind = [];
      if (!(mod?.fieldBindings || []).some(b => b?.fieldId === mediaFid)) addBind.push({ fieldId: mediaFid, role: "media", hidden: true });
      if (filesFid && !(mod?.fieldBindings || []).some(b => b?.fieldId === filesFid)) addBind.push({ fieldId: filesFid, role: "files", hidden: true });
      if (addBind.length) await Module.updateOne({ gridId, id: job.modId }, { $push: { fieldBindings: { $each: addBind } } });
      done++;
      if (done % 100 === 0) log(`   ${done} photos stored…`);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);

  log(`stored ${done} photo(s) in uploads/user/${shard}/ · ${failed.length} failed`);
  for (const f of failed.slice(0, 15)) log(`   failed: ${f}`);
  if (failed.length > 15) log(`   … and ${failed.length - 15} more (re-run to retry them)`);
  log("done. Restart the server (pm2) so the warm cache serves it.");
}
