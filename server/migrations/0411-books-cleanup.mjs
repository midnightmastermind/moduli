// 0411 — the Books board: rows with no file from Calibre, personal documents, and duplicate books.
//
// User, 2026-10-16: *"myth and religion is a book that doesnt have a cover and i cant access the file"* ·
// *"there are a ton of duplicate books still. can you go through and remove the new ones from calibre
// library (not the ones where we got a file for a prev book)"*. Answers (CLAUDE_CHAT 14:58): delete only the
// Calibre rows with NO file; merge duplicates keeping the better file; delete the personal rows.
//   1. a row whose only sources are Calibre libraries (meta.bookLibraries all *calibre*) and that carries no
//      file — it came from the PC's Calibre list and its file was never uploaded (Myth and Religion is one).
//   2. personal documents the 08-24 scan put on the Books board (PERSONAL: names, not titles of books).
//   3. duplicate rows of one book (DUPLICATES: label groups, measured on poms 2026-10-16) — the row with the
//      better file is kept (epub > azw3 > mobi/azw > pdf > djvu; then the fuller row), empty fields + meta
//      filled from the others, references repointed; the others and their file records go. Drive files stay.
//      The kept row takes the group's FIRST label (the cleanest name; a file-name label like "…-Citadel (16 Nov
//      2013)" is often the one with the better file).
// A deleted row's references (another row's field value) are cleared; its spread viewer container goes too.
// A row some text EMBEDS is refused (named), never deleted.

import { pickKeeper as fullerRow, mergeFields, mergeMeta } from "./0401-link-drive-books.mjs";

export const id = "0411-books-cleanup";
export const describe = "Books board: Calibre rows with no file deleted, personal documents deleted, duplicate books merged (better file kept). Drive files untouched.";
export const touches = ["occurrences", "modules"];

export const PERSONAL = [/^temp\d+$/, /^resume 2025$/i, /^portugal: /i, /^JP: Employment Offer Letter$/, /^ewfaawf$/, /^BadgerCare/];
export const DUPLICATES = [
  ["The Manga Guide to Cryptography", "Manga Guide to Cryptography, The"],
  ["The Manga Guide to Microprocessors", "Manga Guide to Microprocessors, The"],
  ["The Manga Guide to Molecular Biology", "Manga Guide to Molecular Biology, The"],
  ["The Manga Guide to Physics", "Manga Guide to Physics, The"],
  ["The Mind Map Book: How to Use Radiant Thinking to Maximize Your Brain's Untapped Potential", "Mind Map Book, The"],
  ["The Mindful Geek: Secular Meditation for Smart Skeptics", "The Mindful Geek: Mindfulness Meditation for Secular Skeptics"],
  ["The Medici Effect: What Elephants and Epidemics Can Teach Us About Innovation", "The Medici Effect, With a New Preface and Discussion Guide: What Elephants and Epidemics Can Teach Us About Innovation"],
  ["Slaughterhouse-Five, Or, the Children's Crusade: A Duty-Dance With Death", "Slaughterhouse-Five: A Novel"],
  ["Write Great Code, Vol. 1: Understanding the Machine", "Write Great Code: Understanding the Machine"],
  ["Life of Greece", "The Life of Greece: Being a History of Greek Civilization From the Beginnings, and of Civilization in the Near East From the Death of Alexander, to the Roman Conquest ; With an Introduction on the Prehistoric Culture of Crete"],
  ["The Highly Sensitive Person", "The Highly Sensitive Person-Citadel (16 Nov 2013)", "The Highly Sensitive Person: How to Thrive When the World Overwhelms You"],
  ["Six Pillars of Self-Esteem", "The Six Pillars of Self-Esteem"],
  ["Interface", "Interface: A Novel"],
  ["Cibola Burn", "Cibola Burn: Book 4 of the Expanse (Now a Prime Original Series)"],
  ["Media Control: The Spectacular Achievements of Propaganda", "Media Control-Perseus (2010_2002)"],
];

const RANK = { epub: 5, azw3: 4, mobi: 3, azw: 3, pdf: 2, djvu: 1 };
export const extOf = (n) => (String(n || "").match(/\.([a-z0-9]{2,5})$/i)?.[1] || "").toLowerCase();

/** PURE. Which rows go, why, and which duplicate groups merge into which keeper.
 *  rows: [{ id, label, libs:[...], files:[{occId, ext}] }]. */
export function planCleanup(rows) {
  const byLabel = new Map(rows.map((r) => [r.label, r]));
  const deletes = new Map(); const merges = [];
  for (const r of rows) {
    if (r.libs.length && r.libs.every((l) => /calibre/.test(l)) && !r.files.length) deletes.set(r.id, "calibre, no file");
    if (PERSONAL.some((rx) => rx.test(r.label))) deletes.set(r.id, "personal");
  }
  const best = (r) => Math.max(0, ...r.files.map((f) => RANK[f.ext] || 0));
  for (const labels of DUPLICATES) {
    const group = labels.map((l) => byLabel.get(l)).filter((r) => r && !deletes.has(r.id));
    if (group.length < 2) continue;
    const top = Math.max(...group.map(best));
    const pool = group.filter((r) => best(r) === top);
    const fuller = fullerRow(pool.map((r) => r.doc || r));
    const keep = pool.find((r) => r.id === fuller.id);
    merges.push({ keepId: keep.id, label: labels[0], dropIds: group.filter((r) => r.id !== keep.id).map((r) => r.id) });
  }
  return { deletes, merges };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Field } = models;
  const gid = String(gridId);
  const fid = async (name) => (await Field.findOne({ gridId: gid, name }).lean())?.id;
  const F = { files: await fid("Files"), cat: await fid("Board Category") };
  if (!F.files || !F.cat) throw new Error("0411: Files / Board Category field missing");
  const docs = await Occurrence.find({ gridId: gid, [`fields.${F.cat}.value`]: "book", "meta.feedSourceId": { $in: [null, undefined] } }).lean();
  const fileIds = [...new Set(docs.flatMap((d) => d.fields?.[F.files]?.value || []))];
  const fOccs = new Map((await Occurrence.find({ gridId: gid, id: { $in: fileIds } }, { id: 1, moduleId: 1 }).lean()).map((o) => [o.id, o]));
  const fMods = new Map((await Module.find({ gridId: gid, id: { $in: [...fOccs.values()].map((o) => o.moduleId) } }).lean()).map((m) => [m.id, m]));
  const rows = docs.map((d) => ({
    id: d.id, label: d.label || "", libs: d.meta?.bookLibraries || [], doc: d,
    files: (d.fields?.[F.files]?.value || []).map((occId) => { const m = fMods.get(fOccs.get(occId)?.moduleId); return { occId, ext: extOf(m?.meta?.originalName || m?.label) }; }),
  }));
  const { deletes, merges } = planCleanup(rows);

  // refuse a row some text embeds
  const doomed = new Set([...deletes.keys(), ...merges.flatMap((m) => m.dropIds)]);
  const embedded = new Set();
  for await (const o of Occurrence.find({ gridId: gid, textmap: { $ne: null } }, { textmap: 1 }).lean().cursor()) {
    const s = typeof o.textmap === "string" ? o.textmap : JSON.stringify(o.textmap);
    for (const id of doomed) if (s.includes(id)) embedded.add(id);
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const why = {}; for (const r of deletes.values()) why[r] = (why[r] || 0) + 1;
  log(`delete ${deletes.size} row(s) ${JSON.stringify(why)}; merge ${merges.length} group(s) (${merges.reduce((n, m) => n + m.dropIds.length, 0)} rows into keepers)`);
  for (const [id, r] of deletes) log(`  - [${r}] ${byId.get(id).label}`);
  for (const m of merges) log(`  = keep "${byId.get(m.keepId).label}"${m.label !== byId.get(m.keepId).label ? ` as "${m.label}"` : ""} (${byId.get(m.keepId).files.map((f) => f.ext).join(",") || "no file"}) ← ${m.dropIds.map((d) => `"${byId.get(d).label}"`).join(", ")}`);
  if (embedded.size) log(`  ! refused (embedded in text): ${[...embedded].map((id) => byId.get(id).label).join(", ")}`);
  if (dryRun) return;

  const goneRows = new Set(); const goneFiles = new Set();
  const repoint = new Map(); // dropped id -> keeper id (null = clear)
  for (const m of merges) {
    if (m.dropIds.some((d) => embedded.has(d))) continue;
    const keep = byId.get(m.keepId).doc; const drops = m.dropIds.map((d) => byId.get(d).doc);
    const fields = mergeFields(keep, drops);
    const keepFile = byId.get(m.keepId).files.length ? keep.fields[F.files] : drops.map((d) => d.fields?.[F.files]).find((c) => c?.value?.length);
    if (keepFile) fields[F.files] = { ...keepFile, value: [keepFile.main && keepFile.value.includes(keepFile.main) ? keepFile.main : keepFile.value[0]], main: keepFile.main && keepFile.value.includes(keepFile.main) ? keepFile.main : keepFile.value[0] };
    await Occurrence.updateOne({ gridId: gid, id: keep.id }, { $set: { fields, meta: mergeMeta(keep, drops), label: m.label } });
    const kept = new Set(fields[F.files]?.value || []);
    for (const d of drops) { repoint.set(d.id, keep.id); goneRows.add(d.id); for (const f of d.fields?.[F.files]?.value || []) if (!kept.has(f)) goneFiles.add(f); }
    for (const f of byId.get(m.keepId).files) if (!kept.has(f.occId)) goneFiles.add(f.occId);
  }
  for (const [id] of deletes) {
    if (embedded.has(id)) continue;
    repoint.set(id, null); goneRows.add(id);
    for (const f of byId.get(id).files) goneFiles.add(f.occId);
  }
  // references in other rows' fields
  const ids = [...repoint.keys()];
  const refs = await Occurrence.find({ gridId: gid, id: { $nin: ids }, $or: [{ occurrences: { $in: ids } }, ...Object.keys((await Field.find({ gridId: gid, type: "occurrence" }, { id: 1 }).lean()).reduce((a, f) => (a[f.id] = 1, a), {})).map((k) => ({ [`fields.${k}.value`]: { $in: ids } }))] }).lean();
  let refFixed = 0;
  for (const r of refs) {
    const $set = {}; let any = false;
    for (const [k, c] of Object.entries(r.fields || {})) {
      const v = c?.value;
      if (typeof v === "string" && repoint.has(v)) { $set[`fields.${k}`] = { ...c, value: repoint.get(v) }; any = true; }
      else if (Array.isArray(v) && v.some((x) => repoint.has(x))) { $set[`fields.${k}`] = { ...c, value: [...new Set(v.map((x) => (repoint.has(x) ? repoint.get(x) : x)).filter(Boolean))] }; any = true; }
    }
    if ((r.occurrences || []).some((x) => repoint.has(x))) { $set.occurrences = r.occurrences.filter((x) => !repoint.has(x)); any = true; }
    if (any) { await Occurrence.updateOne({ gridId: gid, id: r.id }, { $set }); refFixed++; }
  }
  // spread viewer containers for the gone rows
  const hosts = await Occurrence.find({ gridId: gid, "meta.spreadFor": { $in: [...goneRows] } }, { id: 1, moduleId: 1 }).lean();
  const goneOccs = [...goneRows, ...goneFiles, ...hosts.map((h) => h.id)];
  const modIds = (await Occurrence.find({ gridId: gid, id: { $in: goneOccs } }, { moduleId: 1 }).lean()).map((o) => o.moduleId);
  await Occurrence.deleteMany({ gridId: gid, id: { $in: goneOccs } });
  await Occurrence.updateMany({ gridId: gid, occurrences: { $in: goneOccs } }, { $pull: { occurrences: { $in: goneOccs } } });
  let modsGone = 0;
  for (const mid of new Set(modIds)) if (!(await Occurrence.exists({ gridId: gid, moduleId: mid }))) { await Module.deleteOne({ gridId: gid, id: mid }); modsGone++; }
  log(`written: ${goneRows.size} rows, ${goneFiles.size} file records, ${hosts.length} viewer containers deleted; ${modsGone} modules swept; ${refFixed} references repointed/cleared. Restart the server (pm2).`);
}
