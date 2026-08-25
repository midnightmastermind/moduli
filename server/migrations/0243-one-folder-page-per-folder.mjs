/**
 * 0243 — a folder page listed ITSELF, forever.
 *
 * User, 2026-08-25: *"we have an infinite loop going with trackers. theres a
 * trackers folder with trackers inside the trackers folder and its like that
 * all the way down."*
 *
 * ── THE MECHANISM, AND WHY ONE DUPLICATE IS ENOUGH TO CAUSE IT ───────────
 *
 * A folder page renders every occurrence parented to its folder, minus itself:
 *
 *     .filter(occ => occ.id !== occurrence.id && !occ.meta?.isTemplate)
 *
 * That is a SINGLE-ID check. A folder's own card IS a `role:"page"
 * kind:"folder"` occurrence parented to that folder — so with TWO of them, page
 * A excludes A and renders B, clicking B opens the same folder, B excludes B and
 * renders A. Infinite descent, and every level looks legitimate.
 *
 * ── MEASURED, AND THE TIMESTAMPS NAME THE CAUSE ──────────────────────────
 *
 * ```
 * poms grid   70 folders · 31 folder-page occurrences · 8 folders with TWO
 *   Day Pages · Library · Files · Interests · Lookup · Projects · Trackers · Documents
 *   every pair created 2026-08-25T14:35:01 and 14:35:12 — 11 seconds apart
 * test grid 1   0 duplicates      test grid 2   0      contrast scratch   0
 * ```
 *
 * `ModulePage` mints a missing folder page from an EFFECT, and
 * `ensureFolderPageOcc` decides "does one exist" from the occurrence map it is
 * HANDED — so two callers resolving that map before either write lands both
 * mint. Two panels on the same folder page do it in a single commit. Same
 * 14:35 window as the duplicate day columns `0242` repaired.
 *
 * ── ALL THREE HALVES SHIP, BECAUSE NONE OF THEM IS SUFFICIENT ────────────
 *
 *  - this migration removes the 8 duplicates that exist;
 *  - `ensureFolderPageOcc` gains a per-folder latch, which closes the
 *    same-tick window but CANNOT help across tabs;
 *  - `ModulePage.folderChildOccs` now drops folder pages of its OWN folder by
 *    KIND rather than by id, so a duplicate that does arrive can never loop
 *    again. That is the durable one; this file only cleans up.
 *
 * ── WHICH COPY SURVIVES, AND WHY IT IS SAFE ──────────────────────────────
 *
 * Every one of the 16 is EMPTY — `occurrences: []`, no children parented to it,
 * no textmap. They are pure cards. So the keeper is simply the EARLIEST (the
 * one anything already pointing at a folder page is most likely to name), and
 * the guard is re-run at apply time: a duplicate that holds ANY child, any
 * listed occurrence or any text is left alone and reported, never deleted.
 *
 * Nothing else references these ids — checked, not assumed: a copy listed by
 * some other occurrence, or named by an operation, is kept.
 */
import fs from "fs";
import path from "path";
import { decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0243-one-folder-page-per-folder";
export const describe =
  "Removes duplicate folder-page occurrences (8 folders on poms grid hold two each), keeping the earliest. Refuses any copy that holds children, is listed elsewhere, or carries text.";
export const touches = ["occurrences"];

/** Is this occurrence a folder's own card? Module kind+role — the RENDERER's test. */
export function isFolderPageOcc(occ, modulesById) {
  const mod = modulesById.get(occ?.moduleId);
  return mod?.kind === "folder" && mod?.role === "page";
}

export function textCharsOf(occ) {
  const tm = decompressTextmap(occ?.textmap);
  if (!tm) return 0;
  let n = 0;
  (function walk(node) {
    if (!node) return;
    if (typeof node.text === "string") n += node.text.length;
    for (const c of node.content || []) walk(c);
  })(tm);
  return n;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Operation } = models;
  const [occs, mods, ops] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Operation.find({ gridId }).lean(),
  ]);
  const modulesById = new Map(mods.map((m) => [m.id, m]));

  // Group every folder-page occurrence by the folder it belongs to.
  const byFolder = new Map();
  for (const o of occs) {
    if (!o.parentId) continue;
    if (!isFolderPageOcc(o, modulesById)) continue;
    if (!byFolder.has(o.parentId)) byFolder.set(o.parentId, []);
    byFolder.get(o.parentId).push(o);
  }
  const dups = [...byFolder.entries()].filter(([, l]) => l.length > 1);
  log(`${byFolder.size} folder(s) carry a folder page; ${dups.length} carry more than one.`);
  if (!dups.length) { log("nothing to do."); return; }

  // Anything that names an occurrence id, so a referenced copy is never removed.
  const listedAnywhere = new Set();
  for (const o of occs) for (const c of o.occurrences || []) listedAnywhere.add(c);
  const childrenOf = new Map();
  for (const o of occs) {
    if (!o.parentId) continue;
    if (!childrenOf.has(o.parentId)) childrenOf.set(o.parentId, []);
    childrenOf.get(o.parentId).push(o.id);
  }
  const opBlob = JSON.stringify(ops);

  const toDelete = [];
  for (const [folderId, list] of dups) {
    const sorted = [...list].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    const keeper = sorted[0];
    log(`  folder ${folderId.slice(0, 10)}: ${list.length} pages — keeping ${keeper.id.slice(0, 10)} (earliest)`);
    for (const loser of sorted.slice(1)) {
      const kids = childrenOf.get(loser.id) || [];
      const chars = textCharsOf(loser);
      const reasons = [];
      if ((loser.occurrences || []).length) reasons.push(`lists ${loser.occurrences.length} child(ren)`);
      if (kids.length) reasons.push(`${kids.length} occurrence(s) parented to it`);
      if (chars) reasons.push(`${chars} character(s) of text`);
      if (listedAnywhere.has(loser.id)) reasons.push("listed by another occurrence");
      if (opBlob.includes(loser.id)) reasons.push("named by an operation");
      if (reasons.length) {
        log(`     KEEPING ${loser.id.slice(0, 10)} — ${reasons.join("; ")}`);
        continue;
      }
      toDelete.push(loser);
    }
  }

  log(`\nplan: delete ${toDelete.length} duplicate folder-page occurrence(s)`);
  if (dryRun) { log("DRY RUN — nothing written."); return; }
  if (!toDelete.length) return;

  const dir = path.resolve(process.cwd(), "backups/orphans");
  fs.mkdirSync(dir, { recursive: true });
  const dump = path.join(dir, `0243-folder-pages-${Date.now()}.json`);
  fs.writeFileSync(dump, JSON.stringify(toDelete, null, 2));
  log(`dumped ${toDelete.length} raw occurrence(s) to ${dump}`);

  await Occurrence.deleteMany({ gridId, id: { $in: toDelete.map((o) => o.id) } });
  log(`removed ${toDelete.length} occurrence(s).`);
}
