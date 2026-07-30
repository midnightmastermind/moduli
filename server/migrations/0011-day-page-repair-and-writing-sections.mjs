// User, 2026-07-30: "make sure the daypage is working on poms grid … add in
// writing sections in the necessary spots. like a journal todolist notetaking
// daypage."
//
// The grid held exactly ONE day page (2026-07-28) and nothing for the two days
// since, its Daily Question was inert, and its Tasks Completed embeds all
// pointed at the literal string "$task.id". Five defects, repaired together
// because they overlap — and because a master repair propagates into every copy
// minted afterwards, so masters and copies have to move in the same pass
// (2026-07-30 lesson).
//
//  1. `Day Page: Build` located its template with `FIND meta.templateName IS
//     "Day Page"`. APPLY_TEMPLATE copies meta onto the clone, so from the second
//     day on that FIND matched the template AND every page it had built; a
//     multi-match FIND returns an ARRAY, which APPLY_TEMPLATE cannot resolve.
//     One page, then jammed forever. Now bound picker-direct by id.
//  2. The day-column catch-all is renamed `No timeslot` → `Todo` — on the module
//     label AND on the Time Slot identity MARKER that Build Schedule finds it by,
//     on the master and on every per-day copy, in one pass. The two move together
//     on purpose: a label saying one thing while the marker says another is the
//     silent drift that cost three repair passes on 2026-07-30. (The markers were
//     already intact — this is a rename, not a repair.)
//  3. The day page gains Journal / Notes / Highlights sections, and links that
//     day's Todo container in by multi-parenting (not copying — one occurrence,
//     so a tick here and a tick on the Schedule are the same write).
//  4. `Daily Question` flips to inputEnabled so its bound header can be written.
//     Its 117-question pool and randomize flag already worked.
//  5. Existing day pages are repaired in place, not rebuilt.
//
// The client fixes that pair with this (APPLY_TEMPLATE's defaultFields reaching
// bound container/textblock clones, and PUSH_TO_ARRAY resolving nested leaves)
// ship in the same commit — the ops here depend on both.

import { makeDayPageBuildOp, makeDayPageBuildTasksCompletedOp, TODO_SLOT_LABEL } from "../utils/liveSystemBuilders.js";
// Textmaps are stored COMPRESSED. A migration reads raw DB documents, so a bare
// `page.textmap.content` is undefined rather than the node list — which silently
// turned the damage check below into a no-op the first time round.
import { decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0011-day-page-repair-and-writing-sections";
export const describe =
  "Unjams Day Page: Build (picker-direct template ref), renames the day-column catch-all to Todo and " +
  "restores its identity marker, adds Journal/Notes/Highlights to the Day Page template and to existing " +
  "day pages, links that day's Todo into the page, and makes Daily Question writable.";

const WRITING_SECTIONS = ["Journal", "Notes", "Highlights"];
const uid = () => Math.random().toString(36).slice(2, 14);

// Section order on the page. Todo is absent: it is not a section the page owns
// — the op splices in the day-column's own container after the Daily Question.
const ORDER = ["Day Page heading", "Daily Question", "Journal", "Notes", "Tasks Completed", "Highlights"];

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Field, Module, Occurrence, Operation, Folder } = models;

  const userId = grid.userId;
  const sched = grid?.meta?.scheduleFieldIds || {};
  const { dateFieldId, timeslotFieldId, scheduleFormatFieldId, pageOccurrenceId: schedulePageOccId } = sched;
  if (!dateFieldId || !timeslotFieldId || !scheduleFormatFieldId || !schedulePageOccId) {
    throw new Error("grid.meta.scheduleFieldIds is incomplete — cannot resolve the schedule fields this migration keys on");
  }

  // ── 1. The catch-all container: rename the label AND the identity marker ──
  // Found STRUCTURALLY (the module the day-columns copy-link, by its current
  // label) rather than by a baked id. The master and every per-day copy move in
  // the SAME pass: Build Schedule COPY_LINKs the master, so a rename that landed
  // on only one of the two would propagate the mismatch into every copy minted
  // afterwards (2026-07-30).
  const catchAll = await Module.findOne({
    gridId, role: "container", label: { $in: ["No timeslot", TODO_SLOT_LABEL] },
  }).select({ id: 1, label: 1 }).lean();

  if (!catchAll) {
    log("no No timeslot/Todo container module — skipping the rename");
  } else {
    const occs = await Occurrence.find({ gridId, moduleId: catchAll.id }).select({ id: 1, fields: 1, identitySignature: 1 }).lean();
    const unmarked = occs.filter(o => o.fields?.[timeslotFieldId]?.value !== TODO_SLOT_LABEL);
    log(`rename "${catchAll.label}" -> "${TODO_SLOT_LABEL}" on the module label and on the Time Slot marker of ${unmarked.length} of ${occs.length} occurrence(s) (master + per-day copies)`);
    if (!dryRun) {
      await Module.updateOne({ gridId, id: catchAll.id }, { $set: { label: TODO_SLOT_LABEL } });
      for (const o of unmarked) {
        await Occurrence.updateOne({ gridId, id: o.id }, {
          $set: {
            [`fields.${timeslotFieldId}`]: { value: TODO_SLOT_LABEL, flow: "in" },
            identitySignature: `slot:${TODO_SLOT_LABEL}`,
          },
        });
      }
    }
  }

  // A day-column may hold TWO Todo copies: Build Schedule dedupes by
  // `meta.copyLinkSource`, so a copy minted by any other path is invisible to
  // that check and survives alongside the real one. Keep the copy-linked one
  // (the one Build Schedule will keep re-finding); drop childless strays only —
  // a duplicate holding items is data, and gets left alone to be looked at.
  if (catchAll) {
    const all = await Occurrence.find({ gridId, moduleId: catchAll.id }).select({ id: 1, parentId: 1, meta: 1, occurrences: 1 }).lean();
    const byParent = new Map();
    for (const o of all) {
      if (!o.parentId) continue;
      (byParent.get(o.parentId) || byParent.set(o.parentId, []).get(o.parentId)).push(o);
    }
    const strays = [];
    for (const [, group] of byParent) {
      if (group.length < 2) continue;
      const keeper = group.find(o => o.meta?.copyLinkSource) || group[0];
      for (const o of group) {
        if (o.id === keeper.id) continue;
        if ((o.occurrences || []).length) { log(`  duplicate Todo ${o.id} holds ${o.occurrences.length} item(s) — LEFT IN PLACE for review`); continue; }
        strays.push(o.id);
      }
    }
    if (strays.length) {
      log(`delete ${strays.length} duplicate empty Todo container(s) from their day-column(s)`);
      if (!dryRun) {
        await Occurrence.deleteMany({ gridId, id: { $in: strays } });
        await Occurrence.updateMany({ gridId, occurrences: { $in: strays } }, { $pull: { occurrences: { $in: strays } } });
      }
    }
  }

  // `Due` carries its own label in Time Slot as an identity marker the same way.
  // It is NOT renamed — this is a no-op guard that re-asserts the marker only if
  // some earlier repair ever left it empty (the 2026-07-30 blunt pass nulled
  // these once). Expected to log nothing.
  const dueMod = await Module.findOne({ gridId, role: "container", label: "Due" }).select({ id: 1 }).lean();
  if (dueMod) {
    const dueOccs = await Occurrence.find({ gridId, moduleId: dueMod.id }).select({ id: 1, fields: 1 }).lean();
    const needDue = dueOccs.filter(o => o.fields?.[timeslotFieldId]?.value !== "Due");
    if (needDue.length) {
      log(`restore the Due identity marker on ${needDue.length} of ${dueOccs.length} occurrence(s)`);
      if (!dryRun) {
        for (const o of needDue) {
          await Occurrence.updateOne({ gridId, id: o.id }, { $set: { [`fields.${timeslotFieldId}`]: { value: "Due", flow: "in" } } });
        }
      }
    }
  }

  // ── 2. Schedule: Build Schedule — point its two FINDs at the new marker ────
  const buildSched = await Operation.findOne({ gridId, name: "Schedule: Build Schedule" }).lean();
  if (buildSched) {
    const before = JSON.stringify(buildSched.pipeline);
    // ALSO: the per-slot dedupe matched `_ancestors HAS_ANCESTOR $dayColId`.
    // Once the day page multi-parents the Todo container in, that copy's
    // ancestor chain can resolve through the PAGE instead of the day-column, so
    // the dedupe misses and a duplicate is minted on every load. parentId is the
    // precise test for a direct child and is unaffected by a second parent.
    const after = before
      .split('"No timeslot"').join(`"${TODO_SLOT_LABEL}"`)
      .replace(/\{("id":"[^"]*",)?"left":"_ancestors","comparator":"HAS_ANCESTOR","right":"\$dayColId"\}(\]\},"itemIdVar":"\$slotCopyId")/g,
               (_m, idPart = "", tail) => `{${idPart}"left":"parentId","comparator":"IS","right":"$dayColId"}${tail}`);
    if (after !== before) {
      log(`Schedule: Build Schedule — retarget ${before.split('"No timeslot"').length - 1} marker rule(s) to "${TODO_SLOT_LABEL}"`);
      if (!dryRun) await Operation.updateOne({ gridId, id: buildSched.id }, { $set: { pipeline: JSON.parse(after) } });
    } else {
      log("Schedule: Build Schedule already targets the new marker");
    }
  }

  // ── 3. Daily Question becomes writable ────────────────────────────────────
  const dq = await Field.findOne({ gridId, name: "Daily Question" }).select({ id: 1, inputEnabled: 1 }).lean();
  if (dq && !dq.inputEnabled) {
    log("Daily Question -> inputEnabled (a display-only field renders no writable header control)");
    if (!dryRun) await Field.updateOne({ gridId, id: dq.id }, { $set: { inputEnabled: true } });
  }

  // ── 4. Writing sections, on the template AND on every existing day page ───
  // The template occurrence is the one parented to the TEMPLATES folder. It
  // cannot be told from its clones by meta alone: APPLY_TEMPLATE copies
  // meta.templateName AND meta.templateModule onto every page it mints.
  const tplFolder = await Folder.findOne({ gridId, folderType: "templates" }).select({ id: 1 }).lean();
  const tplRootId = tplFolder?.id
    || (await Folder.findOne({ gridId, name: "Templates" }).select({ id: 1 }).lean())?.id;
  const tplPage = tplRootId
    ? await Occurrence.findOne({ gridId, parentId: tplRootId, "meta.templateName": "Day Page" }).lean()
    : null;
  if (!tplPage) throw new Error("Day Page template occurrence not found under the Templates folder");

  const dayFolder = await Folder.findOne({ gridId, folderType: "day-pages" }).select({ id: 1 }).lean();
  const allDayPages = dayFolder
    ? await Occurrence.find({ gridId, parentId: dayFolder.id, "meta.templateName": "Day Page" }).lean()
    : [];

  // Sweep pages the period-object bug named. `$dayDate` used to resolve to the
  // picker's {value,unit,…} object, so the name interpolated to the literal
  // "Day Page - [object Object]" — a page for no date at all, which nothing can
  // ever find again. Deleted with its children rather than renamed: there is no
  // date to rename it TO.
  // APPLY_TEMPLATE's rootLabel lands on the cloned MODULE, so the occurrence's
  // own `label` is usually null — resolve through the module before matching.
  const pageMods = await Module.find({ gridId, id: { $in: allDayPages.map(p => p.moduleId) } }).select({ id: 1, label: 1 }).lean();
  const modLabel = new Map(pageMods.map(m => [m.id, m.label]));
  const nameOf = (p) => p.label ?? modLabel.get(p.moduleId) ?? "";
  const malformed = allDayPages.filter(p => /\[object Object\]/.test(nameOf(p)));
  const livePages = allDayPages.filter(p => !malformed.includes(p));
  if (malformed.length) {
    log(`delete ${malformed.length} malformed day page(s) named by the period-object bug: ${malformed.map(nameOf).join(", ")}`);
    if (!dryRun) {
      for (const p of malformed) {
        const kidIds = p.occurrences || [];
        const grandKids = await Occurrence.find({ gridId, id: { $in: kidIds } }).select({ occurrences: 1 }).lean();
        const doomed = [p.id, ...kidIds, ...grandKids.flatMap(k => k.occurrences || [])];
        await Occurrence.deleteMany({ gridId, id: { $in: doomed } });
        // Unlink from anything still listing it (the hub panel's tab strip).
        await Occurrence.updateMany({ gridId, occurrences: { $in: doomed } }, { $pull: { occurrences: { $in: doomed } } });
      }
    }
  }

  // Mints the three containers under `page` when absent and rebuilds the page's
  // textmap in the agreed order. Idempotent: a page that already carries them
  // is left alone.
  async function addSections(page, isTemplate) {
    const kids = await Occurrence.find({ gridId, id: { $in: page.occurrences || [] } }).select({ id: 1, moduleId: 1 }).lean();
    const kidMods = await Module.find({ gridId, id: { $in: kids.map(k => k.moduleId) } }).select({ id: 1, label: 1 }).lean();
    const labelOf = new Map(kidMods.map(m => [m.id, m.label]));
    const have = new Map(kids.map(k => [labelOf.get(k.moduleId), k.id]));

    // A page whose textmap holds nodes that are not TipTap nodes was written by
    // the loop-over-nested-path bug (it iterated every occurrence and wrote 1278
    // occurrence records in as if they were nodes). Rebuild it regardless of
    // whether the sections are present.
    const tm = decompressTextmap(page.textmap) || {};
    const damaged = (tm.content || []).some(n => !n?.type);
    const missing = WRITING_SECTIONS.filter(s => !have.has(s));
    if (!missing.length && !damaged) return 0;
    if (damaged) log(`  ${nameOf(page)}: textmap holds ${(tm.content || []).length} entries, some of them not nodes — rebuilding`);

    for (const label of missing) {
      const modId = uid(), occId = uid();
      if (!dryRun) {
        await new Module({
          id: modId, userId, gridId, role: "container", kind: "doc", label,
          meta: isTemplate ? { templateModule: true } : {},
        }).save();
        await new Occurrence({
          id: occId, userId, gridId, moduleId: modId, targetId: modId, targetType: "module",
          parentId: page.id, occurrences: [],
          textmap: { type: "doc", content: [{ type: "paragraph" }] },
        }).save();
      }
      have.set(label, occId);
    }

    // Rebuild the child list + textmap in ORDER. Anything the page carries that
    // ORDER does not name (a Todo link, a section the user added) is preserved
    // at the end rather than dropped — de-duplicated, because ADD_CHILD ran
    // once per op fire before the child list settled.
    const known = new Set(ORDER);
    const extras = [...new Set(kids.filter(k => !known.has(labelOf.get(k.moduleId))).map(k => k.id))];
    const ordered = ORDER.map(l => have.get(l)).filter(Boolean).concat(extras);

    // The heading child is hosted by an `instanceTextblock` node (which also
    // carries the child's MODULE id), every other section by a `moduleEmbed`.
    // Emitting the wrong node type renders the heading as an empty block.
    const modIdOf = new Map(kids.map(k => [k.id, k.moduleId]));
    const headingOccId = have.get("Day Page heading");
    const oldContent = tm.content || [];
    const nodeFor = (occId) => oldContent.find(n => n?.type && n?.attrs?.occurrenceId === occId)
      || (occId === headingOccId
        ? { type: "instanceTextblock", attrs: { instanceId: modIdOf.get(occId), occurrenceId: occId } }
        : { type: "moduleEmbed", attrs: { occurrenceId: occId } });

    if (!dryRun) {
      await Occurrence.updateOne({ gridId, id: page.id }, {
        $set: { occurrences: ordered, textmap: { type: "doc", content: ordered.map(nodeFor) } },
      });
    }
    return missing.length;
  }

  const tplAdded = await addSections(tplPage, true);
  log(`Day Page template: ${tplAdded ? `added ${tplAdded} writing section(s)` : "already carries the writing sections"}`);
  for (const p of livePages) {
    const n = await addSections(p, false);
    log(`  ${nameOf(p)}: ${n ? `added ${n} writing section(s)` : "already complete"}`);
  }

  // ── 5. Day Page: Build — regenerate from the builder ──────────────────────
  // Regenerated rather than patched: the template ref changes shape AND a whole
  // Todo-link tail is appended, so a surgical edit would be the more fragile of
  // the two. The op's OWN id/name/folder are preserved so nothing referencing it
  // by either breaks; the picker-direct page ids are read back out of the
  // pipeline it already carries, so none are re-derived by guesswork.
  const old = await Operation.findOne({ gridId, name: "Day Page: Build" }).lean();
  if (!old) { log("no Day Page: Build op — nothing to regenerate"); return; }

  const oldJson = JSON.stringify(old.pipeline);
  const goalsPageOccId = oldJson.match(/\$goalsPage","expr":"\$allItemsById\.([\w-]+)"/)?.[1];
  const hubPanelOccIdVar = oldJson.match(/"type":"ADD_CHILD","parentId":"([\w-]+)"/)?.[1];
  const dayPagesFolderId = oldJson.match(/"rootParent":"([\w-]+)"/)?.[1] || dayFolder?.id;
  if (!goalsPageOccId || !hubPanelOccIdVar || !dayPagesFolderId) {
    throw new Error(`could not read the existing Day Page: Build refs (goals=${goalsPageOccId} hub=${hubPanelOccIdVar} folder=${dayPagesFolderId})`);
  }

  const rebuilt = makeDayPageBuildOp({
    userId, gridId, dateFieldId, dayPagesFolderId, hubPanelOccIdVar,
    goalsPageOccId, schedulePageOccId,
    dayPageTemplateOccId: tplPage.id,
    timeslotFieldId, scheduleFormatFieldId,
  });
  log(`Day Page: Build — regenerate pipeline (template ref -> $allItemsById.${tplPage.id}, $activeDate, + Todo link pass)`);
  if (!dryRun) {
    await Operation.updateOne({ gridId, id: old.id }, {
      $set: {
        pipeline: rebuilt.pipeline,
        triggerTypes: rebuilt.triggerTypes,
        triggerObjects: rebuilt.triggerObjects,
        targetOccurrenceId: rebuilt.targetOccurrenceId,
      },
    });
  }

  // ── 6. Day Page: Build Tasks Completed — same date fix ────────────────────
  // It resolved $dayDate the same broken way, so its $dayPageName never matched
  // a real page. Regenerated for the date chain + targetOccurrenceId; its
  // embeds only resolve correctly alongside the PUSH_TO_ARRAY deep-resolve fix
  // shipping in the same commit.
  const oldTC = await Operation.findOne({ gridId, name: "Day Page: Build Tasks Completed" }).lean();
  if (oldTC) {
    const completed = await Field.findOne({ gridId, name: "Completed" }).select({ id: 1 }).lean();
    const completedFieldId = completed?.id
      || JSON.stringify(oldTC.pipeline).match(/"left":"fields\.([\w-]+)\.value","comparator":"IS","right":"true"/)?.[1];
    if (!completedFieldId) throw new Error("could not resolve the Completed field id for Day Page: Build Tasks Completed");
    const rebuiltTC = makeDayPageBuildTasksCompletedOp({ userId, gridId, dateFieldId, completedFieldId, schedulePageOccId });
    log("Day Page: Build Tasks Completed — regenerate pipeline ($activeDate + targetOccurrenceId)");
    if (!dryRun) {
      await Operation.updateOne({ gridId, id: oldTC.id }, {
        $set: {
          pipeline: rebuiltTC.pipeline,
          triggerTypes: rebuiltTC.triggerTypes,
          triggerObjects: rebuiltTC.triggerObjects,
          targetOccurrenceId: rebuiltTC.targetOccurrenceId,
        },
      });
    }
  }
}
