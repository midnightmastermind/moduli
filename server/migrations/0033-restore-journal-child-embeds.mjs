// User 2026-08-01: "theres stuff written in the journal container, a textblock,
// and no daily question container" → "just bring it back".
//
// The Daily Question was never deleted on either affected day — it is still a
// child in the Journal's `occurrences[]`. What is missing is its `moduleEmbed`
// node in the Journal's TEXTMAP, and a Journal is `kind: "doc"`, so it renders
// its textmap and NOT its occurrences[] list. A child that is listed but not
// embedded therefore exists in the data and is invisible on screen — exactly
// the reported symptom, and the same class as the 2026-07-31 (2) "you got rid
// of my trackers" report (nothing deleted, the render path just couldn't reach
// it).
//
// Measured across the four day columns before writing this:
//
//   Jul 28  textmap [moduleEmbed->Daily Question, paragraph]   ✅ healthy
//   Jul 31  textmap [moduleEmbed->Daily Question, paragraph]   ✅ healthy
//   Jul 30  textmap [paragraph]                                ❌ embed gone
//   Aug 1   textmap [instanceTextblock->(writing), paragraph]  ❌ never embedded
//
// TWO different causes, confirmed against the pre-migration snapshots — worth
// recording because only one of them is a data-repair problem:
//
//   * Jul 30 — `0032` caused it. That Journal's textmap embedded a DETACHED
//     Daily Question wrapper (d4mix7d3) while occurrences[] listed a different,
//     healthy one. 0032 deleted the detached wrapper and correctly scrubbed the
//     dangling embed — but scrubbing the only rendered Daily Question left the
//     Journal with none, because the listed survivor was never embedded.
//     **The lesson: removing a dangling reference is not automatically safe. If
//     the reference was the only thing rendering a surviving sibling, the scrub
//     is itself a regression.**
//   * Aug 1 — NOT 0032. The embed was already absent in the 13:39:27 snapshot,
//     taken before either 0032 run. Today's Daily Question was created at
//     13:22:03 and linked into occurrences[] without ever being embedded, so
//     the build/merge path that mints it is not writing the parent's doc body.
//     THAT IS STILL OPEN — see CLAUDE.md. This migration repairs the data; it
//     does not stop tomorrow's column from arriving the same way.
//
// SAFETY: append-only. Nothing is removed, reordered, or rewritten — the only
// edit is inserting a `moduleEmbed` for a child that is already the Journal's
// own listed child and is currently referenced nowhere in its body. The user's
// writing is preserved verbatim (it is a separate node and is left untouched).
// Idempotent: a child that is already referenced anywhere in the textmap is
// skipped, so re-running writes nothing.

import { decompressTextmap, compressTextmap } from "../utils/textmapCompression.js";

export const id = "0033-restore-journal-child-embeds";
export const describe =
  "Re-embeds child CONTAINERS that a day-column Journal lists in occurrences[] but does not reference in " +
  "its textmap, so they render again (the Daily Question). Append-only; never removes or reorders content.";

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence } = models;

  const boardMod = await Module.findOne({ gridId, role: "page", kind: "board", label: "Day Page" })
    .select({ id: 1 }).lean();
  if (!boardMod) { log("no Day Page board on this grid"); return; }
  const board = await Occurrence.findOne({ gridId, moduleId: boardMod.id })
    .select({ id: 1, occurrences: 1 }).lean();
  if (!board) { log("Day Page board has no occurrence"); return; }

  const occs = await Occurrence.find({ gridId }).select({ id: 1, moduleId: 1, occurrences: 1, textmap: 1 }).lean();
  const mods = await Module.find({ gridId }).select({ id: 1, label: 1, role: 1 }).lean();
  const modById = new Map(mods.map(m => [m.id, m]));
  const byId = new Map(occs.map(o => [o.id, o]));
  const labelOf = (o) => modById.get(o?.moduleId)?.label ?? "(unknown)";

  let repaired = 0, alreadyFine = 0;

  for (const colId of board.occurrences || []) {
    const col = byId.get(colId);
    if (!col) continue;

    for (const kid of col.occurrences || []) {
      const journal = byId.get(kid);
      if (!journal || labelOf(journal) !== "Journal") continue;

      const tm = decompressTextmap(journal.textmap) || { type: "doc", content: [] };
      const content = Array.isArray(tm.content) ? tm.content : [];
      // Any id mentioned ANYWHERE in the body counts as referenced — nodes nest,
      // so a top-level-only scan would re-embed something already on screen.
      const referenced = JSON.stringify(content);

      const missing = (journal.occurrences || [])
        .map(id => byId.get(id))
        .filter(c => c && modById.get(c.moduleId)?.role === "container" && !referenced.includes(c.id));

      if (!missing.length) { alreadyFine++; continue; }

      // Front, matching the healthy columns (the question leads the Journal) and
      // keeping the user's own writing below it in the order they wrote it.
      const next = [
        ...missing.map(c => ({ type: "moduleEmbed", attrs: { occurrenceId: c.id } })),
        ...content,
      ];
      log(`  ${labelOf(col)} › Journal ${journal.id.slice(0, 8)}: re-embedding ` +
          missing.map(c => `${labelOf(c)} (${c.id.slice(0, 8)})`).join(", ") +
          `  [${content.length} existing node(s) preserved]`);
      repaired++;
      if (!dryRun) {
        // Compressed, like every other textmap on the grid — the app's own
        // update_occurrence compresses, and a raw write here would leave this
        // record shaped unlike every neighbour.
        await Occurrence.updateOne(
          { gridId, id: journal.id },
          { $set: { textmap: compressTextmap({ ...tm, type: tm.type || "doc", content: next }) } },
        );
      }
    }
  }

  log(`${repaired} Journal(s) repaired, ${alreadyFine} already rendering their children`);
}
