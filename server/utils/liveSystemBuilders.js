// server/utils/liveSystemBuilders.js
// New-system seed builders shared by createTestGrid.js + createLiveData.js.
// buildGridDoc + buildScheduleFilters are pure (return plain objects, no DB writes).
// buildTemplatesManifest / buildDailyRoutineTemplate / buildDayPageTemplate accept
// injected Mongoose constructors + mkOcc and perform DB writes via those injections.

import { uid } from "./operationBuilders.js";
import { completionGateOrRule } from "./completionGate.js";

// The day-column's no-time bucket. This ONE constant is both the container's
// label and its Time Slot identity-marker value — the ops FIND it by the marker,
// so letting the two drift apart is a silent breakage (2026-07-30).
export const TODO_SLOT_LABEL = "Todo";

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
  completedFieldId, waterFieldId,
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

  // Day-container wrapper module + occurrence — sits between the page
  // root and the 48 slots. Schedule Template: Build APPLY_TEMPLATEs
  // this whole subtree into Library > Templates; the Day container
  // becomes the canonical "day-col template" that Schedule: Build
  // COPY_LINKs into the active Schedule page per-day.
  const tplDayModId = uid();
  const tplDayOccId = uid();
  await new Module({
    id: tplDayModId, userId, gridId,
    role: "container", kind: "board", label: "Day",
    meta: { templateModule: true, allowChildContainers: true },
  }).save();

  // Due container — holds tasks for the day with no specific time slot.
  // Lives as the FIRST child of the Day container, before the 48 timeslots.
  // Identity is field-based (timeslot="Due") — no schedule-specific meta
  // marker.
  const tplDueModId = uid();
  const tplDueOccId = uid();
  await new Module({
    id: tplDueModId, userId, gridId,
    role: "container", kind: "board", label: "Due",
    meta: { templateModule: true },
    fieldBindings: [{ fieldId: timeslotFieldId, role: "input", hidden: true, order: 0 }],
  }).save();
  await mkOcc({
    id: tplDueOccId,
    moduleId: tplDueModId,
    targetId: tplDueModId, targetType: "module",
    parentId: tplDayOccId,
    fields: {
      [timeslotFieldId]: { value: "Due", flow: "in" },
    },
    occurrences: [],
    identitySignature: "slot:Due",
  });

  // Build one slot container per timeslot, with nested routine instances
  const tplSlotOccIds = [];
  for (const slot of timeSlots) {
    const tplSlotModId = uid();
    const tplSlotOccId = uid();
    await new Module({
      id: tplSlotModId, userId, gridId,
      role: "container", kind: "board",
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
        role: "instance", label: r.label,
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
      parentId: tplDayOccId,
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

  // Day container occurrence — wraps Due + the 48 slots.
  // Due comes first so it visually anchors the top of each day-col.
  await mkOcc({
    id: tplDayOccId,
    moduleId: tplDayModId,
    targetId: tplDayModId, targetType: "module",
    parentId: tplRoutineRootOccId,
    occurrences: [tplDueOccId, ...tplSlotOccIds],
    meta: { templateModule: true },
    identitySignature: "day-container",
  });

  // Template root occurrence — parented to templates manifest root folder.
  // Contains exactly one child: the Day container.
  await mkOcc({
    id: tplRoutineRootOccId,
    moduleId: tplRoutineRootModId,
    targetId: tplRoutineRootModId, targetType: "module",
    parentId: tplManifestRootFolderId,
    occurrences: [tplDayOccId],
    meta: { templateName: "Daily Routine", templateModule: true },
  });

  return tplRoutineRootOccId;
}

// ── "Schedule Template" PAGE in Library > Templates ───────────────────────────
// Live-data variant of the Daily Routine template. Same Day-container subtree
// (Due + 48 slots + per-slot routine instances), but parented as a real PAGE
// under Library > Templates so the user can open + edit it directly. The
// "Schedule: Build Schedule" op COPY_LINKs the Day container into the active
// Schedule page per visible day in the active period — instances live HERE
// canonically; day-cols are linked views.
//
// Returns { schedTplPageOccId, dayContainerOccId } so the seed can pass the
// Day container's id straight into the op via picker-direct binding.
export async function buildScheduleTemplatePage({
  userId, gridId, timeSlots, timeslotFieldId, routineBySlot,
  libraryTemplatesFolderId, mkOcc, Module, findModule,
  completedFieldId, waterFieldId,
  scheduleFormatFieldId = null,
}) {
  const schedTplPageModId = uid();
  await new Module({
    id: schedTplPageModId, userId, gridId,
    role: "page", kind: "board", label: "Schedule Template",
  }).save();

  const schedTplPageOccId = uid();
  const dayContainerModId = uid();
  const dayContainerOccId = uid();
  await new Module({
    id: dayContainerModId, userId, gridId,
    role: "container", kind: "board", label: "Day",
    meta: { allowChildContainers: true },
  }).save();

  // Due container (first child of Day). Field-based identity via timeslot="Due".
  const tplDueModId = uid();
  const tplDueOccId = uid();
  await new Module({
    id: tplDueModId, userId, gridId,
    role: "container", kind: "board", label: "Due",
    fieldBindings: [{ fieldId: timeslotFieldId, role: "input", hidden: true, order: 0 }],
  }).save();
  await mkOcc({
    id: tplDueOccId,
    moduleId: tplDueModId,
    targetId: tplDueModId, targetType: "module",
    parentId: dayContainerOccId,
    fields: { [timeslotFieldId]: { value: "Due", flow: "in" } },
    occurrences: [],
    identitySignature: "slot:Due",
  });

  // "Todo" container — like Due, but the bucket for tasks with no time on them:
  // anything dropped on a day-column outside a slot, plus drops made in the
  // SUMMARIZED (>7-day) view, which has no timeslot grid. Hidden in summary;
  // shown as a slot in the full view so summary drops "pop up" here when you open
  // the full day (user 2026-07-19). Also the day page's Todo section — the page
  // multi-parents THIS occurrence rather than copying it.
  //
  // The LABEL and the Time Slot identity MARKER are one constant on purpose.
  // The marker is what Schedule: Build Schedule and Day Page: Build FIND by, so a
  // label that says one thing while the marker says another is a silent trap —
  // exactly the drift that cost three repair passes on 2026-07-30.
  const tplNoSlotModId = uid();
  const tplNoSlotOccId = uid();
  await new Module({
    id: tplNoSlotModId, userId, gridId,
    role: "container", kind: "board", label: TODO_SLOT_LABEL,
    fieldBindings: [{ fieldId: timeslotFieldId, role: "input", hidden: true, order: 0 }],
  }).save();
  await mkOcc({
    id: tplNoSlotOccId,
    moduleId: tplNoSlotModId,
    targetId: tplNoSlotModId, targetType: "module",
    parentId: dayContainerOccId,
    fields: { [timeslotFieldId]: { value: TODO_SLOT_LABEL, flow: "in" } },
    occurrences: [],
    identitySignature: `slot:${TODO_SLOT_LABEL}`,
  });

  // 48 slot containers + per-slot routine instances.
  const tplSlotOccIds = [];
  for (const slot of timeSlots) {
    const tplSlotModId = uid();
    const tplSlotOccId = uid();
    await new Module({
      id: tplSlotModId, userId, gridId,
      role: "container", kind: "board",
      label: slot.label,
      meta: {
        slotHour: slot.hour,
        slotMinute: slot.minute,
        slotLabel: slot.label,
      },
      fieldBindings: scheduleFormatFieldId
        ? [{ fieldId: scheduleFormatFieldId, role: "input", hidden: true, order: 0 }]
        : [],
    }).save();

    const routineInsts = routineBySlot[slot.label] || [];
    const slotChildOccIds = [];
    for (const r of routineInsts) {
      const tplInstModId = uid();
      const tplInstOccId = uid();
      const srcMod = await findModule({ id: r.sourceModId, gridId });
      await new Module({
        id: tplInstModId, userId, gridId,
        role: "instance", label: r.label,
        defaultDragMode: "copy",
        fieldBindings: srcMod?.fieldBindings || [],
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
      parentId: dayContainerOccId,
      fields: {
        [timeslotFieldId]: { value: slot.label, flow: "in" },
        ...(scheduleFormatFieldId ? { [scheduleFormatFieldId]: { value: "slot", flow: "in" } } : {}),
      },
      occurrences: slotChildOccIds,
      meta: { slotLabel: slot.label },
      identitySignature: `slot:${slot.label}`,
    });
    tplSlotOccIds.push(tplSlotOccId);
  }

  // Day container — wraps Due + the 48 slots.
  await mkOcc({
    id: dayContainerOccId,
    moduleId: dayContainerModId,
    targetId: dayContainerModId, targetType: "module",
    parentId: schedTplPageOccId,
    occurrences: [tplDueOccId, tplNoSlotOccId, ...tplSlotOccIds],
    identitySignature: "day-container",
  });

  // Page root — parented to Library > Templates folder.
  await mkOcc({
    id: schedTplPageOccId,
    moduleId: schedTplPageModId,
    targetId: schedTplPageModId, targetType: "module",
    parentId: libraryTemplatesFolderId,
    sortOrder: 0,
    occurrences: [dayContainerOccId],
    iteration: { mode: "persistent" },
    fields: {},
    filterOverride: {},
    filterNavConfig: { filter_daily: { visible: false } },
  });

  return { schedTplPageOccId, dayContainerOccId };
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
  // The template root is a day COLUMN, not a page (user 2026-07-31: "make
  // daypage work like the schedule, with containers being the days — these
  // would be doccontainers with other containers inside of it"). One "Day Page"
  // BOARD page holds the columns, exactly as the Schedule page holds its
  // day-cols, so:
  //   * a period of several days renders side by side instead of one page per
  //     day plus a hub tab per day (which had been accumulating),
  //   * the column carries the Date field, so it answers the filter cascade the
  //     same way a schedule day-col does,
  //   * nothing has to be pinned per day — the page is pinned once.
  const tplDayPageRootModId = uid();
  await new Module({
    id: tplDayPageRootModId, userId, gridId,
    role: "container", kind: "doc", label: "Day Page",
    fieldBindings: dateFieldId
      ? [{ fieldId: dateFieldId, role: "input", hidden: true, order: 0 }]
      : [],
    // The column IS the day's H1 — its header carries the date, so the template
    // no longer holds a heading textblock repeating it underneath.
    meta: { templateModule: true, headingLevel: 1 },
  }).save();

  // NO heading textblock. It rendered "Day Page - {Date}" directly under a
  // column header already reading "Day Page - <date>" — the same string twice
  // (2026-07-31). The column IS the day's heading; its label carries the date
  // and its meta.headingLevel makes it the H1.

  // Tasks Completed container — kind:doc so its body is a TipTap editor that
  // "Day Page: Build Tasks Completed" (separate op, pending) can write a
  // sorted-by-timeslot list into. Label "Tasks Completed" renders as the
  // embedded-container H2-ish header (Container.jsx embedded mode already
  // styles the label as a 20px/700 mono heading, matching `##`).
  // BOARD, not doc — it holds that day's completed tasks as real rows, the
  // same way the Todo section does (user 2026-07-31: "tasks completed in the
  // daypage should be like the todo container … it says click to edit instead
  // of add new item"). A doc body could only ever hold a rendering of them.
  // The build op links the tasks as CHILDREN now, so this container has no
  // textmap to keep in step.
  const tplTasksCompletedContModId = uid();
  await new Module({
    id: tplTasksCompletedContModId, userId, gridId,
    role: "container", kind: "board", label: "Tasks Completed",
    meta: { templateModule: true, headingLevel: 2 },
  }).save();

  // The free-writing sections. Same shape as Tasks Completed — a kind:doc
  // container whose LABEL is the `##` header and whose body is an open editor —
  // but nothing writes into them: the user does. They carry NO field bindings
  // on purpose. The occurrence is minted fresh per day, so its `textmap` is
  // already per-day; binding a field would only matter if the text had to sync
  // with some OTHER occurrence (the reason Daily Answer binds one), and these
  // have nothing to sync with.
  const WRITING_SECTIONS = ["Journal", "Notes", "Highlights"];
  const tplWritingSections = [];
  for (const label of WRITING_SECTIONS) {
    const modId = uid();
    await new Module({
      id: modId, userId, gridId,
      role: "container", kind: "doc", label,
      meta: {
        templateModule: true,
        headingLevel: 2,
        // Journal HOLDS the Daily Question section. A container renders child
        // CONTAINERS only when it carries this flag — without it the nested
        // question would vanish while sitting perfectly well in the data
        // (the 2026-07-31 "you got rid of my trackers" lesson).
        ...(label === "Journal" ? { allowChildContainers: true } : {}),
      },
    }).save();
    tplWritingSections.push({ label, modId, occId: uid() });
  }
  const sectionOcc = (label) => tplWritingSections.find(s => s.label === label);

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
  let tplDailyQOuterModId = null;
  let tplDailyQOuterOccId = null;

  if (wantsDailyQuestion) {
    tplDailyQContModId = uid();
    tplDailyQContOccId = uid();
    tplDailyQTextblockModId = uid();
    tplDailyQTextblockOccId = uid();

    // TWO containers, not one (user 2026-07-31: "put the daily question in a
    // daily question container with the actual question being a container
    // inside of it"). The OUTER one is the section — a plain "Daily Question"
    // heading like Journal or Notes. The INNER one is the question itself: its
    // header is the bound picker, so the selected question reads as the
    // heading and the field name sits small beside it in the binding badge.
    // Splitting them is what stops the section header from BEING a whole
    // sentence, which marquee-scrolled its own empty space.
    tplDailyQOuterModId = uid();
    tplDailyQOuterOccId = uid();
    await new Module({
      id: tplDailyQOuterModId, userId, gridId,
      role: "container", kind: "doc", label: "Daily Question",
      // ### — it sits INSIDE Journal (##), so it is a level deeper.
      // labelOverflow "marquee": a bound header truncates by default (a control
      // is not prose, 2026-07-31), but the QUESTION is prose — the whole point
      // is reading it, and it rarely fits a column. So this one scrolls.
      meta: { templateModule: true, headingLevel: 3, labelOverflow: "marquee" },
    }).save();

    await new Module({
      id: tplDailyQContModId, userId, gridId,
      // No label: the header renders the SELECTED QUESTION (BoundHeader's
      // picker). A label here would print beside the question — the exact
      // duplication the user flagged.
      role: "container", kind: "doc", label: "",
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
  const tplTasksCompletedContOccId = uid();

  await mkOcc({
    id: tplTasksCompletedContOccId,
    moduleId: tplTasksCompletedContModId,
    targetId: tplTasksCompletedContModId, targetType: "module",
    parentId: tplDayPageRootOccId,
    identitySignature: "daypage:Tasks Completed",
    // Empty placeholder paragraph — the seeding op rewrites this on each
    // Day Page: Build run with the schedule tasks for that day.
    textmap: { type: "doc", content: [{ type: "paragraph" }] },
    occurrences: [],
  });

  for (const s of tplWritingSections) {
    await mkOcc({
      id: s.occId,
      moduleId: s.modId,
      targetId: s.modId, targetType: "module",
      parentId: tplDayPageRootOccId,
      identitySignature: `daypage:${s.label}`,
      // Blank body — this is where the user writes.
      textmap: { type: "doc", content: [{ type: "paragraph" }] },
      occurrences: [],
    });
  }

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
      // Signed for the same reason as its parent below: merge recurses into a
      // matched node, and anything unsigned inside it gets cloned again.
      identitySignature: "daypage:Daily Question/answer",
      // Blank doc — the bound body editor will populate from
      // fields[journalAnswer] via BoundBody at render time.
      textmap: { type: "doc", content: [{ type: "paragraph" }] },
      occurrences: [],
    });

    await mkOcc({
      id: tplDailyQContOccId,
      moduleId: tplDailyQContModId,
      targetId: tplDailyQContModId, targetType: "module",
      parentId: tplDailyQOuterOccId,
      // MUST be signed. A signature on the SECTION alone only stops the section
      // being re-cloned — merge then recurses INTO it, finds this child
      // unsigned, and clones a second question wrapper. Every load added one:
      // today's column had collected 23 before this was caught (2026-07-31).
      identitySignature: "daypage:Daily Question/question",
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

    // The section wrapper: "Daily Question" heading, question container inside.
    await mkOcc({
      id: tplDailyQOuterOccId,
      moduleId: tplDailyQOuterModId,
      targetId: tplDailyQOuterModId, targetType: "module",
      parentId: sectionOcc("Journal").occId,
      identitySignature: "daypage:Daily Question",
      textmap: {
        type: "doc",
        content: [{ type: "moduleEmbed", attrs: { occurrenceId: tplDailyQContOccId } }],
      },
      occurrences: [tplDailyQContOccId],
    });
  }

  // Page order, top to bottom: prompt → plan → write → capture → review.
  // The TODO section is absent here on purpose — it is not a section the
  // template owns. It is that day's own Todo container from the Schedule's
  // day-column, multi-parented in by Day Page: Build (which inserts it right
  // after the Daily Question), so checking an item off here and on the Schedule
  // are the same write on one occurrence.
  const dayPageOccurrencesList = [
    // Daily Question is NOT listed here — it lives inside Journal now
    // (user 2026-08-01), so the column lists Journal and Journal lists it.
    sectionOcc("Journal").occId,
    sectionOcc("Notes").occId,
    tplTasksCompletedContOccId,
    sectionOcc("Highlights").occId,
  ];

  const embed = (occId) => ({ type: "moduleEmbed", attrs: { occurrenceId: occId } });
  const dayPageTextmapContent = [
    embed(sectionOcc("Journal").occId),
    embed(sectionOcc("Notes").occId),
    embed(tplTasksCompletedContOccId),
    embed(sectionOcc("Highlights").occId),
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
      role: "container", kind: "board", label: col.label,
      styleMode: "own", ownStyle: { bg: col.bg },
      meta: { templateModule: true },
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
      // identitySignature is a TOP-LEVEL field on the OCCURRENCE (schema,
      // 2026-05-14). It used to be written into the MODULE's meta here, where
      // merge never reads it — so re-applying this template duplicated all six
      // columns. Caught by the `unsigned-template-node` integrity check.
      identitySignature: `kanbanCol:${col.key}`,
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
    identitySignature: "project:Kanban",
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
    identitySignature: "project:Project Scope",
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
                    kind: "board",
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
export function makeScheduleBuildScheduleOp({ userId, gridId, dateFieldId, dueFieldId, timeslotFieldId, scheduleFormatFieldId = null, completedTrackerName = "Tracker: Tasks Completed", waterTrackerName = "Tracker: Water Today", goalsPageOccId, schedulePageOccId, dayContainerOccId }) {
  if (!schedulePageOccId) throw new Error("makeScheduleBuildScheduleOp: schedulePageOccId required (picker-direct ancestor + page ref)");
  if (!goalsPageOccId)    throw new Error("makeScheduleBuildScheduleOp: goalsPageOccId required (picker-direct ancestor)");
  if (!dayContainerOccId) throw new Error("makeScheduleBuildScheduleOp: dayContainerOccId required (Day container occurrence id from the seeded Schedule Template page)");
  if (!scheduleFormatFieldId) throw new Error("makeScheduleBuildScheduleOp: scheduleFormatFieldId required (used to tag day-col containers)");
  return {
    id: uid(), userId, gridId, name: "Schedule: Build Schedule",
    description: "For each visible day in the active filter period, COPY_LINK the Day container from the Schedule Template into the Schedule page as a date-stamped day-col. Idempotent. Day-cols outside the period are deleted; the template + its instances persist.",
    // Resolve the built-in date vars ($activeDate / $activePeriod /
    // $activePeriodDates) from the SCHEDULE PAGE's effective filter cascade
    // (page filterOverride → grid) — the same cascade every other schedule op
    // already reads in-pipeline ($schedPage._effectiveFilter). Without this the
    // built-ins fall back to the GRID filter only, so an on-page date switch
    // (which writes the page's filterOverride, not the grid) left the period
    // stale and the schedule rebuilt for the old day. Now grid and page filter
    // switches resolve uniformly through one cascade.
    targetOccurrenceId: schedulePageOccId,
    triggerTypes: ["onLoad", "onFilterChange"],
    triggerObjects: [
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 1 },
      { eventType: "onFilterChange", subjectType: "grid",      targetId: "", priority: 1 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", priority: 1 },
    ],
    enabled: true,
    pipeline: {
      steps: [
        // Picker-direct refs — seed-time IDs, rename-stable.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPage",   expr: `$allItemsById.${schedulePageOccId}` } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPageId", expr: "$schedPage.id" } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalsPage",   expr: `$allItemsById.${goalsPageOccId}` } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$dayCont",     expr: `$allItemsById.${dayContainerOccId}` } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$dayContId",   expr: "$dayCont.id" } },

        // Source-only guard: fire ONCE per filter change. Lets through
        //   (a) grid-subject triggers — no sourceOccurrenceId — toolbar +
        //       onLoad
        //   (b) the Schedule/Goals page's OWN filter change — sourceOccurrenceId
        //       matches one of the seeded pages
        // Does NOT pass descendant-cascade NavigationOps (where source is a
        // day-col / slot / instance). `updateOccurrenceFilterOverride` fires
        // one NavigationOp per inheriting descendant; without this tightening
        // every descendant would re-fire the build (50+ no-op runs per click
        // that still re-emit UPDATE_ITEM_META / RUN_OPERATION tails, choking
        // the createQueue).
        { id: uid(), type: "if",
          condition: { operator: "OR", rules: [
            { id: uid(), left: "$trigger.sourceOccurrenceId", comparator: "IS_EMPTY", right: "" },
            { id: uid(), left: "$trigger.sourceOccurrenceId", comparator: "IS",       right: "$schedPage.id" },
            { id: uid(), left: "$trigger.sourceOccurrenceId", comparator: "IS",       right: "$goalsPage.id" },
          ]},
          then: [
            { id: uid(), type: "if",
              condition: { operator: "AND", rules: [
                { id: uid(), left: "$schedPageId", comparator: "IS_NOT_EMPTY", right: "" },
                { id: uid(), left: "$dayContId",   comparator: "IS_NOT_EMPTY", right: "" },
              ]},
              then: [
                // ── PHASE A: per-day hybrid build of the day-col ──────────────
                // Each active day gets one day-col under the Schedule page,
                // built bottom-up:
                //   1. Fresh day-col container (CREATE) — fresh module so
                //      its label can be date-stamped ("Schedule - <date>")
                //      without affecting the template.
                //   2. For each direct child of the template's Day container
                //      (Due + 48 slot containers) — shallow COPY_LINK into
                //      the day-col. The slot's MODULE is shared with the
                //      template so editing the template's "6:00am" slot's
                //      label updates every day-col. linkedGroupId pairs the
                //      slot copies for cross-day field/textmap sync.
                //   3. For each routine instance in the template slot —
                //      COPY_LINK with `linked: false` (no linkedGroupId)
                //      and `recursive: false` (leaf), parented into the
                //      day-col's slot copy, with date stamped. Result:
                //      shared instance MODULE (edit "Drink Water" → all
                //      days update) but per-day independent OCCURRENCES
                //      (completion is per-day).
                // Idempotent via the day-col FIND at the top of the loop.
                {
                  id: uid(), type: "loop", overExpr: "$activePeriodDates", as: "$day",
                  body: [
                    { id: uid(), type: "action", config: {
                        type: "FIND", over: "$allContainers",
                        predicate: { operator: "AND", rules: [
                          { id: uid(), left: "_ancestors",                            comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                          { id: uid(), left: `fields.${scheduleFormatFieldId}.value`, comparator: "IS",           right: "day-col" },
                          { id: uid(), left: `fields.${dateFieldId}.value`,           comparator: "SAME_DAY",     right: "$day" },
                        ]},
                        itemIdVar: "$dayColId",
                    }},
                    // 1. Ensure the day-col container exists (idempotent —
                    //    CREATE only runs when FIND came back empty).
                    {
                      id: uid(), type: "if",
                      condition: { operator: "AND", rules: [{ id: uid(), left: "$dayColId", comparator: "IS_EMPTY", right: "" }] },
                      then: [{ id: uid(), type: "action", config: {
                          type: "CREATE",
                          name: "Schedule - ${dateLong:$day}",
                          role: "container", kind: "board",
                          meta: { allowChildContainers: true },
                          parent: "$schedPageId",
                          filterOverride: { [dateFieldId]: "$day" },
                          fields: {
                            [dateFieldId]: "$day",
                            [scheduleFormatFieldId]: "literal:day-col",
                          },
                          fieldHidden: {
                            [dateFieldId]: true,
                            [scheduleFormatFieldId]: true,
                          },
                          itemIdVar: "$dayColId",
                      }}],
                      else: [],
                    },
                    // 2. Per-slot population — runs ALWAYS, not just when
                    //    the day-col is fresh. The previous gate ("only
                    //    populate when day-col is empty") made the build
                    //    non-self-healing: if the user reloaded
                    //    mid-build, only the slots that had landed in
                    //    Mongo before the AbortController fired survived,
                    //    and the next reload's FIND saw the half-built
                    //    day-col, took the "skip" branch, and the
                    //    schedule stayed stuck at "Due only".
                    //
                    //    Now we walk every template Day child and FIRST
                    //    check whether a copy already exists under the
                    //    day-col (matched via linkedGroupId="lg-<tplId>",
                    //    which COPY_LINK derives deterministically from
                    //    the source id). If it exists, skip — that slot
                    //    is already populated. If missing, COPY_LINK +
                    //    APPLY_TEMPLATE the instances. Reloads now
                    //    self-heal a partial build with O(missing) work.
                    // TIMESLOT view (≤7 days) = full 48-slot day-col below;
                    // SUMMARIZED view (>7 days) = flat day-col (the day's tasks
                    // directly, no 48 slots) in the else. 30×48 = 1440 slot
                    // containers per month froze the app (user 2026-07-19).
                    {
                      id: uid(), type: "if",
                      condition: { operator: "AND", rules: [{ id: uid(), left: "$activePeriodCount", comparator: "LESS_OR_EQUAL", right: 7 }] },
                      then: [
                      // Convert a previously-SUMMARIZED day back to full. Delete only
                      // the ROUTINE flat clones (marked scheduleFormat="flat" by the
                      // summary build) — they get re-cloned into their timeslot slots
                      // below. USER DROPS (unmarked flat instances) are PRESERVED and
                      // re-homed into the Todo slot after the slots exist
                      // (user 2026-07-19: dropping in summary must persist to full).
                      { id: uid(), type: "action", config: { type: "SET_VAR", name: "$dcOcc", expr: "$allItemsById.${$dayColId}" }},
                      { id: uid(), type: "loop", overExpr: "$dcOcc.occurrences", as: "$dcKidId",
                        body: [
                          { id: uid(), type: "action", config: { type: "SET_VAR", name: "$dcKid", expr: "$allItemsById.${$dcKidId}" }},
                          { id: uid(), type: "if",
                            condition: { operator: "AND", rules: [
                              { id: uid(), left: "$dcKid.role", comparator: "IS", right: "instance" },
                              { id: uid(), left: `$dcKid.fields.${scheduleFormatFieldId}.value`, comparator: "IS", right: "flat" },
                            ]},
                            then: [{ id: uid(), type: "action", config: { type: "DELETE", itemIdExpr: "$dcKidId" } }],
                            else: [],
                          },
                        ],
                      },
                      {
                      id: uid(), type: "loop", overExpr: "$dayCont.occurrences", as: "$tplChildId",
                      body: [
                        { id: uid(), type: "action", config: {
                            type: "SET_VAR", name: "$tplChild",
                            expr: "$allItemsById.${$tplChildId}",
                        }},
                        // Idempotency check: does a copy of this template
                        // child already live under the day-col? COPY_LINK
                        // stamps `meta.copyLinkSource = <sourceId>` on
                        // every cloned occurrence, so the match is direct
                        // and discoverable — no need for the op author to
                        // know the `lg-<id>` linkedGroupId derivation rule.
                        { id: uid(), type: "action", config: {
                            type: "FIND", over: "$allContainers",
                            predicate: { operator: "AND", rules: [
                              { id: uid(), left: "meta.copyLinkSource", comparator: "IS", right: "$tplChildId" },
                              // parentId, NOT _ancestors. These copies are DIRECT
                              // children, and `_ancestors` is derived from the
                              // parent map — so the moment a copy gains a SECOND
                              // parent (the day page multi-parents the Todo
                              // container in), its ancestor chain can resolve
                              // through that other parent instead and this dedupe
                              // stops matching, re-minting a duplicate on every
                              // single load. parentId stays the day-column.
                              { id: uid(), left: "parentId", comparator: "IS", right: "$dayColId" },
                            ]},
                            itemIdVar: "$slotCopyId",
                        }},
                        // Only build this slot if it's not already there.
                        {
                          id: uid(), type: "if",
                          condition: { operator: "AND", rules: [{ id: uid(), left: "$slotCopyId", comparator: "IS_EMPTY", right: "" }] },
                          then: [
                            // 2a. Shallow COPY_LINK the slot/Due — shares
                            //     the template's module + linkedGroupId,
                            //     but its occurrences[] starts empty so we
                            //     can populate it with per-day instances.
                            { id: uid(), type: "action", config: {
                                type: "COPY_LINK",
                                sourceId: "$tplChildId",
                                parent: "$dayColId",
                                recursive: false,
                                itemIdVar: "$slotCopyId",
                            }},
                            // 2b. Per-instance: APPLY_TEMPLATE the template
                            //     instance into the slot copy. Deep clones
                            //     (fresh module + occurrence). defaultFields
                            //     stamps the date.
                            {
                              id: uid(), type: "loop", overExpr: "$tplChild.occurrences", as: "$tplInstId",
                              body: [{ id: uid(), type: "action", config: {
                                  type: "APPLY_TEMPLATE",
                                  templateRef: "$tplInstId",
                                  rootParent: "$slotCopyId",
                                  defaultFields: { [dateFieldId]: "$day" },
                              }}],
                            },
                          ],
                          else: [],
                        },
                      ],
                    },
                    // Re-home surviving USER DROPS (unmarked flat instances still
                    // directly under the day-col) into the Todo slot now
                    // that the slots exist — a task dropped in summary view shows up
                    // under Todo when you open the full day (user 2026-07-19).
                    { id: uid(), type: "action", config: {
                        type: "FIND", over: "$allContainers",
                        predicate: { operator: "AND", rules: [
                          { id: uid(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$dayColId" },
                          { id: uid(), left: `fields.${timeslotFieldId}.value`, comparator: "IS", right: TODO_SLOT_LABEL },
                        ]},
                        itemIdVar: "$noSlotId",
                    }},
                    { id: uid(), type: "if",
                      condition: { operator: "AND", rules: [{ id: uid(), left: "$noSlotId", comparator: "IS_NOT_EMPTY", right: "" }] },
                      then: [
                        { id: uid(), type: "action", config: { type: "SET_VAR", name: "$dcOcc2", expr: "$allItemsById.${$dayColId}" }},
                        { id: uid(), type: "loop", overExpr: "$dcOcc2.occurrences", as: "$dropId",
                          body: [
                            { id: uid(), type: "action", config: { type: "SET_VAR", name: "$dropKid", expr: "$allItemsById.${$dropId}" }},
                            { id: uid(), type: "if",
                              condition: { operator: "AND", rules: [
                                { id: uid(), left: "$dropKid.role", comparator: "IS", right: "instance" },
                                { id: uid(), left: `$dropKid.fields.${scheduleFormatFieldId}.value`, comparator: "IS_EMPTY", right: "" },
                              ]},
                              then: [{ id: uid(), type: "action", config: { type: "MOVE_OCCURRENCE", occurrenceIdExpr: "$dropId", toContainerIdExpr: "$noSlotId" } }],
                              else: [],
                            },
                          ],
                        },
                      ],
                      else: [],
                    }],
                      else: [
                        // PRESERVE user drops on the way DOWN to summary: flatten the
                        // Todo slot's tasks to directly under the day-col
                        // BEFORE the container teardown cascade-deletes that slot.
                        { id: uid(), type: "action", config: {
                            type: "FIND", over: "$allContainers",
                            predicate: { operator: "AND", rules: [
                              { id: uid(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$dayColId" },
                              { id: uid(), left: `fields.${timeslotFieldId}.value`, comparator: "IS", right: TODO_SLOT_LABEL },
                            ]},
                            itemIdVar: "$noSlotId",
                        }},
                        { id: uid(), type: "if",
                          condition: { operator: "AND", rules: [{ id: uid(), left: "$noSlotId", comparator: "IS_NOT_EMPTY", right: "" }] },
                          then: [
                            { id: uid(), type: "action", config: { type: "SET_VAR", name: "$noSlotOcc", expr: "$allItemsById.${$noSlotId}" }},
                            { id: uid(), type: "loop", overExpr: "$noSlotOcc.occurrences", as: "$ndId",
                              body: [
                                { id: uid(), type: "action", config: { type: "SET_VAR", name: "$ndKid", expr: "$allItemsById.${$ndId}" }},
                                { id: uid(), type: "if",
                                  condition: { operator: "AND", rules: [{ id: uid(), left: "$ndKid.role", comparator: "IS", right: "instance" }] },
                                  then: [{ id: uid(), type: "action", config: { type: "MOVE_OCCURRENCE", occurrenceIdExpr: "$ndId", toContainerIdExpr: "$dayColId" } }],
                                  else: [],
                                },
                              ],
                            },
                          ],
                          else: [],
                        },
                        // Convert a previously-FULL day (Due + 48 slot CONTAINERS)
                        // to summarized: delete the container children first (cascade
                        // removes their nested instances), then build flat below —
                        // else an already-full day would stay full (user 2026-07-19).
                        { id: uid(), type: "action", config: { type: "SET_VAR", name: "$dcOcc", expr: "$allItemsById.${$dayColId}" }},
                        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$hadFullContent", value: 0 }},
                        { id: uid(), type: "loop", overExpr: "$dcOcc.occurrences", as: "$dcKidId",
                          body: [
                            { id: uid(), type: "action", config: { type: "SET_VAR", name: "$dcKid", expr: "$allItemsById.${$dcKidId}" }},
                            { id: uid(), type: "if",
                              condition: { operator: "AND", rules: [{ id: uid(), left: "$dcKid.role", comparator: "IS", right: "container" }] },
                              then: [
                                // Flag the conversion: the executor's in-run overlay
                                // can't reflect these DELETEs, so the $flatChildId FIND
                                // below still sees the deleted instances. Without this
                                // flag the flat build is skipped and the day (the one
                                // that WAS full) renders EMPTY (user 2026-07-19).
                                { id: uid(), type: "action", config: { type: "SET_VAR", name: "$hadFullContent", expr: "literal:1" }},
                                { id: uid(), type: "action", config: { type: "DELETE", itemIdExpr: "$dcKidId" } },
                              ],
                              else: [],
                            },
                          ],
                        },
                        // SUMMARIZED (>7 days): the day's tasks FLAT under the
                        // day-col — NO 48 slot containers. Idempotent: build only
                        // when the day-col has no instances yet (fresh this run).
                        { id: uid(), type: "action", config: {
                            type: "FIND", over: "$allInstances",
                            predicate: { operator: "AND", rules: [
                              { id: uid(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$dayColId" },
                            ]},
                            itemIdVar: "$flatChildId",
                        }},
                        { id: uid(), type: "if",
                          condition: { operator: "OR", rules: [
                            { id: uid(), left: "$flatChildId", comparator: "IS_EMPTY", right: "" },
                            { id: uid(), left: "$hadFullContent", comparator: "GREATER", right: 0 },
                          ]},
                          then: [
                            { id: uid(), type: "loop", overExpr: "$dayCont.occurrences", as: "$sTplChildId",
                              body: [
                                { id: uid(), type: "action", config: { type: "SET_VAR", name: "$sTplChild", expr: "$allItemsById.${$sTplChildId}" }},
                                { id: uid(), type: "loop", overExpr: "$sTplChild.occurrences", as: "$sTplInstId",
                                  body: [{ id: uid(), type: "action", config: {
                                      type: "APPLY_TEMPLATE",
                                      templateRef: "$sTplInstId",
                                      rootParent: "$dayColId",
                                      // Mark as a routine flat clone so the full-view
                                      // teardown deletes it (re-cloned into slots)
                                      // while leaving user drops (unmarked) intact.
                                      defaultFields: { [dateFieldId]: "$day", [scheduleFormatFieldId]: "flat" },
                                  }}],
                                },
                              ],
                            },
                          ],
                          else: [],
                        },
                      ],
                    },
                  ],
                },

                // ── PHASE B: layout cascade ──────────────────────────────────
                // hideChildIds is empty — the template's Day container lives
                // in Library > Templates, not under Schedule, so nothing needs
                // hiding at the Schedule page level.
                { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$pageMode",    expr: "literal:stack" } },
                { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$pageColumns", value: 1 } },
                { id: uid(), type: "if",
                  condition: { operator: "AND", rules: [
                    { id: uid(), left: "$activePeriodCount", comparator: "GREATER",       right: 1 },
                    { id: uid(), left: "$activePeriodCount", comparator: "LESS_OR_EQUAL", right: 7 },
                  ]},
                  then: [{ id: uid(), type: "action", config: { type: "SET_VAR", name: "$pageMode", expr: "literal:flex-row" } }],
                  else: [],
                },
                { id: uid(), type: "if",
                  condition: { operator: "AND", rules: [{ id: uid(), left: "$activePeriodCount", comparator: "GREATER", right: 7 }] },
                  then: [
                    { id: uid(), type: "action", config: { type: "SET_VAR", name: "$pageMode",    expr: "literal:grid" } },
                    { id: uid(), type: "action", config: { type: "SET_VAR", name: "$pageColumns", value: 7 } },
                  ],
                  else: [],
                },
                { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPageOcc", expr: `$allItemsById.${schedulePageOccId}` } },
                { id: uid(), type: "action", config: {
                    type: "UPDATE",
                    path: "$schedPageOcc.meta.layoutCascadeOverride",
                    // sortChildrenByField pins the day-columns into chronological
                    // order by their date field regardless of the order they were
                    // appended to the page (selection order, idempotent re-adds).
                    // PageBoard consumes it generically. dateFieldId is a literal
                    // id (not a $-expr) so it passes through deepResolveExpr.
                    value: { mode: "$pageMode", columns: "$pageColumns", hideChildIds: "json:[]", sortChildrenByField: dateFieldId },
                }},

                // ── PHASE C: teardown out-of-period day-cols ─────────────────
                // Delete every container under Schedule tagged scheduleFormat="day-col"
                // whose date is NOT in the active period. The template (and its
                // routine instances) live elsewhere, so DELETE doesn't cascade
                // into shared structure.
                {
                  id: uid(), type: "loop", overExpr: "$allContainers", as: "$cont",
                  body: [{
                    id: uid(), type: "if",
                    condition: { operator: "AND", rules: [
                      { id: uid(), left: "$cont._ancestors",                                       comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                      { id: uid(), left: `$cont.fields.${scheduleFormatFieldId}.value`,            comparator: "IS",           right: "day-col" },
                    ]},
                    then: [{
                      id: uid(), type: "if",
                      condition: { operator: "AND", rules: [
                        { id: uid(), left: "$activePeriodDates", comparator: "ARRAY_INCLUDES", right: `$cont.fields.${dateFieldId}.value` },
                      ]},
                      then: [],
                      else: [{ id: uid(), type: "action", config: { type: "DELETE", itemIdExpr: "$cont.id" } }],
                    }],
                    else: [],
                  }],
                },

                // Tail: re-aggregate trackers so newly-built day-cols + their
                // linked routine instances tick goal totals immediately.
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
export function makeDayPageBuildOp({
  userId, gridId, dateFieldId, dayPageBoardOccId, goalsPageOccId, schedulePageOccId,
  dayPageTemplateOccId,
  // Todo-link context (optional — omit and the op skips the link pass entirely).
  timeslotFieldId = null, scheduleFormatFieldId = null, todoMarkerValue = "Todo",
}) {
  if (!schedulePageOccId) throw new Error("makeDayPageBuildOp: schedulePageOccId required (picker-direct ancestor + page ref)");
  if (!goalsPageOccId)    throw new Error("makeDayPageBuildOp: goalsPageOccId required (picker-direct ancestor)");
  if (!dayPageBoardOccId) throw new Error("makeDayPageBuildOp: dayPageBoardOccId required — the board page the day COLUMNS live on");
  if (!dayPageTemplateOccId) throw new Error("makeDayPageBuildOp: dayPageTemplateOccId required — resolving the template by meta.templateName matches the CLONES too (APPLY_TEMPLATE copies meta), and a multi-match FIND returns an ARRAY that APPLY_TEMPLATE cannot use");
  const wantsTodoLink = !!(timeslotFieldId && scheduleFormatFieldId);
  return {
    id: uid(), userId, gridId, name: "Day Page: Build",
    // The DAY PAGE's own filter drives the build, exactly as Build Schedule
    // keys off the Schedule page (user 2026-07-31: "the daypage should respond
    // to the filters like schedule"). $activePeriodDates therefore resolves
    // through this page's cascade, so an on-page date switch — which never
    // touches the grid filter — builds the days you are looking at.
    targetOccurrenceId: dayPageBoardOccId,
    description: "Build one day COLUMN per active date on the Day Page board, cloning the Day Page template into each and keeping existing columns topped up with any section the template has gained.",
    triggerTypes: ["onLoad", "onFilterChange"],
    triggerObjects: [
      // Priority 5, after Schedule: Build Schedule (1) — the Todo link reads the
      // day-column's children, so it has to run once those exist.
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 5 },
      { eventType: "onFilterChange", subjectType: "grid",      targetId: "", priority: 5 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", priority: 5 },
    ],
    enabled: true,
    pipeline: {
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPage",   expr: `$allItemsById.${schedulePageOccId}` }},
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPageId", expr: "$schedPage.id" }},
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalsPage",   expr: `$allItemsById.${goalsPageOccId}` }},
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$board",       expr: `$allItemsById.${dayPageBoardOccId}` }},
        // The template, bound picker-direct by id. This CANNOT go back to
        // `FIND meta.templateName IS "Day Page"`: APPLY_TEMPLATE copies meta
        // onto every clone, so that FIND matches the template AND every day it
        // ever built; a multi-match FIND returns an ARRAY, which APPLY_TEMPLATE
        // cannot resolve, and the op silently stops building.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$tpl",   expr: `$allItemsById.${dayPageTemplateOccId}` }},
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$tplId", expr: "$tpl.id" }},

        // Source-only guard — fires once per filter change. Descendant-cascade
        // NavigationOps are skipped.
        { id: uid(), type: "if",
          condition: { operator: "OR", rules: [
            { id: uid(), left: "$trigger.sourceOccurrenceId", comparator: "IS_EMPTY", right: "" },
            { id: uid(), left: "$trigger.sourceOccurrenceId", comparator: "IS",       right: "$schedPage.id" },
            { id: uid(), left: "$trigger.sourceOccurrenceId", comparator: "IS",       right: "$goalsPage.id" },
            { id: uid(), left: "$trigger.sourceOccurrenceId", comparator: "IS",       right: "$board.id" },
          ]},
          then: [
            { id: uid(), type: "if",
              condition: { operator: "AND", rules: [{ id: uid(), left: "$tplId", comparator: "IS_NOT_EMPTY", right: "" }] },
              then: [

        // ── one column per active date ──────────────────────────────────────
        // $activePeriodDates is the executor's normalized YYYY-MM-DD list for
        // the period — the same var Build Schedule loops. Never the raw filter
        // value: the picker persists a period OBJECT even for a single day, and
        // interpolating that yields "Day Page - [object Object]".
        { id: uid(), type: "loop", overExpr: "$activePeriodDates", as: "$day",
          body: [
            // Existing column for this date? Matched on the DATE FIELD, not on
            // a label — the label is the user's to rename.
            { id: uid(), type: "action", config: {
                type: "FIND",
                over: "$allContainers",
                predicate: { operator: "AND", rules: [
                  { id: uid(), left: "parentId", comparator: "IS", right: dayPageBoardOccId },
                  { id: uid(), left: `fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$day" },
                ]},
                itemIdVar: "$colId", itemVar: "$col",
            }},
            { id: uid(), type: "if",
              condition: { operator: "AND", rules: [{ id: uid(), left: "$colId", comparator: "IS_EMPTY", right: "" }] },
              then: [
                // Fresh column. rootParent makes APPLY_TEMPLATE mint a
                // standalone subtree under the board; replacements stamps the
                // date into the cloned heading; defaultFields puts the date on
                // every clone that BINDS it — the column itself (so it answers
                // the filter cascade) and the Daily Question pair (whose
                // header/body bindings JOIN on it).
                { id: uid(), type: "action", config: {
                    type: "APPLY_TEMPLATE",
                    templateRef: "$tplId",
                    rootParent: dayPageBoardOccId,
                    // "Friday, July 31st, 2026" — the day of the week reads first
                    // (user 2026-08-01). Same `dateLong:` token the Schedule's
                    // day-columns use, so both surfaces name a day identically.
                    // No "Day Page - " prefix: the board is already called that.
                    rootLabel: "${dateLong:$day}",
                    replacements: { "{Date}": "$day" },
                    rootIdVar: "$colId",
                    defaultFields: { [dateFieldId]: "$day" },
                }},
                { id: uid(), type: "action", config: { type: "ADD_CHILD", parentId: dayPageBoardOccId, childId: "$colId" } },
                // Re-bind the record now that it exists, so the steps below can
                // write through $col.
                { id: uid(), type: "action", config: {
                    type: "FIND", over: "$allContainers",
                    predicate: { operator: "AND", rules: [
                      { id: uid(), left: "id", comparator: "IS", right: "$colId" },
                    ]},
                    itemIdVar: "$colId2", itemVar: "$col",
                }},
              ],
              else: [
                // TOP UP an existing column: merge mode clones only the
                // sections the template has GAINED (matched on
                // identitySignature), leaving everything the user has written
                // untouched. This is what makes a template edit reach days that
                // already exist instead of only future ones.
                { id: uid(), type: "action", config: {
                    type: "APPLY_TEMPLATE",
                    templateRef: "$tplId",
                    targetOccurrenceVar: "$colId",
                    mode: "merge",
                    unwrapRoot: true,
                    replacements: { "{Date}": "$day" },
                    defaultFields: { [dateFieldId]: "$day" },
                }},
              ],
            },
            // Stamp the route BACK to the template, which is what lights up
            // "Save over Day Page" in the header dropdown — edit a day the way
            // you want it, then save it as the template.
            { id: uid(), type: "action", config: {
                type: "UPDATE", path: "$col.meta.appliedFromTemplateId", value: "$tplId",
            }},

            // ── that day's Todo, multi-parented in ──────────────────────────
            // NOT cloned: it IS the Schedule day-column's own catch-all
            // container, so ticking an item here and on the Schedule are one
            // write on one occurrence. Two copies would fork the state.
            ...(wantsTodoLink ? [
              { id: uid(), type: "action", config: {
                  type: "FIND", over: "$allContainers",
                  predicate: { operator: "AND", rules: [
                    { id: uid(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                    { id: uid(), left: `fields.${scheduleFormatFieldId}.value`, comparator: "IS", right: "day-col" },
                    { id: uid(), left: `fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$day" },
                  ]},
                  itemIdVar: "$dayColId",
              }},
              { id: uid(), type: "if",
                condition: { operator: "AND", rules: [{ id: uid(), left: "$dayColId", comparator: "IS_NOT_EMPTY", right: "" }] },
                then: [
                  // Found by its Time Slot IDENTITY MARKER, never by label. And
                  // by parentId, NOT _ancestors: this op multi-parents the Todo
                  // into the column, so an ancestor test would then resolve
                  // through the COLUMN and stop finding it — the op would saw
                  // off the branch it sits on.
                  { id: uid(), type: "action", config: {
                      type: "FIND", over: "$allContainers",
                      predicate: { operator: "AND", rules: [
                        { id: uid(), left: "parentId", comparator: "IS", right: "$dayColId" },
                        { id: uid(), left: `fields.${timeslotFieldId}.value`, comparator: "IS", right: todoMarkerValue },
                      ]},
                      itemIdVar: "$todoId",
                  }},
                  { id: uid(), type: "if",
                    condition: { operator: "AND", rules: [{ id: uid(), left: "$todoId", comparator: "IS_NOT_EMPTY", right: "" }] },
                    then: [
                      { id: uid(), type: "action", config: { type: "ADD_CHILD", parentId: "$colId", childId: "$todoId" } },
                    ],
                    else: [],
                  },
                ],
                else: [],
              },
            ] : []),

            // ── the column's body, rebuilt from ITS OWN CHILDREN ─────────────
            // Template-driven: the order is whatever the template produced (and
            // merge appends anything it later gains), so this op no longer owns
            // a hardcoded section list — the previous version did, which is why
            // a section added to the template was cloned but never rendered.
            //
            // Rewritten whole rather than spliced: the pipeline language has no
            // splice, and looping a nested path with `over` silently iterates
            // every occurrence on the grid (that once wrote 1278 occurrence
            // records into a live page's textmap). `overExpr` resolves the path
            // properly.
            { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$body", expr: "json:[]" } },
            // Pass 1 — the heading, then the Todo directly under it, so the
            // day opens with the question and the plan.
            { id: uid(), type: "loop", overExpr: "$col.occurrences", as: "$kidId",
              body: [
                { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$kid", expr: "$allItemsById.${$kidId}" } },
                { id: uid(), type: "if",
                  condition: { operator: "AND", rules: [
                    { id: uid(), left: "$kid.role", comparator: "IS", right: "textblock" },
                  ]},
                  then: [
                    { id: uid(), type: "action", config: {
                        type: "PUSH_TO_ARRAY", name: "$body",
                        value: { type: "instanceTextblock", attrs: { instanceId: "$kid.moduleId", occurrenceId: "$kidId" } },
                    }},
                  ],
                  else: [],
                },
              ],
            },
            // Pass 2 — every other child, in the template's order, with Todo
            // slotted in after the FIRST section. Counted rather than named:
            // the op must not know which section comes first (it is the Daily
            // Question today, and that is the template's business, not this
            // pipeline's).
            { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$secN", expr: "literal:0" } },
            { id: uid(), type: "loop", overExpr: "$col.occurrences", as: "$kidId2",
              body: [
                { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$kid2", expr: "$allItemsById.${$kidId2}" } },
                { id: uid(), type: "if",
                  condition: { operator: "AND", rules: [
                    { id: uid(), left: "$kid2.role", comparator: "IS_NOT", right: "textblock" },
                    ...(wantsTodoLink ? [{ id: uid(), left: "$kidId2", comparator: "IS_NOT", right: "$todoId" }] : []),
                  ]},
                  then: [
                    { id: uid(), type: "action", config: {
                        type: "PUSH_TO_ARRAY", name: "$body",
                        value: { type: "moduleEmbed", attrs: { occurrenceId: "$kidId2" } },
                    }},
                    { id: uid(), type: "action", config: { type: "INCREMENT_VAR", name: "$secN", by: 1 } },
                    ...(wantsTodoLink ? [{
                      id: uid(), type: "if",
                      condition: { operator: "AND", rules: [
                        { id: uid(), left: "$secN",   comparator: "IS",           right: 1 },
                        { id: uid(), left: "$todoId", comparator: "IS_NOT_EMPTY", right: "" },
                      ]},
                      then: [
                        { id: uid(), type: "action", config: {
                            type: "PUSH_TO_ARRAY", name: "$body",
                            value: { type: "moduleEmbed", attrs: { occurrenceId: "$todoId" } },
                        }},
                      ],
                      else: [],
                    }] : []),
                  ],
                  else: [],
                },
              ],
            },
            { id: uid(), type: "action", config: {
                type: "UPDATE", path: "$col.textmap",
                value: { type: "doc", content: "$body" },
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

export function makeStampDateTimeSlotOp({ userId, gridId, timeslotFieldId, hubPanelModuleId, lastSeenFieldId = null, dateFieldId = null, scheduleFormatFieldId = null }) {
  const steps = [
    // Bind $item to the freshly-created occurrence so UPDATE paths resolve.
    { id: uid(), type: "action", config: {
        type: "FIND",
        predicate: { operator: "AND", rules: [
          { id: uid(), left: "id", comparator: "IS", right: "$trigger.occurrenceId" },
        ]},
        itemVar: "$item",
    }},
  ];
  // Timeslot label — derives from the destination container's label, which the
  // OccurrenceCreateOp trigger carries as $trigger.containerLabel.
  //
  // GATED on the destination actually BEING a timeslot (2026-07-29, user: "in
  // workouts, time is set to schedule canvas and not a time"). Time Slot is a
  // select of the 48 generated slot labels, and this op used to write the
  // container's label unconditionally — so creating anything under the hub panel
  // that ISN'T a slot stamped a page/container NAME as the "time" ("Schedule
  // Canvas", "Schedule Table", "Due", "Todo"), and every history row that
  // reads the field showed it. The ELSE branch matters as much as the gate: a
  // COPY carries the source's fields, so a slotted item copied onto a canvas
  // would otherwise keep a slot it no longer sits in. Null = Due / no slot,
  // which is the field's own documented empty state.
  //
  // `scheduleFormat` is the data-driven discriminator already used by
  // makeAlarmOp and Pomodoro: Start — no label matching, no hardcoded names.
  // Optional: grids without the field (createTestGrid) keep the old
  // unconditional stamp, byte-identical.
  if (scheduleFormatFieldId) {
    steps.push(
      { id: uid(), type: "action", config: {
          type: "FIND",
          over: "$allOccurrences",
          predicate: { operator: "AND", rules: [
            { id: uid(), left: "id", comparator: "IS", right: "$trigger.containerId" },
          ]},
          itemVar: "$destContainer",
      }},
      {
        id: uid(), type: "if",
        condition: { operator: "AND", rules: [
          { id: uid(), left: `$destContainer.fields.${scheduleFormatFieldId}.value`, comparator: "IS", right: "slot" },
        ]},
        then: [
          { id: uid(), type: "action", config: {
              type: "UPDATE",
              path: `$item.fields.${timeslotFieldId}.value`,
              value: "$trigger.containerLabel",
          }},
        ],
        else: [
          { id: uid(), type: "action", config: {
              type: "UPDATE",
              path: `$item.fields.${timeslotFieldId}.value`,
              value: null,
          }},
        ],
      },
    );
  } else {
    steps.push({ id: uid(), type: "action", config: {
        type: "UPDATE",
        path: `$item.fields.${timeslotFieldId}.value`,
        value: "$trigger.containerLabel",
    }});
  }
  // Date stamp — resolves the destination's effective filter date via the
  // bound $item's _effectiveFilter (precomputed by executePipeline at
  // pipeline start), falling back to $today. Routes through UPDATE_ITEM_FIELD
  // so bindSocketToStore's auto-bind side-effect adds the date binding to
  // the source module the first time it's needed; subsequent drops are
  // idempotent no-ops. Lives here (vs. dropHandlers.computePageFilterFields)
  // so the stamping rule has a single architectural home.
  if (dateFieldId) {
    steps.push({
      id: uid(), type: "action", config: {
        type: "UPDATE",
        path: `$item.fields.${dateFieldId}.value`,
        value: `$item._effectiveFilter.${dateFieldId}`,
      },
    });
  }
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
  // Caller-supplied EXTRA gate rules, ANDed into every value loop's predicate
  // (2026-07-25). Generic: the caller passes fully-formed rules referencing
  // `$item`, so a tracker can narrow to a specific pick without the builder
  // knowing anything about what the field means. Used by Water, which only
  // counts a Drink whose Beverage pick IS the "Water" option.
  matchRules = [],
  // How much ONE counted item contributes (count / countTrue only). Default 1 =
  // a plain tally. Sleep passes 30: a slot IS 30 minutes, so "how many
  // half-hour Sleep slots did you complete" IS the minutes slept, with no
  // Duration field to fill in (user 2026-07-30).
  perItem = 1,
  agg, flow = "any", timeFilter = "daily", scopeLabel = "Schedule",
  // Picker-direct scope page — the occurrence id of the page the data lives
  // under (the Schedule page). When provided, $scopePageId is bound from this
  // literal id instead of a FIND-by-label over $allPages. Preferred: the seed
  // has the id at wiring time, so there's no label-collision risk and no
  // "the system knows what a 'Schedule' is" coupling. scopeLabel stays the
  // back-compat fallback for the test grid (which mints ops before it has
  // the page occ id handy).
  scopePageOccId,
  // When both are set, the loop predicate ALSO filters by
  // `$item.fields.<accountRefFieldId>.value IS <accountOccurrenceId>`
  // on top of the page-scope HAS_ANCESTOR rule. Used by per-account
  // balance trackers (Checking, Mom's, etc.) — a task must carry the
  // accountRef AND live under the scope page (2026-07-11: toolkit items
  // must not move balances until dragged into the Schedule).
  accountRefFieldId,
  accountOccurrenceId,
  description,
  // Optional data-driven discriminator: only count items that CARRY this
  // field (IS_NOT_EMPTY). The system has no hardcoded item-type concept —
  // "what counts" is defined purely by which fields an item carries (e.g.
  // Pomodoros Today gates on the pomodoroNumber field's presence so only
  // pomodoro-session items contribute).
  presenceFieldId,
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
  // Optional override for the loop's completion gate. Each agg has a
  // sensible default (sum/countTrue gate on Completed; multiSum/count don't),
  // but a caller can force it. Total Reps sets `true` so a workout's reps only
  // roll up once the user completes it (2026-07-09 — matches the per-muscle
  // Volume trackers + Steps/Water/Protein; an uncompleted set is intent).
  requireCompleted,
  // Honor `flow:"replace"` entries as balance RESETS (2026-07-11, agg "sum" /
  // "net" only): the latest completed in-scope item whose value field carries
  // flow:"replace" becomes the base — the accumulator starts from its value,
  // and only non-replace transactions dated the SAME DAY OR LATER add on top
  // (start-of-day semantic: "as of this date the balance IS X"). This is the
  // old {value, flow:"in"|"out"|"replace"} attribute made real for balances —
  // used by the seeded "Set Account Balance" task.
  supportsReplace,
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
  function buildLoopRules({ srcField, completionGate, includePresence, flowField, extraRules }) {
    const rules = [];
    // Presence: only meaningful for value-bearing aggregations on a real
    // source field (Water guards `IS_NOT_EMPTY` on the water field so empty
    // routine slots don't zero the sum).
    if (includePresence && srcField) {
      rules.push({ id: uid(), left: `$item.fields.${srcField}.value`, comparator: "IS_NOT_EMPTY", right: "" });
    }
    // Completion gate (user policy 2026-07-11): an item counts when it's
    // COMPLETE — and an item whose module never BINDS a Completed field counts
    // on scope membership alone. The discriminator is the BINDING
    // ($item._boundFieldIds), not the stored value: a bound-but-unchecked
    // Completed reads as empty, and empty must mean NOT done, never "counts".
    //   "policy" — the OR-form above (gates a different source field).
    //   "strict" — completed IS true only (completion IS the measured fact:
    //              countTrue / completionRate's done-count).
    if (completionGate === "policy" && completedFieldId) {
      rules.push(completionGateOrRule("$item", completedFieldId));
    } else if (completionGate === "strict" && completedFieldId) {
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
    // Scope — items must be under the named scope page (default "Schedule").
    // ALWAYS applies (user policy 2026-07-11: "it needs to be complete and in
    // the schedule for the trackers and goals to update from it" — a toolkit
    // item must not move an account balance until it's dragged into the
    // Schedule). accountRef, when set, is an ADDITIONAL condition narrowing
    // to items that point at this tracker's account occurrence.
    if (accountRefFieldId && accountOccurrenceId) {
      rules.push({ id: uid(), left: `$item.fields.${accountRefFieldId}.value`, comparator: "IS", right: accountOccurrenceId });
    }
    rules.push({ id: uid(), left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: "$scopePageId" });
    // Feed copies never aggregate — a feed (occurrence.feed) mints copy-linked
    // mirrors marked meta.feedSourceId; counting them would double-count the
    // source when a feed sits inside an aggregation scope.
    {
      rules.push({ id: uid(), left: "$item.meta.feedSourceId", comparator: "IS_EMPTY", right: "" });
    }
    // Flow direction filter (in/out aggregations like income vs expense).
    if (flowField && flow === "in") {
      rules.push({ id: uid(), left: `$item.fields.${flowField}.flow`, comparator: "IS", right: "in" });
    } else if (flowField && flow === "out") {
      rules.push({ id: uid(), left: `$item.fields.${flowField}.flow`, comparator: "IS", right: "out" });
    }
    // Presence discriminator (see presenceFieldId doc above) — no item-type
    // markers, just "does this item carry the field that defines the metric".
    if (presenceFieldId) {
      rules.push({ id: uid(), left: `$item.fields.${presenceFieldId}.value`, comparator: "IS_NOT_EMPTY", right: "" });
    }
    if (extraRules && extraRules.length) rules.push(...extraRules);
    if (matchRules && matchRules.length) rules.push(...matchRules);
    return rules;
  }

  // ── flow:"replace" support (see supportsReplace param doc) ──
  // Rules appended to every VALUE loop: skip replace entries themselves, and
  // only count transactions dated on/after the base reset (no base → all).
  function replaceGuardRules(valueField) {
    if (!supportsReplace) return [];
    return [
      { id: uid(), left: `$item.fields.${valueField}.flow`, comparator: "IS_NOT", right: "replace" },
      { id: uid(), operator: "OR", rules: [
        { id: uid(), left: "$baseDate", comparator: "IS_EMPTY", right: "" },
        { id: uid(), left: `$item.fields.${dateFieldId}.value`, comparator: "DATE_AFTER", right: "$baseDate" },
        { id: uid(), left: `$item.fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$baseDate" },
      ] },
    ];
  }

  // Base-scan steps: find the LATEST completed in-scope replace entry on
  // `replField` → $baseDate + seed the accumulator with its value. Emitted
  // BEFORE the value loops so their date guard reads a settled $baseDate.
  function buildReplaceBaseSteps(replField) {
    return [
      { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$baseDate", value: "" } },
      {
        id: uid(), type: "loop", overExpr: "$allItems", as: "$item",
        body: [{
          id: uid(), type: "if",
          condition: {
            operator: "AND",
            rules: [
              ...buildLoopRules({ srcField: replField, completionGate: "policy", includePresence: true }),
              { id: uid(), left: `$item.fields.${replField}.flow`, comparator: "IS", right: "replace" },
            ],
          },
          then: [{
            id: uid(), type: "if",
            condition: { operator: "OR", rules: [
              { id: uid(), left: "$baseDate", comparator: "IS_EMPTY", right: "" },
              { id: uid(), left: `$item.fields.${dateFieldId}.value`, comparator: "DATE_AFTER", right: "$baseDate" },
            ] },
            then: [
              { id: uid(), type: "action", config: { type: "SET_VAR", name: "$baseDate", expr: `$item.fields.${dateFieldId}.value` } },
              { id: uid(), type: "action", config: { type: "SET_VAR", name: accVar, expr: `$item.fields.${replField}.value` } },
            ],
            else: [],
          }],
          else: [],
        }],
      },
    ];
  }

  // ── Accumulator body for a single loop, given the agg ──
  // Value aggs (sum/multiSum/net) use completionGate:"policy"; count-of-completed
  // aggs (countTrue / completionRate's done-count) use "strict"; raw reads
  // (last / plain count / the total denominator) don't gate at all.
  // NOTE: The first param (e.g. "sum", "netIncome") is a human-readable label
  // for call-site self-documentation only. It is intentionally not consumed
  // inside the function body — do not wire it into step ids.
  function buildLoopFor(kind, opts = {}) {
    const {
      srcField,
      accumulator,            // array of action configs run in the inner `if` then
      completionGate,
      includePresence,
      flowField,
      extraRules,
    } = opts;
    return {
      id: uid(), type: "loop", overExpr: "$allItems", as: "$item",
      body: [{
        id: uid(), type: "if",
        condition: {
          operator: "AND",
          rules: buildLoopRules({ srcField, completionGate, includePresence, flowField, extraRules }),
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
      if (supportsReplace) steps.push(...buildReplaceBaseSteps(sourceFieldId));
      steps.push(buildLoopFor("sum", {
        srcField: sourceFieldId,
        completionGate: "policy",  // Water: sum where completed (or no Completed binding)
        includePresence: true,
        flowField: sourceFieldId,
        extraRules: replaceGuardRules(sourceFieldId),
        accumulator: [{ type: "ADD_TO_VAR", name: accVar, expr: `$item.fields.${sourceFieldId}.value` }],
      }));
    } else if (agg === "multiSum") {
      // One ADD_TO_VAR per source field. Raw roll-up by default; callers that
      // represent completion-based facts (Total Reps) pass requireCompleted.
      steps.push(buildLoopFor("multiSum", {
        completionGate: requireCompleted === true ? "policy" : false,
        includePresence: false,
        accumulator: (sourceFieldIds || []).map((fid) => ({
          type: "ADD_TO_VAR", name: accVar, expr: `$item.fields.${fid}.value`,
        })),
      }));
    } else if (agg === "count") {
      // Plain count — no completion gate (count of items in scope/date).
      steps.push(buildLoopFor("count", {
        completionGate: false,
        includePresence: false,
        accumulator: [{ type: "INCREMENT_VAR", name: accVar, by: perItem }],
      }));
    } else if (agg === "countTrue") {
      // Tasks: count(+1) where completed IS true — STRICT: completion is the
      // measured fact here, so an item without a Completed binding never counts.
      steps.push(buildLoopFor("countTrue", {
        completionGate: "strict",
        includePresence: false,
        accumulator: [{ type: "INCREMENT_VAR", name: accVar, by: perItem }],
      }));
    } else if (agg === "last") {
      // Raw read of the most-recent matching item's value (loop overwrites).
      steps.push(buildLoopFor("last", {
        srcField: sourceFieldId,
        completionGate: false,
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
      // The balance reset lives on the SPENT field (the seeded "Set Account
      // Balance" task binds accountRef + amount) — base scan reads it, and
      // both value loops guard against replace entries / pre-base dates.
      if (supportsReplace) steps.push(...buildReplaceBaseSteps(spentFieldId));
      // Both net loops gate on completion (2026-07-11): a transaction moves
      // the balance only once it's completed (or carries no Completed field).
      steps.push(buildLoopFor("netIncome", {
        srcField: incomeFieldId,
        completionGate: "policy",
        includePresence: true,
        extraRules: replaceGuardRules(incomeFieldId),
        accumulator: [{ type: "ADD_TO_VAR", name: accVar, expr: `$item.fields.${incomeFieldId}.value` }],
      }));
      steps.push(buildLoopFor("netSpent", {
        srcField: spentFieldId,
        completionGate: "policy",
        includePresence: true,
        extraRules: replaceGuardRules(spentFieldId),
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
        completionGate: "strict", // done-count: completion IS the measured fact
        includePresence: false,
        accumulator: [{ type: "INCREMENT_VAR", name: "$done", by: 1 }],
      }));
      steps.push(buildLoopFor("crTot", {
        completionGate: false,
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

  // MeasureOp now carries `fields: { [fid]: value }` (coalesced) and the
  // executor's matchSubjectFilter already drops MeasureOps that don't touch
  // any of this op's targeted fields — so the in-pipeline `$trigger.fieldId IS X`
  // gate is redundant. We keep only the date-gate when this tracker is
  // date-scoped (filters out MeasureOps from occurrences outside $goalPeriod).
  const measureRule = {
    id: uid(), operator: "AND",
    rules: [
      { id: uid(), left: "$trigger.type", comparator: "IS", right: "MeasureOp" },
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
      // Narrowed to ancestorLabel:"Schedule" — trackers aggregate over Schedule
      // tasks, so a container/instance add outside the Schedule subtree (e.g.
      // dropping a textblock into Notes) has no possible effect on the goal
      // total and shouldn't pay the per-op match + pipeline-setup cost.
      // Pairs with the executor's matchAncestorScope extension covering onAdd/onDelete.
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "container", targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "container", targetId: "", ancestorLabel: "Schedule", priority: 3 },
      // Instance-role pair: an ITEM dropped into / deleted from a Schedule
      // slot must re-aggregate too — the container pair alone only fires on
      // slot-container CRUD (2026-07-07 root cause of "trackers don't update
      // when I drop something onto the schedule").
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "instance",  targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "instance",  targetId: "", ancestorLabel: "Schedule", priority: 3 },
      // On-PAGE (Goals local nav) filter change. The GLOBAL (toolbar) filter change
      // is added uniformly to every filter-driven op by ensureGridFilterTrigger
      // (utils/gridFilterTrigger.js), so "the grid filter updates everything" —
      // Schedule, Goals, Accounts — is one rule, not a per-builder detail.
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Goals", priority: 3 },
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
        // scope so we only aggregate entries written into it. Picker-direct
        // (bind the id literal) when the caller passed the page occ id;
        // otherwise fall back to FIND-by-label (test grid).
        scopePageOccId
          ? { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$scopePageId", value: scopePageOccId } }
          : { id: uid(), type: "action", config: {
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

export function makeClearDateOnMoveOutOp({ userId, gridId, dateFieldId, timeslotFieldId, schedulePageOccId }) {
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
        // Picker-direct Schedule page (id literal) — no label check.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPageId", value: schedulePageOccId } },
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

// ── Alarm/reminder operation (server twin of client helpers/alarmOps.js) ─────
// An alarm IS an operation: `op.alarm` marks it Alarms-tab-managed, the
// atTimes schedule fires it daily via useScheduler, and the pipeline is one
// NOTIFY (sound for alarms, silent for reminders). Name/schedule/pipeline are
// DERIVED from the alarm config — same derivation the client applies on every
// Alarms-tab edit (applyAlarmToOperation), so seeded alarms can't drift.
function formatAlarmTime(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  if (!m) return String(hhmm || "");
  let h = Number(m[1]);
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m[2]} ${suffix}`;
}

// The alarm's time as a slot-style timeslot label ("17:00" → "5:00pm",
// "17:15" → "5:15pm"). `exactSlot` = only when the minute lands on a real
// half-hour slot (0/30), else null — used to MATCH an existing slot container.
function alarmTimeslotLabel(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  if (!m) return { label: null, exactSlot: null };
  const hour = Number(m[1]);
  const min = Number(m[2]);
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? "am" : "pm";
  const label = `${h}:${String(min).padStart(2, "0")}${ampm}`;
  return { label, exactSlot: (min === 0 || min === 30) ? label : null };
}

// When a `sched` context ({ dateFieldId, timeslotFieldId, scheduleFormatFieldId })
// is provided, an alarm firing also drops an instance into TODAY's Schedule (like
// Pomodoro: Start): resolve today's day-col, target the slot matching the alarm's
// timeslot (else the day-col itself), and create the alarm instance once per day —
// matching and de-duping on the TIMESLOT field (not the label), and stamping it on
// the created instance. MUST mirror the client's alarmScheduleSteps in helpers/alarmOps.js.
function alarmScheduleSteps({ sched, instanceLabel, time }) {
  if (!sched || !sched.dateFieldId || !sched.scheduleFormatFieldId
      || !sched.timeslotFieldId || !sched.pageOccurrenceId) return [];
  const df = sched.dateFieldId;
  const sf = sched.scheduleFormatFieldId;
  const tf = sched.timeslotFieldId;
  const { label: tsLabel, exactSlot } = alarmTimeslotLabel(time);
  if (!tsLabel) return [];
  return [
    { id: uid(), type: "action", config: { type: "FIND", over: "$allPages",
      predicate: { operator: "AND", rules: [
        { id: uid(), left: "id", comparator: "IS", right: sched.pageOccurrenceId },
      ] }, itemIdVar: "$alSchedPage" } },
    { id: uid(), type: "if",
      condition: { operator: "AND", rules: [{ id: uid(), left: "$alSchedPage", comparator: "IS_NOT_EMPTY", right: "" }] },
      then: [
        { id: uid(), type: "action", config: { type: "FIND", over: "$allContainers",
          predicate: { operator: "AND", rules: [
            { id: uid(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$alSchedPage" },
            { id: uid(), left: `fields.${sf}.value`, comparator: "IS", right: "day-col" },
            { id: uid(), left: `fields.${df}.value`, comparator: "SAME_DAY", right: "$today" },
          ] }, itemIdVar: "$alDayCol" } },
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$alDayCol", comparator: "IS_NOT_EMPTY", right: "" }] },
          then: [
            { id: uid(), type: "action", config: { type: "SET_VAR", name: "$alTarget", expr: "$alDayCol" } },
            ...(exactSlot ? [
              { id: uid(), type: "action", config: { type: "FIND", over: "$allContainers",
                predicate: { operator: "AND", rules: [
                  { id: uid(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$alDayCol" },
                  { id: uid(), left: `fields.${tf}.value`, comparator: "IS", right: exactSlot },
                ] }, itemIdVar: "$alSlot" } },
              { id: uid(), type: "if",
                condition: { operator: "AND", rules: [{ id: uid(), left: "$alSlot", comparator: "IS_NOT_EMPTY", right: "" }] },
                then: [{ id: uid(), type: "action", config: { type: "SET_VAR", name: "$alTarget", expr: "$alSlot" } }],
                else: [] },
            ] : []),
            // De-dupe on the timeslot FIELD (one alarm instance per timeslot per day).
            { id: uid(), type: "action", config: { type: "FIND", over: "$allInstances",
              predicate: { operator: "AND", rules: [
                { id: uid(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$alDayCol" },
                { id: uid(), left: `fields.${tf}.value`, comparator: "IS", right: tsLabel },
                { id: uid(), left: "label", comparator: "IS", right: instanceLabel },
              ] }, itemIdVar: "$alExisting" } },
            { id: uid(), type: "if",
              condition: { operator: "AND", rules: [{ id: uid(), left: "$alExisting", comparator: "IS_EMPTY", right: "" }] },
              then: [
                { id: uid(), type: "action", config: {
                  type: "CREATE", role: "instance", name: instanceLabel,
                  parent: "$alTarget", fields: { [df]: "$today", [tf]: tsLabel },
                  fieldHidden: { [df]: true, [tf]: true },
                } },
              ], else: [] },
          ], else: [] },
      ], else: [] },
  ];
}

export function makeAlarmOp({ userId, gridId, folderId, type = "alarm", label = "", time = "08:00", enabled = true, sched = null }) {
  const ring = type === "alarm";
  const instanceLabel = `${ring ? "⏰" : "🔔"} ${label || (ring ? "Alarm" : "Reminder")}`;
  return {
    id: uid(), userId, gridId, priority: 5,
    name: `${ring ? "Alarm" : "Reminder"}: ${label || formatAlarmTime(time)}`,
    description: "Managed by the Alarms tab — edit it there.",
    alarm: { type, label, time, ...(sched ? { sched } : {}) },
    triggerTypes: [],
    triggerObjects: [],
    triggerType: "manual",
    schedule: { kind: "atTimes", times: [time], suppressNotifications: false, lastFiredAt: null },
    pipeline: {
      sources: [],
      steps: [
        { id: uid(), type: "action", config: {
            type: "NOTIFY",
            message: `${ring ? "⏰" : "🔔"} ${label || (ring ? "Alarm" : "Reminder")} — ${formatAlarmTime(time)}`,
            sound: ring,
            duration: ring ? 60000 : 15000,
        }},
        ...alarmScheduleSteps({ sched, instanceLabel, time }),
      ],
    },
    folderId,
    enabled,
  };
}

// ─── makeMediaHistoryOp ──────────────────────────────────────────────────────
// The "what did I consume today" trackers — Movies Watched / Books Read /
// Podcasts Listened. All three were hand-written Operation literals with an
// IDENTICAL 19-node pipeline skeleton (verified by structural diff against the
// live grid 2026-07-29); they differed only in ids, loop-variable names, and
// one optional extra key on each pushed row. ~12KB of duplicated JSON, and the
// duplication is why three of them drifted apart in trigger surface over time.
//
// The pipeline: resolve the goal occurrence → bail if missing → resolve
// $goalPeriod from its effective filter → resolve the Schedule page → trigger
// gate (mirrors makeTrackerOp) → loop source instances in period under
// Schedule → inner-loop the pick array → resolve each picked occurrence →
// push a row + remember the last title → write rows + last title to the goal.
//
// Var names are PARAMETERS rather than derived, so this reproduces the three
// existing pipelines byte-for-byte and the extraction is provably a no-op.
// New callers should just pass a `varPrefix` and take the defaults.
export function makeMediaHistoryOp({
  uid, userId, gridId,
  name, description,
  goalOccurrenceId,          // the per-type occurrence under Media
  schedulePageOccId,
  sourceTemplateId,          // the action module whose occurrences carry the pick
  pickFieldId,               // array field holding picked occurrence ids
  rowsFieldId,               // display field receiving the row array
  lastTitleFieldId,          // display field receiving the most recent title
  triggerFieldId,            // field whose onChange retriggers this
  dateFieldId, timeslotFieldId,
  varPrefix = "item",
  instVar = `$${varPrefix}Inst`,
  pickVar = `$${varPrefix}OccId`,
  itemVar = `$${varPrefix}`,
  itemIdVar = `$${varPrefix}Id`,
  // Row extras, split by SLOT so the emitted key order matches each existing
  // op exactly (Movies: poster,label,…; Books: poster,label,pages,…). Key order
  // is semantically irrelevant, but keeping it lets the extraction be verified
  // by byte-diff rather than by argument.
  rowBeforeLabel = null,
  rowAfterLabel = null,
  ancestorLabel = "Trackers",
  priority = 3,
}) {
  const gate = (t) => ({ operator: "AND", rules: [
    { left: "$trigger.type", comparator: "IS", right: t },
    { left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
  ]});

  return {
    id: uid(), userId, gridId, priority,
    name, description,
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: triggerFieldId, priority },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "container", targetId: "", ancestorLabel: "Schedule", priority },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "container", targetId: "", ancestorLabel: "Schedule", priority },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "instance",  targetId: "", ancestorLabel: "Schedule", priority },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "instance",  targetId: "", ancestorLabel: "Schedule", priority },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel, priority },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority },
    ],
    pipeline: {
      sources: [],
      steps: [
        { type: "action", action: "INIT_VAR", cfg: { name: "$goalItem",   expr: `$allItemsById.${goalOccurrenceId}` } },
        { type: "action", action: "INIT_VAR", cfg: { name: "$goalItemId", expr: "$goalItem.id" } },
        {
          type: "if",
          condition: { conjunction: "AND", rules: [{ left: "$goalItemId", comparator: "IS_EMPTY", right: "" }] },
          then: [{ type: "action", action: "INIT_VAR", cfg: { name: "$earlyExit", expr: "true" } }],
          else: [],
        },
        {
          type: "action", action: "INIT_VAR",
          cfg: { name: "$goalPeriod", expr: `$goalItem._effectiveFilter.${dateFieldId}`, fallback: "$trigger.date", fallback2: "$today" },
        },
        { type: "action", action: "INIT_VAR", cfg: { name: "$schedPage",   expr: `$allItemsById.${schedulePageOccId}` } },
        { type: "action", action: "INIT_VAR", cfg: { name: "$schedPageId", expr: "$schedPage.id" } },
        {
          type: "if",
          condition: { operator: "OR", rules: [
            { operator: "AND", rules: [{ left: "$trigger.type", comparator: "IS", right: "onLoad" }] },
            { operator: "AND", rules: [{ left: "$trigger.type", comparator: "IS", right: "NavigationOp" }] },
            gate("OccurrenceCreateOp"), gate("OccurrenceDeleteOp"), gate("MeasureOp"),
          ]},
          then: [
            { type: "action", action: "INIT_VAR", cfg: { name: "$rows", value: [] } },
            { type: "action", action: "INIT_VAR", cfg: { name: "$lastTitle", value: "" } },
            {
              type: "loop", overExpr: "$allInstances", as: instVar,
              body: [{
                type: "if",
                condition: { conjunction: "AND", rules: [
                  { left: `${instVar}.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
                  { left: `${instVar}._ancestors`, comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                  { left: `${instVar}.meta.feedSourceId`, comparator: "IS_EMPTY", right: "" },
                  { left: `${instVar}.templateId`, comparator: "IS", right: sourceTemplateId },
                ]},
                then: [{
                  type: "loop", overExpr: `${instVar}.fields.${pickFieldId}.value`, as: pickVar,
                  body: [
                    {
                      type: "action", action: "FIND",
                      cfg: {
                        over: "$allInstances",
                        predicate: { conjunction: "AND", rules: [{ left: "id", comparator: "IS", right: pickVar }] },
                        itemVar, itemIdVar,
                      },
                    },
                    {
                      type: "if",
                      condition: { conjunction: "AND", rules: [{ left: itemIdVar, comparator: "IS_NOT_EMPTY", right: "" }] },
                      then: [
                        {
                          type: "action", action: "PUSH_TO_ARRAY",
                          cfg: { name: "$rows", value: {
                            ...(rowBeforeLabel || {}),
                            label:    { kind: "occurrence", id: `${itemVar}.id` },
                            ...(rowAfterLabel || {}),
                            timeslot: `${instVar}.fields.${timeslotFieldId}.value`,
                            date:     `${instVar}.fields.${dateFieldId}.value`,
                          }},
                        },
                        { type: "action", action: "SET_VAR", cfg: { name: "$lastTitle", expr: `${itemVar}.label` } },
                      ],
                      else: [],
                    },
                  ],
                }],
                else: [],
              }],
            },
            { type: "action", action: "UPDATE", cfg: { path: `$goalItem.fields.${rowsFieldId}.value`, value: "$rows" } },
            { type: "action", action: "UPDATE", cfg: { path: `$goalItem.fields.${lastTitleFieldId}.value`, value: "$lastTitle" } },
          ],
          else: [],
        },
      ],
    },
    enabled: true,
  };
}
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
        // MeasureOp carries `fields: { [fid]: { value, flow } }` (coalesced
        // shape — see CommitHelpers / dropHandlers fire sites). Read the
        // status field's new value off that map.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$newStatus", expr: `$trigger.fields.${statusFieldId}.value` } },
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
  userId, gridId, dateFieldId, completedFieldId, schedulePageOccId, habitFieldId = null,
  // The board page the day COLUMNS live on. Without it this op can only look
  // for a per-day PAGE, which no longer exists.
  dayPageBoardOccId = null,
}) {
  return {
    id: uid(), userId, gridId, name: "Day Page: Build Tasks Completed",
    // $activeDate is resolved through THIS occurrence's filter cascade, so the
    // op follows the Schedule page's own date — including an on-page switch that
    // never touches the grid filter. Same wiring Build Schedule uses.
    targetOccurrenceId: schedulePageOccId,
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
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "container", targetId: "", ancestorLabel: "Schedule", priority: 4 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "container", targetId: "", ancestorLabel: "Schedule", priority: 4 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "instance",  targetId: "", ancestorLabel: "Schedule", priority: 4 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "instance",  targetId: "", ancestorLabel: "Schedule", priority: 4 },
    ],
    enabled: true,
    pipeline: {
      steps: [
        // Resolve $dayDate exactly like Day Page: Build. Picker-direct Schedule
        // page — the object (for _effectiveFilter) + its id (for HAS_ANCESTOR),
        // no label check.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPage",   expr: `$allItemsById.${schedulePageOccId}` } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPageId", value: schedulePageOccId } },
        // $activeDate — the executor's normalized YYYY-MM-DD, NOT $trigger.date
        // or the raw effective filter. Those hand back the picker's period
        // OBJECT, which interpolates into the literal "Day Page - [object
        // Object]" and then matches no page at all. Same reason as Day Page:
        // Build; both ops carry targetOccurrenceId so it resolves through the
        // Schedule page's filter cascade.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$dayDate", expr: "$activeDate" } },
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$dayDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$dayDate", expr: "$today" } }],
          else: [],
        },

        // SCOPE GUARD (2026-05-25 part 3 — inclusive). Only rebuild the
        // Tasks-Completed embed list on a genuine Schedule change: a bulk
        // fire (no trigger occurrence) OR a trigger occurrence under the
        // Schedule page (a task completion toggle, a drag in/out, a slot
        // container from Build Day's APPLY_TEMPLATE). Without this, the op's
        // unscoped onAdd/onDelete instance+container triggers re-fire it on
        // EVERY other mirror op's row/card CRUD — it fired 57x in the
        // toolkit-drop freeze even though it only writes a textmap (no CRUD
        // fuel of its own). ANDed into the $dayPageId gate below.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$triggerOccId",   expr: "$trigger.occurrenceId" } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$isSourceChange", expr: "literal:0" } },
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$triggerOccId", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "SET_VAR", name: "$isSourceChange", expr: "literal:1" } }],
          else: [],
        },
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$trigger.occurrence._ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" }] },
          then: [{ id: uid(), type: "action", config: { type: "SET_VAR", name: "$isSourceChange", expr: "literal:1" } }],
          else: [],
        },

        // Locate the day page for $dayDate.
        { id: uid(), type: "action", config: {
            type: "FIND",
            // The day COLUMN, matched on its date field under the Day Page
            // board — not on a page label. Day pages are columns now, and a
            // label is the user's to rename.
            over: "$allContainers",
            predicate: { operator: "AND", rules: [
              ...(dayPageBoardOccId
                ? [{ id: uid(), left: "parentId", comparator: "IS", right: dayPageBoardOccId }]
                : []),
              { id: uid(), left: `fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$dayDate" },
            ]},
            itemIdVar: "$dayPageId",
            itemVar: "$dayPage",
        }},
        // Bail when no day page has been built yet — Day Page: Build runs
        // earlier in the same priority sweep but this op is safe either way.
        // Also bail (no-op) when this wasn't a genuine Schedule source change
        // (see SCOPE GUARD above) so non-source CRUD echoes don't rebuild.
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [
            { id: uid(), left: "$dayPageId",      comparator: "IS_NOT_EMPTY", right: "" },
            { id: uid(), left: "$isSourceChange", comparator: "IS",           right: 1  },
          ] },
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
                // ── SWEEP first ────────────────────────────────────────────
                // Anything listed here that is no longer a completed task for
                // this day is UNLINKED — never deleted. These children are the
                // Schedule's own occurrences, multi-parented in, so deleting
                // one would take the user's task out of the Schedule too. That
                // is exactly why REMOVE_CHILD exists (REMOVE_OCCURRENCE would
                // have been the wrong verb).
                { id: uid(), type: "loop",
                  overExpr: "$tcCont.occurrences",
                  as: "$kidId",
                  body: [
                    { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$kid", expr: "$allItemsById.${$kidId}" } },
                    // The KEEP test is the add predicate verbatim, and the
                    // unlink hangs off its ELSE — there is no NOT_SAME_DAY
                    // comparator, and more importantly a hand-inverted copy of
                    // the rule is a second source of truth that drifts.
                    { id: uid(), type: "if",
                      condition: { operator: "AND", rules: [
                        { id: uid(), left: `$kid.fields.${completedFieldId}.value`, comparator: "IS",       right: "true" },
                        { id: uid(), left: `$kid.fields.${dateFieldId}.value`,      comparator: "SAME_DAY", right: "$dayDate" },
                        ...(habitFieldId
                          ? [{ id: uid(), left: "$kid._boundFieldIds", comparator: "ARRAY_NOT_INCLUDES", right: habitFieldId }]
                          : []),
                      ]},
                      then: [],
                      else: [
                        { id: uid(), type: "action", config: { type: "REMOVE_CHILD", parentId: "$tcContId", childId: "$kidId" } },
                      ],
                    },
                  ],
                },
                // ── then LINK every completed task for the day ─────────────
                // ADD_CHILD is idempotent, so re-running just re-asserts the
                // list. The container is a BOARD (like Todo), so its children
                // ARE what it renders — no textmap to keep in step.
                { id: uid(), type: "loop",
                  over: "$allInstances",
                  as: "$task",
                  predicate: { operator: "AND", rules: [
                    { id: uid(), left: "_ancestors",                              comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                    { id: uid(), left: `fields.${dateFieldId}.value`,             comparator: "SAME_DAY",     right: "$dayDate" },
                    { id: uid(), left: `fields.${completedFieldId}.value`,        comparator: "IS",           right: "true" },
                    // TASKS only. A routine action (Sleep, Drink, Hygiene …) binds
                    // the hidden Habit marker and belongs to Completed Habits — the
                    // same module-BINDING discriminator the two trackers use, so a
                    // day of sleep slots can't crowd out the tasks (user 2026-07-30:
                    // "dont include sleep in the tasks completed").
                    ...(habitFieldId
                      ? [{ id: uid(), left: "_boundFieldIds", comparator: "ARRAY_NOT_INCLUDES", right: habitFieldId }]
                      : []),
                  ]},
                  body: [
                    { id: uid(), type: "action", config: {
                        type: "ADD_CHILD", parentId: "$tcContId", childId: "$task.id",
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

