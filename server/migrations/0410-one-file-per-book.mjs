// 0410 — a book row carries ONE book file.
//
// User, 2026-10-16: *"dont connect two book files of the same book … i want one book file for each"*.
// 0401 (one file per row, upgrades kept the old one as main), the second Drive folder and 0407 (the
// converted epub beside the original) left many rows with two or more files. Each such row keeps
// one: the best format (epub > azw3 > mobi/azw > pdf > djvu), its `main` breaking a tie. The others are detached and their artifact records
// deleted — the FILES stay in Drive (the user: "keep the originals").
//
// Only rows whose Files are ALL book files (kind ebook | pdf with a gdrive: fileRef) are touched, so a
// person's photos or an ingredient's pictures never are. An artifact another row still lists is kept.

export const id = "0410-one-file-per-book";
export const describe = "Book rows with several book files keep one (the main / best format); the others are detached and their artifact records deleted. Drive files are not touched.";
export const touches = ["occurrences", "modules"];

const RANK = { epub: 5, azw3: 4, mobi: 3, azw: 3, pdf: 2, djvu: 1 };
export const extOf = (name) => (String(name || "").match(/\.([a-z0-9]{2,5})$/i)?.[1] || "").toLowerCase();

/** PURE. Which file a row keeps: the best format; the row's main breaks a tie. (0401 left the OLD
 *  file as main when a better format arrived, so main alone would keep an azw beside an epub.) */
export function pickKeeper(files, mainId) {
  const r = (f) => (RANK[f.ext] || 0) * 2 + (f.occId === mainId ? 1 : 0);
  return [...files].sort((a, b) => r(b) - r(a))[0]?.occId || null;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Field } = models;
  const gid = String(gridId);
  const F = { files: (await Field.findOne({ gridId: gid, name: "Files" }).lean())?.id, formats: (await Field.findOne({ gridId: gid, name: "Formats" }).lean())?.id };
  if (!F.files) throw new Error("0410: no Files field");
  const rows = await Occurrence.find({ gridId: gid, [`fields.${F.files}.value.1`]: { $exists: true } }).lean();
  const allIds = [...new Set(rows.flatMap((r) => r.fields[F.files].value))];
  const occs = new Map((await Occurrence.find({ gridId: gid, id: { $in: allIds } }, { id: 1, moduleId: 1 }).lean()).map((o) => [o.id, o]));
  const mods = new Map((await Module.find({ gridId: gid, id: { $in: [...occs.values()].map((o) => o.moduleId) } }).lean()).map((m) => [m.id, m]));
  const fileOf = (occId) => { const o = occs.get(occId); const m = o && mods.get(o.moduleId); return m && /^gdrive:/.test(m.fileRef || "") && ["ebook", "pdf"].includes(m.kind) ? { occId, modId: m.id, ext: extOf(m.meta?.originalName || m.label), name: m.meta?.originalName || m.label } : null; };

  const plan = [];
  for (const r of rows) {
    const cell = r.fields[F.files]; const ids = cell.value;
    const files = ids.map(fileOf);
    if (files.some((f) => !f)) continue;                       // not purely book files
    const keep = pickKeeper(files, cell.main);
    plan.push({ row: r, keep, kept: files.find((f) => f.occId === keep), drop: files.filter((f) => f.occId !== keep) });
  }
  const dropIds = new Set(plan.flatMap((p) => p.drop.map((d) => d.occId)));
  // an artifact some OTHER row (not in this plan's drop for it) still lists is kept
  const keptSomewhere = new Set(plan.map((p) => p.keep));
  const stillListed = await Occurrence.find({ gridId: gid, [`fields.${F.files}.value`]: { $in: [...dropIds] }, id: { $nin: plan.map((p) => p.row.id) } }, { fields: 1 }).lean();
  for (const o of stillListed) for (const id of o.fields[F.files].value) keptSomewhere.add(id);
  const toDelete = [...dropIds].filter((id) => !keptSomewhere.has(id));
  const byExt = {}; for (const p of plan) byExt[p.kept.ext] = (byExt[p.kept.ext] || 0) + 1;
  log(`${plan.length} book row(s) with several files → keep one each (kept formats ${JSON.stringify(byExt)}); ${dropIds.size} file link(s) dropped, ${toDelete.length} artifact record(s) deleted`);
  if (dryRun) { for (const p of plan.slice(0, 5)) log(`  e.g. keep ${p.kept.name} · drop ${p.drop.map((d) => d.name).join(", ")}`); return; }

  for (const p of plan) {
    const $set = { [`fields.${F.files}`]: { ...p.row.fields[F.files], value: [p.keep], main: p.keep } };
    if (F.formats && p.row.fields?.[F.formats]) $set[`fields.${F.formats}`] = { ...p.row.fields[F.formats], value: p.kept.ext };
    await Occurrence.updateOne({ gridId: gid, id: p.row.id }, { $set });
  }
  const delOccs = await Occurrence.find({ gridId: gid, id: { $in: toDelete } }, { id: 1, moduleId: 1, parentId: 1 }).lean();
  await Occurrence.deleteMany({ gridId: gid, id: { $in: toDelete } });
  await Occurrence.updateMany({ gridId: gid, occurrences: { $in: toDelete } }, { $pull: { occurrences: { $in: toDelete } } });
  for (const o of delOccs) if (!(await Occurrence.exists({ gridId: gid, moduleId: o.moduleId }))) await Module.deleteOne({ gridId: gid, id: o.moduleId });
  const left = await Occurrence.countDocuments({ gridId: gid, id: { $in: plan.map((p) => p.row.id) }, [`fields.${F.files}.value.1`]: { $exists: true } });
  log(`written; rows still holding several files: ${left}. Restart the server (pm2).`);
}
