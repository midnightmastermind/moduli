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

// ── Operation: Schedule Build Day (priority 1) ──
// Two responsibilities:
//   1. Ensure the schedule shell exists (Due + 48 timeslot containers, created ONCE).
//   2. Seed the Daily Routine instances for the active date via APPLY_TEMPLATE
//      (idempotent: skips if routine instances for that date already exist).
// Also sweeps todos whose dueDate matches the active date into Due.
// "Schedule: Seed Daily Routine" has been removed; this op now owns both jobs.
export function makeScheduleBuildDayOp({ userId, gridId, dateFieldId, dueFieldId, timeslotFieldId }) {
  return {
    id: uid(), userId, gridId, name: "Schedule: Build Day",
    description: "Ensure Due + 48 timeslot containers exist, seed Daily Routine via APPLY_TEMPLATE, and sweep matching todos into Due.",
    // priority 1 so the shell (slots) + routine seeding finish before goal
    // aggregations (priority 3) read the data. Four onFilterChange triggers:
    //   - grid: toolbar date arrows write grid.activeFilterValues — fires a
    //     NavigationOp with no ancestor data; matchSubjectFilter (May 15 fix)
    //     restricts grid-subject triggers to true global changes ONLY, so this
    //     no longer matches local container-only filter changes.
    //   - filterNav ancestorLabel "Schedule": LocalFilterNav writes
    //     filterOverride on the Schedule page occurrence — fire carries
    //     _ancestorLabels routes via ancestor scope.
    //   - filterNav ancestorLabel "Daily Goals": Goals/Physical/sub-container
    //     filter changes fire NavigationOps with "Daily Goals" in their
    //     ancestor chain. Build Day uses $trigger.date (the goals filter's
    //     new value) — not $schedPage._effectiveFilter — so the seed lands
    //     on the goals' day even when Schedule is filtered to a different
    //     date. Without this trigger, navigating Goals to an unvisited day
    //     showed 0s indefinitely (no underlying tasks existed for that day).
    //     Schedule isn't visually polluted because the new instances are
    //     dated to goals' day and Schedule's filter cascade hides anything
    //     not matching its own current filter.
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
        // Locate the Schedule page first — we want to drive $schedDate off its
        // effective filter (page override → grid filter → ...). Without this,
        // onLoad ran with $schedDate = $today even when the user was viewing a
        // different date, so newly-created copies were dated today and stayed
        // hidden by the page's date filter — looked like the op did nothing.
        { id: uid(), type: "action", config: {
            type: "FIND",
            over: "$allPages",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "label", comparator: "IS", right: "Schedule" },
            ]},
            itemIdVar: "$schedPageId",
            itemVar: "$schedPage",
        }},

        // $schedDate resolution — $trigger.date wins. Build Day's triggers
        // are all explicit user-action sources that carry the intended date:
        //   - Schedule LocalFilterNav → $trigger.date = Schedule's new override
        //   - Daily Goals LocalFilterNav (also Physical/sub-container) →
        //     $trigger.date = goals' new override (the user clarified: when
        //     fired from goals, USE the goals filter date, even though
        //     $schedPage._effectiveFilter would resolve to Schedule's own
        //     filter — possibly a different day).
        //   - Toolbar grid filter change → $trigger.date = toolbar value
        // Only onLoad has no $trigger.date; we fall through to the page's
        // effective filter (Schedule's current view) for that case.
        // $parentFilter (the trigger occurrence's own ancestor-merged filter)
        // is intentionally NOT used — it'd anchor on the trigger source and
        // pull in irrelevant filter overrides further down the chain.
        //   1. $trigger.date
        //   2. $schedPage._effectiveFilter.<dateFieldId> (onLoad fallback)
        //   3. $today (cold-start last resort)
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
            // Ensure the Due container exists. Created ONCE — not per day.
            // Date filtering is handled by the page's filter cascade walking
            // down to the per-day instance copies inside Due, not by stamping
            // a date on the container itself.
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

            // Apply the "Daily Routine" template in MERGE mode. The template
            // captures the full schedule subtree (48 slot containers with
            // routine instances pre-placed). Merge semantics:
            //   - Existing slot (matched by identitySignature "slot:<label>")
            //     → skip cloning the slot, recurse into its template children.
            //   - Routine instance templates carry NO identitySignature, so
            //     merge falls through to a fresh clone on every apply.
            // To keep per-date routine instances idempotent across reloads /
            // filter changes, gate the whole apply on a FIND for any existing
            // instance under $schedPage already stamped with $schedDate. If
            // one exists, the date has been seeded — skip.
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
                // defaultFields stamps the date/due directly into each cloned
                // routine instance's `fields` map at CREATE_ITEM time. The
                // previous LOOP+UPDATE pattern emitted a separate
                // update_occurrence per clone, which raced the create on the
                // server (update can upsert before create drains the queue,
                // then create's $set clobbers the date). Baking the date in
                // makes it a single socket emit per clone.
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

            // Sweep todos whose due-date matches the active date into Due.
            // CREATE a copy of the todo into Due — independent occurrence so the
            // user can mark the schedule copy complete without affecting the
            // original todo. Idempotent via a per-todo FIND scoped to $schedDate
            // matching the source todo's templateId.
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
                    // Capture the source todo's templateId + label before we
                    // start the copy guard so $item references stay stable.
                    { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$todoTemplateId", expr: "$item.templateId" } },
                    { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$todoLabel",      expr: "$item.label" } },
                    // Has a copy of this todo already been swept into the active
                    // date's Due? Date filtering must live in the predicate —
                    // FIND no longer reads cfg.scope.dateFieldId. Without the
                    // SAME_DAY rule, a copy from any past day matches and the
                    // sweep silently skips creation for the date being viewed.
                    // FIND predicate paths are bare record paths (no $item. prefix).
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
                          // COPY_LINK (not CREATE): the swept Due copy shares
                          // a linkedGroupId with the source todo, so marking
                          // either complete propagates via the server's
                          // update_occurrence linked-group fan-out
                          // (server/socketHandlers/occurrences.js:91-124).
                          // Reuses source.moduleId, so no template mint and
                          // the source's existing fieldBindings (incl. the
                          // already-hidden date binding) carry through —
                          // hence no fieldHidden here, unlike a fresh CREATE.
                          type: "COPY_LINK",
                          sourceId: "$item.id",
                          parent: "$dueId",
                          // Stamp both date fields so the schedule cascade
                          // matches AND the visible "Due" field renders the
                          // active date. copyFields default true seeds the
                          // copy's other fields from the source so the visual
                          // states match before the first propagated write.
                          fields: {
                            [dateFieldId]: "$schedDate",
                            [dueFieldId]:  "$schedDate",
                          },
                        },
                      }],
                      // A copy already exists for this date. If it predates
                      // COPY_LINK (or was a plain CREATE), it shares NO
                      // linkedGroupId with the source todo — so marking either
                      // complete does nothing to the other. Call COPY_LINK in
                      // migration mode (sourceId + targetId, no new occurrence)
                      // to retroactively join them via a shared linkedGroupId.
                      // Idempotent: once linked, the IS check inside COPY_LINK
                      // no-ops (no UPDATE emitted when both already match).
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

            // Tail: re-aggregate the goal trackers so any newly-seeded routine
            // OR newly-swept Due copy immediately ticks goal totals — without
            // this, Schedule nav created tasks but Goals stayed at its old
            // count until the user re-triggered the trackers (filter nav).
            // Trackers' onFilterChange is ancestor-scoped to "Daily Goals", so
            // a Schedule-page filter change does NOT naturally re-fire them.
            // The in-batch `liveOccs` overlay (operationExecutor.runMatching
            // Operations) means trackers see this op's CREATE_ITEM effects.
            // When Build Day was itself called by a Goals nav, the trackers
            // also fire naturally at priority 3 — these tail invocations are
            // a redundant-but-idempotent recompute (aggregations are pure).
            { id: uid(), type: "action", config: { type: "RUN_OPERATION", operationName: "Tracker: Water Today" } },
            { id: uid(), type: "action", config: { type: "RUN_OPERATION", operationName: "Tracker: Tasks Completed Today" } },
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
export function makeDayPageBuildOp({ userId, gridId, dateFieldId, dayPagesFolderId, hubPanelOccIdVar }) {
  return {
    id: uid(), userId, gridId, name: "Day Page: Build",
    description: "Create one doc Day Page per active date in the Day Pages folder, applying the Day Page template with the date stamped into the textblock heading.",
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
        // Resolve the date exactly like Build Day: $trigger.date wins (every
        // trigger here is an explicit user action carrying the intended
        // date), then the Schedule page's effective filter for the onLoad
        // case, then $today as a cold-start last resort.
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
                { id: uid(), type: "action", config: {
                    type: "APPLY_TEMPLATE",
                    templateRef: "$dayPageTplId",
                    rootParent: dayPagesFolderId,
                    rootLabel: "$dayPageName",
                    replacements: { "{Date}": "$dayDate" },
                    rootIdVar: "$newDayPageId",
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
    },
  };
}

export function makeStampDateTimeSlotOp({ userId, gridId, timeslotFieldId, hubPanelModuleId }) {
  return {
    id: uid(), userId, gridId, name: "Schedule: Stamp Date & Time Slot",
    triggerTypes: ["onCreate"],
    // Per-trigger priority 2: field stamps run after auto-build (1).
    triggerObjects: [
      { eventType: "onCreate", subjectType: "module", subjectRole: "panel", targetId: hubPanelModuleId, priority: 2 },
    ],
    enabled: true,
    pipeline: {
      steps: [
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
      ],
    },
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
  sourceFieldId, sourceFieldIds, incomeFieldId, spentFieldId,
  agg, flow = "any", timeFilter = "daily", scopeLabel = "Schedule",
  description,
}) {
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
    // Date gate — daily: SAME_DAY $goalDate; weekly: SAME_WEEK $goalDate
    // (SAME_WEEK is a real ISO Mon-Sun comparator — operationActions.js
    // case "SAME_WEEK", lines 260-273); all: omitted.
    if (timeFilter === "daily") {
      rules.push({ id: uid(), left: `$item.fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$goalDate" });
    } else if (timeFilter === "weekly") {
      rules.push({ id: uid(), left: `$item.fields.${dateFieldId}.value`, comparator: "SAME_WEEK", right: "$goalDate" });
    }
    // Scope — only items under the scope page count.
    rules.push({ id: uid(), left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: "$scopePageId" });
    // Flow direction filter (in/out aggregations like income vs expense).
    if (flowField && flow === "in") {
      rules.push({ id: uid(), left: `$item.fields.${flowField}.flow`, comparator: "IS", right: "in" });
    } else if (flowField && flow === "out") {
      rules.push({ id: uid(), left: `$item.fields.${flowField}.flow`, comparator: "IS", right: "out" });
    }
    return rules;
  }

  // ── Accumulator body for a single loop, given the agg ──
  // sum/count/countTrue include the completion gate (matches Water + Tasks).
  // last/multiSum do not gate on completion (semantically a raw read / a
  // multi-field roll-up).
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
  function eventRule(triggerType, extraRules = []) {
    const rules = [{ id: uid(), left: "$trigger.type", comparator: "IS", right: triggerType }];
    for (const r of extraRules) rules.push(r);
    if (dateGated) {
      rules.push({ id: uid(), left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$goalDate" });
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
        ? [{ id: uid(), left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$goalDate" }]
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

  // ── $goalDate chain (only when date-gated) ──
  const goalDateSteps = dateGated ? [
    { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalDate", expr: `$goalItem._effectiveFilter.${dateFieldId}` } },
    {
      id: uid(), type: "if",
      condition: { operator: "AND", rules: [{ id: uid(), left: "$goalDate", comparator: "IS_EMPTY", right: "" }] },
      then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalDate", expr: "$trigger.date" } }],
      else: [],
    },
    {
      id: uid(), type: "if",
      condition: { operator: "AND", rules: [{ id: uid(), left: "$goalDate", comparator: "IS_EMPTY", right: "" }] },
      then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalDate", expr: "$today" } }],
      else: [],
    },
  ] : [];

  // onChange trigger objects — one per measured field.
  const onChangeTriggers = uniqMeasureFieldIds.map((fid) => (
    { eventType: "onChange", subjectType: "field", targetId: fid, priority: 3 }
  ));

  return {
    id: uid(), userId, gridId, name,
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
        { id: uid(), type: "action", config: {
            type: "FIND",
            over: "$allInstances",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "label", comparator: "IS", right: goalLabel },
            ]},
            itemIdVar: "$goalId",
            itemVar: "$goalItem",
        }},

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
