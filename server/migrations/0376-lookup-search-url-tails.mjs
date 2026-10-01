// 0376 — Lookup rows whose search swallowed the rest of its Google URL
// ("web development mind map&rlz=1C1ONGR…&sxsrf=…") are trimmed to the search.
// Follows 0375 (user, 2026-10-01: "random characters and urls"). A trimmed
// label that already has its own row is a duplicate and is removed. Idempotent.
import { stripSearchTail } from "../utils/raindropImport.js";

export const id = "0376-lookup-search-url-tails";
export const describe = "Trim Google URL parameters (&rlz=, &sxsrf=, …) off Lookup row labels. DELETES a row whose trimmed search already has its own row.";
export const touches = ["occurrences", "modules"];

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Folder } = models;
  const lf = await Folder.findOne({ gridId: String(gridId), name: "Lookup" }).lean();
  if (!lf) { log("no Lookup folder."); return; }
  let board = null;
  for (const p of await Occurrence.find({ parentId: lf.id }).lean()) for (const k of p.occurrences || []) { const c = await Occurrence.findOne({ id: k }).lean(); if ((c?.occurrences || []).length > (board?.occurrences?.length || 0)) board = c; }
  if (!board) { log("no Lookup board."); return; }
  const rows = await Occurrence.find({ id: { $in: board.occurrences } }).lean();
  const mods = new Map((await Module.find({ id: { $in: rows.map((r) => r.moduleId) } }).lean()).map((m) => [m.id, m]));
  const labelOf = (r) => r.label || mods.get(r.moduleId)?.label || "";
  const clean = new Set(rows.map((r) => labelOf(r)).filter((l) => stripSearchTail(l) === l.trim()).map((l) => l.trim().toLowerCase()));
  let trimmed = 0, removed = 0;
  for (const r of rows) {
    const l = labelOf(r), t = stripSearchTail(l);
    if (t === l.trim() || !t) continue;
    if (clean.has(t.toLowerCase())) {
      removed++;
      if (!dryRun) { await Occurrence.updateMany({ occurrences: r.id }, { $pull: { occurrences: r.id } }); await Occurrence.deleteOne({ id: r.id }); if (!(await Occurrence.exists({ moduleId: r.moduleId }))) await Module.deleteOne({ id: r.moduleId }); }
      continue;
    }
    clean.add(t.toLowerCase()); trimmed++;
    if (!dryRun) {
      if (r.label) await Occurrence.updateOne({ id: r.id }, { $set: { label: t } });
      else await Module.updateOne({ id: r.moduleId }, { $set: { label: t } });
    }
  }
  log(`trimmed ${trimmed}, removed ${removed} duplicate(s).`);
}
