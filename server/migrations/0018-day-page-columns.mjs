// User, 2026-07-31: "can we make daypage work like the schedule. with containers
// being the days. these would be doccontainers with other containers inside of
// it" — plus "the daypage should respond to the filters like schedule" and "id
// also like to change the template on the fly so it updates".
//
// Converts the live grid from a page-per-day to ONE board page holding a COLUMN
// per day. Besides being what was asked for, it retires the recurring pinning
// failure by construction: there is one page, pinned once, instead of a fresh
// page and a fresh hub tab every morning (the strip had three by the third day,
// one of them a junk "[object Object]" module from the old naming bug).
//
//   Day Page (board page)
//     └─ Day Page - 2026-07-31   day COLUMN, kind:doc, carries the Date field
//          ├─ Daily Question / Todo / Journal / Notes / Tasks Completed / …
//
// What this does, in order:
//   1. mints the board page (idempotent — reuses one if it exists),
//   2. gives the TEMPLATE the same shape as the seed: root is a container that
//      binds Date, and every section carries an identitySignature so a later
//      merge tops up existing days instead of duplicating their sections,
//   3. converts each existing day page into a column under the board, carrying
//      its own date and a route back to the template,
//   4. unpins the per-day tabs from the hub and pins the board once,
//   5. drops the junk "[object Object]" module (verified to have no occurrence),
//   6. rewrites both stored pipelines from the builders.
//
// Nothing a user wrote is deleted: the columns keep their own children and
// bodies, so journals, notes and answers come across untouched.

import { makeDayPageBuildOp, makeDayPageBuildTasksCompletedOp } from "../utils/liveSystemBuilders.js";

export const id = "0018-day-page-columns";
export const describe =
  "Converts the day pages into day COLUMNS on a single 'Day Page' board page (kept content and all), " +
  "reshapes the Day Page template to match, unpins the accumulated per-day hub tabs in favour of the " +
  "one board page, deletes the junk 'Day Page - [object Object]' module (which has no occurrence), and " +
  "rewrites the two Day Page pipelines. No user content is deleted.";

const uid = () => Math.random().toString(36).slice(2, 14);
const DATE_IN_LABEL = /Day Page - (\d{4}-\d{2}-\d{2})/;

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Field, Module, Occurrence, Operation, Folder, View } = models;
  const userId = grid.userId;

  const sched = grid?.meta?.scheduleFieldIds || {};
  const { dateFieldId, timeslotFieldId, scheduleFormatFieldId, pageOccurrenceId: schedulePageOccId } = sched;
  if (!dateFieldId || !schedulePageOccId) throw new Error("grid.meta.scheduleFieldIds is incomplete");

  // ── 1. the board page ─────────────────────────────────────────────────────
  const dayFolder = await Folder.findOne({ gridId, folderType: "day-pages" }).select({ id: 1 }).lean();
  let boardMod = await Module.findOne({ gridId, role: "page", kind: "board", label: "Day Page" }).select({ id: 1 }).lean();
  let boardOcc = boardMod
    ? await Occurrence.findOne({ gridId, moduleId: boardMod.id }).select({ id: 1, occurrences: 1 }).lean()
    : null;
  let boardOccId = boardOcc?.id || uid();
  if (!boardOcc) {
    log(`minting the Day Page board page (${boardOccId})`);
    if (!dryRun) {
      const modId = boardMod?.id || uid();
      if (!boardMod) await new Module({ id: modId, userId, gridId, role: "page", kind: "board", label: "Day Page" }).save();
      await new Occurrence({
        id: boardOccId, userId, gridId, moduleId: modId, targetId: modId, targetType: "module",
        parentId: dayFolder?.id ?? null, sortOrder: 0, occurrences: [],
        iteration: { mode: "persistent" }, fields: {},
        // The date filter is what makes the page answer navigation the way the
        // Schedule does.
        filters: [{
          id: uid(), fieldId: dateFieldId, active: true, showNav: true, isNav: true,
          condition: { operator: "OR", rules: [
            { id: uid(), left: `fields.${dateFieldId}.value`, comparator: "SAME_DAY",  right: null },
            { id: uid(), left: `fields.${dateFieldId}.value`, comparator: "IS_EMPTY", right: "" },
          ]},
        }],
      }).save();
    }
  } else log(`board page already exists (${boardOccId})`);

  // ── 2. the template takes the column shape ────────────────────────────────
  const tplOcc = await Occurrence.findOne({ gridId, "meta.templateName": "Day Page", parentId: { $ne: null } })
    .select({ id: 1, moduleId: 1, occurrences: 1, parentId: 1 }).lean();
  // The real template is the one parented to the TEMPLATES manifest root; the
  // day pages are clones that inherited meta.templateName (APPLY_TEMPLATE copies
  // meta — the same trap that once jammed the build op).
  const tplCandidates = await Occurrence.find({ gridId, "meta.templateName": "Day Page" })
    .select({ id: 1, moduleId: 1, occurrences: 1, parentId: 1 }).lean();
  const tplMods = await Module.find({ gridId, id: { $in: tplCandidates.map(t => t.moduleId) } })
    .select({ id: 1, role: 1, meta: 1 }).lean();
  const tplModById = new Map(tplMods.map(m => [m.id, m]));
  const template = tplCandidates.find(t => tplModById.get(t.moduleId)?.meta?.templateModule === true);
  if (!template) throw new Error("no Day Page TEMPLATE found (an occurrence whose module carries meta.templateModule)");
  log(`template: ${template.id}`);

  const tplMod = tplModById.get(template.moduleId);
  if (tplMod.role !== "container") {
    log("  template root: page → container, binding Date");
    if (!dryRun) {
      await Module.updateOne({ gridId, id: tplMod.id }, {
        $set: {
          role: "container", kind: "doc",
          fieldBindings: [{ fieldId: dateFieldId, role: "input", hidden: true, order: 0 }],
        },
      });
    }
  } else log("  template root is already a container");

  // identitySignature per section — what makes merge-mode top-up idempotent.
  const tplKids = await Occurrence.find({ gridId, id: { $in: template.occurrences || [] } })
    .select({ id: 1, moduleId: 1, identitySignature: 1 }).lean();
  const kidMods = await Module.find({ gridId, id: { $in: tplKids.map(k => k.moduleId) } })
    .select({ id: 1, label: 1, role: 1 }).lean();
  const kidModById = new Map(kidMods.map(m => [m.id, m]));
  for (const k of tplKids) {
    if (k.identitySignature) continue;
    const m = kidModById.get(k.moduleId);
    const sig = m?.role === "textblock" ? "daypage:heading" : `daypage:${m?.label || k.id}`;
    log(`  template section "${m?.label || m?.role}" → identitySignature ${sig}`);
    if (!dryRun) await Occurrence.updateOne({ gridId, id: k.id }, { $set: { identitySignature: sig } });
  }

  // ── 3. existing day pages become columns ──────────────────────────────────
  const dayMods = await Module.find({ gridId, role: "page", label: /^Day Page - / }).select({ id: 1, label: 1 }).lean();
  const dayOccs = await Occurrence.find({ gridId, moduleId: { $in: dayMods.map(m => m.id) } })
    .select({ id: 1, moduleId: 1, fields: 1, meta: 1 }).lean();
  const boardKids = [...(boardOcc?.occurrences || [])];

  for (const occ of dayOccs) {
    const mod = dayMods.find(m => m.id === occ.moduleId);
    const date = (mod?.label.match(DATE_IN_LABEL) || [])[1]
      ?? occ.fields?.[dateFieldId]?.value ?? null;
    if (!date) { log(`  ${mod?.label}: no date could be resolved — leaving it alone`); continue; }
    log(`  ${mod?.label} → column under the board (date ${date})`);
    if (!boardKids.includes(occ.id)) boardKids.push(occ.id);
    if (dryRun) continue;
    await Module.updateOne({ gridId, id: mod.id }, {
      $set: {
        role: "container", kind: "doc",
        fieldBindings: [{ fieldId: dateFieldId, role: "input", hidden: true, order: 0 }],
      },
    });
    await Occurrence.updateOne({ gridId, id: occ.id }, {
      $set: {
        parentId: boardOccId,
        [`fields.${dateFieldId}`]: { value: date, flow: "in" },
        "meta.appliedFromTemplateId": template.id,
      },
    });
  }
  if (!dryRun && boardKids.length) {
    await Occurrence.updateOne({ gridId, id: boardOccId }, { $set: { occurrences: boardKids } });
  }

  // ── 4. the hub keeps ONE tab ──────────────────────────────────────────────
  const dayOccIds = new Set(dayOccs.map(o => o.id));
  const hubs = await Occurrence.find({ gridId, occurrences: { $in: [...dayOccIds] } })
    .select({ id: 1, occurrences: 1, viewId: 1 }).lean();
  for (const hub of hubs) {
    const kept = (hub.occurrences || []).filter(k => !dayOccIds.has(k));
    if (!kept.includes(boardOccId)) kept.push(boardOccId);
    log(`  panel ${hub.id}: ${(hub.occurrences || []).length} tab(s) → ${kept.length} (per-day tabs out, board in)`);
    if (dryRun) continue;
    await Occurrence.updateOne({ gridId, id: hub.id }, { $set: { occurrences: kept } });
    if (hub.viewId) {
      const view = await View.findOne({ id: hub.viewId }).select({ id: 1, activeOccurrenceId: 1 }).lean();
      if (view && dayOccIds.has(view.activeOccurrenceId)) {
        log(`    its open tab was a day page — pointing it at the board`);
        await View.updateOne({ id: view.id }, { $set: { activeOccurrenceId: boardOccId } });
      }
    }
  }

  // ── 5. the junk module from the old naming bug ────────────────────────────
  const junk = await Module.find({ gridId, label: /\[object Object\]/ }).select({ id: 1, label: 1 }).lean();
  for (const j of junk) {
    const uses = await Occurrence.countDocuments({ gridId, moduleId: j.id });
    if (uses) { log(`  "${j.label}" has ${uses} occurrence(s) — NOT deleting`); continue; }
    log(`  deleting the unused module "${j.label}"`);
    if (!dryRun) await Module.deleteOne({ gridId, id: j.id });
  }

  // ── 6. both pipelines ─────────────────────────────────────────────────────
  const completed = await Field.findOne({ gridId, name: "Completed" }).select({ id: 1 }).lean();
  const habit = await Field.findOne({ gridId, name: "Habit" }).select({ id: 1 }).lean();
  const goalsPage = await Occurrence.findOne({ gridId, id: grid?.meta?.goalsPageOccId || "" }).select({ id: 1 }).lean();
  const goalsPageOccId = goalsPage?.id
    || (await Occurrence.findOne({ gridId, moduleId: (await Module.findOne({ gridId, role: "page", label: "Trackers" }).select({ id: 1 }).lean())?.id })
        .select({ id: 1 }).lean())?.id;
  if (!goalsPageOccId) throw new Error("could not resolve the trackers/goals page occurrence for the rebuilt op");

  const build = await Operation.findOne({ gridId, name: "Day Page: Build" }).lean();
  if (build) {
    log("rebuilding 'Day Page: Build' for columns");
    if (!dryRun) {
      const next = makeDayPageBuildOp({
        userId, gridId, dateFieldId,
        dayPageBoardOccId: boardOccId,
        goalsPageOccId, schedulePageOccId,
        dayPageTemplateOccId: template.id,
        timeslotFieldId, scheduleFormatFieldId,
      });
      await Operation.updateOne({ gridId, id: build.id }, {
        $set: { pipeline: next.pipeline, targetOccurrenceId: next.targetOccurrenceId, description: next.description },
      });
    }
  } else log("no 'Day Page: Build' op on this grid");

  const tc = await Operation.findOne({ gridId, name: "Day Page: Build Tasks Completed" }).lean();
  if (tc && completed) {
    log("rebuilding 'Day Page: Build Tasks Completed' to find the column by date");
    if (!dryRun) {
      const next = makeDayPageBuildTasksCompletedOp({
        userId, gridId, dateFieldId,
        completedFieldId: completed.id,
        schedulePageOccId,
        habitFieldId: habit?.id ?? null,
        dayPageBoardOccId: boardOccId,
      });
      await Operation.updateOne({ gridId, id: tc.id }, { $set: { pipeline: next.pipeline } });
    }
  }
}
