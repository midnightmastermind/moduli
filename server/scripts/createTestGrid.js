// scripts/createTestGrid.js
// ============================================================
// Creates a deterministic minimal test grid for any user. Used by
// resetData.js to seed both josh@jpoms.com and test@moduli.test
// with the same fixture, and runnable standalone via:
//
//   node --env-file=.env scripts/createTestGrid.js                 # default user (josh)
//   node --env-file=.env scripts/createTestGrid.js test@moduli.test
//
// Standalone runs (`node ... scripts/createTestGrid.js [email]`) drop the
// existing "Test Grid" + its scoped data first so re-running gives a clean
// re-seed. Other grids on the user are left untouched. The exported
// `createTestGrid(userId)` function itself is still pure-create — callers
// like `resetData.js` that have already wiped user data don't need a second
// drop. To wipe + recreate the Test Grid for both seeded users in one shot,
// use scripts/resetTestGridData.js.
//
// Layout (2×3):
//   [0,0] Daily Toolkit  — Physical (Drink Water, Morning Run, Vitamins, Stretch, Take Medication, Go to Gym)
//   [1,0] Todo List      — General (6 todos)
//   [0,1] Center Hub ×2  — Schedule (slots created on-demand) | Notes
//   [0,2] Daily Goals    — Physical (Water + Tasks total displays)
//
// Schedule slots and the preset routine (Drink Water / Take Medication / Go to Gym)
// are created automatically by the "Schedule: Auto-Build for Active Date" operation
// the first time the user opens or navigates to a given date. Re-running the
// operation on the same date is a no-op.
// ============================================================

import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, "../.env") });

import { nanoid } from "nanoid";
import Grid from "../models/Grid.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Field from "../models/Field.js";
import Manifest from "../models/Manifest.js";
import View from "../models/View.js";
import Folder from "../models/Folder.js";
import Operation from "../models/Operation.js";
import User from "../models/User.js";
import { generateTimeSlots } from "../utils/operationBuilders.js";

const DEFAULT_USER_EMAIL = "josh@jpoms.com";
const DEFAULT_GRID_NAME = "Test Grid";
const uid = () => nanoid(12);

export async function dropExistingTestGrid(userId, gridName = DEFAULT_GRID_NAME) {
  const existing = await Grid.findOne({ userId, name: gridName });
  if (!existing) return false;
  const gridId = existing._id.toString();
  await Promise.all([
    Occurrence.deleteMany({ gridId }),
    Module.deleteMany({ gridId }),
    Field.deleteMany({ gridId }),
    Manifest.deleteMany({ gridId }),
    View.deleteMany({ gridId }),
    Folder.deleteMany({ gridId }),
    Operation.deleteMany({ gridId }),
  ]);
  await Grid.deleteOne({ _id: existing._id });
  return true;
}

export async function createTestGrid(userId, options = {}) {
  const { gridName = DEFAULT_GRID_NAME } = options;

  const today = new Date();
  today.setHours(12, 0, 0, 0);

  // ── Pre-generate IDs ────────────────────────────────────────────────────────
  const dateFieldId = uid();
  const waterFieldId = uid();
  const completedFieldId = uid();
  const timeslotFieldId = uid();
  const dueFieldId = uid();
  const totalWaterFieldId = uid();
  const totalTasksCompletedFieldId = uid();

  const toolkitPanelId = uid();
  const goalsPanelId   = uid();
  const todoPanelId    = uid();
  const centerHubId    = uid();

  const physicalContId     = uid();
  const physicalGoalContId = uid();
  const todoGeneralContId  = uid();

  const drinkWaterModId = uid();
  const waterGoalModId  = uid();
  const tasksGoalModId  = uid();
  const morningRunModId = uid();
  const vitaminsModId   = uid();
  const stretchModId    = uid();
  const takeMedicationModId = uid();
  const goToGymModId        = uid();
  const todoGroceriesModId  = uid();
  const todoDentistModId    = uid();
  const todoReviewPRModId   = uid();
  const todoBillsModId      = uid();
  const todoReadModId       = uid();
  const todoEmailModId      = uid();

  const centerHubViewId = uid();
  const manifestId      = uid();
  const rootFolderId    = uid();
  const notesFolderId   = uid();

  // ── STEP 1: Grid ────────────────────────────────────────────────────────────
  const schedFilterId = uid();

  const grid = new Grid({
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
    activeFilterValues: { [dateFieldId]: today.toISOString().slice(0, 10) },
  });
  await grid.save();
  const gridId = grid._id.toString();

  // ── STEP 2: Fields ──────────────────────────────────────────────────────────
  await Field.insertMany([
    { id: dateFieldId, userId, gridId, name: "Date", type: "date", inputEnabled: true, displayEnabled: false },
    { id: waterFieldId, userId, gridId, name: "Water", type: "number", inputEnabled: true, displayEnabled: false, meta: { postfix: " oz", increment: 8, flow: "in" } },
    { id: completedFieldId, userId, gridId, name: "Completed", type: "boolean", inputEnabled: true, displayEnabled: false },
    { id: timeslotFieldId, userId, gridId, name: "Time Slot", type: "text", inputEnabled: true, displayEnabled: false },
    { id: dueFieldId, userId, gridId, name: "Due", type: "date", inputEnabled: true, displayEnabled: false },
    { id: totalWaterFieldId, userId, gridId, name: "Daily Water", type: "number", inputEnabled: false, displayEnabled: true,
      displayConfig: { showArrows: true, arrowColor: "green", targetValue: 64, targetPeriod: "daily" }, meta: { postfix: " oz" } },
    { id: totalTasksCompletedFieldId, userId, gridId, name: "Tasks Completed", type: "number", inputEnabled: false, displayEnabled: true,
      displayConfig: { showArrows: true, arrowColor: "green", targetValue: 6, targetPeriod: "daily" }, meta: {} },
  ]);

  // ── STEP 3: Instance modules ────────────────────────────────────────────────
  await Module.insertMany([
    {
      id: drinkWaterModId, userId, gridId, role: "instance", kind: "list", label: "Drink Water",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: completedFieldId, role: "input", order: 0 },
        { fieldId: waterFieldId, role: "input", order: 1 },
        { fieldId: dateFieldId, role: "input", order: 2, hidden: true },
      ],
    },
    {
      id: morningRunModId, userId, gridId, role: "instance", kind: "list", label: "Morning Run",
      defaultDragMode: "copy",
      fieldBindings: [{ fieldId: completedFieldId, role: "input", order: 0 }],
    },
    {
      id: vitaminsModId, userId, gridId, role: "instance", kind: "list", label: "Take Vitamins",
      defaultDragMode: "copy",
      fieldBindings: [{ fieldId: completedFieldId, role: "input", order: 0 }],
    },
    {
      id: stretchModId, userId, gridId, role: "instance", kind: "list", label: "Stretch",
      defaultDragMode: "copy",
      fieldBindings: [{ fieldId: completedFieldId, role: "input", order: 0 }],
    },
    {
      id: takeMedicationModId, userId, gridId, role: "instance", kind: "list", label: "Take Medication",
      defaultDragMode: "copy",
      fieldBindings: [{ fieldId: completedFieldId, role: "input", order: 0 }],
    },
    {
      id: goToGymModId, userId, gridId, role: "instance", kind: "list", label: "Go to Gym",
      defaultDragMode: "copy",
      fieldBindings: [{ fieldId: completedFieldId, role: "input", order: 0 }],
    },
    {
      id: waterGoalModId, userId, gridId, role: "instance", kind: "list", label: "Physical Wellness",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: totalWaterFieldId, role: "display", order: 0 },
      ],
    },
    {
      id: tasksGoalModId, userId, gridId, role: "instance", kind: "list", label: "Task Progress",
      defaultDragMode: "move",
      fieldBindings: [{ fieldId: totalTasksCompletedFieldId, role: "display", order: 0 }],
    },
    {
      id: todoGroceriesModId, userId, gridId, role: "instance", kind: "list", label: "Buy groceries",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: completedFieldId, role: "input", order: 0 },
        { fieldId: dueFieldId, role: "input", order: 1 },
      ],
    },
    {
      id: todoDentistModId, userId, gridId, role: "instance", kind: "list", label: "Call dentist",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: completedFieldId, role: "input", order: 0 },
        { fieldId: dueFieldId, role: "input", order: 1 },
      ],
    },
    {
      id: todoReviewPRModId, userId, gridId, role: "instance", kind: "list", label: "Review open PRs",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: completedFieldId, role: "input", order: 0 },
        { fieldId: dueFieldId, role: "input", order: 1 },
      ],
    },
    {
      id: todoBillsModId, userId, gridId, role: "instance", kind: "list", label: "Pay monthly bills",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: completedFieldId, role: "input", order: 0 },
        { fieldId: dueFieldId, role: "input", order: 1 },
      ],
    },
    {
      id: todoReadModId, userId, gridId, role: "instance", kind: "list", label: "Read a chapter",
      defaultDragMode: "move",
      fieldBindings: [{ fieldId: completedFieldId, role: "input", order: 0 }],
    },
    {
      id: todoEmailModId, userId, gridId, role: "instance", kind: "list", label: "Clear inbox",
      defaultDragMode: "move",
      fieldBindings: [{ fieldId: completedFieldId, role: "input", order: 0 }],
    },
  ]);

  // ── STEP 4: Container modules ───────────────────────────────────────────────
  const timeSlots = generateTimeSlots();
  const schedContainers = {};
  for (const slot of timeSlots) {
    const key = `slot_${slot.hour}_${slot.minute}`;
    schedContainers[key] = { id: uid(), label: slot.label, hour: slot.hour, minute: slot.minute };
  }

  await Module.insertMany([
    { id: physicalContId,     userId, gridId, role: "container", kind: "list", label: "Physical", styleMode: "own", ownStyle: { bg: "#b44a1a" } },
    { id: physicalGoalContId, userId, gridId, role: "container", kind: "list", label: "Physical", styleMode: "own", ownStyle: { bg: "#b44a1a" } },
    { id: todoGeneralContId,  userId, gridId, role: "container", kind: "list", label: "General",
      defaultDragMode: "move", meta: { todoListContainer: true } },
    ...timeSlots.map(slot => {
      const key = `slot_${slot.hour}_${slot.minute}`;
      return {
        id: schedContainers[key].id, userId, gridId, role: "container", kind: "list",
        label: slot.label,
        meta: {
          scheduleSlot: true,
          slotHour: slot.hour,
          slotMinute: slot.minute,
          slotLabel: slot.label,
        },
      };
    }),
  ]);

  // ── STEP 5: Panel modules ───────────────────────────────────────────────────
  const panelLayout = (name) => ({ name, display: "flex", flow: "column", wrap: "nowrap", gapPx: 4, scrollY: "auto", padding: "sm" });
  await Module.insertMany([
    { id: toolkitPanelId, userId, gridId, role: "panel", kind: "board", label: "Panel A", defaultDragMode: "copy", layout: panelLayout("Panel A") },
    { id: goalsPanelId,   userId, gridId, role: "panel", kind: "board", label: "Panel D", defaultDragMode: "move", layout: panelLayout("Panel D") },
    { id: todoPanelId,    userId, gridId, role: "panel", kind: "board", label: "Panel B", defaultDragMode: "move", layout: { ...panelLayout("Panel B"), gapPx: 8 } },
    { id: centerHubId,    userId, gridId, role: "panel", kind: "board", label: "Panel C", defaultDragMode: "move", layout: panelLayout("Panel C") },
  ]);

  // ── STEP 6: Instance + container occurrences ────────────────────────────────
  async function mkOcc(data) {
    const id = data.id || uid();
    const doc = new Occurrence({ id, userId, gridId, timestamp: new Date(), fields: {}, meta: {}, hidden: false, ...data });
    await doc.save();
    return id;
  }

  // Due date helpers
  const in1Day  = new Date(today); in1Day.setDate(in1Day.getDate() + 1);
  const in2Days = new Date(today); in2Days.setDate(in2Days.getDate() + 2);
  const in7Days = new Date(today); in7Days.setDate(in7Days.getDate() + 7);

  // Toolkit Physical container instances
  const drinkWaterOccId = await mkOcc({
    targetType: "module", targetId: drinkWaterModId,
    meta: { containerId: physicalContId },
    fields: { [dateFieldId]: { value: today.toISOString(), flow: "in", timestamp: new Date() } },
  });
  const morningRunOccId = await mkOcc({
    targetType: "module", targetId: morningRunModId,
    meta: { containerId: physicalContId }, fields: {},
  });
  const vitaminsOccId = await mkOcc({
    targetType: "module", targetId: vitaminsModId,
    meta: { containerId: physicalContId },
    fields: { [completedFieldId]: { value: true, flow: "in", timestamp: new Date() } },
  });
  const stretchOccId = await mkOcc({
    targetType: "module", targetId: stretchModId,
    meta: { containerId: physicalContId }, fields: {},
  });
  const takeMedicationOccId = await mkOcc({
    targetType: "module", targetId: takeMedicationModId,
    meta: { containerId: physicalContId }, fields: {},
  });
  const goToGymOccId = await mkOcc({
    targetType: "module", targetId: goToGymModId,
    meta: { containerId: physicalContId }, fields: {},
  });

  // Goals container instances
  const waterGoalOccId = await mkOcc({
    targetType: "module", targetId: waterGoalModId,
    meta: { containerId: physicalGoalContId },
    fields: { [dateFieldId]: { value: today.toISOString(), flow: "in", timestamp: new Date() } },
  });
  const tasksGoalOccId = await mkOcc({
    targetType: "module", targetId: tasksGoalModId,
    meta: { containerId: physicalGoalContId }, fields: {},
  });

  const physContOccId = await mkOcc({
    targetType: "module", targetId: physicalContId,
    occurrences: [drinkWaterOccId, morningRunOccId, vitaminsOccId, stretchOccId, takeMedicationOccId, goToGymOccId],
  });
  const physGoalContOccId = await mkOcc({
    targetType: "module", targetId: physicalGoalContId,
    occurrences: [waterGoalOccId, tasksGoalOccId],
  });

  // Todo instances
  const todoGroceriesOccId = await mkOcc({
    targetType: "module", targetId: todoGroceriesModId,
    meta: { containerId: todoGeneralContId },
    fields: { [dueFieldId]: { value: in2Days.toISOString(), flow: "in", timestamp: new Date() } },
  });
  const todoDentistOccId = await mkOcc({
    targetType: "module", targetId: todoDentistModId,
    meta: { containerId: todoGeneralContId },
    fields: { [dueFieldId]: { value: in7Days.toISOString(), flow: "in", timestamp: new Date() } },
  });
  const todoReviewPROccId = await mkOcc({
    targetType: "module", targetId: todoReviewPRModId,
    meta: { containerId: todoGeneralContId },
    fields: { [dueFieldId]: { value: in1Day.toISOString(), flow: "in", timestamp: new Date() } },
  });
  const todoBillsOccId = await mkOcc({
    targetType: "module", targetId: todoBillsModId,
    meta: { containerId: todoGeneralContId },
    fields: {
      [completedFieldId]: { value: true, flow: "in", timestamp: new Date() },
      [dueFieldId]: { value: today.toISOString(), flow: "in", timestamp: new Date() },
    },
  });
  const todoReadOccId = await mkOcc({
    targetType: "module", targetId: todoReadModId,
    meta: { containerId: todoGeneralContId }, fields: {},
  });
  const todoEmailOccId = await mkOcc({
    targetType: "module", targetId: todoEmailModId,
    meta: { containerId: todoGeneralContId }, fields: {},
  });

  const todoContOccId = await mkOcc({
    targetType: "module", targetId: todoGeneralContId,
    occurrences: [todoReviewPROccId, todoBillsOccId, todoGroceriesOccId, todoDentistOccId, todoReadOccId, todoEmailOccId],
  });

  // Schedule slots are created on demand by the "Schedule: Auto-Build for Active Date"
  // operation when the user navigates to a date that doesn't have slot occurrences yet.
  const scheduleOccIds = [];

  // ── STEP 7: Manifest + folders ──────────────────────────────────────────────
  await new Manifest({ id: manifestId, userId, gridId, manifestType: "user", rootFolderId }).save();
  await new Folder({ id: rootFolderId, userId, gridId, name: "Root", parentId: null, folderType: "normal", sortOrder: 0, isExpanded: true }).save();
  await new Folder({ id: notesFolderId, userId, gridId, parentId: rootFolderId, name: "Notes", folderType: "normal", sortOrder: 0, isExpanded: true }).save();

  // ── STEP 8: Page modules + page occurrences ─────────────────────────────────
  const toolkitPageModId = uid(); const toolkitPageOccId = uid();
  await new Module({ id: toolkitPageModId, userId, gridId, role: "page", kind: "board", label: "Daily Toolkit" }).save();
  await mkOcc({ id: toolkitPageOccId, targetType: "module", targetId: toolkitPageModId, parentId: rootFolderId, sortOrder: 0, occurrences: [physContOccId], iteration: { mode: "persistent" }, fields: {} });

  const goalsPageModId = uid(); const goalsPageOccId = uid();
  await new Module({ id: goalsPageModId, userId, gridId, role: "page", kind: "board", label: "Daily Goals" }).save();
  await mkOcc({ id: goalsPageOccId, targetType: "module", targetId: goalsPageModId, parentId: rootFolderId, sortOrder: 1, occurrences: [physGoalContOccId], iteration: { mode: "persistent" }, fields: {} });

  const todoPageModId = uid(); const todoPageOccId = uid();
  await new Module({ id: todoPageModId, userId, gridId, role: "page", kind: "board", label: "Todo List" }).save();
  await mkOcc({ id: todoPageOccId, targetType: "module", targetId: todoPageModId, parentId: rootFolderId, sortOrder: 2, occurrences: [todoContOccId], iteration: { mode: "persistent" }, fields: {} });

  const schedPageModId = uid(); const schedPageOccId = uid();
  await new Module({ id: schedPageModId, userId, gridId, role: "page", kind: "board", label: "Schedule" }).save();
  await mkOcc({
    id: schedPageOccId, targetType: "module", targetId: schedPageModId,
    parentId: rootFolderId, sortOrder: 3, occurrences: scheduleOccIds,
    iteration: { mode: "persistent" }, fields: {},
    filters: [{
      id: schedFilterId,
      fieldId: dateFieldId,
      active: true,
      showNav: true,
      timeUnit: "day",
      defaultNavValue: "today",
      condition: {
        operator: "OR",
        rules: [
          { left: "$field.value", comparator: "DATE_EQUALS", right: "$nav" },
          { left: "$field.value", comparator: "IS_EMPTY" },
        ],
      },
    }],
  });

  const notesPageModId = uid(); const notesPageOccId = uid();
  await new Module({ id: notesPageModId, userId, gridId, role: "page", kind: "doc", label: "Notes" }).save();
  await mkOcc({ id: notesPageOccId, targetType: "module", targetId: notesPageModId, parentId: notesFolderId, sortOrder: 0, iteration: { mode: "persistent" }, textmap: { type: "doc", content: [{ type: "paragraph" }] }, fields: {} });

  await new View({ id: centerHubViewId, userId, gridId, viewType: "board", activeOccurrenceId: schedPageOccId }).save();

  // ── STEP 9: Panel occurrences (grid placements) ─────────────────────────────
  const panelOccIds = {};
  const placements = [
    { key: "toolkit",  panelId: toolkitPanelId, row: 0, col: 0, width: 1, height: 1, viewId: null            },
    { key: "todo",     panelId: todoPanelId,    row: 1, col: 0, width: 1, height: 1, viewId: null            },
    { key: "hub",      panelId: centerHubId,    row: 0, col: 1, width: 1, height: 2, viewId: centerHubViewId },
    { key: "goals",    panelId: goalsPanelId,   row: 0, col: 2, width: 1, height: 1, viewId: null            },
  ];

  const gridOccIds = [];
  for (const p of placements) {
    const occId = await mkOcc({
      targetType: "module", targetId: p.panelId,
      placement: { row: p.row, col: p.col, width: p.width, height: p.height },
      ...(p.viewId && { viewId: p.viewId }),
    });
    panelOccIds[p.key] = occId;
    gridOccIds.push(occId);
  }

  // ── STEP 10: Wire page occurrences into panel occurrences ───────────────────
  await Occurrence.findOneAndUpdate({ id: panelOccIds.toolkit }, { $set: { occurrences: [toolkitPageOccId] } });
  await Occurrence.findOneAndUpdate({ id: panelOccIds.todo },    { $set: { occurrences: [todoPageOccId] } });
  await Occurrence.findOneAndUpdate({ id: panelOccIds.hub },     { $set: { occurrences: [schedPageOccId, notesPageOccId] } });
  await Occurrence.findOneAndUpdate({ id: panelOccIds.goals },   { $set: { occurrences: [goalsPageOccId] } });

  // ── STEP 11: Finalize grid ──────────────────────────────────────────────────
  await Grid.findByIdAndUpdate(grid._id, { $set: { occurrences: gridOccIds } });

  // ── STEP 12: Operations ─────────────────────────────────────────────────────

  await new Operation({
    id: uid(), userId, gridId, name: "Water Today",
    description: "Sum daily water oz — only for items under the Schedule page",
    priority: 3, // Goal aggregation — runs after auto-build (1) and field stamps (2)
    triggerTypes: ["onChange", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: waterFieldId },
      { eventType: "onChange",       subjectType: "field",     targetId: completedFieldId },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "" },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "" },
    ],
    enabled: true,
    pipeline: {
      sources: [
        { id: uid(), variableName: "triggerType",    entityType: "trigger", triggerProp: "type" },
        { id: uid(), variableName: "triggerFieldId", entityType: "trigger", triggerProp: "fieldId" },
        { id: uid(), variableName: "triggerDate",    entityType: "trigger", triggerProp: "date" },
      ],
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$total", value: 0 } },
        // Locate the Schedule page first so we can drive $schedDate off its
        // effective filter (page override → grid filter → trigger → today).
        { id: uid(), type: "action", config: {
            type: "FIND",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "$item.label", comparator: "IS", right: "Schedule" },
            ]},
            itemIdVar: "$schedPageId",
            itemVar: "$schedPage",
        }},
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: `$schedPage._effectiveFilter.${dateFieldId}` } },
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$schedDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: "$triggerDate" } }],
          else: [],
        },
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$schedDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: "$today" } }],
          else: [],
        },
        // Locate the goal display item so we can address its display key.
        { id: uid(), type: "action", config: {
            type: "FIND",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "$item.label", comparator: "IS", right: "Physical Wellness" },
            ]},
            itemIdVar: "$goalId",
        }},
        {
          id: uid(), type: "if",
          condition: {
            operator: "OR",
            rules: [
              { id: uid(), left: "$triggerType", comparator: "IS", right: "onLoad" },
              { id: uid(), left: "$triggerType", comparator: "IS", right: "NavigationOp" },
              {
                id: uid(), operator: "AND",
                rules: [
                  { id: uid(), left: "$triggerType", comparator: "IS", right: "MeasureOp" },
                  {
                    id: uid(), operator: "OR",
                    rules: [
                      { id: uid(), left: "$triggerFieldId", comparator: "IS", right: waterFieldId },
                      { id: uid(), left: "$triggerFieldId", comparator: "IS", right: completedFieldId },
                    ],
                  },
                ],
              },
            ],
          },
          then: [
            {
              id: uid(), type: "loop", overExpr: "$allItems", as: "$item",
              body: [{
                id: uid(), type: "if",
                condition: {
                  operator: "AND",
                  rules: [
                    { id: uid(), left: `$item.fields.${waterFieldId}.value`,     comparator: "IS_NOT_EMPTY", right: "" },
                    { id: uid(), left: `$item.fields.${completedFieldId}.value`, comparator: "IS",           right: true },
                    { id: uid(), left: `$item.fields.${dateFieldId}.value`,      comparator: "SAME_DAY",     right: "$schedDate" },
                    { id: uid(), left: "$item._ancestors",                       comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                  ],
                },
                then: [{ id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$total", expr: `$item.fields.${waterFieldId}.value` } }],
                else: [],
              }],
            },
            // Write the aggregated total to the goal item's display field.
            { id: uid(), type: "action", config: {
                type: "UPDATE",
                path: `$display.${totalWaterFieldId}.\${$goalId}`,
                value: "$total",
            }},
          ],
          else: [],
        },
      ],
    },
  }).save();

  await new Operation({
    id: uid(), userId, gridId, name: "Tasks Completed Today",
    description: "Count completed tasks under the Schedule page — fires on field change, add/remove, nav, load",
    priority: 3, // Goal aggregation — runs after auto-build (1) and field stamps (2)
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: completedFieldId },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "container", targetId: "" },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "container", targetId: "" },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "" },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "" },
    ],
    enabled: true,
    pipeline: {
      sources: [
        { id: uid(), variableName: "triggerType",    entityType: "trigger", triggerProp: "type" },
        { id: uid(), variableName: "triggerFieldId", entityType: "trigger", triggerProp: "fieldId" },
        { id: uid(), variableName: "triggerDate",    entityType: "trigger", triggerProp: "date" },
      ],
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$count", value: 0 } },
        // Locate the Schedule page first so $schedDate can flow off its
        // effective filter — same fallback chain as Water Today / Build Day.
        { id: uid(), type: "action", config: {
            type: "FIND",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "$item.label", comparator: "IS", right: "Schedule" },
            ]},
            itemIdVar: "$schedPageId",
            itemVar: "$schedPage",
        }},
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: `$schedPage._effectiveFilter.${dateFieldId}` } },
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$schedDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: "$triggerDate" } }],
          else: [],
        },
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$schedDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: "$today" } }],
          else: [],
        },
        // Locate the goal display item so we can address its display key.
        { id: uid(), type: "action", config: {
            type: "FIND",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "$item.label", comparator: "IS", right: "Task Progress" },
            ]},
            itemIdVar: "$goalId",
        }},
        {
          id: uid(), type: "if",
          condition: {
            operator: "OR",
            rules: [
              { id: uid(), left: "$triggerType", comparator: "IS", right: "onLoad" },
              { id: uid(), left: "$triggerType", comparator: "IS", right: "NavigationOp" },
              { id: uid(), left: "$triggerType", comparator: "IS", right: "OccurrenceCreateOp" },
              { id: uid(), left: "$triggerType", comparator: "IS", right: "OccurrenceDeleteOp" },
              {
                id: uid(), operator: "AND",
                rules: [
                  { id: uid(), left: "$triggerType",    comparator: "IS", right: "MeasureOp" },
                  { id: uid(), left: "$triggerFieldId", comparator: "IS", right: completedFieldId },
                ],
              },
            ],
          },
          then: [
            {
              id: uid(), type: "loop", overExpr: "$allItems", as: "$item",
              body: [{
                id: uid(), type: "if",
                condition: {
                  operator: "AND",
                  rules: [
                    { id: uid(), left: `$item.fields.${completedFieldId}.value`, comparator: "IS",           right: true },
                    { id: uid(), left: `$item.fields.${dateFieldId}.value`,      comparator: "SAME_DAY",     right: "$schedDate" },
                    { id: uid(), left: "$item._ancestors",                       comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                  ],
                },
                then: [{ id: uid(), type: "action", config: { type: "INCREMENT_VAR", name: "$count", by: 1 } }],
                else: [],
              }],
            },
            // Write the count to the goal item's display field.
            { id: uid(), type: "action", config: {
                type: "UPDATE",
                path: `$display.${totalTasksCompletedFieldId}.\${$goalId}`,
                value: "$count",
            }},
          ],
          else: [],
        },
      ],
    },
  }).save();

  // ── Operation: Schedule Build Day (priority 1) ──
  // Single responsibility: ensure the schedule shell exists for the active date.
  // Creates Due container occurrence + 48 timeslot occurrences. Does NOT seed
  // any task instances — that's "Schedule: Seed Daily Routine" (priority 4).
  // Also sweeps todos whose dueDate matches the active date into Due.
  await new Operation({
    id: uid(), userId, gridId, name: "Schedule: Build Day",
    description: "Ensure Due + 48 timeslot containers exist for the active date. Sweep matching todos into Due.",
    priority: 1,
    triggerTypes: ["onLoad", "onFilterChange"],
    triggerObjects: [
      { eventType: "onLoad",         subjectType: "grid",      targetId: "" },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "" },
    ],
    enabled: true,
    pipeline: {
      sources: [
        { id: uid(), variableName: "triggerDate", entityType: "trigger", triggerProp: "date" },
      ],
      steps: [
        // Locate the Schedule page first — we want to drive $schedDate off its
        // effective filter (page override → grid filter → ...). Without this,
        // onLoad ran with $schedDate = $today even when the user was viewing a
        // different date, so newly-created copies were dated today and stayed
        // hidden by the page's date filter — looked like the op did nothing.
        { id: uid(), type: "action", config: {
            type: "FIND",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "$item.label", comparator: "IS", right: "Schedule" },
            ]},
            itemIdVar: "$schedPageId",
            itemVar: "$schedPage",
        }},

        // $schedDate fallback chain:
        //   1. Schedule page's effective filter (page filterOverride layered on grid filter)
        //   2. $trigger.date (set on NavigationOp by LocalFilterNav)
        //   3. $today
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: `$schedPage._effectiveFilter.${dateFieldId}` } },
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$schedDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: "$triggerDate" } }],
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
                predicate: { operator: "AND", rules: [
                  { id: uid(), left: "$item.label", comparator: "IS", right: "Due" },
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
                    insertAtIndex: 0,
                    itemIdVar: "$dueId",
                }},
              ],
              else: [],
            },

            // Build the 48 timeslot containers ONCE — not per day. The slot
            // array itself never changes between days, so we don't need a
            // per-day occurrence per slot. Each loop iteration FINDs by
            // meta.slotLabel (no date scope); if any slot for that label
            // already exists we skip the CREATE entirely. The page-level
            // date filter cascades down through the slots to the per-day
            // instances they hold — that's where date filtering happens,
            // not on the slots themselves.
            { id: uid(), type: "action", config: {
                type: "INIT_VAR", name: "$slots",
                arrayOf: timeSlots.map(s => ({
                  templateId: schedContainers[`slot_${s.hour}_${s.minute}`].id,
                  label: s.label,
                })),
            }},
            {
              id: uid(), type: "loop", overExpr: "$slots", as: "$slot",
              body: [
                { id: uid(), type: "action", config: {
                    type: "FIND",
                    predicate: { operator: "AND", rules: [
                      { id: uid(), left: "$item.meta.scheduleSlot", comparator: "IS", right: true },
                      { id: uid(), left: "$item.meta.slotLabel",    comparator: "IS", right: "$slot.label" },
                    ]},
                    itemIdVar: "$slotItemId",
                }},
                {
                  id: uid(), type: "if",
                  condition: { operator: "AND", rules: [{ id: uid(), left: "$slotItemId", comparator: "IS_EMPTY", right: "" }] },
                  then: [
                    { id: uid(), type: "action", config: {
                        type: "CREATE",
                        name: "$slot.label",
                        role: "container",
                        kind: "list",
                        meta: { scheduleSlot: true, slotLabel: "$slot.label" },
                        parent: "$schedPageId",
                        fields: { [timeslotFieldId]: "$slot.label" },
                        itemVar: "$item",
                    }},
                  ],
                  else: [],
                },
              ],
            },

            // Sweep todos whose due-date matches the active date into Due.
            // CREATE a copy of the todo into Due — independent occurrence so the
            // user can mark the schedule copy complete without affecting the
            // original todo. Idempotent via a per-todo FIND scoped to $schedDate
            // matching the source todo's templateId.
            { id: uid(), type: "action", config: {
                type: "FIND",
                predicate: { operator: "AND", rules: [
                  { id: uid(), left: "$item.meta.todoListContainer", comparator: "IS", right: true },
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
                    // Has a copy of this todo already been swept into today's Due?
                    { id: uid(), type: "action", config: {
                        type: "FIND",
                        predicate: { operator: "AND", rules: [
                          { id: uid(), left: "$item.templateId",    comparator: "IS", right: "$todoTemplateId" },
                          { id: uid(), left: "$item._ancestors",    comparator: "HAS_ANCESTOR", right: "$dueId" },
                        ]},
                        scope: { dateFieldId, dateExpr: "$schedDate" },
                        itemIdVar: "$existingCopyId",
                    }},
                    {
                      id: uid(), type: "if",
                      condition: { operator: "AND", rules: [{ id: uid(), left: "$existingCopyId", comparator: "IS_EMPTY", right: "" }] },
                      then: [{
                        id: uid(), type: "action", config: {
                          type: "CREATE",
                          name: "$todoLabel",
                          role: "instance",
                          kind: "list",
                          parent: "$dueId",
                          date: { fieldId: dateFieldId, value: "$schedDate" },
                        },
                      }],
                      else: [],
                    },
                  ],
                  else: [],
                }],
              }],
              else: [],
            },
          ],
          else: [],
        },
      ],
    },
  }).save();

  // ── Operation: Seed Daily Routine (priority 4) ──
  // Adds the three test routine items into their slots, ONCE per day. Runs after
  // Build Day (priority 1) so the slots already exist. Each preset is idempotent:
  // if an occurrence of the source module already exists for the active date,
  // the loop iteration short-circuits and creates nothing.
  await new Operation({
    id: uid(), userId, gridId, name: "Schedule: Seed Daily Routine",
    description: "Drop the daily routine (Drink Water 7am, Take Medication 8am, Go to Gym 9am) into their slots once per day.",
    // Priority 2: runs after auto-build (1) creates the slots but BEFORE goal
    // aggregations (3) read the data. The pre-completed 6am Drink Water needs
    // to exist by the time Tasks Completed / Water Today aggregate, otherwise
    // first-load totals come back empty.
    priority: 2,
    triggerTypes: ["onLoad", "onFilterChange"],
    triggerObjects: [
      { eventType: "onLoad",         subjectType: "grid",      targetId: "" },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "" },
    ],
    enabled: true,
    pipeline: {
      sources: [
        { id: uid(), variableName: "triggerDate", entityType: "trigger", triggerProp: "date" },
      ],
      steps: [
        // Drive $schedDate off the schedule page's effective filter so onLoad
        // creates copies for the date the user is viewing — not always $today.
        // Same fallback chain as Schedule: Build Day.
        { id: uid(), type: "action", config: {
            type: "FIND",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "$item.label", comparator: "IS", right: "Schedule" },
            ]},
            itemIdVar: "$schedPageId",
            itemVar: "$schedPage",
        }},
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: `$schedPage._effectiveFilter.${dateFieldId}` } },
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$schedDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: "$triggerDate" } }],
          else: [],
        },
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$schedDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: "$today" } }],
          else: [],
        },

        // One presets array, one loop. Each preset = { moduleLabel, slotLabel,
        // completed?, water? }. The 6:00am Drink Water seed is pre-completed
        // with 10oz so on-load aggregations have data to read (proves the
        // Tasks Completed + Water Today goal pipelines actually fire on load).
        { id: uid(), type: "action", config: {
            type: "INIT_VAR", name: "$presets",
            arrayOf: [
              { moduleLabel: "Drink Water",     slotLabel: "6:00am", completed: true, water: 10 },
              { moduleLabel: "Drink Water",     slotLabel: "7:00am" },
              { moduleLabel: "Take Medication", slotLabel: "8:00am" },
              { moduleLabel: "Go to Gym",       slotLabel: "9:00am" },
            ],
        }},
        {
          id: uid(), type: "loop", overExpr: "$presets", as: "$preset",
          body: [
            // Resolve the source item (existing template-instance pair) by label.
            { id: uid(), type: "action", config: {
                type: "FIND",
                predicate: { operator: "AND", rules: [
                  { id: uid(), left: "$item.label", comparator: "IS", right: "$preset.moduleLabel" },
                ]},
                itemVar: "$src",
            }},
            { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$srcTemplateId", expr: "$src.templateId" } },

            // Skip if a copy of this preset already lives in this preset's slot
            // for the active date. Scoped by templateId + slotLabel so each
            // (template, slot) pair is independently idempotent — that lets two
            // presets share a moduleLabel (e.g. "Drink Water" at 6am and 7am)
            // without one suppressing the other.
            { id: uid(), type: "action", config: {
                type: "FIND",
                predicate: { operator: "AND", rules: [
                  { id: uid(), left: "$item.templateId",          comparator: "IS", right: "$srcTemplateId" },
                  { id: uid(), left: `$item.fields.${timeslotFieldId}.value`, comparator: "IS", right: "$preset.slotLabel" },
                ]},
                scope: { dateFieldId, dateExpr: "$schedDate" },
                itemIdVar: "$existingId",
            }},
            {
              id: uid(), type: "if",
              condition: { operator: "AND", rules: [
                { id: uid(), left: "$srcTemplateId", comparator: "IS_NOT_EMPTY", right: "" },
                { id: uid(), left: "$existingId",    comparator: "IS_EMPTY",     right: "" },
              ]},
              then: [
                // Locate the target slot by meta.slotLabel only — slots are
                // shared across days now, no date scope.
                { id: uid(), type: "action", config: {
                    type: "FIND",
                    predicate: { operator: "AND", rules: [
                      { id: uid(), left: "$item.meta.scheduleSlot", comparator: "IS", right: true },
                      { id: uid(), left: "$item.meta.slotLabel",    comparator: "IS", right: "$preset.slotLabel" },
                    ]},
                    itemIdVar: "$slotId",
                }},
                {
                  id: uid(), type: "if",
                  condition: { operator: "AND", rules: [{ id: uid(), left: "$slotId", comparator: "IS_NOT_EMPTY", right: "" }] },
                  then: [{
                    id: uid(), type: "action", config: {
                      type: "CREATE",
                      name: "$preset.moduleLabel",
                      role: "instance",
                      kind: "list",
                      parent: "$slotId",
                      date: { fieldId: dateFieldId, value: "$schedDate" },
                      // Stamp the slot label so the FIND above can de-dupe per
                      // (template, slot) pair, and pass through preset-level
                      // initial field values (water/completed). resolveExpr
                      // returns null for absent preset keys so unset fields are
                      // skipped on the create.
                      fields: {
                        [timeslotFieldId]: "$preset.slotLabel",
                        [waterFieldId]:    "$preset.water",
                        [completedFieldId]: "$preset.completed",
                      },
                    },
                  }],
                  else: [],
                },
              ],
              else: [],
            },
          ],
        },
      ],
    },
  }).save();

  await new Operation({
    id: uid(), userId, gridId, name: "Schedule: Stamp Date & Time Slot",
    priority: 2, // Field stamp — runs after auto-build (1)
    triggerTypes: ["onCreate"],
    triggerObjects: [
      { eventType: "onCreate", subjectType: "module", subjectRole: "panel", targetId: centerHubId },
    ],
    enabled: true,
    pipeline: {
      sources: [
        { id: uid(), variableName: "containerLabel", entityType: "trigger", triggerProp: "containerLabel" },
        { id: uid(), variableName: "triggerOccId",   entityType: "trigger", triggerProp: "occurrenceId" },
      ],
      steps: [
        // Bind $item to the freshly-created occurrence so UPDATE paths resolve.
        { id: uid(), type: "action", config: {
            type: "FIND",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "$item.id", comparator: "IS", right: "$triggerOccId" },
            ]},
            itemVar: "$item",
        }},
        // Date stamping is handled by the drop side (dropHandlers.stampPageFilterFields)
        // which reads the slot's parent-chain effective filter at drop time. The
        // Stamp op only handles the timeslot label, which is derived from the
        // slot container the instance was dropped into.
        { id: uid(), type: "action", config: {
            type: "UPDATE",
            path: `$item.fields.${timeslotFieldId}.value`,
            value: "$containerLabel",
        }},
      ],
    },
  }).save();

  await new Operation({
    id: uid(), userId, gridId, name: "Schedule: Clear Date on Move-Out",
    description:
      "When an occurrence is moved (not copied), check whether it still lives under the Schedule page. " +
      "If it has been moved out of the schedule, clear its date + timeslot fields. Copy creates a new " +
      "occurrence with a different ID, so this op naturally does not fire on copy.",
    priority: 2, // Field stamp — runs after auto-build (1)
    triggerTypes: ["onMove"],
    triggerObjects: [
      { eventType: "onMove", subjectType: "occurrence", targetId: "" },
    ],
    enabled: true,
    pipeline: {
      sources: [
        { id: uid(), variableName: "self", entityType: "trigger", triggerProp: "occurrenceId" },
      ],
      steps: [
        { id: uid(), type: "action", config: {
            type: "FIND",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "$item.label", comparator: "IS", right: "Schedule" },
            ]},
            itemIdVar: "$schedPageId",
        }},
        // Walk all items (enriched with _ancestors); locate the moved one by id and
        // clear its schedule fields if it no longer descends from the Schedule page.
        {
          id: uid(), type: "loop", overExpr: "$allItems", as: "$item",
          body: [{
            id: uid(), type: "if",
            condition: { operator: "AND", rules: [
              { id: uid(), left: "$item.id",         comparator: "IS",                right: "$self" },
              { id: uid(), left: "$item._ancestors", comparator: "NOT_HAS_ANCESTOR",  right: "$schedPageId" },
            ]},
            then: [
              { id: uid(), type: "action", config: {
                  type: "UPDATE",
                  path: `$item.fields.${dateFieldId}.value`,
                  value: "literal:null",
              }},
              { id: uid(), type: "action", config: {
                  type: "UPDATE",
                  path: `$item.fields.${timeslotFieldId}.value`,
                  value: "literal:null",
              }},
            ],
            else: [],
          }],
        },
      ],
    },
  }).save();

  return {
    gridId,
    gridName,
    schedPageOccId,
    fieldIds: { dateFieldId, waterFieldId, completedFieldId, timeslotFieldId, dueFieldId, totalWaterFieldId, totalTasksCompletedFieldId },
    panelOccIds,
  };
}

async function main() {
  const targetEmail = process.argv[2] || DEFAULT_USER_EMAIL;
  console.log(`🔄 Creating test grid for ${targetEmail}...\n`);
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected\n");

    const user = await User.findOne({ email: targetEmail });
    if (!user) throw new Error(`User not found: ${targetEmail}`);
    const userId = user._id.toString();
    console.log(`✅ Found user: ${userId}\n`);

    const dropped = await dropExistingTestGrid(userId);
    console.log(dropped
      ? `🗑️  Dropped existing "${DEFAULT_GRID_NAME}" + scoped data\n`
      : `🆕 No existing "${DEFAULT_GRID_NAME}" to drop\n`);

    const result = await createTestGrid(userId);

    console.log("=".repeat(50));
    console.log("✅ Test grid created!");
    console.log(`   Grid ID: ${result.gridId}`);
    console.log("=".repeat(50));
    console.log("Layout (2×3):");
    console.log("  [0,0] Daily Toolkit  — Physical → Drink Water, Morning Run, Take Vitamins, Stretch, Take Medication, Go to Gym");
    console.log("  [1,0] Todo List      — General (6 items)");
    console.log("  [0,1] Center Hub ×2  — Schedule (slots created on-demand) | Notes");
    console.log("  [0,2] Daily Goals    — Physical → Water + Tasks totals");
    console.log("=".repeat(50));
  } catch (err) {
    console.error("❌ Failed:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("✅ Disconnected");
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isDirectRun) main();
