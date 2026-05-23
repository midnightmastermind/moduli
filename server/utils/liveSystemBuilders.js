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
      // D/W/M/Y units exposed on the toolbar FilterNav. The comparator above is
      // SAME_DAY but `isOccurrenceVisible` routes through DATE_IN_PERIOD when
      // the active value carries a unit other than "day".
      units: ["day", "week", "month", "year"],
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
  completedFieldId, waterFieldId, isTaskFieldId,
  // When set, every slot container is stamped scheduleFormat="slot" via the
  // module's fieldBindings + the occurrence's fields. Live data passes this;
  // test grid leaves it null and relies on the legacy meta.scheduleSlot
  // marker. Same dual-mode pattern as makeScheduleBuildScheduleOp.
  scheduleFormatFieldId = null,
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
        // Legacy meta marker — kept only when scheduleFormatFieldId isn't
        // passed (test grid path). Live data uses the field-based identity.
        ...(scheduleFormatFieldId ? {} : { scheduleSlot: true }),
        slotHour: slot.hour,
        slotMinute: slot.minute,
        slotLabel: slot.label,
      },
      fieldBindings: scheduleFormatFieldId
        ? [{ fieldId: scheduleFormatFieldId, role: "input", hidden: true, order: 0 }]
        : [],
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
      // Mark every daily-routine instance as a task so the cloned occurrences
      // (per-day copies minted by APPLY_TEMPLATE) inherit isTask=true.
      if (isTaskFieldId) initialFields[isTaskFieldId] = { value: true, flow: "in" };
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
      fields: {
        [timeslotFieldId]: { value: slot.label, flow: "in" },
        ...(scheduleFormatFieldId ? { [scheduleFormatFieldId]: { value: "slot", flow: "in" } } : {}),
      },
      occurrences: slotChildOccIds,
      meta: {
        ...(scheduleFormatFieldId ? {} : { scheduleSlot: true }),
        slotLabel: slot.label,
      },
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
export async function buildDayPageTemplate({
  userId,
  gridId,
  tplManifestRootFolderId,
  mkOcc,
  Module,
  // Editor↔field binding context (optional — when present, the template
  // wires a Daily Question container with header/body bindings).
  dateFieldId = null,
  journalQuestionFieldId = null,
  journalAnswerFieldId = null,
}) {
  const tplDayPageRootModId = uid();
  await new Module({
    id: tplDayPageRootModId, userId, gridId,
    role: "page", kind: "doc", label: "Day Page",
    meta: { templateModule: true },
  }).save();

  // Day page heading (textblock) — H1 "Day Page - {Date}". APPLY_TEMPLATE
  // replaces {Date} via cfg.replacements when Day Page: Build clones the
  // template into a fresh occurrence.
  const tplDayPageTextblockModId = uid();
  await new Module({
    id: tplDayPageTextblockModId, userId, gridId,
    role: "textblock", kind: "doc", label: "Day Page heading",
    meta: { templateModule: true },
  }).save();

  // Tasks Completed container — kind:doc so its body is a TipTap editor that
  // "Day Page: Build Tasks Completed" (separate op, pending) can write a
  // sorted-by-timeslot list into. Label "Tasks Completed" renders as the
  // embedded-container H2-ish header (Container.jsx embedded mode already
  // styles the label as a 20px/700 mono heading, matching `##`).
  const tplTasksCompletedContModId = uid();
  await new Module({
    id: tplTasksCompletedContModId, userId, gridId,
    role: "container", kind: "doc", label: "Tasks Completed",
    meta: { templateModule: true },
  }).save();

  // Daily Question container — only mounted when binding context is supplied.
  // Header binding: container.fields[journalQuestion] drives the header
  // dropdown (options come from journalQuestion's find-mode pool).
  // Body binding (on inner textblock): textblock.fields[journalAnswer] is
  // edited via TipTap; both are stamped with date so propagateBoundFieldWrite
  // syncs them with any other occurrence (e.g. journaling instance) sharing
  // the same date.
  const wantsDailyQuestion = !!(dateFieldId && journalQuestionFieldId && journalAnswerFieldId);
  let tplDailyQContModId = null;
  let tplDailyQContOccId = null;
  let tplDailyQTextblockModId = null;
  let tplDailyQTextblockOccId = null;

  if (wantsDailyQuestion) {
    tplDailyQContModId = uid();
    tplDailyQContOccId = uid();
    tplDailyQTextblockModId = uid();
    tplDailyQTextblockOccId = uid();

    await new Module({
      id: tplDailyQContModId, userId, gridId,
      role: "container", kind: "doc", label: "Daily Question",
      fieldBindings: [
        { fieldId: dateFieldId, role: "input", hidden: true, order: 0 },
        { fieldId: journalQuestionFieldId, role: "input", hidden: true, order: 1 },
      ],
      meta: {
        templateModule: true,
        headerLink: { selfField: journalQuestionFieldId, link: dateFieldId },
      },
    }).save();

    await new Module({
      id: tplDailyQTextblockModId, userId, gridId,
      role: "textblock", kind: "doc", label: "Daily Answer",
      fieldBindings: [
        { fieldId: dateFieldId, role: "input", hidden: true, order: 0 },
        { fieldId: journalAnswerFieldId, role: "input", hidden: true, order: 1 },
      ],
      meta: {
        templateModule: true,
        bodyLink: { selfField: journalAnswerFieldId, link: dateFieldId },
      },
    }).save();
  }

  const tplDayPageRootOccId = uid();
  const tplDayPageTextblockOccId = uid();
  const tplTasksCompletedContOccId = uid();

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
    id: tplTasksCompletedContOccId,
    moduleId: tplTasksCompletedContModId,
    targetId: tplTasksCompletedContModId, targetType: "module",
    parentId: tplDayPageRootOccId,
    // Empty placeholder paragraph — the seeding op rewrites this on each
    // Day Page: Build run with the schedule tasks for that day.
    textmap: { type: "doc", content: [{ type: "paragraph" }] },
    occurrences: [],
  });

  if (wantsDailyQuestion) {
    // Daily Question container occurrence — fields[dateFieldId] is stamped at
    // APPLY_TEMPLATE time by Day Page: Build (replacements + defaultFields).
    // The header binding reads fields[journalQuestion]; the textblock body
    // reads fields[journalAnswer]. Both fields are blank on the template;
    // ops + user edits populate them on the cloned occurrence.
    await mkOcc({
      id: tplDailyQTextblockOccId,
      moduleId: tplDailyQTextblockModId,
      targetId: tplDailyQTextblockModId, targetType: "module",
      parentId: tplDailyQContOccId,
      // Blank doc — the bound body editor will populate from
      // fields[journalAnswer] via BoundBody at render time.
      textmap: { type: "doc", content: [{ type: "paragraph" }] },
      occurrences: [],
    });

    await mkOcc({
      id: tplDailyQContOccId,
      moduleId: tplDailyQContModId,
      targetId: tplDailyQContModId, targetType: "module",
      parentId: tplDayPageRootOccId,
      // Container body embeds the textblock (which is what the user types into
      // for the answer).
      textmap: {
        type: "doc",
        content: [
          { type: "instanceTextblock", attrs: { instanceId: tplDailyQTextblockModId, occurrenceId: tplDailyQTextblockOccId } },
        ],
      },
      occurrences: [tplDailyQTextblockOccId],
    });
  }

  const dayPageOccurrencesList = wantsDailyQuestion
    ? [tplDayPageTextblockOccId, tplDailyQContOccId, tplTasksCompletedContOccId]
    : [tplDayPageTextblockOccId, tplTasksCompletedContOccId];

  const dayPageTextmapContent = wantsDailyQuestion
    ? [
        { type: "instanceTextblock", attrs: { instanceId: tplDayPageTextblockModId, occurrenceId: tplDayPageTextblockOccId } },
        { type: "moduleEmbed",       attrs: { occurrenceId: tplDailyQContOccId } },
        { type: "moduleEmbed",       attrs: { occurrenceId: tplTasksCompletedContOccId } },
      ]
    : [
        { type: "instanceTextblock", attrs: { instanceId: tplDayPageTextblockModId, occurrenceId: tplDayPageTextblockOccId } },
        { type: "moduleEmbed",       attrs: { occurrenceId: tplTasksCompletedContOccId } },
      ];

  await mkOcc({
    id: tplDayPageRootOccId,
    moduleId: tplDayPageRootModId,
    targetId: tplDayPageRootModId, targetType: "module",
    parentId: tplManifestRootFolderId,
    occurrences: dayPageOccurrencesList,
    textmap: { type: "doc", content: dayPageTextmapContent },
    meta: { templateName: "Day Page", templateModule: true },
  });

  return tplDayPageRootOccId;
}

// ── Project template ─────────────────────────────────────────────────────────
// User-defined template subtree for kanban-style project pages. The
// shape mirrors the Day Page template: real modules + occurrences in
// the Templates manifest carrying placeholder tokens
// (`{ProjectName}`, `{ProjectScope}`) that APPLY_TEMPLATE replaces when
// the user instantiates a new project. The user can edit the template
// itself (add fields, reorder columns, change the scope skeleton) and
// every future Project: Create from it picks up the edits.
//
// Layout:
//   Project: {ProjectName}     (role:page, kind:doc)
//     ├─ Kanban                (role:container, kind:board)
//     │   ├─ Backburner / Docket / Working On / In Review / Test / Complete
//     │   │   (role:container, kind:list — each carries identitySignature
//     │   │    so APPLY_TEMPLATE merge mode doesn't dupe columns on re-apply)
//     └─ Project Scope         (role:textblock, kind:doc)
//        textmap: H1 + intro paragraph using {ProjectScope} token
//
// Returns the root template occurrence id so callers can reference it
// in operation cfg.templateId.
export async function buildProjectTemplate({
  userId,
  gridId,
  tplManifestRootFolderId,
  mkOcc,
  Module,
  statusFieldId = null,
  projectFieldId = null,
}) {
  // ── Root page module ──────────────────────────────────────────────────────
  const tplProjectPageModId = uid();
  await new Module({
    id: tplProjectPageModId, userId, gridId,
    role: "page", kind: "doc",
    label: "Project: {ProjectName}",
    meta: { templateModule: true },
  }).save();

  // ── Kanban board container module ─────────────────────────────────────────
  const tplProjectKanbanModId = uid();
  await new Module({
    id: tplProjectKanbanModId, userId, gridId,
    role: "container", kind: "board", label: "Kanban",
    meta: { templateModule: true },
  }).save();

  // ── 6 kanban column container modules ─────────────────────────────────────
  // Order + labels are spec'd. Distinct background tints follow the
  // agile heat gradient (cool → warm as work moves toward done).
  // identitySignature on each column keeps APPLY_TEMPLATE merge mode
  // from duplicating columns on re-apply.
  const PROJECT_KANBAN_COLS = [
    { key: "backburner", label: "Backburner", bg: "#3b4252" },
    { key: "docket",     label: "Docket",     bg: "#4c566a" },
    { key: "workingOn",  label: "Working On", bg: "#5e6b88" },
    { key: "inReview",   label: "In Review",  bg: "#7c6f8f" },
    { key: "test",       label: "Test",       bg: "#a88a72" },
    { key: "complete",   label: "Complete",   bg: "#5d8a6b" },
  ];
  const tplKanbanColModIds = {};
  const tplKanbanColOccIds = {};
  for (const col of PROJECT_KANBAN_COLS) {
    const modId = uid();
    tplKanbanColModIds[col.key] = modId;
    tplKanbanColOccIds[col.key] = uid();
    await new Module({
      id: modId, userId, gridId,
      role: "container", kind: "list", label: col.label,
      styleMode: "own", ownStyle: { bg: col.bg },
      meta: {
        templateModule: true,
        identitySignature: `kanbanCol:${col.key}`,
      },
    }).save();
  }

  // ── Project scope textblock module ────────────────────────────────────────
  const tplProjectScopeModId = uid();
  await new Module({
    id: tplProjectScopeModId, userId, gridId,
    role: "textblock", kind: "doc", label: "Project Scope",
    meta: { templateModule: true },
  }).save();

  // ── Occurrences ───────────────────────────────────────────────────────────
  // Top-down: root → kanban → columns (empty), then scope textblock.
  const tplProjectPageOccId   = uid();
  const tplProjectKanbanOccId = uid();
  const tplProjectScopeOccId  = uid();

  // Kanban columns — empty occurrences (no seeded tasks). The user
  // creates tasks inside columns after instantiation, OR a future
  // op can seed example tasks.
  for (const col of PROJECT_KANBAN_COLS) {
    await mkOcc({
      id: tplKanbanColOccIds[col.key],
      moduleId: tplKanbanColModIds[col.key],
      targetId: tplKanbanColModIds[col.key], targetType: "module",
      parentId: tplProjectKanbanOccId,
      iteration: { mode: "persistent" }, fields: {},
      occurrences: [],
    });
  }

  // Kanban board occurrence — lists the 6 columns in left-to-right order.
  await mkOcc({
    id: tplProjectKanbanOccId,
    moduleId: tplProjectKanbanModId,
    targetId: tplProjectKanbanModId, targetType: "module",
    parentId: tplProjectPageOccId,
    iteration: { mode: "persistent" }, fields: {},
    occurrences: PROJECT_KANBAN_COLS.map(c => tplKanbanColOccIds[c.key]),
  });

  // Project scope textblock — H1 + skeleton sections + {ProjectScope}
  // placeholder. APPLY_TEMPLATE's `replacements` cfg swaps tokens at
  // instantiation; everything else (the section headings + structure)
  // is preserved so every new project page lands with a scope skeleton
  // ready to fill in.
  await mkOcc({
    id: tplProjectScopeOccId,
    moduleId: tplProjectScopeModId,
    targetId: tplProjectScopeModId, targetType: "module",
    parentId: tplProjectPageOccId,
    iteration: { mode: "persistent" }, fields: {},
    textmap: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Project Scope — {ProjectName}" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Overview" }] },
        { type: "paragraph", content: [{ type: "text", text: "{ProjectScope}" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Goals" }] },
        { type: "bulletList", content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Goal 1" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Goal 2" }] }] },
        ]},
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Milestones" }] },
        { type: "bulletList", content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "M1" }] }] },
        ]},
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Risks" }] },
        { type: "paragraph", content: [{ type: "text", text: "—" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Success Criteria" }] },
        { type: "paragraph", content: [{ type: "text", text: "—" }] },
      ],
    },
    occurrences: [],
  });

  // Root project page occurrence — its `occurrences[]` lists kanban
  // first, then the scope textblock. textmap embeds them in the same
  // order so the rendered doc body reads kanban → scope.
  await mkOcc({
    id: tplProjectPageOccId,
    moduleId: tplProjectPageModId,
    targetId: tplProjectPageModId, targetType: "module",
    parentId: tplManifestRootFolderId,
    occurrences: [tplProjectKanbanOccId, tplProjectScopeOccId],
    textmap: {
      type: "doc",
      content: [
        { type: "moduleEmbed", attrs: { occurrenceId: tplProjectKanbanOccId } },
        { type: "moduleEmbed", attrs: { occurrenceId: tplProjectScopeOccId } },
      ],
    },
    meta: { templateName: "Project Page", templateModule: true },
  });

  return tplProjectPageOccId;
}

// ── Schedule / Day-Page operation factories ──────────────────────────────────
// Each factory returns the plain object literal passed to `new Operation(obj)`.
// The caller is responsible for `.save()`. All uid() calls are inline so every
// pipeline step gets a fresh stable id on each factory invocation.
//
// Factory params:
//   makeScheduleBuildDayOp    — { userId, gridId, dateFieldId, dueFieldId, timeslotFieldId }
//   makeDayPageBuildOp        — { userId, gridId, dateFieldId, dayPagesFolderId, hubPanelOccIdVar }
//   makeStampDateTimeSlotOp   — { userId, gridId, timeslotFieldId, hubPanelModuleId }
//   makeClearDateOnMoveOutOp  — { userId, gridId, dateFieldId, timeslotFieldId }

// ── Operation: Schedule Build Day (priority 1) — ORIGINAL, used by createTestGrid ──
// Two responsibilities:
//   1. Ensure the schedule shell exists (Due + 48 timeslot containers, created ONCE).
//   2. Seed the Daily Routine instances for the active date via APPLY_TEMPLATE
//      (idempotent: skips if routine instances for that date already exist).
// Also sweeps todos whose dueDate matches the active date into Due.
// Kept intact for the test grid (single-day Schedule). See
// `makeScheduleBuildScheduleOp` below for the multi-day day-column version
// used by createLiveData.
export function makeScheduleBuildDayOp({ userId, gridId, dateFieldId, dueFieldId, timeslotFieldId, completedTrackerName = "Tracker: Tasks Completed" }) {
  return {
    id: uid(), userId, gridId, name: "Schedule: Build Day",
    description: "Ensure Due + 48 timeslot containers exist, seed Daily Routine via APPLY_TEMPLATE, and sweep matching todos into Due.",
    triggerTypes: ["onLoad", "onFilterChange"],
    triggerObjects: [
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 1 },
      { eventType: "onFilterChange", subjectType: "grid",      targetId: "", priority: 1 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Schedule",    priority: 1 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Daily Goals", priority: 1 },
    ],
    enabled: true,
    pipeline: {
      steps: [
        { id: uid(), type: "action", config: {
            type: "FIND",
            over: "$allPages",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "label", comparator: "IS", right: "Schedule" },
            ]},
            itemIdVar: "$schedPageId",
            itemVar: "$schedPage",
        }},
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: "$trigger.date" } },
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$schedDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: `$schedPage._effectiveFilter.${dateFieldId}` } }],
          else: [],
        },
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$schedDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: "$today" } }],
          else: [],
        },
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$schedPageId", comparator: "IS_NOT_EMPTY", right: "" }] },
          then: [
            { id: uid(), type: "action", config: {
                type: "FIND",
                over: "$allContainers",
                predicate: { operator: "AND", rules: [
                  { id: uid(), left: "label", comparator: "IS", right: "Due" },
                ]},
                itemIdVar: "$dueId",
            }},
            {
              id: uid(), type: "if",
              condition: { operator: "AND", rules: [{ id: uid(), left: "$dueId", comparator: "IS_EMPTY", right: "" }] },
              then: [
                { id: uid(), type: "action", config: {
                    type: "CREATE",
                    name: "Due",
                    role: "container",
                    kind: "list",
                    meta: { scheduleDueContainer: true },
                    parent: "$schedPageId",
                    fields: { [timeslotFieldId]: "literal:Due" },
                    fieldHidden: { [timeslotFieldId]: true },
                    insertAtIndex: 0,
                    itemIdVar: "$dueId",
                }},
              ],
              else: [],
            },
            { id: uid(), type: "action", config: {
                type: "FIND",
                over: "$allOccurrences",
                predicate: { operator: "AND", rules: [
                  { id: uid(), left: "meta.templateName", comparator: "IS", right: "Daily Routine" },
                ]},
                itemIdVar: "$dailyRoutineTplId",
            }},
            { id: uid(), type: "action", config: {
                type: "FIND",
                over: "$allInstances",
                predicate: { operator: "AND", rules: [
                  { id: uid(), left: "_ancestors",                  comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                  { id: uid(), left: `fields.${dateFieldId}.value`, comparator: "SAME_DAY",     right: "$schedDate" },
                ]},
                itemIdVar: "$existingRoutineId",
            }},
            {
              id: uid(), type: "if",
              condition: { operator: "AND", rules: [
                { id: uid(), left: "$dailyRoutineTplId", comparator: "IS_NOT_EMPTY", right: "" },
                { id: uid(), left: "$existingRoutineId", comparator: "IS_EMPTY",     right: "" },
              ]},
              then: [
                { id: uid(), type: "action", config: {
                    type: "APPLY_TEMPLATE",
                    templateRef: "$dailyRoutineTplId",
                    targetOccurrenceVar: "$schedPageId",
                    mode: "merge",
                    unwrapRoot: true,
                    resultVar: "$newScheduleOccs",
                    defaultFields: {
                      [dateFieldId]: "$schedDate",
                      [dueFieldId]:  "$schedDate",
                    },
                }},
              ],
              else: [],
            },
            { id: uid(), type: "action", config: {
                type: "FIND",
                over: "$allContainers",
                predicate: { operator: "AND", rules: [
                  { id: uid(), left: "meta.todoListContainer", comparator: "IS", right: true },
                ]},
                itemIdVar: "$todoContId",
            }},
            {
              id: uid(), type: "if",
              condition: { operator: "AND", rules: [{ id: uid(), left: "$todoContId", comparator: "IS_NOT_EMPTY", right: "" }] },
              then: [{
                id: uid(), type: "loop", overExpr: "$allItems", as: "$item",
                body: [{
                  id: uid(), type: "if",
                  condition: { operator: "AND", rules: [
                    { id: uid(), left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: "$todoContId" },
                    { id: uid(), left: `$item.fields.${dueFieldId}.value`, comparator: "SAME_DAY", right: "$schedDate" },
                  ]},
                  then: [
                    { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$todoTemplateId", expr: "$item.templateId" } },
                    { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$todoLabel",      expr: "$item.label" } },
                    { id: uid(), type: "action", config: {
                        type: "FIND",
                        over: "$allInstances",
                        predicate: { operator: "AND", rules: [
                          { id: uid(), left: "templateId", comparator: "IS",           right: "$todoTemplateId" },
                          { id: uid(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$dueId" },
                          { id: uid(), left: `fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$schedDate" },
                        ]},
                        itemIdVar: "$existingCopyId",
                    }},
                    {
                      id: uid(), type: "if",
                      condition: { operator: "AND", rules: [{ id: uid(), left: "$existingCopyId", comparator: "IS_EMPTY", right: "" }] },
                      then: [{
                        id: uid(), type: "action", config: {
                          type: "COPY_LINK",
                          sourceId: "$item.id",
                          parent: "$dueId",
                          fields: {
                            [dateFieldId]: "$schedDate",
                            [dueFieldId]:  "$schedDate",
                          },
                        },
                      }],
                      else: [{
                        id: uid(), type: "action", config: {
                          type: "COPY_LINK",
                          sourceId: "$item.id",
                          targetId: "$existingCopyId",
                        },
                      }],
                    },
                  ],
                  else: [],
                }],
              }],
              else: [],
            },
            { id: uid(), type: "action", config: { type: "RUN_OPERATION", operationName: "Tracker: Water Today" } },
            { id: uid(), type: "action", config: { type: "RUN_OPERATION", operationName: completedTrackerName } },
          ],
          else: [],
        },
      ],
    },
  };
}

// ── Operation: Schedule Build Schedule (priority 1) — NEW, used by createLiveData ──
// HYBRID architecture: shared slots + ephemeral day-col wrappers.
//
//   Schedule page
//     occurrences[] = [day-col-mon, day-col-tue, day-col-wed, ...slot1..slot48, Due]
//                     ↑ wrappers live here (active period only) — slots also remain
//                       in the list (multi-parented) so the cascade still finds them
//                       on direct ancestor walks.
//
//   shared slots + Due  (parentId = Schedule, never deleted)
//     Routine instances accumulate inside the shared slots, one per (date, slot).
//     Visibility cascade filters per render context (day-col's filterOverride).
//
//   day-col-<date>
//     occurrences[] = [Due, slot1, slot2, ..., slot48]   ← multi-parent refs
//     filterOverride.dateField = <date>                  ← scopes cascade for this column
//     meta.dayDate = <date>, meta.scheduleDayColumn = true
//
// Tear-down semantics: day-col wrappers whose meta.dayDate is NOT in the active
// $activePeriodDates list get DELETEd. This is safe — slots have parentId =
// Schedule (still rooted) AND are multi-parented into the surviving day-cols,
// so DELETE on a wrapper does NOT cascade into the shared slot subtree.
// Instances inside slots persist regardless. Zero data loss.
//
// Day-col MODULE is shared: CREATE's find-by-label-and-reuse mints "Day Column"
// once and every day's day-col OCCURRENCE points at that one module.
//
// Idempotency: per-day FIND checks gate creation; APPLY_TEMPLATE's identitySig
// merge skips already-cloned slots; ADD_CHILD's includes-check skips duplicate
// multi-parent refs.
export function makeScheduleBuildScheduleOp({ userId, gridId, dateFieldId, dueFieldId, timeslotFieldId, scheduleFormatFieldId = null, completedTrackerName = "Tracker: Tasks Completed", waterTrackerName = "Tracker: Water Today", goalsPageOccId, schedulePageOccId }) {
  if (!schedulePageOccId) throw new Error("makeScheduleBuildScheduleOp: schedulePageOccId required (picker-direct ancestor + page ref; see CLAUDE_CHAT.md 2026-05-22)");
  if (!goalsPageOccId)    throw new Error("makeScheduleBuildScheduleOp: goalsPageOccId required (picker-direct ancestor; see CLAUDE_CHAT.md 2026-05-22)");
  return {
    id: uid(), userId, gridId, name: "Schedule: Build Schedule",
    description: "Build one day-column per visible day in the active filter period. ≤7 days: full slot structure per day-col. >7 days: flat day-cols. Persistent — day-cols never deleted, visibility cascade hides out-of-period ones.",
    // priority 1 so the shell (slots) + routine seeding finish before goal
    // aggregations (priority 3) read the data.
    //
    // Trigger surface (2026-05-22 refactor — picker-style direct ancestor binding):
    //   - onLoad / onFilterChange + subjectType:grid — toolbar arrows + initial
    //     load. matchSubjectFilter restricts grid-subject triggers to true
    //     global changes (no sourceOccurrenceId, no _ancestorIds), so this no
    //     longer matches local container filter changes.
    //   - onFilterChange + subjectType:filterNav — broad match. The previous
    //     ancestorLabel:"Schedule" / "Daily Goals" entries were brittle to
    //     page renames (live grid renamed "Daily Goals" → "Goals" 2026-05-19;
    //     the labels diverged and trackers silently stopped firing on goals
    //     filter nav). Replaced by a pipeline-internal IF guard that grabs
    //     the goals + schedule page occurrences directly via $allItemsById
    //     and HAS_ANCESTOR-matches them against $trigger._ancestorIds. The
    //     ids come from the seed via params; both grids can pass their own.
    triggerTypes: ["onLoad", "onFilterChange"],
    triggerObjects: [
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 1 },
      { eventType: "onFilterChange", subjectType: "grid",      targetId: "", priority: 1 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", priority: 1 },
    ],
    enabled: true,
    pipeline: {
      steps: [
        // ── Picker-style direct bindings — rename-stable refs to seed-time
        // ancestors. $allItemsById.<id> resolves to the occurrence object via
        // the executor's path resolver. Equivalent to what the value-builder
        // picker emits when an author drills into Occurrences > $allItemsById
        // > <label> — id is in the path string but the source code reads as a
        // reference, not a hardcoded literal on the trigger.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPage",   expr: `$allItemsById.${schedulePageOccId}` }},
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPageId", expr: "$schedPage.id" }},
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalsPage",   expr: `$allItemsById.${goalsPageOccId}` }},

        // ── Ancestor guard. Lets through: (a) grid-subject triggers — no
        // sourceOccurrenceId — toolbar arrows + onLoad. (b) filterNav whose
        // ancestor chain includes Schedule or Goals. Anything else (filter
        // change on an unrelated page like Todo / Daily Toolkit) short-
        // circuits. Replaces the rename-fragile trigger.ancestorLabel approach.
        { id: uid(), type: "if",
          condition: { operator: "OR", rules: [
            { id: uid(), left: "$trigger.sourceOccurrenceId", comparator: "IS_EMPTY",     right: "" },
            { id: uid(), left: "$trigger._ancestorIds",       comparator: "HAS_ANCESTOR", right: "$schedPage.id" },
            { id: uid(), left: "$trigger._ancestorIds",       comparator: "HAS_ANCESTOR", right: "$goalsPage.id" },
          ]},
          then: [
        // ── Top-level lookups (one-time per run) ────────────────────────────
        { id: uid(), type: "action", config: {
            type: "FIND", over: "$allOccurrences",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "meta.templateName", comparator: "IS", right: "Daily Routine" },
            ]},
            itemIdVar: "$dailyRoutineTplId",
        }},
        { id: uid(), type: "action", config: {
            type: "FIND", over: "$allContainers",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "meta.todoListContainer", comparator: "IS", right: true },
            ]},
            itemIdVar: "$todoContId",
        }},

        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$schedPageId", comparator: "IS_NOT_EMPTY", right: "" }] },
          then: [
            // ── PHASE 1: shared Due ─────────────────────────────────────────
            // One Due container per Schedule page. parentId = Schedule;
            // multi-parented into every day-col via ADD_CHILD below.
            // Identity: scheduleFormat="due" field (live data path) or
            // meta.scheduleDueContainer (test grid fallback when the field
            // id wasn't passed).
            { id: uid(), type: "action", config: {
                type: "FIND", over: "$allContainers",
                predicate: { operator: "AND", rules: [
                  { id: uid(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                  scheduleFormatFieldId
                    ? { id: uid(), left: `fields.${scheduleFormatFieldId}.value`, comparator: "IS", right: "due" }
                    : { id: uid(), left: "meta.scheduleDueContainer", comparator: "IS", right: true },
                ]},
                itemIdVar: "$sharedDueId",
            }},
            {
              id: uid(), type: "if",
              condition: { operator: "AND", rules: [{ id: uid(), left: "$sharedDueId", comparator: "IS_EMPTY", right: "" }] },
              then: [{ id: uid(), type: "action", config: {
                  type: "CREATE", name: "Due", role: "container", kind: "list",
                  meta: scheduleFormatFieldId ? {} : { scheduleDueContainer: true },
                  parent: "$schedPageId",
                  fields: {
                    [timeslotFieldId]: "literal:Due",
                    ...(scheduleFormatFieldId ? { [scheduleFormatFieldId]: "literal:due" } : {}),
                  },
                  fieldHidden: {
                    [timeslotFieldId]: true,
                    ...(scheduleFormatFieldId ? { [scheduleFormatFieldId]: true } : {}),
                  },
                  insertAtIndex: 0,
                  itemIdVar: "$sharedDueId",
              }}],
              else: [],
            },

            // ── PHASE 2: shared 48 slots (one-time setup) ───────────────────
            // Check if any slot exists under Schedule. If none, APPLY_TEMPLATE
            // the Daily Routine template; identitySig "slot:<label>" makes
            // re-runs no-ops once slots exist. defaultFields here stamps the
            // first $activePeriodDates day so the first routine instances are
            // dated. Subsequent days top up in PHASE 3.
            { id: uid(), type: "action", config: {
                type: "FIND", over: "$allContainers",
                predicate: { operator: "AND", rules: [
                  { id: uid(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                  scheduleFormatFieldId
                    ? { id: uid(), left: `fields.${scheduleFormatFieldId}.value`, comparator: "IS", right: "slot" }
                    : { id: uid(), left: "meta.scheduleSlot", comparator: "IS", right: true },
                ]},
                itemIdVar: "$anySlotId",
            }},
            { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$firstDay", expr: "$activePeriodDates.0" } },
            {
              id: uid(), type: "if",
              condition: { operator: "AND", rules: [
                { id: uid(), left: "$dailyRoutineTplId", comparator: "IS_NOT_EMPTY", right: "" },
                { id: uid(), left: "$anySlotId",         comparator: "IS_EMPTY",     right: "" },
              ]},
              then: [{ id: uid(), type: "action", config: {
                  type: "APPLY_TEMPLATE",
                  templateRef: "$dailyRoutineTplId",
                  targetOccurrenceVar: "$schedPageId",
                  mode: "merge", unwrapRoot: true,
                  defaultFields: {
                    [dateFieldId]: "$firstDay",
                    [dueFieldId]:  "$firstDay",
                  },
              }}],
              else: [],
            },

            // ── PHASE 3: per-day routine seeding ────────────────────────────
            // For each $day in the active period, ensure routine instances
            // dated to $day exist under the shared slots. APPLY_TEMPLATE in
            // merge mode skips slot containers (identitySig dedup) and only
            // clones the routine instances stamped with $day.
            {
              id: uid(), type: "loop", overExpr: "$activePeriodDates", as: "$day",
              body: [
                { id: uid(), type: "action", config: {
                    type: "FIND", over: "$allInstances",
                    predicate: { operator: "AND", rules: [
                      { id: uid(), left: "_ancestors",                  comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                      { id: uid(), left: `fields.${dateFieldId}.value`, comparator: "SAME_DAY",     right: "$day" },
                    ]},
                    itemIdVar: "$existingRoutineId",
                }},
                {
                  id: uid(), type: "if",
                  condition: { operator: "AND", rules: [
                    { id: uid(), left: "$dailyRoutineTplId", comparator: "IS_NOT_EMPTY", right: "" },
                    { id: uid(), left: "$existingRoutineId", comparator: "IS_EMPTY",     right: "" },
                  ]},
                  then: [{ id: uid(), type: "action", config: {
                      type: "APPLY_TEMPLATE",
                      templateRef: "$dailyRoutineTplId",
                      targetOccurrenceVar: "$schedPageId",
                      mode: "merge", unwrapRoot: true,
                      defaultFields: {
                        [dateFieldId]: "$day",
                        [dueFieldId]:  "$day",
                      },
                  }}],
                  else: [],
                },
              ],
            },

            // ── PHASE 4a: pre-compute slot ID list ──────────────────────────
            // Walk $allContainers ONCE up-front and push every shared-slot id
            // into $slotIds. Phase 4b's per-day loop then iterates $slotIds
            // instead of re-scanning $allContainers per day. Cuts perf from
            // O(days × containers) to O(containers + days × slots).
            { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$slotIds", expr: "json:[]" } },
            {
              id: uid(), type: "loop", overExpr: "$allContainers", as: "$cont",
              body: [{
                id: uid(), type: "if",
                condition: { operator: "AND", rules: [
                  { id: uid(), left: "$cont._ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                  scheduleFormatFieldId
                    ? { id: uid(), left: `$cont.fields.${scheduleFormatFieldId}.value`, comparator: "IS", right: "slot" }
                    : { id: uid(), left: "$cont.meta.scheduleSlot", comparator: "IS", right: true },
                ]},
                then: [{ id: uid(), type: "action", config: { type: "PUSH_TO_VAR", name: "$slotIds", expr: "$cont.id" } }],
                else: [],
              }],
            },

            // ── PHASE 4b: per-day TIMESLOT day-col creation + multi-parent ───
            // Gated on $activePeriodCount ≤ 7. For each $day, ensure a
            // timeslot day-col wrapper exists with all shared slots + Due
            // multi-parented in. ADD_CHILD is idempotent so re-runs are
            // no-ops. Above 7 days, PHASE 4c creates shortened day-cols
            // instead (flat, no slots).
            //
            // Day-col identity is field-based: a container with the
            // scheduleFormat field stamped (any value) is a day-col. Date
            // comes from the dateFieldId stamp. No meta markers.
            {
              id: uid(), type: "if",
              condition: { operator: "AND", rules: [{ id: uid(), left: "$activePeriodCount", comparator: "LESS_OR_EQUAL", right: 7 }] },
              then: [{
                id: uid(), type: "loop", overExpr: "$activePeriodDates", as: "$day",
                body: [
                  { id: uid(), type: "action", config: {
                      type: "FIND", over: "$allContainers",
                      predicate: { operator: "AND", rules: [
                        { id: uid(), left: "_ancestors",                                       comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                        ...(scheduleFormatFieldId ? [{ id: uid(), left: `fields.${scheduleFormatFieldId}.value`, comparator: "IS", right: "timeslot" }] : []),
                        { id: uid(), left: `fields.${dateFieldId}.value`,                      comparator: "SAME_DAY",    right: "$day" },
                      ]},
                      itemIdVar: "$dayColId",
                  }},
                  // Create the day-col only when missing. ADD_CHILD steps
                  // below ALWAYS run because they're idempotent (parent's
                  // occurrences[] gets the child appended only when not
                  // already present) — gating them on IS_EMPTY made a
                  // partially-populated day-col from a prior run stick
                  // empty forever, since subsequent runs found the day-col,
                  // skipped the THEN branch, and never multi-parented the
                  // slots in. Self-healing requires ADD_CHILD outside the gate.
                  {
                    id: uid(), type: "if",
                    condition: { operator: "AND", rules: [{ id: uid(), left: "$dayColId", comparator: "IS_EMPTY", right: "" }] },
                    then: [{ id: uid(), type: "action", config: {
                        type: "CREATE",
                        // Label interpolated with the iteration date — was just
                        // "Day Column" so every column rendered the same header.
                        // resolveExpr template-interpolates ${$day} at create
                        // time (see operationActions.js Mar 22 2026).
                        name: "${$day} Day Column",
                        role: "container", kind: "list",
                        meta: { allowChildContainers: true },
                        parent: "$schedPageId",
                        filterOverride: { [dateFieldId]: "$day" },
                        fields: {
                          [dateFieldId]: "$day",
                          ...(scheduleFormatFieldId ? { [scheduleFormatFieldId]: "literal:timeslot" } : {}),
                        },
                        fieldHidden: {
                          [dateFieldId]: true,
                          ...(scheduleFormatFieldId ? { [scheduleFormatFieldId]: true } : {}),
                        },
                        itemIdVar: "$dayColId",
                    }}],
                    else: [],
                  },
                  // Iterate the precomputed slot list and ADD_CHILD each
                  // — runs every pass so a half-built day-col self-heals.
                  {
                    id: uid(), type: "loop", overExpr: "$slotIds", as: "$slotId",
                    body: [
                      { id: uid(), type: "action", config: {
                          type: "ADD_CHILD",
                          parentId: "$dayColId",
                          childId: "$slotId",
                      }},
                    ],
                  },
                  // Multi-parent the shared Due too.
                  {
                    id: uid(), type: "if",
                    condition: { operator: "AND", rules: [{ id: uid(), left: "$sharedDueId", comparator: "IS_NOT_EMPTY", right: "" }] },
                    then: [{ id: uid(), type: "action", config: {
                        type: "ADD_CHILD",
                        parentId: "$dayColId",
                        childId: "$sharedDueId",
                    }}],
                    else: [],
                  },
                ],
              }],
              else: [],
            },

            // ── PHASE 4c: per-day SHORTENED day-col creation ────────────────
            // Gated on $activePeriodCount > 7. Each shortened day-col is a
            // flat container (no slots inside) — Schedule's day-grouped
            // calendar view for long periods. Field-based identity (no
            // meta markers): scheduleFormat="shortened" + date field = $day.
            ...(scheduleFormatFieldId ? [{
              id: uid(), type: "if",
              condition: { operator: "AND", rules: [{ id: uid(), left: "$activePeriodCount", comparator: "GREATER", right: 7 }] },
              then: [{
                id: uid(), type: "loop", overExpr: "$activePeriodDates", as: "$day",
                body: [
                  { id: uid(), type: "action", config: {
                      type: "FIND", over: "$allContainers",
                      predicate: { operator: "AND", rules: [
                        { id: uid(), left: "_ancestors",                                       comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                        { id: uid(), left: `fields.${scheduleFormatFieldId}.value`,            comparator: "IS",           right: "shortened" },
                        { id: uid(), left: `fields.${dateFieldId}.value`,                      comparator: "SAME_DAY",     right: "$day" },
                      ]},
                      itemIdVar: "$shortColId",
                  }},
                  {
                    id: uid(), type: "if",
                    condition: { operator: "AND", rules: [{ id: uid(), left: "$shortColId", comparator: "IS_EMPTY", right: "" }] },
                    then: [
                      { id: uid(), type: "action", config: {
                          type: "CREATE",
                          // Shortened day-col label uses date too — was just
                          // "Day" so every column was indistinguishable.
                          name: "${$day}",
                          role: "container", kind: "list",
                          meta: { allowChildContainers: true },
                          parent: "$schedPageId",
                          filterOverride: { [dateFieldId]: "$day" },
                          fields: {
                            [dateFieldId]: "$day",
                            [scheduleFormatFieldId]: "literal:shortened",
                          },
                          fieldHidden: {
                            [dateFieldId]: true,
                            [scheduleFormatFieldId]: true,
                          },
                          itemIdVar: "$shortColId",
                      }},
                    ],
                    else: [],
                  },
                ],
              }],
              else: [],
            }] : []),

            // ── PHASE 5: teardown out-of-period / wrong-format day-cols ─────
            // Loop every container under Schedule that has the scheduleFormat
            // field stamped (i.e. is a day-col). DELETE if EITHER:
            // (a) its date field is NOT in $activePeriodDates, OR
            // (b) its scheduleFormat doesn't match the current mode
            //     (timeslot when ≤7, shortened when >7).
            // Slots aren't touched — they don't carry scheduleFormat, so the
            // outer `IS_NOT_EMPTY` gate skips them. Slots are multi-parented
            // into surviving day-cols, so DELETE doesn't cascade.
            ...(scheduleFormatFieldId ? [
              { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$expectedFormat", expr: "literal:timeslot" } },
              {
                id: uid(), type: "if",
                condition: { operator: "AND", rules: [{ id: uid(), left: "$activePeriodCount", comparator: "GREATER", right: 7 }] },
                then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$expectedFormat", expr: "literal:shortened" } }],
                else: [],
              },
              {
                id: uid(), type: "loop", overExpr: "$allContainers", as: "$cont",
                body: [{
                  id: uid(), type: "if",
                  condition: { operator: "AND", rules: [
                    { id: uid(), left: "$cont._ancestors",                                       comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                    { id: uid(), left: `$cont.fields.${scheduleFormatFieldId}.value`,            comparator: "IS_NOT_EMPTY", right: "" },
                  ]},
                  then: [{
                    id: uid(), type: "if",
                    condition: { operator: "AND", rules: [
                      { id: uid(), left: "$activePeriodDates",                                   comparator: "ARRAY_INCLUDES", right: `$cont.fields.${dateFieldId}.value` },
                      { id: uid(), left: `$cont.fields.${scheduleFormatFieldId}.value`,          comparator: "IS",             right: "$expectedFormat" },
                    ]},
                    then: [],
                    else: [{ id: uid(), type: "action", config: {
                        type: "DELETE",
                        itemIdExpr: "$cont.id",
                    }}],
                  }],
                  else: [],
                }],
              },
            ] : []),

            // ── PHASE 6: per-day todo sweep into shared Due ─────────────────
            // For each $day, sweep matching todos into the shared Due via
            // COPY_LINK (so completion fan-out works). All swept copies live
            // under the shared Due — visibility cascade filters them per
            // day-col render via the day-col's filterOverride.
            {
              id: uid(), type: "if",
              condition: { operator: "AND", rules: [
                { id: uid(), left: "$todoContId",  comparator: "IS_NOT_EMPTY", right: "" },
                { id: uid(), left: "$sharedDueId", comparator: "IS_NOT_EMPTY", right: "" },
              ]},
              then: [{
                id: uid(), type: "loop", overExpr: "$activePeriodDates", as: "$day",
                body: [{
                  id: uid(), type: "loop", overExpr: "$allItems", as: "$item",
                  body: [{
                    id: uid(), type: "if",
                    condition: { operator: "AND", rules: [
                      { id: uid(), left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: "$todoContId" },
                      { id: uid(), left: `$item.fields.${dueFieldId}.value`, comparator: "SAME_DAY", right: "$day" },
                    ]},
                    then: [
                      { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$todoTemplateId", expr: "$item.templateId" } },
                      { id: uid(), type: "action", config: {
                          type: "FIND", over: "$allInstances",
                          predicate: { operator: "AND", rules: [
                            { id: uid(), left: "templateId", comparator: "IS",           right: "$todoTemplateId" },
                            { id: uid(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$sharedDueId" },
                            { id: uid(), left: `fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$day" },
                          ]},
                          itemIdVar: "$existingCopyId",
                      }},
                      {
                        id: uid(), type: "if",
                        condition: { operator: "AND", rules: [{ id: uid(), left: "$existingCopyId", comparator: "IS_EMPTY", right: "" }] },
                        then: [{ id: uid(), type: "action", config: {
                            type: "COPY_LINK",
                            sourceId: "$item.id",
                            parent: "$sharedDueId",
                            fields: { [dateFieldId]: "$day", [dueFieldId]: "$day" },
                        }}],
                        else: [{ id: uid(), type: "action", config: {
                            type: "COPY_LINK",
                            sourceId: "$item.id",
                            targetId: "$existingCopyId",
                        }}],
                      },
                    ],
                    else: [],
                  }],
                }],
              }],
              else: [],
            },

            // Tail: re-aggregate trackers so newly-seeded routine + swept
            // todos tick goal totals immediately. Names parameterized so
            // live data ("Tracker: Water") and test grid ("Tracker: Water Today")
            // each point at the right ops.
            { id: uid(), type: "action", config: { type: "RUN_OPERATION", operationName: waterTrackerName } },
            { id: uid(), type: "action", config: { type: "RUN_OPERATION", operationName: completedTrackerName } },
          ],
          else: [],
        },
          ],
          else: [],
        },
      ],
    },
  };
}

// ── Day Page: Build ──────────────────────────────────────────────────────────
// Same trigger surface + $date resolution chain as "Schedule: Build Day".
// Per active date: ensure a doc page "Day Page - <date>" exists in the Day
// Pages folder. If missing, APPLY_TEMPLATE the "Day Page" template as a fresh
// standalone page (rootParent = Day Pages folder, rootLabel = the dated
// name) with replacements { "{Date}": "$dayDate" } so the cloned textblock
// H1 reads "Day Page - <date>". Idempotent: the existence FIND is by the
// deterministic page label.
//
// hubPanelOccIdVar — the literal occurrence id of the Center Hub panel
//   occurrence (panelOccIds.hub from createTestGrid). ADD_CHILD appends the
//   new day page as an inactive tab on that panel; hub View.activeOccurrenceId
//   stays Schedule, so the tab is present but not shown until the user clicks it.
// dayPagesFolderId — the folder id of the "Day Pages" day-pages folder.
export function makeDayPageBuildOp({ userId, gridId, dateFieldId, dayPagesFolderId, hubPanelOccIdVar, goalsPageOccId, schedulePageOccId }) {
  if (!schedulePageOccId) throw new Error("makeDayPageBuildOp: schedulePageOccId required (picker-direct ancestor + page ref; see CLAUDE_CHAT.md 2026-05-22)");
  if (!goalsPageOccId)    throw new Error("makeDayPageBuildOp: goalsPageOccId required (picker-direct ancestor; see CLAUDE_CHAT.md 2026-05-22)");
  return {
    id: uid(), userId, gridId, name: "Day Page: Build",
    description: "Create one doc Day Page per active date in the Day Pages folder, applying the Day Page template with the date stamped into the textblock heading.",
    // Trigger surface (2026-05-22 refactor — picker-direct ancestor):
    //   grid-subject onLoad/onFilterChange + broad filterNav. Pipeline IF
    //   guard at the top matches $trigger._ancestorIds against the picker-
    //   bound goals + schedule pages. Drops the rename-fragile
    //   ancestorLabel approach (was "Daily Goals" / "Schedule" hardcoded).
    triggerTypes: ["onLoad", "onFilterChange"],
    triggerObjects: [
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 1 },
      { eventType: "onFilterChange", subjectType: "grid",      targetId: "", priority: 1 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", priority: 1 },
    ],
    enabled: true,
    pipeline: {
      steps: [
        // Picker-style direct bindings — rename-stable refs to seed-time pages.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPage",   expr: `$allItemsById.${schedulePageOccId}` }},
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPageId", expr: "$schedPage.id" }},
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalsPage",   expr: `$allItemsById.${goalsPageOccId}` }},

        // Ancestor guard — grid/onLoad fall through (no sourceOccurrenceId);
        // filterNav matches when ancestor chain includes Schedule or Goals.
        { id: uid(), type: "if",
          condition: { operator: "OR", rules: [
            { id: uid(), left: "$trigger.sourceOccurrenceId", comparator: "IS_EMPTY",     right: "" },
            { id: uid(), left: "$trigger._ancestorIds",       comparator: "HAS_ANCESTOR", right: "$schedPage.id" },
            { id: uid(), left: "$trigger._ancestorIds",       comparator: "HAS_ANCESTOR", right: "$goalsPage.id" },
          ]},
          then: [
        // Resolve the date exactly like Build Day: $trigger.date wins (every
        // trigger here is an explicit user action carrying the intended
        // date), then the Schedule page's effective filter for the onLoad
        // case, then $today as a cold-start last resort.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$dayDate", expr: "$trigger.date" } },
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$dayDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$dayDate", expr: `$schedPage._effectiveFilter.${dateFieldId}` } }],
          else: [],
        },
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$dayDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$dayDate", expr: "$today" } }],
          else: [],
        },

        // Deterministic page name — also the idempotency key.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$dayPageName", expr: "Day Page - ${$dayDate}" } },

        // Already built for this date?
        { id: uid(), type: "action", config: {
            type: "FIND",
            over: "$allPages",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "label", comparator: "IS", right: "$dayPageName" },
            ]},
            itemIdVar: "$existingDayPageId",
        }},
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$existingDayPageId", comparator: "IS_EMPTY", right: "" }] },
          then: [
            // Locate the Day Page template root (templates manifest).
            { id: uid(), type: "action", config: {
                type: "FIND",
                over: "$allOccurrences",
                predicate: { operator: "AND", rules: [
                  { id: uid(), left: "meta.templateName", comparator: "IS", right: "Day Page" },
                ]},
                itemIdVar: "$dayPageTplId",
            }},
            {
              id: uid(), type: "if",
              condition: { operator: "AND", rules: [{ id: uid(), left: "$dayPageTplId", comparator: "IS_NOT_EMPTY", right: "" }] },
              then: [
                // Fresh doc page in the Day Pages folder. parent is the
                // folder id (pages parent to folders via parentId — same as
                // the seeded Notes/Schedule pages).
                // Mint a fresh doc page (root + its textblock child) straight
                // into the Day Pages folder. rootParent makes APPLY_TEMPLATE
                // create a standalone new page (no pre-CREATE, no merge into an
                // existing target); rootLabel names it per date; replacements
                // stamps the date into the cloned textblock's H1. The page's
                // own instanceTextblock ref is auto-remapped to the clone.
                //
                // defaultFields stamps fields[dateFieldId] = $dayDate on every
                // cloned occurrence (the Daily Question container + textblock
                // need this so their { selfField, link:dateFieldId } bindings
                // can JOIN with the journaling instance for that day). The H1
                // textblock and Tasks Completed container also receive the
                // stamp — harmless; they just don't read it.
                { id: uid(), type: "action", config: {
                    type: "APPLY_TEMPLATE",
                    templateRef: "$dayPageTplId",
                    rootParent: dayPagesFolderId,
                    rootLabel: "$dayPageName",
                    replacements: { "{Date}": "$dayDate" },
                    rootIdVar: "$newDayPageId",
                    defaultFields: { [dateFieldId]: "$dayDate" },
                }},
                // Pin the new day page into the Center Hub panel as an
                // inactive tab — same as how the Notes page is "opened"
                // alongside Schedule. parentId stays the Day Pages folder
                // (tree); this only appends to the panel occ's occurrences[].
                // The hub View's activeOccurrenceId remains Schedule, so the
                // tab is present but not shown until the user clicks it.
                { id: uid(), type: "action", config: {
                    type: "ADD_CHILD",
                    parentId: hubPanelOccIdVar,
                    childId: "$newDayPageId",
                }},
              ],
              else: [],
            },
          ],
          else: [],
        },
          ],
          else: [],
        },
      ],
    },
  };
}

// ── Project: Create ──────────────────────────────────────────────────────────
// APPLY_TEMPLATEs the Project Page template into the Projects folder,
// swapping {ProjectName} + {ProjectScope} tokens at instantiation
// (same bracket-replacement technique Day Page uses for {Date}).
//
// Dual-trigger behavior:
//   - onLoad → seeds an EXAMPLE project ("Moduli v1 Launch") with a
//     long-form demo scope. Idempotent — only mints if no project page
//     of that label exists yet. Gives every fresh user a populated
//     Projects folder on first load.
//   - manual → GET_USER_INPUT prompts for the project name first, then
//     the project scope description. Both bound to $projectName /
//     $projectScope and passed into APPLY_TEMPLATE's replacements.
//
// Both paths converge on the same APPLY_TEMPLATE branch — the template
// (with its kanban + 6 columns + scope skeleton) is preserved; only the
// name + scope-paragraph text get filled in.
export function makeProjectCreateOp({ userId, gridId, projectsFolderId }) {
  // Demo scope text — used on onLoad. Single paragraph string that
  // fills the {ProjectScope} token in the template's Overview section.
  // The rest of the scope skeleton (Goals / Milestones / Risks / Success
  // Criteria) is structural and lives in the template.
  const DEMO_PROJECT_SCOPE = "Ship the Moduli v1 release: assistant drawer in every workspace, public REST API at /api/v1, drilldown date picker, display rules system, project kanban demo. The launch is a deliverable, not a moment — every feature has to survive the hard edges of real day-to-day use before it counts as shipped.";

  return {
    id: uid(), userId, gridId, name: "Project: Create",
    description: "Mint a new project page from the Project Page template. onLoad → seeds an example 'Moduli v1 Launch' project (idempotent). Manual → GET_USER_INPUT prompts for name + scope, then APPLY_TEMPLATEs with those replacements. Same {token} replacement technique as Day Page.",
    triggerType: "manual",
    triggerTypes: ["manual", "onLoad"],
    triggerObjects: [
      { eventType: "onLoad", subjectType: "grid", targetId: "", priority: 5 },
    ],
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        // ── Branch on trigger type ─────────────────────────────────────────
        // onLoad → hardcoded demo values. Manual → prompt the user.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$triggerType", expr: "$trigger.type" } },
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [
            { id: uid(), left: "$triggerType", comparator: "IS", right: "onLoad" },
          ]},
          then: [
            // onLoad path — stamp the demo values directly.
            { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$projectName",  expr: "literal:Moduli v1 Launch" } },
            { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$projectScope", expr: `literal:${DEMO_PROJECT_SCOPE}` } },
          ],
          else: [
            // Manual path — prompt for name, then scope. Each
            // GET_USER_INPUT suspends the pipeline until the user
            // submits the modal; the response binds to resultVar and
            // the next step runs.
            { id: uid(), type: "action", config: {
                type: "GET_USER_INPUT",
                title: "Create Project",
                question: "What's the project name?",
                inputType: "text",
                defaultValue: "Untitled",
                resultVar: "$projectName",
            }},
            { id: uid(), type: "action", config: {
                type: "GET_USER_INPUT",
                title: "Create Project",
                question: "Brief scope / overview (one paragraph)?",
                inputType: "text",
                defaultValue: "—",
                resultVar: "$projectScope",
            }},
          ],
        },
        // Defensive fallbacks if either var ended up empty (e.g. the
        // user cancelled a modal). Use the literal: prefix so the
        // resolveExpr fallback path doesn't try to look up a $-var.
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$projectName", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$projectName", expr: "literal:Untitled" } }],
          else: [],
        },
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$projectScope", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$projectScope", expr: "literal:—" } }],
          else: [],
        },

        // ── Idempotency-by-label gate ──────────────────────────────────────
        // Same pattern as Day Page: Build — never dupe.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$projectPageName", expr: "Project: ${$projectName}" } },
        { id: uid(), type: "action", config: {
            type: "FIND", over: "$allPages",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "label", comparator: "IS", right: "$projectPageName" },
            ]},
            itemIdVar: "$existingProjectPageId",
        }},
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$existingProjectPageId", comparator: "IS_EMPTY", right: "" }] },
          then: [
            // Locate the Project Page template root.
            { id: uid(), type: "action", config: {
                type: "FIND", over: "$allOccurrences",
                predicate: { operator: "AND", rules: [
                  { id: uid(), left: "meta.templateName", comparator: "IS", right: "Project Page" },
                ]},
                itemIdVar: "$projectTplId",
            }},
            {
              id: uid(), type: "if",
              condition: { operator: "AND", rules: [{ id: uid(), left: "$projectTplId", comparator: "IS_NOT_EMPTY", right: "" }] },
              then: [
                // APPLY_TEMPLATE into the Projects folder, swapping
                // {ProjectName} + {ProjectScope} tokens via replacements.
                { id: uid(), type: "action", config: {
                    type: "APPLY_TEMPLATE",
                    templateRef: "$projectTplId",
                    rootParent: projectsFolderId,
                    rootLabel: "$projectPageName",
                    replacements: {
                      "{ProjectName}":  "$projectName",
                      "{ProjectScope}": "$projectScope",
                    },
                    rootIdVar: "$newProjectPageId",
                }},
              ],
              else: [],
            },
          ],
          else: [],
        },
      ],
    },
  };
}

// ── Day Page: Build Tasks Completed ─────────────────────────────────────────
// Sibling op to `Day Page: Build`. After the day page exists (containing the
// cloned "Tasks Completed" doc container), this op walks $allInstances and
// rewrites the container's textmap to a list of moduleEmbed nodes pointing at
// each completed schedule task for `$dayDate`.
//
// Trigger surface:
//   - onLoad                                            — cold-start build
//   - onFilterChange grid                               — global filter date moved
//   - onFilterChange filterNav ancestorLabel "Schedule" — schedule day navigation
//   - onChange on completedFieldId                      — tick a task complete/uncomplete
//
// $dayDate chain mirrors Day Page: Build (and Build Day): $trigger.date →
// Schedule page's effective filter → $today. The day page is found by its
// deterministic label "Day Page - <date>" (the same idempotency key Build
// uses). The Tasks Completed container is found by walking the day page's
// occurrences[] and matching `label IS "Tasks Completed"`.
//
// Sort: naïve. $allInstances iteration order is whatever insertion order the
// executor's $allItems carries (typically load-time order). For perfectly
// time-ordered rendering, a future SORT_BY primitive would walk
// `$schedPage.occurrences` (slot containers in time order) and inner-loop
// each slot's children. Filed as TODO; the unsorted list is still useful.
// ── Project: Status Router ───────────────────────────────────────────────────
// onChange trigger on the statusFieldId. When a task in any project's kanban
// gets its status field set to one of the 6 column labels (Backburner /
// Docket / Working On / In Review / Test / Complete), this op MOVE_OCCURRENCEs
// the task between columns on the same project page.
//
// Strategy (no global routing tables — derive everything from the live tree):
//   1. Resolve $newStatus + $taskId from the trigger.
//   2. Look up the task in $allInstances so we can read its parentId (current
//      kanban column).
//   3. Look up the current column in $allContainers — its parentId is the
//      kanban board occurrence.
//   4. FIND the target column under the same kanban board where
//      label IS $newStatus. The column labels match the status field's
//      option values verbatim, so no mapping is needed.
//   5. If the target column exists AND differs from the current column,
//      MOVE_OCCURRENCE the task to it.
//
// Same-project guarantee: by anchoring step 4 on parentId = the task's
// current kanban board, we never cross over to a different project's
// kanban (each project page has its own kanban board container).
//
// Skipped silently when:
//   - the task isn't inside a kanban board (parent or grandparent doesn't
//     match), so changing status on a non-kanban task is a no-op
//   - the new column doesn't exist (status options out of sync with column
//     set — e.g. typo) — fail closed rather than create a bad move
//   - the task is already in the target column (idempotent re-fire)
export function makeProjectStatusRouterOp({ userId, gridId, statusFieldId }) {
  return {
    id: uid(), userId, gridId, name: "Project: Status Router",
    description: "When a task's status field changes, move the task between kanban columns on the same project page. Column label = status value (Backburner / Docket / Working On / In Review / Test / Complete).",
    triggerType: "onChange",
    triggerTypes: ["onChange"],
    triggerObjects: [
      { eventType: "onChange", subjectType: "field", targetId: statusFieldId, priority: 5 },
    ],
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        // ── Trigger args ──────────────────────────────────────────────────
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$newStatus", expr: "$trigger.value" } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$taskId",    expr: "$trigger.occurrenceId" } },

        // ── Resolve the task occurrence (need its parentId) ──────────────
        { id: uid(), type: "action", config: {
            type: "FIND", over: "$allInstances",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "id", comparator: "IS", right: "$taskId" },
            ]},
            itemVar: "$task", itemIdVar: "$taskFoundId",
        }},

        // ── Only continue if the task was found and has a parent column ──
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [
            { id: uid(), left: "$taskFoundId", comparator: "IS_NOT_EMPTY", right: "" },
            { id: uid(), left: "$task.parentId", comparator: "IS_NOT_EMPTY", right: "" },
          ]},
          then: [
            // ── Resolve current column (one level up from task) ──────────
            { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$currentColId", expr: "$task.parentId" } },
            { id: uid(), type: "action", config: {
                type: "FIND", over: "$allContainers",
                predicate: { operator: "AND", rules: [
                  { id: uid(), left: "id", comparator: "IS", right: "$currentColId" },
                ]},
                itemVar: "$currentCol", itemIdVar: "$currentColFoundId",
            }},

            {
              id: uid(), type: "if",
              condition: { operator: "AND", rules: [
                { id: uid(), left: "$currentColFoundId", comparator: "IS_NOT_EMPTY", right: "" },
                { id: uid(), left: "$currentCol.parentId", comparator: "IS_NOT_EMPTY", right: "" },
              ]},
              then: [
                // $kanbanBoardId is the parent of the current column. Find the
                // target column whose label matches $newStatus AND whose parent
                // is the same kanban board — guarantees we stay within the
                // same project.
                { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$kanbanBoardId", expr: "$currentCol.parentId" } },
                { id: uid(), type: "action", config: {
                    type: "FIND", over: "$allContainers",
                    predicate: { operator: "AND", rules: [
                      { id: uid(), left: "parentId", comparator: "IS", right: "$kanbanBoardId" },
                      { id: uid(), left: "label",    comparator: "IS", right: "$newStatus"    },
                    ]},
                    itemVar: "$targetCol", itemIdVar: "$targetColId",
                }},

                {
                  id: uid(), type: "if",
                  condition: { operator: "AND", rules: [
                    { id: uid(), left: "$targetColId",  comparator: "IS_NOT_EMPTY", right: "" },
                    { id: uid(), left: "$targetColId",  comparator: "IS_NOT",       right: "$currentColId" },
                  ]},
                  then: [
                    { id: uid(), type: "action", config: {
                        type: "MOVE_OCCURRENCE",
                        occurrenceIdExpr: "$taskId",
                        toContainerIdExpr: "$targetColId",
                    }},
                  ],
                  else: [],
                },
              ],
              else: [],
            },
          ],
          else: [],
        },
      ],
    },
  };
}

export function makeDayPageBuildTasksCompletedOp({
  userId, gridId, dateFieldId, completedFieldId, isTaskFieldId,
}) {
  return {
    id: uid(), userId, gridId, name: "Day Page: Build Tasks Completed",
    description: "Rewrite the Tasks Completed container on the active day's Day Page with moduleEmbed nodes for every completed schedule task on that date.",
    // Priority 4 — runs AFTER Build Day (1), Stamp (2), trackers (3) so the
    // completion state it reads is fully settled.
    // onAdd / onDelete on BOTH container AND instance subjects.
    // Container subjects catch slot-container churn from Schedule:
    // Build Day's APPLY_TEMPLATE; instance subjects catch task-level
    // adds/removes (drag in/out of Schedule, manual deletion). Both
    // are needed — root cause of stale moduleEmbed refs was that the
    // prior trigger set only covered containers, leaving instance-
    // level deletions to orphan embeds at ids no longer in the store.
    triggerTypes: ["onLoad", "onFilterChange", "onChange", "onAdd", "onDelete"],
    triggerObjects: [
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 4 },
      { eventType: "onFilterChange", subjectType: "grid",      targetId: "", priority: 4 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Schedule", priority: 4 },
      { eventType: "onChange",       subjectType: "field",     targetId: completedFieldId, priority: 4 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "container", targetId: "", priority: 4 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "container", targetId: "", priority: 4 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "instance",  targetId: "", priority: 4 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "instance",  targetId: "", priority: 4 },
    ],
    enabled: true,
    pipeline: {
      steps: [
        // Resolve $dayDate exactly like Day Page: Build.
        { id: uid(), type: "action", config: {
            type: "FIND",
            over: "$allPages",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "label", comparator: "IS", right: "Schedule" },
            ]},
            itemIdVar: "$schedPageId",
            itemVar: "$schedPage",
        }},
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$dayDate", expr: "$trigger.date" } },
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$dayDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$dayDate", expr: `$schedPage._effectiveFilter.${dateFieldId}` } }],
          else: [],
        },
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$dayDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$dayDate", expr: "$today" } }],
          else: [],
        },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$dayPageName", expr: "Day Page - ${$dayDate}" } },

        // Locate the day page for $dayDate.
        { id: uid(), type: "action", config: {
            type: "FIND",
            over: "$allPages",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "label", comparator: "IS", right: "$dayPageName" },
            ]},
            itemIdVar: "$dayPageId",
            itemVar: "$dayPage",
        }},
        // Bail when no day page has been built yet — Day Page: Build runs
        // earlier in the same priority sweep but this op is safe either way.
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$dayPageId", comparator: "IS_NOT_EMPTY", right: "" }] },
          then: [
            // Find the Tasks Completed container as a direct child of the
            // day page. Match by parentId + label — both fields survive the
            // template clone (the template module's label "Tasks Completed"
            // copies onto the clone; parentId is the cloned day page id).
            { id: uid(), type: "action", config: {
                type: "FIND",
                over: "$allContainers",
                predicate: { operator: "AND", rules: [
                  { id: uid(), left: "parentId", comparator: "IS",  right: "$dayPageId" },
                  { id: uid(), left: "label",    comparator: "IS",  right: "Tasks Completed" },
                ]},
                itemIdVar: "$tcContId",
                itemVar: "$tcCont",
            }},
            { id: uid(), type: "if",
              condition: { operator: "AND", rules: [{ id: uid(), left: "$tcContId", comparator: "IS_NOT_EMPTY", right: "" }] },
              then: [
                // Build the moduleEmbed array via PUSH_TO_ARRAY.
                { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$tcContent", expr: "json:[]" } },
                { id: uid(), type: "loop",
                  over: "$allInstances",
                  as: "$task",
                  predicate: { operator: "AND", rules: [
                    { id: uid(), left: "_ancestors",                              comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                    { id: uid(), left: `fields.${dateFieldId}.value`,             comparator: "SAME_DAY",     right: "$dayDate" },
                    { id: uid(), left: `fields.${completedFieldId}.value`,        comparator: "IS",           right: "true" },
                    { id: uid(), left: `fields.${isTaskFieldId}.value`,           comparator: "IS",           right: "true" },
                  ]},
                  body: [
                    // PUSH_TO_ARRAY deep-resolves `$task.id` inside the embed
                    // object so each push lands a unique occurrenceId.
                    { id: uid(), type: "action", config: {
                        type: "PUSH_TO_ARRAY",
                        name: "$tcContent",
                        value: { type: "moduleEmbed", attrs: { occurrenceId: "$task.id" } },
                    }},
                  ],
                },
                // If the loop pushed nothing, leave a single empty paragraph
                // so the container body still renders cleanly (TipTap requires
                // doc.content to be non-empty).
                { id: uid(), type: "if",
                  condition: { operator: "AND", rules: [{ id: uid(), left: "$tcContent.length", comparator: "IS", right: "0" }] },
                  then: [
                    { id: uid(), type: "action", config: {
                        type: "UPDATE",
                        path: "$tcCont.textmap",
                        value: { type: "doc", content: [{ type: "paragraph" }] },
                    }},
                  ],
                  else: [
                    { id: uid(), type: "action", config: {
                        type: "UPDATE",
                        path: "$tcCont.textmap",
                        value: { type: "doc", content: "$tcContent" },
                    }},
                  ],
                },
              ],
              else: [],
            },
          ],
          else: [],
        },
      ],
    },
  };
}

export function makeStampDateTimeSlotOp({ userId, gridId, timeslotFieldId, hubPanelModuleId, lastSeenFieldId = null }) {
  const steps = [
    // Bind $item to the freshly-created occurrence so UPDATE paths resolve.
    { id: uid(), type: "action", config: {
        type: "FIND",
        predicate: { operator: "AND", rules: [
          { id: uid(), left: "id", comparator: "IS", right: "$trigger.occurrenceId" },
        ]},
        itemVar: "$item",
    }},
    // Date stamping is handled by the drop side (dropHandlers.stampPageFilterFields /
    // computePageFilterFields) which reads the slot's parent-chain effective
    // filter at drop time and pre-stamps the new occurrence's fields BEFORE
    // the OccurrenceCreateOp dispatch. The Stamp op only handles the timeslot
    // label here — writing the date again would overwrite the drop-side stamp
    // with $trigger._effectiveFilter.Date, which doesn't exist on the
    // optimistic OccurrenceCreateOp transaction (resolves to undefined → null).
    { id: uid(), type: "action", config: {
        type: "UPDATE",
        path: `$item.fields.${timeslotFieldId}.value`,
        value: "$trigger.containerLabel",
    }},
  ];
  // Optional lastSeen stamp — when a lastSeenFieldId is provided, also stamp
  // today's date (or the active Schedule filter date) onto the dropped
  // occurrence so "last seen / last touched" displays + occurrence-select
  // chip configs can surface a freshness signal.
  if (lastSeenFieldId) {
    steps.push({
      id: uid(), type: "action", config: {
        type: "UPDATE",
        path: `$item.fields.${lastSeenFieldId}.value`,
        // Prefer the trigger's date (carries the active schedule day on a
        // drop into a slot), fall back to $today.
        value: "$today",
      },
    });
  }
  return {
    id: uid(), userId, gridId, name: "Schedule: Stamp Date & Time Slot",
    triggerTypes: ["onCreate"],
    // Per-trigger priority 2: field stamps run after auto-build (1).
    triggerObjects: [
      { eventType: "onCreate", subjectType: "module", subjectRole: "panel", targetId: hubPanelModuleId, priority: 2 },
    ],
    enabled: true,
    pipeline: { steps },
  };
}

// ── Generalized goal tracker ─────────────────────────────────────────────────
// makeTrackerOp is the conversion engine for the live grid's goals/accounts.
// It generalizes the two hand-built createTestGrid trackers
// ("Tracker: Water Today" sum + "Tracker: Tasks Completed Today" count) into
// ONE factory. Every legacy makeLoop* aggregation re-expresses as one call.
//
// Pipeline shape (faithful to the source trackers, step-for-step):
//   1. INIT_VAR $acc = 0
//   2. FIND $allPages   label IS <scopeLabel>  → $scopePageId   (HAS_ANCESTOR scope)
//   3. FIND $allInstances label IS <goalLabel> → $goalId/$goalItem (UPDATE target)
//   4. $goalDate chain ($goalItem._effectiveFilter.<dateFieldId> → $trigger.date
//      → $today) — emitted ONLY when timeFilter !== "all"
//   5. trigger/date-gate `if` (OR block copied from the source trackers; the
//      per-event SAME_DAY sub-rules are dropped for timeFilter:"all" so bulk
//      events still run)
//   6. then: loop $allItems → inner `if` rule list (completion gate / date gate
//      / HAS_ANCESTOR scope / flow) → accumulator action(s)
//   7. UPDATE $goalItem.fields.<goalFieldId>.value = $acc
//
// Params:
//   { userId, gridId, name, goalLabel, goalFieldId, dateFieldId,
//     completedFieldId, sourceFieldId, sourceFieldIds, incomeFieldId,
//     spentFieldId, agg, flow="any", timeFilter="daily", scopeLabel="Schedule",
//     description }
//
// agg ∈ sum | multiSum | count | countTrue | last | net | completionRate.
// Pure: returns the plain object literal passed to `new Operation(obj)`.
export function makeTrackerOp({
  userId, gridId, name,
  goalLabel, goalFieldId, dateFieldId, completedFieldId,
  // Direct occurrence ID — preferred over goalLabel. When provided, the
  // goal-lookup step binds $goalId from this literal and FINDs $goalItem
  // by id match. Zero label-collision risk. Used by per-metric goal
  // restructure where many goals share field names like "Tasks Completed".
  goalOccurrenceId,
  sourceFieldId, sourceFieldIds, incomeFieldId, spentFieldId,
  agg, flow = "any", timeFilter = "daily", scopeLabel = "Schedule",
  description,
  // Optional filter: only count items where this boolean field is true.
  // Used by Tracker: Tasks Completed to filter out non-task items dragged
  // into Schedule (mood checks, water logs, etc. that don't have isTask=true).
  isTaskFieldId,
  // Optional Command Center folder routing. When set, the returned op
  // carries this folderId so the Trackers column groups it without
  // relying on name-prefix regex post-processing.
  folderId,
  // Optional $displayRules object — when set, an INIT_VAR step is
  // prepended to the pipeline so the executor's display-rules
  // post-processor (helpers/displayRules.js) picks it up. Shape:
  // `{ "<occurrence label>": [{ when, color?, icon?, suffix?, replaceValue? }, ...] }`
  // Rules are evaluated in order; first match wins. `when` accessors
  // are short semantic names — `value`, `target`, or any sibling
  // field's name on the occurrence (case-insensitive). See the
  // helpers/displayRules.js header for the full predicate language.
  displayRules,
}) {
  // ── Fail-fast argument guards ──
  // Task 13 calls this ~20× with varying agg types; silent-zero goals are hard
  // to debug without an explicit error here.
  if (agg === "multiSum" && !(sourceFieldIds && sourceFieldIds.length)) throw new Error(`makeTrackerOp("${name}"): agg "multiSum" requires sourceFieldIds[]`);
  if (agg === "net" && !(incomeFieldId && spentFieldId)) throw new Error(`makeTrackerOp("${name}"): agg "net" requires incomeFieldId + spentFieldId`);
  if ((agg === "sum" || agg === "last") && !sourceFieldId) throw new Error(`makeTrackerOp("${name}"): agg "${agg}" requires sourceFieldId`);

  const dateGated = timeFilter !== "all";
  const accVar = "$acc";

  // ── Inner loop predicate rule list (assembled IN ORDER) ──
  // Faithful to the source trackers: Water sums where the source field is
  // present AND completed IS true AND date SAME_DAY $goalDate AND HAS_ANCESTOR
  // scope page; Tasks counts where completed IS true AND date SAME_DAY
  // $goalDate AND HAS_ANCESTOR scope page.
  function buildLoopRules({ srcField, includeCompletion, includePresence, flowField }) {
    const rules = [];
    // Presence: only meaningful for value-bearing aggregations on a real
    // source field (Water guards `IS_NOT_EMPTY` on the water field so empty
    // routine slots don't zero the sum).
    if (includePresence && srcField) {
      rules.push({ id: uid(), left: `$item.fields.${srcField}.value`, comparator: "IS_NOT_EMPTY", right: "" });
    }
    // Completion gate — Water + Tasks both require completed IS true.
    if (includeCompletion && completedFieldId) {
      rules.push({ id: uid(), left: `$item.fields.${completedFieldId}.value`, comparator: "IS", right: true });
    }
    // Date gate — DATE_IN_PERIOD lets a single rule cover day/week/month/year
    // by reading the unit off the goal's effective filter (resolved into
    // $goalPeriod as a `{value, unit}` object — bare string equals day unit).
    // The aggregator MUST loop over the WHOLE selected period, not just one
    // day: e.g. weekly view sums every value across all 7 days under the
    // scope page. timeFilter "all" still drops the gate entirely for lifetime
    // aggregations.
    if (timeFilter !== "all") {
      rules.push({ id: uid(), left: `$item.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" });
    }
    // Scope — only items under the scope page count.
    rules.push({ id: uid(), left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: "$scopePageId" });
    // Flow direction filter (in/out aggregations like income vs expense).
    if (flowField && flow === "in") {
      rules.push({ id: uid(), left: `$item.fields.${flowField}.flow`, comparator: "IS", right: "in" });
    } else if (flowField && flow === "out") {
      rules.push({ id: uid(), left: `$item.fields.${flowField}.flow`, comparator: "IS", right: "out" });
    }
    // isTask gate — only items explicitly marked as tasks. Lets the Tasks
    // Completed tracker exclude non-task items in Schedule (mood checks,
    // water logs, etc.).
    if (isTaskFieldId) {
      rules.push({ id: uid(), left: `$item.fields.${isTaskFieldId}.value`, comparator: "IS", right: true });
    }
    return rules;
  }

  // ── Accumulator body for a single loop, given the agg ──
  // sum/count/countTrue include the completion gate (matches Water + Tasks).
  // last/multiSum do not gate on completion (semantically a raw read / a
  // multi-field roll-up).
  // NOTE: The first param (e.g. "sum", "netIncome") is a human-readable label
  // for call-site self-documentation only. It is intentionally not consumed
  // inside the function body — do not wire it into step ids.
  function buildLoopFor(kind, opts = {}) {
    const {
      srcField,
      accumulator,            // array of action configs run in the inner `if` then
      includeCompletion,
      includePresence,
      flowField,
    } = opts;
    return {
      id: uid(), type: "loop", overExpr: "$allItems", as: "$item",
      body: [{
        id: uid(), type: "if",
        condition: {
          operator: "AND",
          rules: buildLoopRules({ srcField, includeCompletion, includePresence, flowField }),
        },
        then: accumulator.map((cfg) => ({ id: uid(), type: "action", config: cfg })),
        else: [],
      }],
    };
  }

  // The body run inside the trigger/date-gate `then` — one or more loops plus
  // the final UPDATE. completionRate/net need extra scratch vars + a second
  // loop; the simple aggregations are a single loop.
  function buildAggregationBody() {
    const steps = [];
    if (agg === "sum") {
      steps.push(buildLoopFor("sum", {
        srcField: sourceFieldId,
        includeCompletion: true,   // Water: sum where completed IS true
        includePresence: true,
        flowField: sourceFieldId,
        accumulator: [{ type: "ADD_TO_VAR", name: accVar, expr: `$item.fields.${sourceFieldId}.value` }],
      }));
    } else if (agg === "multiSum") {
      // One ADD_TO_VAR per source field; no completion gate (raw roll-up).
      steps.push(buildLoopFor("multiSum", {
        includeCompletion: false,
        includePresence: false,
        accumulator: (sourceFieldIds || []).map((fid) => ({
          type: "ADD_TO_VAR", name: accVar, expr: `$item.fields.${fid}.value`,
        })),
      }));
    } else if (agg === "count") {
      // Plain count — no completion gate (count of items in scope/date).
      steps.push(buildLoopFor("count", {
        includeCompletion: false,
        includePresence: false,
        accumulator: [{ type: "INCREMENT_VAR", name: accVar, by: 1 }],
      }));
    } else if (agg === "countTrue") {
      // Tasks: count(+1) where completed IS true.
      steps.push(buildLoopFor("countTrue", {
        includeCompletion: true,
        includePresence: false,
        accumulator: [{ type: "INCREMENT_VAR", name: accVar, by: 1 }],
      }));
    } else if (agg === "last") {
      // Raw read of the most-recent matching item's value (loop overwrites).
      steps.push(buildLoopFor("last", {
        srcField: sourceFieldId,
        includeCompletion: false,
        includePresence: true,
        accumulator: [{ type: "SET_VAR", name: accVar, expr: `$item.fields.${sourceFieldId}.value` }],
      }));
    } else if (agg === "net") {
      // Two loops: income added into $acc, spent accumulated into $spentAcc,
      // then $spentAcc negated and added to $acc. Mirrors makeNetBalanceOp in
      // the legacy createDefaultUserData.js builders.
      // Cannot negate via "-$item.fields.X.value" — resolveExpr only resolves
      // $-prefixed strings; the leading "-" makes it a literal string →
      // Number("-$item…") = NaN → || 0, so the subtraction never happens.
      const spentAccVar = "$spentAcc";
      steps.push({ id: uid(), type: "action", config: { type: "INIT_VAR", name: spentAccVar, value: 0 } });
      steps.push(buildLoopFor("netIncome", {
        srcField: incomeFieldId,
        includeCompletion: false,
        includePresence: true,
        accumulator: [{ type: "ADD_TO_VAR", name: accVar, expr: `$item.fields.${incomeFieldId}.value` }],
      }));
      steps.push(buildLoopFor("netSpent", {
        srcField: spentFieldId,
        includeCompletion: false,
        includePresence: true,
        accumulator: [{ type: "ADD_TO_VAR", name: spentAccVar, expr: `$item.fields.${spentFieldId}.value` }],
      }));
      // Negate spent accumulator then add to income accumulator.
      steps.push({ id: uid(), type: "action", config: { type: "MULTIPLY_VAR", name: spentAccVar, expr: -1 } });
      steps.push({ id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: accVar, expr: spentAccVar } });
    } else if (agg === "completionRate") {
      // $done = completed count, $tot = total count, $acc = round($done/$tot*100).
      steps.push({ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$done", value: 0 } });
      steps.push({ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$tot", value: 0 } });
      steps.push(buildLoopFor("crDone", {
        includeCompletion: true,
        includePresence: false,
        accumulator: [{ type: "INCREMENT_VAR", name: "$done", by: 1 }],
      }));
      steps.push(buildLoopFor("crTot", {
        includeCompletion: false,
        includePresence: false,
        accumulator: [{ type: "INCREMENT_VAR", name: "$tot", by: 1 }],
      }));
      steps.push({ id: uid(), type: "action", config: { type: "MULTIPLY_VAR", name: "$done", expr: 100 } });
      steps.push({ id: uid(), type: "action", config: { type: "DIV_VAR", name: "$done", by: "$tot" } });
      steps.push({ id: uid(), type: "action", config: { type: "SET_VAR", name: accVar, expr: "$done" } });
    }
    // Final: write the aggregated value to the goal record itself.
    steps.push({ id: uid(), type: "action", config: {
      type: "UPDATE",
      path: `$goalItem.fields.${goalFieldId}.value`,
      value: accVar,
    }});
    return steps;
  }

  // ── Trigger/date-gate OR block — copied from the source trackers ──
  // Bulk events (onLoad / NavigationOp) always run. Item-bearing events only
  // run when the trigger item's date matches the goal date — UNLESS the
  // tracker is timeFilter:"all", in which case the per-event SAME_DAY
  // sub-rules are dropped so a value change on any-dated record still
  // re-aggregates (lifetime totals have no date window).
  //
  // KNOWN LIMITATION — weekly trigger-gate date sub-rule:
  // For timeFilter:"weekly" the per-event trigger date sub-rule (emitted by
  // eventRule/measureRule below) is still SAME_DAY $goalDate (the ISO
  // week-start day), NOT SAME_WEEK. This means an item-bearing event
  // (MeasureOp/OccurrenceCreateOp) on a same-week-but-different-day item
  // will NOT itself retrigger the op (the SAME_DAY check fails for that day).
  // The loop body (which uses SAME_WEEK from buildLoopRules) is correct; and
  // onLoad/NavigationOp bulk triggers always re-run the full aggregation so
  // the value self-heals on every nav/load. Task 13 wires one weekly op —
  // acceptable because its bulk triggers cover it.
  function eventRule(triggerType) {
    const rules = [{ id: uid(), left: "$trigger.type", comparator: "IS", right: triggerType }];
    if (dateGated) {
      // DATE_IN_PERIOD broadens the per-event gate to the goal's full period
      // (weekly/monthly/yearly) so an in-period item change retriggers the
      // aggregation. Bare-string $goalPeriod still narrows to same-day.
      rules.push({ id: uid(), left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" });
    }
    return { id: uid(), operator: "AND", rules };
  }

  // onChange field targets: completedFieldId always, plus the source field(s)
  // when the agg reads a value (sum/last/multiSum/net/completionRate-not).
  const measureFieldIds = [];
  if (completedFieldId) measureFieldIds.push(completedFieldId);
  if (agg === "multiSum") {
    for (const fid of sourceFieldIds || []) measureFieldIds.push(fid);
  } else if (agg === "net") {
    if (incomeFieldId) measureFieldIds.push(incomeFieldId);
    if (spentFieldId) measureFieldIds.push(spentFieldId);
  } else if (agg === "sum" || agg === "last") {
    if (sourceFieldId) measureFieldIds.push(sourceFieldId);
  }
  const uniqMeasureFieldIds = [...new Set(measureFieldIds)];

  const measureRule = {
    id: uid(), operator: "AND",
    rules: [
      { id: uid(), left: "$trigger.type", comparator: "IS", right: "MeasureOp" },
      uniqMeasureFieldIds.length === 1
        ? { id: uid(), left: "$trigger.fieldId", comparator: "IS", right: uniqMeasureFieldIds[0] }
        : {
            id: uid(), operator: "OR",
            rules: uniqMeasureFieldIds.map((fid) => ({ id: uid(), left: "$trigger.fieldId", comparator: "IS", right: fid })),
          },
      ...(dateGated
        ? [{ id: uid(), left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" }]
        : []),
    ],
  };

  const triggerGateRules = [
    // Bulk events: always run. No trigger item to date-gate on.
    { id: uid(), left: "$trigger.type", comparator: "IS", right: "onLoad" },
    { id: uid(), left: "$trigger.type", comparator: "IS", right: "NavigationOp" },
    eventRule("OccurrenceCreateOp"),
    eventRule("OccurrenceDeleteOp"),
    measureRule,
  ];

  // ── $goalPeriod chain (only when date-gated) ──
  // $goalPeriod is the FULL filter-value object ({value, unit}) or a bare
  // YYYY-MM-DD string. DATE_IN_PERIOD reads both. Resolution order:
  // goal's _effectiveFilter → $trigger.date → $today. Bare-string $trigger.date
  // and $today both fold cleanly into DATE_IN_PERIOD as "day" unit.
  const goalDateSteps = dateGated ? [
    { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalPeriod", expr: `$goalItem._effectiveFilter.${dateFieldId}` } },
    {
      id: uid(), type: "if",
      condition: { operator: "AND", rules: [{ id: uid(), left: "$goalPeriod", comparator: "IS_EMPTY", right: "" }] },
      then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalPeriod", expr: "$trigger.date" } }],
      else: [],
    },
    {
      id: uid(), type: "if",
      condition: { operator: "AND", rules: [{ id: uid(), left: "$goalPeriod", comparator: "IS_EMPTY", right: "" }] },
      then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalPeriod", expr: "$today" } }],
      else: [],
    },
  ] : [];

  // onChange trigger objects — one per measured field.
  const onChangeTriggers = uniqMeasureFieldIds.map((fid) => (
    { eventType: "onChange", subjectType: "field", targetId: fid, priority: 3 }
  ));

  return {
    id: uid(), userId, gridId, name,
    ...(folderId ? { folderId } : {}),
    description: description || `${agg} aggregation into "${goalLabel}" scoped under the "${scopeLabel}" page${dateGated ? ` for the ${timeFilter} window the goal page is showing` : " (lifetime)"}.`,
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    // Per-trigger priority 3: runs AFTER seed (priority 2) on the same Daily
    // Goals filter change so newly-seeded occurrences are present in the live
    // overlay when this aggregates. onAdd/onDelete catch drag-into-scope and
    // item removal.
    triggerObjects: [
      ...onChangeTriggers,
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Daily Goals", priority: 3 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 3 },
    ],
    enabled: true,
    pipeline: {
      steps: [
        // Optional $displayRules — when authored at the call site,
        // prepended here so the executor's post-process step in
        // executePipeline can read it from $vars after the writes.
        ...(displayRules ? [{
          id: uid(),
          type: "action",
          config: { type: "INIT_VAR", name: "$displayRules", expr: `json:${JSON.stringify(displayRules)}` },
        }] : []),
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: accVar, value: 0 } },

        // The scope page is where the data lives — used for the HAS_ANCESTOR
        // scope so we only aggregate entries written into it.
        { id: uid(), type: "action", config: {
            type: "FIND",
            over: "$allPages",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "label", comparator: "IS", right: scopeLabel },
            ]},
            itemIdVar: "$scopePageId",
        }},

        // Locate the goal display item — the UPDATE target. $goalDate is
        // driven off its OWN _effectiveFilter (instance → goal container →
        // goal page → grid), NOT $parentFilter (which is anchored on the
        // trigger occurrence and would resolve to the wrong day).
        //
        // Two lookup modes:
        //   - goalOccurrenceId provided: direct picker-style binding. Single
        //     INIT_VAR resolves `$allItemsById.<id>` to the occurrence object
        //     via the executor's path resolver — rename-stable, no FIND
        //     needed. The id is the picker output committed at seed time;
        //     identical shape to what the CategoryPathPicker emits when an
        //     author drills into Occurrences > $allItemsById > <label>.
        //   - goalLabel only: legacy path, FIND by label across $allInstances.
        //     Used by the test grid + any goals whose label is globally unique.
        ...(goalOccurrenceId
          ? [
              // Set both $goalItem (the full record) and $goalId (its id) so
              // downstream steps that reference either still work.
              { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalItem", expr: `$allItemsById.${goalOccurrenceId}` } },
              { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalId",   expr: "$goalItem.id" } },
            ]
          : [
              { id: uid(), type: "action", config: {
                  type: "FIND",
                  over: "$allInstances",
                  predicate: { operator: "AND", rules: [
                    { id: uid(), left: "label", comparator: "IS", right: goalLabel },
                  ]},
                  itemIdVar: "$goalId",
                  itemVar: "$goalItem",
              }},
            ]
        ),

        ...goalDateSteps,

        {
          id: uid(), type: "if",
          condition: { operator: "OR", rules: triggerGateRules },
          then: buildAggregationBody(),
          else: [],
        },
      ],
    },
  };
}

export function makeClearDateOnMoveOutOp({ userId, gridId, dateFieldId, timeslotFieldId }) {
  return {
    id: uid(), userId, gridId, name: "Schedule: Clear Date on Move-Out",
    description:
      "When an occurrence is moved (not copied), check whether it still lives under the Schedule page. " +
      "If it has been moved out of the schedule, clear its date + timeslot fields. Copy creates a new " +
      "occurrence with a different ID, so this op naturally does not fire on copy.",
    triggerTypes: ["onMove"],
    // Per-trigger priority 2: field stamps run after auto-build (1).
    triggerObjects: [
      { eventType: "onMove", subjectType: "occurrence", targetId: "", priority: 2 },
    ],
    enabled: true,
    pipeline: {
      steps: [
        { id: uid(), type: "action", config: {
            type: "FIND",
            over: "$allPages",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "label", comparator: "IS", right: "Schedule" },
            ]},
            itemIdVar: "$schedPageId",
        }},
        // Bind the moved occurrence directly via its trigger id (no need to walk
        // every item) — record carries the enriched `_ancestors` chain.
        { id: uid(), type: "action", config: {
            type: "FIND",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "id", comparator: "IS", right: "$trigger.occurrenceId" },
            ]},
            itemVar: "$movedItem",
        }},
        // If the moved occurrence no longer lives under the Schedule page, clear
        // its schedule-only fields. Note: `value: null` (not "literal:null") —
        // the executor writes JS null directly.
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [
            { id: uid(), left: "$movedItem._ancestors", comparator: "NOT_HAS_ANCESTOR", right: "$schedPageId" },
          ]},
          then: [
            { id: uid(), type: "action", config: {
                type: "UPDATE",
                path: `$movedItem.fields.${dateFieldId}.value`,
                value: null,
            }},
            { id: uid(), type: "action", config: {
                type: "UPDATE",
                path: `$movedItem.fields.${timeslotFieldId}.value`,
                value: null,
            }},
          ],
          else: [],
        },
      ],
    },
  };
}
