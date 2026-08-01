// User, 2026-08-01: "put the daily question in the journal container as a
// nested container, give Daily Question a ### heading".
//
// Daily Question moves from being a sibling section of Journal to a child of
// it, and drops to heading level 3 (it sits inside a `##`, so it is a level
// deeper). The template does the same in the same commit, so tomorrow's column
// is built this way instead of being re-flattened.
//
// The load-bearing part is `allowChildContainers` on Journal: a container
// renders child CONTAINERS only when its module carries that flag. Move the
// question in without it and it vanishes from the page while sitting perfectly
// well in the data — the exact failure that read as "you got rid of my
// trackers" on 2026-07-31. It is set here BEFORE anything is re-parented.

import { decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0027-daily-question-inside-journal";
export const describe =
  "Nests each day's Daily Question inside its Journal section (heading level 3) and sets " +
  "allowChildContainers on Journal so the nested container actually renders.";

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence } = models;

  const boardMod = await Module.findOne({ gridId, role: "page", kind: "board", label: "Day Page" })
    .select({ id: 1 }).lean();
  const boardOcc = boardMod
    ? await Occurrence.findOne({ gridId, moduleId: boardMod.id }).select({ occurrences: 1 }).lean()
    : null;
  const tplMod = await Module.findOne({ gridId, label: "Day Page", role: "container", "meta.templateModule": true })
    .select({ id: 1 }).lean();
  const tplOcc = tplMod ? await Occurrence.findOne({ gridId, moduleId: tplMod.id }).select({ id: 1 }).lean() : null;

  const colIds = [...(boardOcc?.occurrences || []), ...(tplOcc ? [tplOcc.id] : [])];
  if (!colIds.length) { log("no Day Page board or template on this grid"); return; }

  let moved = 0, levelled = 0, flagged = 0;

  for (const colId of colIds) {
    const col = await Occurrence.findOne({ gridId, id: colId })
      .select({ id: 1, moduleId: 1, occurrences: 1, textmap: 1 }).lean();
    if (!col) continue;
    const colMod = await Module.findOne({ gridId, id: col.moduleId }).select({ label: 1 }).lean();

    // Resolve this column's own Journal + Daily Question children.
    let journal = null, question = null;
    for (const kid of col.occurrences || []) {
      const o = await Occurrence.findOne({ gridId, id: kid })
        .select({ id: 1, moduleId: 1, parentId: 1, occurrences: 1, textmap: 1 }).lean();
      if (!o || o.parentId !== col.id) continue;
      const m = await Module.findOne({ gridId, id: o.moduleId }).select({ id: 1, label: 1, meta: 1 }).lean();
      if (m?.label === "Journal") journal = { occ: o, mod: m };
      if (m?.label === "Daily Question") question = { occ: o, mod: m };
    }
    if (!journal) { log(`  ${colMod?.label}: no Journal section — skipped`); continue; }
    if (!question) { log(`  ${colMod?.label}: Daily Question already moved (or absent)`); }

    // 1. Journal must be allowed to render a nested container FIRST.
    if (journal.mod.meta?.allowChildContainers !== true) {
      log(`  ${colMod?.label}: Journal → allowChildContainers`);
      flagged++;
      if (!dryRun) {
        await Module.updateOne({ gridId, id: journal.mod.id }, { $set: { "meta.allowChildContainers": true } });
      }
    }
    if (!question) continue;

    // 2. Daily Question is a level deeper now.
    if (question.mod.meta?.headingLevel !== 3) {
      levelled++;
      if (!dryRun) await Module.updateOne({ gridId, id: question.mod.id }, { $set: { "meta.headingLevel": 3 } });
    }

    // 3. Re-parent: out of the column's list + body, into Journal's.
    log(`  ${colMod?.label}: Daily Question → inside Journal`);
    moved++;
    if (dryRun) continue;

    const colTm = decompressTextmap(col.textmap) || {};
    const colContent = (colTm.content || []).filter(n => n?.attrs?.occurrenceId !== question.occ.id);
    await Occurrence.updateOne({ gridId, id: col.id }, {
      $set: {
        occurrences: (col.occurrences || []).filter(k => k !== question.occ.id),
        textmap: { type: "doc", content: colContent.length ? colContent : [{ type: "paragraph" }] },
      },
    });

    const jTm = decompressTextmap(journal.occ.textmap) || {};
    const jContent = (jTm.content || []).filter(n => n?.attrs?.occurrenceId !== question.occ.id);
    // The question goes FIRST — it is the prompt the journal answers.
    jContent.unshift({ type: "moduleEmbed", attrs: { occurrenceId: question.occ.id } });
    const jKids = (journal.occ.occurrences || []).filter(k => k !== question.occ.id);
    jKids.unshift(question.occ.id);
    await Occurrence.updateOne({ gridId, id: journal.occ.id }, {
      $set: { occurrences: jKids, textmap: { type: "doc", content: jContent } },
    });
    await Occurrence.updateOne({ gridId, id: question.occ.id }, { $set: { parentId: journal.occ.id } });
  }

  log(`${moved} question(s) nested, ${levelled} set to level 3, ${flagged} Journal(s) allowed to hold containers`);
}
