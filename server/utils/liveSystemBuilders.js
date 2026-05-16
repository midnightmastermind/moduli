// server/utils/liveSystemBuilders.js
// New-system seed builders shared by createTestGrid.js + createLiveData.js.
// buildGridDoc + buildScheduleFilters are pure (return plain objects, no DB writes).
// buildTemplatesManifest / buildDailyRoutineTemplate / buildDayPageTemplate accept
// injected Mongoose constructors + mkOcc and perform DB writes via those injections.

import { uid } from "./operationBuilders.js";

// Mirrors createTestGrid STEP 1. Returns a plain object the caller passes to `new Grid(obj)`.
export function buildGridDoc({ userId, gridName, manifestId, dateFieldId }) {
  return {
    userId, name: gridName, rows: 2, cols: 3,
    templates: [], occurrences: [],
    manifestId,
    namedFilters: [{
      id: "filter_daily",
      name: "Daily",
      conditions: [{ fieldId: dateFieldId, comparator: "SAME_DAY", isNav: true }],
      timeUnit: "day",
    }],
    activeFilterId: "filter_daily",
    activeFilterValues: {},
  };
}

// Mirrors the schedule-page `filters` array in createTestGrid STEP 8.
export function buildScheduleFilters({ schedFilterId, timeslotFilterId, dateFieldId, timeslotFieldId, timeslotLabels }) {
  return [
    {
      id: schedFilterId, fieldId: dateFieldId, active: true, showNav: true,
      timeUnit: "day", defaultNavValue: "today",
      condition: { operator: "OR", rules: [
        { left: "$field.value", comparator: "DATE_EQUALS", right: "$nav" },
        { left: "$field.value", comparator: "IS_EMPTY" },
      ]},
    },
    {
      id: timeslotFilterId, fieldId: timeslotFieldId, active: true, showNav: true,
      style: "select", options: timeslotLabels, condition: null,
    },
  ];
}

// ── STEP 7b: Templates manifest ─────────────────────────────────────────────
// The templates manifest holds the "Daily Routine" template subtree. The
// APPLY_TEMPLATE action looks up the template occurrence by id from occurrencesById,
// so we just need the occurrence to exist in the DB with meta.templateName set.
//
// Injected params: Folder, Manifest — caller-supplied Mongoose model constructors
// so this builder stays unit-testable with stubs.
export async function buildTemplatesManifest({ userId, gridId, Folder, Manifest }) {
  const tplManifestRootFolderId = uid();
  const tplManifestId = uid();
  await new Folder({
    id: tplManifestRootFolderId,
    userId, gridId,
    name: "Templates",
    parentId: null,
    folderType: "templates",
    sortOrder: 0,
    isExpanded: true,
  }).save();
  await new Manifest({
    id: tplManifestId,
    userId, gridId,
    name: "Templates",
    manifestType: "templates",
    rootFolderId: tplManifestRootFolderId,
  }).save();
  return { tplManifestId, tplManifestRootFolderId };
}

// ── "Daily Routine" template — the FULL schedule subtree ─────────────────
// Root: container "Daily Routine" (page-kind so it visually mirrors the
//   schedule page when previewed)
// Children: one slot container per entry in timeSlots (same shape as live slot containers).
// Within each slot: any routine instances from routineBySlot[slot.label].
// Build Day applies this via APPLY_TEMPLATE with unwrapRoot:true so the
// 48 slot containers land directly under the schedule page (no wrapper).
//
// Injected params:
//   - mkOcc(data) — caller-owned occurrence-persisting helper; returns id
//   - Module      — caller-supplied Mongoose model constructor (new Module({...}).save())
//   - findModule  — async ({ id, gridId }) → module plain object (mirrors Module.findOne(...).lean())
//   - routineBySlot — { [slotLabel]: [{ sourceModId, label, completed?, water? }] }
//   - completedFieldId, waterFieldId — optional; used if routineBySlot entries carry
//     completed/water values (test-grid-specific; omit when seeding a grid without those fields)
//
// Returns tplRoutineRootOccId.
export async function buildDailyRoutineTemplate({
  userId, gridId, timeSlots, timeslotFieldId, routineBySlot,
  tplManifestRootFolderId, mkOcc, Module, findModule,
  completedFieldId, waterFieldId,
}) {
  const tplRoutineRootModId = uid();
  await new Module({
    id: tplRoutineRootModId, userId, gridId,
    role: "page", kind: "board", label: "Daily Routine",
    meta: { templateModule: true },
  }).save();

  const tplRoutineRootOccId = uid();

  // Build one slot container per timeslot, with nested routine instances
  const tplSlotOccIds = [];
  for (const slot of timeSlots) {
    const tplSlotModId = uid();
    const tplSlotOccId = uid();
    await new Module({
      id: tplSlotModId, userId, gridId,
      role: "container", kind: "list",
      label: slot.label,
      meta: {
        templateModule: true,
        scheduleSlot: true,
        slotHour: slot.hour,
        slotMinute: slot.minute,
        slotLabel: slot.label,
      },
    }).save();

    // Mint routine instances for this slot (if any)
    const routineInsts = routineBySlot[slot.label] || [];
    const slotChildOccIds = [];
    for (const r of routineInsts) {
      const tplInstModId = uid();
      const tplInstOccId = uid();
      const srcMod = await findModule({ id: r.sourceModId, gridId });
      await new Module({
        id: tplInstModId, userId, gridId,
        role: "instance", kind: "list", label: r.label,
        defaultDragMode: "copy",
        fieldBindings: srcMod?.fieldBindings || [],
        meta: { templateModule: true },
      }).save();
      const initialFields = {
        [timeslotFieldId]: { value: slot.label, flow: "in" },
      };
      if (r.completed && completedFieldId) initialFields[completedFieldId] = { value: true, flow: "in" };
      if (r.water != null && waterFieldId) initialFields[waterFieldId] = { value: r.water, flow: "in" };
      await mkOcc({
        id: tplInstOccId,
        moduleId: tplInstModId,
        targetId: tplInstModId, targetType: "module",
        parentId: tplSlotOccId,
        fields: initialFields,
        occurrences: [],
      });
      slotChildOccIds.push(tplInstOccId);
    }

    await mkOcc({
      id: tplSlotOccId,
      moduleId: tplSlotModId,
      targetId: tplSlotModId, targetType: "module",
      parentId: tplRoutineRootOccId,
      fields: { [timeslotFieldId]: { value: slot.label, flow: "in" } },
      occurrences: slotChildOccIds,
      meta: { scheduleSlot: true, slotLabel: slot.label },
      identitySignature: `slot:${slot.label}`,
    });
    tplSlotOccIds.push(tplSlotOccId);
  }

  // Template root occurrence — parented to templates manifest root folder
  await mkOcc({
    id: tplRoutineRootOccId,
    moduleId: tplRoutineRootModId,
    targetId: tplRoutineRootModId, targetType: "module",
    parentId: tplManifestRootFolderId,
    occurrences: tplSlotOccIds,
    meta: { templateName: "Daily Routine", templateModule: true },
  });

  return tplRoutineRootOccId;
}

// ── "Day Page" template — a doc page with one textblock child ────────────
// Root: doc page "Day Page". Its OWN textmap is a single `instanceTextblock`
// node pointing at the child textblock (this is exactly how a doc page hosts
// a textblock — same shape DocContent.handleAutoCreateTextblock produces when
// you type into a doc). Child: a role:"textblock" occurrence whose textmap is
// the H1 carrying the literal token "{Date}".
//
// "Day Page: Build" APPLY_TEMPLATE's this with rootParent = Day Pages folder
// (mints a fresh standalone page per date), rootLabel = "Day Page - <date>",
// and replacements { "{Date}": "$dayDate" }. APPLY_TEMPLATE deep-clones the
// subtree, runs the find-and-replace on the cloned textblock's textmap, and
// remaps the root page's instanceTextblock occurrenceId/instanceId to the
// cloned child — so the new doc page renders its own dated textblock.
//
// Injected params:
//   - mkOcc(data) — caller-owned occurrence-persisting helper; returns id
//   - Module      — caller-supplied Mongoose model constructor
//
// Returns tplDayPageRootOccId.
export async function buildDayPageTemplate({ userId, gridId, tplManifestRootFolderId, mkOcc, Module }) {
  const tplDayPageRootModId = uid();
  await new Module({
    id: tplDayPageRootModId, userId, gridId,
    role: "page", kind: "doc", label: "Day Page",
    meta: { templateModule: true },
  }).save();

  const tplDayPageTextblockModId = uid();
  await new Module({
    id: tplDayPageTextblockModId, userId, gridId,
    role: "textblock", kind: "doc", label: "Day Page heading",
    meta: { templateModule: true },
  }).save();

  const tplDayPageRootOccId = uid();
  const tplDayPageTextblockOccId = uid();
  await mkOcc({
    id: tplDayPageTextblockOccId,
    moduleId: tplDayPageTextblockModId,
    targetId: tplDayPageTextblockModId, targetType: "module",
    parentId: tplDayPageRootOccId,
    textmap: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Day Page - {Date}" }] },
      ],
    },
    occurrences: [],
  });
  await mkOcc({
    id: tplDayPageRootOccId,
    moduleId: tplDayPageRootModId,
    targetId: tplDayPageRootModId, targetType: "module",
    parentId: tplManifestRootFolderId,
    occurrences: [tplDayPageTextblockOccId],
    // The doc page's OWN content: an instanceTextblock node hosting the child.
    textmap: {
      type: "doc",
      content: [
        { type: "instanceTextblock", attrs: { instanceId: tplDayPageTextblockModId, occurrenceId: tplDayPageTextblockOccId } },
      ],
    },
    meta: { templateName: "Day Page", templateModule: true },
  });

  return tplDayPageRootOccId;
}
