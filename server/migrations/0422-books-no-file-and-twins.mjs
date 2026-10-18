// 0422 — Books board: book rows with no file go; duplicates merge into the copy with the file.
//
// User, 2026-10-18: *"theres also alot of duplicates in books still. some without a file path. lets get rid of
// the ones that dont have filepath or are a duplicate still."*
// Measured on poms grid 2026-10-18 (server/_bookaudit.mjs): 514 book rows, 27 book rows with no file, and —
// matching titles with and without the "Author - " prefix, subtitles and series tags — 7 no-file rows that are a
// second row of a book another row has the file for, plus 2 pairs that hold the same file twice (Manga Guides).
// Everything else that looked alike is a different volume (Buddha, Assassin's Creed, Jesus Christ 1-3, Rob Bell…).
//
//   TWINS       the no-file row merges INTO the row with the file (its empty fields fill, references repoint)
//   DUPLICATES  both have the file: the fuller row is kept, the other merges into it and its file record goes
//   no file     every other book instance with no file is deleted
//
// Only book rows (artifact/book): the Books board CONTAINER carries the "book" tag too (and lists all 515).
// A row some text embeds is refused, as in 0411. Drive files are never touched.

import { pickKeeper as fullerRow, mergeFields, mergeMeta } from "./0401-link-drive-books.mjs";

export const id = "0422-books-no-file-and-twins";
export const describe = "Books board: book rows with no file deleted; their twins and same-file duplicates merged into the row with the file. Drive untouched.";
export const touches = ["occurrences", "modules"];

// [no-file row, row with the file]
export const TWINS = [
  ["Alcoholics Anonymous: The Big Book", "- Alcoholics Anonymous (Big Book)-AA"],
  ["(Expanse #2) James S.A. Corey - Caliban's War", "Caliban's War"],
  ["Chris Smith, Jon Stewart - The Daily Show", /^The Daily Show \(The Book\)/],
  ["(Expanse #2.50) James S.A. Corey - Gods of Risk", "Gods of Risk: An Expanse Novella"],
  [/^Carol A\. Fleming PhD - It's the Way You Say It/, /^It's the Way You Say It: Becoming Articulate/],
  [/^\(Penguin Classics\) Marcus Aurelius, Martin Hammond, Diskin Clay - Meditations/, "Meditations"],
  ["(Expanse 8) James S.A. Corey - Tiamat’s Wrath", /^Tiamat's Wrath: Book 8 of the Expanse/],
  // their File Path names the single book's file, which another row carries
  ["The Hitchhiker's Guide to the Galaxy Omnibus: A Trilogy in Five Parts", "The Hitchhiker's Guide to the Galaxy"],
  [/^How to Stop Worrying and Start Living, the Art of Public Speaking/, "How To Stop Worrying And Start Living"],
];
export const DUPLICATES = [
  ["The Manga Guide to Electricity", "Manga Guide to Electricity, The"],
  ["The Manga Guide to Statistics", "Manga Guide to Statistics, The"],
  // two rows each holding a copy of the same 154 MB pdf, and a third with no file
  [/^The daily stoic journal: 366 days/, "Hanselman, Stephen Hol - The daily stoic journal 366 day", "Hanselman, Stephen Holiday, Ryan"],
];

const matches = (label, m) => (m instanceof RegExp ? m.test(label) : label === m);

/** PURE. rows: [{ id, label, files:[occId] }] (book instances). */
export function planBooks(rows) {
  const find = (m) => rows.filter((r) => matches(r.label, m));
  const merges = []; const problems = []; const inMerge = new Set();
  for (const [lone, twin] of TWINS) {
    const a = find(lone); const b = find(twin);
    if (a.length !== 1 || b.length !== 1) { problems.push(`twin ${lone} → ${twin}: found ${a.length} / ${b.length}`); continue; }
    if (a[0].files.length || !b[0].files.length) { problems.push(`twin ${a[0].label}: expected no file → a file`); continue; }
    merges.push({ keepId: b[0].id, dropIds: [a[0].id], label: b[0].label, kind: "twin" });
    inMerge.add(a[0].id); inMerge.add(b[0].id);
  }
  for (const labels of DUPLICATES) {
    const group = labels.flatMap(find);
    if (group.length !== labels.length) { problems.push(`duplicate ${labels[0]}: found ${group.length}`); continue; }
    // the keeper always has the file: the fuller of the rows that carry one
    const withFile = group.filter((r) => r.files.length);
    const keep = fullerRow((withFile.length ? withFile : group).map((r) => r.doc || r));
    merges.push({ keepId: keep.id, dropIds: group.filter((r) => r.id !== keep.id).map((r) => r.id), label: labels[0], kind: "duplicate" });
    group.forEach((r) => inMerge.add(r.id));
  }
  const deletes = rows.filter((r) => !r.files.length && !inMerge.has(r.id)).map((r) => r.id);
  return { merges, deletes, problems };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Field } = models;
  const gid = String(gridId);
  const fid = async (name) => (await Field.findOne({ gridId: gid, name }).lean())?.id;
  const F = { files: await fid("Files"), cat: await fid("Board Category") };
  if (!F.files || !F.cat) throw new Error("0422: Files / Board Category field missing");
  const docs = await Occurrence.find({ gridId: gid, [`fields.${F.cat}.value`]: "book", "meta.feedSourceId": { $in: [null, undefined] } }).lean();
  const mods = new Map((await Module.find({ gridId: gid, id: { $in: docs.map((d) => d.moduleId) } }, { id: 1, role: 1, label: 1 }).lean()).map((m) => [m.id, m]));
  // Book rows are artifact/book (513 rows share two modules); the board container carries the tag too.
  const books = docs.filter((d) => !["container", "page", "panel"].includes(mods.get(d.moduleId)?.role));
  log(`book rows ${docs.length}, of them books ${books.length} (skipped: ${docs.length - books.length} container/page, e.g. the board)`);
  const rows = books.map((d) => ({ id: d.id, label: d.label || mods.get(d.moduleId)?.label || "", files: d.fields?.[F.files]?.value || [], doc: d }));
  const { merges, deletes, problems } = planBooks(rows);
  if (problems.length) throw new Error(`0422: the measured lists no longer match the grid:\n  ${problems.join("\n  ")}`);
  const byId = new Map(rows.map((r) => [r.id, r]));

  const doomed = new Set([...deletes, ...merges.flatMap((m) => m.dropIds)]);
  const embedded = new Set();
  for await (const o of Occurrence.find({ gridId: gid, textmap: { $ne: null } }, { textmap: 1 }).lean().cursor()) {
    const s = typeof o.textmap === "string" ? o.textmap : JSON.stringify(o.textmap);
    for (const i of doomed) if (s.includes(i)) embedded.add(i);
  }
  log(`delete ${deletes.length} row(s) with no file; merge ${merges.length} (${merges.filter((m) => m.kind === "twin").length} twins, ${merges.filter((m) => m.kind === "duplicate").length} duplicates)`);
  for (const i of deletes) log(`  - ${byId.get(i).label}`);
  for (const m of merges) log(`  = [${m.kind}] keep "${byId.get(m.keepId).label}" ← ${m.dropIds.map((d) => `"${byId.get(d).label}"`).join(", ")}`);
  if (embedded.size) log(`  ! refused (embedded in text): ${[...embedded].map((i) => byId.get(i).label).join(", ")}`);
  if (dryRun) return;

  const goneRows = new Set(); const goneFiles = new Set(); const repoint = new Map();
  for (const m of merges) {
    if (m.dropIds.some((d) => embedded.has(d))) continue;
    const keep = byId.get(m.keepId).doc; const drops = m.dropIds.map((d) => byId.get(d).doc);
    const fields = mergeFields(keep, drops);
    fields[F.files] = keep.fields[F.files];               // the keeper keeps its own one file
    await Occurrence.updateOne({ gridId: gid, id: keep.id }, { $set: { fields, meta: mergeMeta(keep, drops) } });
    for (const d of drops) { repoint.set(d.id, keep.id); goneRows.add(d.id); for (const f of d.fields?.[F.files]?.value || []) goneFiles.add(f); }
  }
  for (const i of deletes) { if (embedded.has(i)) continue; repoint.set(i, null); goneRows.add(i); }

  const ids = [...repoint.keys()];
  const occFieldIds = (await Field.find({ gridId: gid, type: "occurrence" }, { id: 1 }).lean()).map((f) => f.id);
  const refs = await Occurrence.find({ gridId: gid, id: { $nin: ids }, $or: [{ occurrences: { $in: ids } }, ...occFieldIds.map((k) => ({ [`fields.${k}.value`]: { $in: ids } }))] }).lean();
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
  const hosts = await Occurrence.find({ gridId: gid, "meta.spreadFor": { $in: [...goneRows] } }, { id: 1 }).lean();
  const goneOccs = [...goneRows, ...goneFiles, ...hosts.map((h) => h.id)];
  const modIds = (await Occurrence.find({ gridId: gid, id: { $in: goneOccs } }, { moduleId: 1 }).lean()).map((o) => o.moduleId);
  await Occurrence.deleteMany({ gridId: gid, id: { $in: goneOccs } });
  await Occurrence.updateMany({ gridId: gid, occurrences: { $in: goneOccs } }, { $pull: { occurrences: { $in: goneOccs } } });
  let modsGone = 0;
  for (const mid of new Set(modIds)) if (!(await Occurrence.exists({ gridId: gid, moduleId: mid }))) { await Module.deleteOne({ gridId: gid, id: mid }); modsGone++; }
  log(`written: ${goneRows.size} rows, ${goneFiles.size} file records, ${hosts.length} viewer containers deleted; ${modsGone} modules swept; ${refFixed} references repointed/cleared. Restart the server (pm2).`);
}
