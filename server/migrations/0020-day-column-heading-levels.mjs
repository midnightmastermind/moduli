// User, 2026-07-31: "make the day page container headings ## not #. except the
// top one saying the date" → "make it use # heading and then get rid of the
// textblock at the top that has the same heading".
//
// The template already ships this shape (same commit). This carries it to the
// columns that already exist:
//
//   * the day COLUMN becomes heading level 1 — it holds the date, so it is the
//     day's "#".
//   * every section inside it becomes level 2 — "##".
//   * the heading TEXTBLOCK is deleted. It rendered "Day Page - <date>"
//     directly beneath a column header already reading "Day Page - <date>":
//     the same string twice. Checked before writing this: every one of them
//     held only that date string, no user writing.
//
// The renderer prints one hash per level, so the levels are what produce "#"
// and "##" — no code learns which containers these are.

import { decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0020-day-column-heading-levels";
export const describe =
  "Sets the day COLUMNS to heading level 1 and their sections to level 2, and deletes the redundant " +
  "heading textblock that repeated the column's own title. Skips any heading textblock that carries " +
  "text beyond the date, so nothing written is lost.";

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence } = models;

  // The day columns are the CHILDREN of the Day Page board, plus the template
  // root they were stamped from. Resolved structurally rather than by
  // `meta.appliedFromTemplateId` — the dry run showed that marker also sits on
  // every routine clone the Schedule builds (Drink, Hygiene, Eat…), which would
  // have made 30 workout instances heading level 1.
  const boardMod = await Module.findOne({ gridId, role: "page", kind: "board", label: "Day Page" })
    .select({ id: 1 }).lean();
  const boardOcc = boardMod
    ? await Occurrence.findOne({ gridId, moduleId: boardMod.id }).select({ id: 1, occurrences: 1 }).lean()
    : null;
  // The TEMPLATE is the one whose module is still flagged `templateModule` —
  // APPLY_TEMPLATE copies `meta.templateName` onto every clone (so matching on
  // that alone picked a day COLUMN, verified against the live grid) but strips
  // templateModule from what it mints.
  const tplMod = await Module.findOne({ gridId, label: "Day Page", role: "container", "meta.templateModule": true })
    .select({ id: 1 }).lean();
  const tplOcc = tplMod
    ? await Occurrence.findOne({ gridId, moduleId: tplMod.id }).select({ id: 1 }).lean()
    : null;

  const colIds = [...(boardOcc?.occurrences || []), ...(tplOcc ? [tplOcc.id] : [])];
  if (!colIds.length) { log("no Day Page board or template on this grid"); return; }
  const cols = await Occurrence.find({ gridId, id: { $in: colIds } })
    .select({ id: 1, moduleId: 1, occurrences: 1, textmap: 1 }).lean();
  if (!cols.length) { log("no day columns on this grid"); return; }
  log(`${cols.length} day column(s)${tplOcc ? " (including the template)" : ""}`);

  let levelled = 0, removed = 0, kept = 0;
  for (const col of cols) {
    // 1. the column is the H1
    const colMod = await Module.findOne({ gridId, id: col.moduleId }).select({ id: 1, meta: 1, label: 1 }).lean();
    if (colMod && colMod.meta?.headingLevel !== 1) {
      log(`  "${colMod.label}" → heading level 1`);
      levelled++;
      if (!dryRun) await Module.updateOne({ gridId, id: colMod.id }, { $set: { "meta.headingLevel": 1 } });
    }

    const kids = await Occurrence.find({ gridId, id: { $in: col.occurrences || [] } })
      .select({ id: 1, moduleId: 1, textmap: 1 }).lean();
    const kidMods = await Module.find({ gridId, id: { $in: kids.map(k => k.moduleId) } })
      .select({ id: 1, label: 1, role: 1, meta: 1 }).lean();
    const modById = new Map(kidMods.map(m => [m.id, m]));

    const dropIds = [];
    for (const kid of kids) {
      const mod = modById.get(kid.moduleId);
      if (!mod) continue;

      // 2. the redundant heading textblock
      if (mod.role === "textblock" && mod.label === "Day Page heading") {
        const text = JSON.stringify((decompressTextmap(kid.textmap) || {}).content || []);
        // "Day Page - 2026-07-31" on a column, "Day Page - {Date}" on the
        // template (the token the build op replaces). One text node, nothing else.
        const onlyTheDate = /Day Page - (\d{4}-\d{2}-\d{2}|\{Date\})/.test(text)
          && (text.match(/"text":"[^"]*"/g) || []).length <= 1;
        if (!onlyTheDate) { log(`    heading ${kid.id.slice(0, 8)} carries more than the date — KEEPING it`); kept++; continue; }
        log(`    removing the heading textblock that repeats the column title`);
        removed++;
        dropIds.push(kid.id);
        continue;
      }

      // 3. every section is an H2
      if (mod.role === "container" && mod.meta?.headingLevel !== 2) {
        if (!dryRun) await Module.updateOne({ gridId, id: mod.id }, { $set: { "meta.headingLevel": 2 } });
      }
    }

    if (dropIds.length && !dryRun) {
      const tm = decompressTextmap(col.textmap) || {};
      const content = (tm.content || []).filter(n => !dropIds.includes(n?.attrs?.occurrenceId));
      await Occurrence.updateOne({ gridId, id: col.id }, {
        $set: {
          occurrences: (col.occurrences || []).filter(k => !dropIds.includes(k)),
          textmap: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] },
        },
      });
      await Occurrence.deleteMany({ gridId, id: { $in: dropIds } });
    }
  }

  // The heading MODULE, once nothing places it any more.
  const headMods = await Module.find({ gridId, role: "textblock", label: "Day Page heading" }).select({ id: 1 }).lean();
  for (const m of headMods) {
    const uses = await Occurrence.countDocuments({ gridId, moduleId: m.id });
    if (uses) continue;
    log(`  deleting the now-unplaced "Day Page heading" module`);
    if (!dryRun) await Module.deleteOne({ gridId, id: m.id });
  }

  log(`${levelled} column(s) levelled, ${removed} heading textblock(s) removed${kept ? `, ${kept} kept (had writing)` : ""}`);
}
