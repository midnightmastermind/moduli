// server/migrations/0352-people-from-social-exports.mjs
//
// Replace the People board's TEST people with the user's real ones, from their
// Facebook + Instagram data exports (user, 2026-09-24; plan:
// docs/superpowers/plans/2026-09-24-people-from-social-exports.md).
//
// ── THE DATA IS NOT IN THIS REPO ─────────────────────────────────────────────
// Names and handles are other people's personal data and this repo is on
// GitHub. The import file is built from the exports outside git and copied to
// the server; this migration reads it from PEOPLE_IMPORT_PATH and REFUSES to
// run (and is not recorded as applied) without it.
//
//   { version: 1, people: [{ name, facebook?, facebookSince?, instagram?,
//       instagramSince?, followsYou?, youFollow?, closeFriend?, igBasis?,
//       maybeFacebook? }] }
//
// ── WHAT EACH PERSON GETS ────────────────────────────────────────────────────
// Every person field: the binding set is copied from an existing person (0052's
// rule — derived, not enumerated), plus three fields created here:
//   Facebook Friends Since (date) · Instagram Following Since (date) ·
//   Found Via (multi-select: facebook, instagram, close friend, mutual,
//   follows you, you follow, unconfirmed)
// Filled only from the export: Name, Instagram (handle), Relationship,
// How We Met, Person Notes (a "possibly the same as <Facebook friend>" hint),
// Board Category + Library = person. Nothing is invented (0052's rule).
// "unconfirmed" marks an Instagram account kept on the strength of its
// username alone, so it can be reviewed and removed.
//
// ── THE TEST PEOPLE ──────────────────────────────────────────────────────────
// The ten seeded people are identified by name AND their seeded email, never by
// "not in the export" — Keith and Angela (0052, real) are kept. Removed with
// them: every occurrence of their modules, their ids in any parent's
// occurrences[], their ids in any field value (People Assigned on tasks, …),
// moduleEmbeds of them in any textmap, and their photo artifacts when nothing
// else uses the photo.
//
// Idempotent: each added row carries meta.source="social-import" +
// meta.externalId, and a re-run adds only ids it has not seen. Restart pm2
// after --apply (the warm cache serves reads).

import crypto from "node:crypto";
import fs from "node:fs";
import { decompressTextmap, compressTextmap, isCompressed } from "../utils/textmapCompression.js";

export const id = "0352-people-from-social-exports";
export const describe = "Adds people from the Facebook/Instagram export file (PEOPLE_IMPORT_PATH) to the People board with every person field, creates 3 fields (Facebook Friends Since, Instagram Following Since, Found Via), and DELETES the 10 seeded test people (Ava Martinez … Jack Brennan) with their references and unused photos. Keith and Angela are kept.";
export const touches = ["modules", "occurrences", "fields"];

export const TEST_PEOPLE = {
  "Ava Martinez": "ava.martinez@studio-six.com", "Ben Chen": "ben@chen.dev",
  "Chloe Patel": "chloe.patel@mit.edu", "Deven Wright": "deven@wright.studio",
  "Elise Nakamura": "elise.n@bridge-labs.io", "Felix Romero": "felix@romero.coffee",
  "Grace Okonkwo": "grace@okonkwo.law", "Henry Lindqvist": "henry.l@nord-fjord.no",
  "Isabel Sokolov": "isabel@sokolov.art", "Jack Brennan": "jack@brennan.house",
};

export const NEW_FIELDS = [
  { name: "Facebook Friends Since", type: "date", meta: {} },
  { name: "Instagram Following Since", type: "date", meta: {} },
  { name: "Found Via", type: "select",
    meta: { multiSelect: true, options: ["facebook", "instagram", "close friend", "mutual", "follows you", "you follow", "unconfirmed"] } },
];

const monthYear = (iso) => {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
};

/** The stable identity of one import row. Duplicate FB names get #2, #3 … */
export function externalIdsFor(people) {
  const seen = new Map();
  return people.map((p) => {
    const base = p.facebook ? `fb:${p.name}` : `ig:${p.instagram}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  });
}

/** PURE: the field values one person gets. `f` maps role → field id (null = absent). */
export function personFieldValues(p, f) {
  const via = [];
  if (p.facebook) via.push("facebook");
  if (p.instagram) via.push("instagram");
  if (p.closeFriend) via.push("close friend");
  if (p.followsYou && p.youFollow) via.push("mutual");
  else if (p.followsYou) via.push("follows you");
  else if (p.youFollow && p.instagram) via.push("you follow");
  if (p.igBasis === "judged") via.push("unconfirmed");

  const relationship = p.closeFriend ? "close friend"
    : (p.facebook || (p.followsYou && p.youFollow)) ? "friend" : "acquaintance";
  const how = [
    p.facebook ? `Facebook friends${monthYear(p.facebookSince) ? ` since ${monthYear(p.facebookSince)}` : ""}` : null,
    p.instagram ? `Instagram${monthYear(p.instagramSince) ? ` (following since ${monthYear(p.instagramSince)})` : ""}` : null,
  ].filter(Boolean).join(" · ");

  const out = {};
  const put = (fid, value) => { if (fid && value != null && value !== "" && !(Array.isArray(value) && !value.length)) out[fid] = value; };
  put(f.name, p.name);
  put(f.instagram, p.instagram || null);
  put(f.relationship, relationship);
  put(f.howMet, how || null);
  put(f.notes, p.maybeFacebook ? `Possibly the same person as Facebook friend ${p.maybeFacebook}.` : null);
  put(f.fbSince, p.facebookSince || null);
  put(f.igSince, p.instagramSince || null);
  put(f.foundVia, via);
  put(f.category, ["person"]);
  put(f.library, "person");
  return out;
}

export function stripEmbeds(node, ids) {
  if (!node || typeof node !== "object" || !Array.isArray(node.content)) return { node, removed: 0 };
  let removed = 0;
  const content = [];
  for (const c of node.content) {
    if (c?.type === "moduleEmbed" && ids.has(c.attrs?.occurrenceId)) { removed++; continue; }
    const r = stripEmbeds(c, ids);
    removed += r.removed;
    // A wrapGroup needs >= 2 members (the schema's moduleEmbed{2,}); one left
    // over is FLATTENED into its parent, never left as a one-child group — the
    // editor would fill the gap with an empty embed (the 0336 "embed: missing").
    if (r.node?.type === "wrapGroup" && (r.node.content?.length || 0) < 2) content.push(...(r.node.content || []));
    else content.push(r.node);
  }
  return { node: removed ? { ...node, content } : node, removed };
}

export function stripIds(v, ids) {
  if (typeof v === "string") return ids.has(v) ? undefined : v;
  if (Array.isArray(v)) { const out = v.filter(x => !(typeof x === "string" && ids.has(x))); return out.length === v.length ? v : out; }
  if (v && typeof v === "object") {
    let changed = false; const out = { ...v };
    for (const k of ["value", "main"]) {
      if (k in out) { const n = stripIds(out[k], ids); if (n !== out[k]) { changed = true; if (n === undefined) delete out[k]; else out[k] = n; } }
    }
    return changed ? out : v;
  }
  return v;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Field } = models;
  const path = process.env.PEOPLE_IMPORT_PATH;
  if (!path || !fs.existsSync(path)) {
    throw new Error(`PEOPLE_IMPORT_PATH is not set or the file is missing (${path || "unset"}) — nothing done`);
  }
  const data = JSON.parse(fs.readFileSync(path, "utf8"));
  const people = Array.isArray(data?.people) ? data.people.filter(p => p?.name) : [];
  if (!people.length) throw new Error("the import file has no people — nothing done");

  // ── The board and an exemplar person (for the field set) ──────────────────
  const peopleMods = await Module.find({ gridId, role: "container", label: "People" }).select({ id: 1 }).lean();
  const boards = await Occurrence.find({ gridId, moduleId: { $in: peopleMods.map(m => m.id) } }).lean();
  const board = boards.sort((a, b) => (b.occurrences?.length || 0) - (a.occurrences?.length || 0))[0];
  if (!board?.occurrences?.length) { log("no People board holding people — refusing to guess"); return; }
  const userId = board.userId;

  const onBoard = await Occurrence.find({ gridId, id: { $in: board.occurrences } }).lean();
  const boardMods = await Module.find({ gridId, id: { $in: onBoard.map(o => o.moduleId).filter(Boolean) } }).lean();
  const modById = new Map(boardMods.map(m => [m.id, m]));
  const fields = await Field.find({ gridId }).lean();
  const fieldByName = (name, type) => {
    const hits = fields.filter(f => (f.name || "").toLowerCase() === name.toLowerCase() && (!type || f.type === type));
    return hits.length === 1 ? hits[0] : null;
  };

  const exemplarOcc = onBoard.find(o => modById.get(o.moduleId)?.fieldBindings?.length);
  const exemplarMod = exemplarOcc && modById.get(exemplarOcc.moduleId);
  if (!exemplarMod) { log("no exemplar person to copy the field set from — refusing"); return; }
  const ex = exemplarOcc.fields || {};
  const exVal = (fid) => ex[fid]?.value;
  const nameFid = Object.keys(ex).find(fid => exVal(fid) === exemplarMod.label) || fieldByName("Name")?.id || null;
  if (!nameFid) { log("could not identify the Name field — refusing to add nameless people"); return; }
  const f = {
    name: nameFid,
    library: Object.keys(ex).find(fid => exVal(fid) === "person") || null,
    category: Object.keys(ex).find(fid => Array.isArray(exVal(fid)) && exVal(fid).includes("person")) || null,
    instagram: fieldByName("Instagram", "text")?.id || null,
    relationship: fieldByName("Relationship", "select")?.id || null,
    howMet: fieldByName("How We Met", "text")?.id || null,
    notes: fieldByName("Person Notes")?.id || fieldByName("Notes", "text")?.id || null,
    email: fieldByName("Email")?.id || null,
  };
  log(`People board ${board.id} — ${onBoard.length} rows · field set copied from "${exemplarMod.label}" (${exemplarMod.fieldBindings.length} bindings)`);
  log(`fields found: ${Object.entries(f).map(([k, v]) => `${k}=${v ? "✓" : "—"}`).join(" ")}`);

  // ── New fields (found before created) ─────────────────────────────────────
  const newFieldIds = {};
  for (const spec of NEW_FIELDS) {
    const existing = fieldByName(spec.name, spec.type);
    if (existing) { newFieldIds[spec.name] = existing.id; continue; }
    const fid = crypto.randomUUID();
    newFieldIds[spec.name] = fid;
    log(`CREATE field "${spec.name}" (${spec.type})`);
    if (!dryRun) {
      await Field.create({ id: fid, userId, gridId, name: spec.name, type: spec.type,
        inputEnabled: true, displayEnabled: false, meta: spec.meta });
    }
  }
  f.fbSince = newFieldIds["Facebook Friends Since"];
  f.igSince = newFieldIds["Instagram Following Since"];
  f.foundVia = newFieldIds["Found Via"];

  const baseBindings = exemplarMod.fieldBindings.filter(b => b?.fieldId);
  let order = Math.max(0, ...baseBindings.map(b => b.order ?? 0)) + 1;
  const bindings = [...baseBindings];
  for (const fid of [f.fbSince, f.igSince, f.foundVia]) {
    if (!bindings.some(b => b.fieldId === fid)) bindings.push({ fieldId: fid, role: "input", order: order++ });
  }

  // ── Test people ───────────────────────────────────────────────────────────
  const testOccs = onBoard.filter(o => {
    const name = o.fields?.[nameFid]?.value || modById.get(o.moduleId)?.label;
    const email = f.email ? o.fields?.[f.email]?.value : null;
    return TEST_PEOPLE[name] && (!f.email || email === TEST_PEOPLE[name]);
  });
  const testModIds = new Set(testOccs.map(o => o.moduleId));
  const keep = onBoard.filter(o => !testModIds.has(o.moduleId) && !o.meta?.source);
  log(`REMOVE ${testOccs.length} test people: ${testOccs.map(o => o.fields?.[nameFid]?.value).join(", ")}`);
  log(`KEEP   ${keep.length} other people on the board: ${keep.map(o => o.fields?.[nameFid]?.value || modById.get(o.moduleId)?.label).slice(0, 12).join(", ")}`);

  // ── New people ────────────────────────────────────────────────────────────
  const extIds = externalIdsFor(people);
  const already = new Set((await Occurrence.find({ gridId, "meta.source": "social-import" }).select({ "meta.externalId": 1 }).lean())
    .map(o => o.meta?.externalId));
  const keptNames = new Set(keep.map(o => String(o.fields?.[nameFid]?.value || "").toLowerCase()).filter(Boolean));
  const toAdd = [];
  people.forEach((p, i) => {
    if (already.has(extIds[i])) return;
    if (keptNames.has(p.name.toLowerCase()) && !p.facebook && !p.instagram) return;
    toAdd.push({ p, ext: extIds[i] });
  });
  const count = (pred) => toAdd.filter(({ p }) => pred(p)).length;
  log(`ADD ${toAdd.length} people (${already.size} already imported): facebook ${count(p => p.facebook)} · instagram-only ${count(p => !p.facebook)} (of which unconfirmed ${count(p => p.igBasis === "judged")}) · close friends ${count(p => p.closeFriend)}`);

  // ── Everything that points at a test person ───────────────────────────────
  const all = await Occurrence.find({ gridId }).lean();
  const doomedOccIds = new Set(all.filter(o => testModIds.has(o.moduleId)).map(o => o.id));
  // Their photos: artifacts referenced from a test person's fields and from nothing else.
  const refCount = new Map();
  const collect = (v, into) => {
    if (typeof v === "string") into.add(v);
    else if (Array.isArray(v)) v.forEach(x => collect(x, into));
    else if (v && typeof v === "object") Object.values(v).forEach(x => collect(x, into));
  };
  const testRefs = new Set();
  for (const o of all) {
    const s = new Set(); collect(o.fields || {}, s);
    for (const id of s) refCount.set(id, (refCount.get(id) || 0) + (doomedOccIds.has(o.id) ? 0 : 1));
    if (doomedOccIds.has(o.id)) s.forEach(x => testRefs.add(x));
  }
  const artifactModIds = new Set((await Module.find({ gridId, role: "artifact" }).select({ id: 1 }).lean()).map(m => m.id));
  const photoOccIds = all.filter(o => testRefs.has(o.id) && artifactModIds.has(o.moduleId) && !refCount.get(o.id)).map(o => o.id);
  photoOccIds.forEach(id => doomedOccIds.add(id));

  const listPatches = [], fieldPatches = [], textmapPatches = [];
  for (const o of all) {
    if (doomedOccIds.has(o.id)) continue;
    if ((o.occurrences || []).some(id => doomedOccIds.has(id))) listPatches.push(o.id);
    let fieldsChanged = false; const nf = { ...(o.fields || {}) };
    for (const [k, v] of Object.entries(nf)) { const n = stripIds(v, doomedOccIds); if (n !== v) { fieldsChanged = true; if (n === undefined) delete nf[k]; else nf[k] = n; } }
    if (fieldsChanged) fieldPatches.push({ id: o.id, fields: nf });
    if (o.textmap) {
      let tm = o.textmap; const compressed = isCompressed(tm);
      try { tm = decompressTextmap(tm); } catch { tm = null; }
      if (tm) { const r = stripEmbeds(tm, doomedOccIds); if (r.removed) textmapPatches.push({ id: o.id, textmap: compressed ? compressTextmap(r.node) : r.node, removed: r.removed }); }
    }
  }
  log(`references to clear: ${listPatches.length} parent list(s) · ${fieldPatches.length} field value(s) (e.g. People Assigned) · ${textmapPatches.length} document embed(s) · ${photoOccIds.length} unused photo(s)`);

  if (dryRun) { log("DRY RUN — nothing written"); return; }

  // ── Writes: add first, so the board is never empty mid-run ────────────────
  const now = new Date().toISOString();
  const cell = (value) => ({ value, flow: "in", timestamp: now });
  const newMods = [], newOccs = [];
  for (const { p, ext } of toAdd) {
    const modId = crypto.randomUUID(), occId = crypto.randomUUID();
    const vals = personFieldValues(p, f);
    newMods.push({ id: modId, userId, gridId, role: "instance", label: p.name, defaultDragMode: "copy", fieldBindings: bindings });
    newOccs.push({ id: occId, userId, gridId, moduleId: modId, targetId: modId, targetType: "module", parentId: board.id,
      fields: Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, cell(v)])),
      occurrences: [], meta: { source: "social-import", externalId: ext } });
  }
  for (let i = 0; i < newMods.length; i += 200) {
    await Module.insertMany(newMods.slice(i, i + 200), { ordered: false });
    await Occurrence.insertMany(newOccs.slice(i, i + 200), { ordered: false });
  }
  if (newOccs.length) {
    await Occurrence.updateOne({ id: board.id }, { $push: { occurrences: { $each: newOccs.map(o => o.id) } } });
  }
  // Existing (kept) people gain the three new bindings too, so the board is uniform.
  for (const o of keep) {
    const m = modById.get(o.moduleId);
    if (!m) continue;
    const add = [f.fbSince, f.igSince, f.foundVia].filter(fid => !(m.fieldBindings || []).some(b => b.fieldId === fid));
    if (add.length) {
      let ord = Math.max(0, ...(m.fieldBindings || []).map(b => b.order ?? 0)) + 1;
      await Module.updateOne({ id: m.id }, { $push: { fieldBindings: { $each: add.map(fid => ({ fieldId: fid, role: "input", order: ord++ })) } } });
    }
  }
  log(`added ${newOccs.length} people`);

  // ── Then remove the test people and their references ──────────────────────
  const doomed = [...doomedOccIds];
  for (const pid of listPatches) await Occurrence.updateOne({ id: pid }, { $pull: { occurrences: { $in: doomed } } });
  for (const fp of fieldPatches) await Occurrence.updateOne({ id: fp.id }, { $set: { fields: fp.fields } });
  for (const tp of textmapPatches) await Occurrence.updateOne({ id: tp.id }, { $set: { textmap: tp.textmap } });
  await Occurrence.deleteMany({ gridId, id: { $in: doomed } });
  const photoModIds = all.filter(o => photoOccIds.includes(o.id)).map(o => o.moduleId);
  const orphanMods = [];
  for (const mid of [...testModIds, ...photoModIds]) {
    if (!(await Occurrence.exists({ gridId, moduleId: mid }))) orphanMods.push(mid);
  }
  await Module.deleteMany({ gridId, id: { $in: orphanMods } });
  log(`removed ${doomed.length} occurrence(s) and ${orphanMods.length} module(s). Restart the server (pm2) so the warm cache serves the change.`);
}
