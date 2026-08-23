/**
 * 0199 — the Raindrop export becomes a Bookmarks board and a Lookup page.
 *
 * USER: *"im going to give you a raindrop export and i want you to create a
 * board page of bookmarks where i can click into and it opens the url inside of
 * the panel"*, plus every decision from the design conversation:
 *
 *   flat board, folder as a TAG   *"take the tags and put them in the tags
 *                                  field, add the category in the tags field too"*
 *   searches become LOOKUP        *"a list of instant occurances of all the
 *                                  google search terms ... then yes filter the list"*
 *   Lookup on its OWN page        a reading backlog is not a bookmark
 *   clone per row                 chosen after being shown the cost
 *   only real tags                the 19 date-like ones are Raindrop residue
 *
 * The parse and every rule live in `utils/raindropImport.js`, pure and tested;
 * this migration is the part that writes. Driven over the real export it plans:
 *
 *     1,467 bookmarks · 273 lookup terms · 281 searches routed · 99 duplicates
 *
 * ── IDEMPOTENT ON THE RAINDROP ID ──────────────────────────────────────────
 *
 * Every row carries `meta.raindropId`, and a re-run skips what is already
 * there. That matters more than usual here: this writes ~3,500 documents, and a
 * run that dies halfway must be resumable rather than doubling what it managed.
 *
 * ── WHAT IT REUSES RATHER THAN MINTS ───────────────────────────────────────
 *
 * `URL`, `Tags` and `Date` already exist on this grid. Minting a second `URL`
 * would give the grid two fields with one name — the thing 2026-07-14 (4) swept
 * eleven of and `FieldsTab` now refuses. Only `Cover` and `Excerpt` are new.
 *
 * `Cover` holds the export's image URL as text. It is NOT rendered as a picture
 * yet: `primaryMediaOf` resolves occurrence ids and deliberately has no
 * legacy-string fallback (2026-08-08 (5)), so a URL in a field draws nothing.
 * Turning those into real artifacts is its own pass — 1,030 from the export plus
 * an image search for the 437 without one — and pretending otherwise here would
 * ship a field that looks like a picture and is not.
 */
import { parseCsv, planRaindropImport } from "../utils/raindropImport.js";
import fs from "node:fs";

const uid = () => Math.random().toString(36).slice(2, 12);

export const id = "0199-bookmarks-from-raindrop";
export const describe =
  "Import a Raindrop CSV as a flat Bookmarks board (folder as a tag) plus a Lookup page of search terms. Idempotent on the Raindrop id; creates no duplicate fields.";

/** Where the export is. Overridable, because it is user data and not in the repo. */
export function exportPath() {
  return process.env.RAINDROP_CSV
    || "/home/joshpoms/moduli/screenshots/eb0a375c-4aed-4436-aa66-2c68d50cadc5.csv";
}

/** A page + its board container, as the Ingredients board is shaped. */
function buildSurface({ label, userId, gridId, folderId }) {
  const pageMod = { id: uid(), userId, gridId, role: "page", kind: "board", label, fieldBindings: [], meta: {} };
  const contMod = { id: uid(), userId, gridId, role: "container", kind: "board", label, fieldBindings: [], meta: { allowChildContainers: false } };
  const contOcc = { id: uid(), userId, gridId, moduleId: contMod.id, occurrences: [], fields: {} };
  const pageOcc = { id: uid(), userId, gridId, moduleId: pageMod.id, parentId: folderId, occurrences: [contOcc.id], fields: {} };
  contOcc.parentId = pageOcc.id;
  return { pageMod, contMod, pageOcc, contOcc };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Folder, Grid, Manifest } = models;
  const file = exportPath();
  if (!fs.existsSync(file)) { log(`  REFUSING: no export at ${file} (set RAINDROP_CSV)`); return; }

  const grid = await Grid.findOne({ _id: gridId }).lean() || await Grid.findOne({ id: gridId }).lean();
  const userId = grid?.userId;
  if (!userId) { log("  REFUSING: cannot resolve the grid's userId"); return; }
  const manifest = await Manifest.findOne({ id: grid.manifestId }).lean();
  const rootFolderId = manifest?.rootFolderId;
  if (!rootFolderId) { log("  REFUSING: the grid's manifest has no root folder"); return; }

  const plan = planRaindropImport(parseCsv(fs.readFileSync(file, "utf8")));
  log(`  planned: ${plan.bookmarks.length} bookmark(s), ${plan.lookupTerms.length} lookup term(s)`);
  log(`  dropped: ${plan.dropped.searches} search URL(s) -> Lookup, ${plan.dropped.duplicates} duplicate URL(s)`);

  // ── fields: reuse what exists, mint only what does not ────────────────────
  const fields = await Field.find({ gridId }).lean();
  const byName = new Map(fields.map((f) => [f.name, f]));
  const wanted = [
    { name: "Cover", type: "text", meta: { placeholder: "https://…" } },
    { name: "Excerpt", type: "text", meta: { multiline: true } },
  ];
  const newFields = wanted.filter((w) => !byName.has(w.name))
    .map((w) => ({ id: uid(), userId, gridId, inputEnabled: true, displayEnabled: false, meta: {}, ...w }));
  for (const w of wanted) log(byName.has(w.name) ? `  field ${w.name}: reusing the existing one` : `  field ${w.name}: creating`);
  const fieldId = (n) => byName.get(n)?.id || newFields.find((f) => f.name === n)?.id;
  for (const n of ["URL", "Tags", "Date"]) {
    if (!byName.has(n)) { log(`  REFUSING: expected an existing "${n}" field and found none`); return; }
  }

  // ── surfaces ──────────────────────────────────────────────────────────────
  const existingMods = await Module.find({ gridId, role: "page", label: { $in: ["Bookmarks", "Lookup"] } }).lean();
  if (existingMods.length) log(`  ${existingMods.map((m) => m.label).join(", ")} page(s) already exist — reusing`);

  log(dryRun ? "  (dry run — nothing written)" : "  writing…");
  if (dryRun) return;

  const folders = [], modules = [...newFields.map(() => null)].filter(Boolean), occurrences = [];
  const newModules = [];
  const surfaces = {};
  for (const label of ["Bookmarks", "Lookup"]) {
    const already = existingMods.find((m) => m.label === label);
    if (already) {
      const occ = await Occurrence.findOne({ gridId, moduleId: already.id }).lean();
      const contId = (occ?.occurrences || [])[0];
      surfaces[label] = { pageOccId: occ?.id, contOccId: contId };
      continue;
    }
    const folder = { id: uid(), userId, name: label, parentId: rootFolderId, manifestId: grid.manifestId };
    folders.push(folder);
    const s = buildSurface({ label, userId, gridId, folderId: folder.id });
    newModules.push(s.pageMod, s.contMod);
    occurrences.push(s.pageOcc, s.contOcc);
    surfaces[label] = { pageOccId: s.pageOcc.id, contOccId: s.contOcc.id };
  }

  // ── rows, skipping anything already imported ──────────────────────────────
  const seen = new Set((await Occurrence.find({ gridId, "meta.raindropId": { $exists: true } })
    .select({ meta: 1 }).lean()).map((o) => o.meta.raindropId));
  const U = fieldId("URL"), C = fieldId("Cover"), E = fieldId("Excerpt"),
        T = fieldId("Tags"), D = fieldId("Date");
  const bindings = [U, C, E, T, D].map((f, i) => ({ fieldId: f, order: i, hidden: false, role: "input" }));

  const bmKids = [], lkKids = [];
  for (const b of plan.bookmarks) {
    const key = `b:${b.externalId || b.url}`;
    if (seen.has(key)) continue;
    const mod = { id: uid(), userId, gridId, role: "instance", label: b.title, fieldBindings: bindings, meta: {} };
    const f = { [U]: { value: b.url, flow: "in" } };
    if (b.cover) f[C] = { value: b.cover, flow: "in" };
    if (b.excerpt) f[E] = { value: b.excerpt, flow: "in" };
    if (b.tags.length) f[T] = { value: b.tags, flow: "in" };
    if (b.created) f[D] = { value: b.created, flow: "in" };
    const occ = { id: uid(), userId, gridId, moduleId: mod.id, parentId: surfaces.Bookmarks.contOccId,
                  occurrences: [], fields: f, meta: { raindropId: key } };
    newModules.push(mod); occurrences.push(occ); bmKids.push(occ.id);
  }
  for (const term of plan.lookupTerms) {
    const key = `l:${term.toLowerCase()}`;
    if (seen.has(key)) continue;
    const mod = { id: uid(), userId, gridId, role: "instance", label: term, fieldBindings: [], meta: {} };
    const occ = { id: uid(), userId, gridId, moduleId: mod.id, parentId: surfaces.Lookup.contOccId,
                  occurrences: [], fields: {}, meta: { raindropId: key } };
    newModules.push(mod); occurrences.push(occ); lkKids.push(occ.id);
  }

  if (folders.length) await Folder.insertMany(folders);
  if (newFields.length) await Field.insertMany(newFields);
  for (let i = 0; i < newModules.length; i += 500) await Module.insertMany(newModules.slice(i, i + 500));
  for (let i = 0; i < occurrences.length; i += 500) await Occurrence.insertMany(occurrences.slice(i, i + 500));
  // The container lists its children in one write, not one per row.
  if (bmKids.length) await Occurrence.updateOne({ id: surfaces.Bookmarks.contOccId, gridId }, { $push: { occurrences: { $each: bmKids } } });
  if (lkKids.length) await Occurrence.updateOne({ id: surfaces.Lookup.contOccId, gridId }, { $push: { occurrences: { $each: lkKids } } });

  log(`  done — ${bmKids.length} bookmark(s), ${lkKids.length} lookup term(s), ${newFields.length} new field(s)`);
}
