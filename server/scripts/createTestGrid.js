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
    description: "Sum daily water oz — only for occurrences under the Schedule page",
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
      ],
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$total", value: 0 } },
        { id: uid(), type: "action", config: {
            type: "FIND_OCCURRENCE",
            moduleLabelExpr: "literal:Schedule",
            resultVar: "$schedPage",
            resultIdVar: "$schedPageId",
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
              id: uid(), type: "loop", overExpr: "$allOccurrences", as: "$item",
              body: [{
                id: uid(), type: "if",
                condition: {
                  operator: "AND",
                  rules: [
                    { id: uid(), left: `$item.fields.${waterFieldId}.value`,     comparator: "IS_NOT_EMPTY", right: "" },
                    { id: uid(), left: `$item.fields.${completedFieldId}.value`, comparator: "IS",           right: true },
                    { id: uid(), left: `$item.fields.${dateFieldId}.value`,      comparator: "SAME_DAY",     right: "$activeDate" },
                    { id: uid(), left: "$item._ancestors",                       comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                  ],
                },
                then: [{ id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$total", expr: `$item.fields.${waterFieldId}.value` } }],
                else: [],
              }],
            },
            { id: uid(), type: "action", config: {
                type: "SHOW_VALUE", targetFieldId: totalWaterFieldId,
                sourceExpr: "$total", targetValue: 64, targetPeriod: "daily",
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
      ],
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$count", value: 0 } },
        { id: uid(), type: "action", config: {
            type: "FIND_OCCURRENCE",
            moduleLabelExpr: "literal:Schedule",
            resultVar: "$schedPage",
            resultIdVar: "$schedPageId",
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
              id: uid(), type: "loop", overExpr: "$allOccurrences", as: "$item",
              body: [{
                id: uid(), type: "if",
                condition: {
                  operator: "AND",
                  rules: [
                    { id: uid(), left: `$item.fields.${completedFieldId}.value`, comparator: "IS",           right: true },
                    { id: uid(), left: `$item.fields.${dateFieldId}.value`,      comparator: "SAME_DAY",     right: "$activeDate" },
                    { id: uid(), left: "$item._ancestors",                       comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                  ],
                },
                then: [{ id: uid(), type: "action", config: { type: "INCREMENT_VAR", name: "$count", by: 1 } }],
                else: [],
              }],
            },
            { id: uid(), type: "action", config: {
                type: "SHOW_VALUE", targetFieldId: totalTasksCompletedFieldId,
                sourceExpr: "$count", targetValue: 6, targetPeriod: "daily",
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
        // Resolve $schedDate = $triggerDate ?? $today
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: "$triggerDate" } },
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$schedDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: "$today" } }],
          else: [],
        },

        // Locate the Schedule page; bail out if missing.
        { id: uid(), type: "action", config: {
            type: "FIND_OCCURRENCE",
            moduleLabelExpr: "literal:Schedule",
            resultIdVar: "$schedPageId",
        }},
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$schedPageId", comparator: "IS_NOT_EMPTY", right: "" }] },
          then: [
            // Ensure Due container module + per-day occurrence.
            { id: uid(), type: "action", config: {
                type: "FIND_MODULE", nameExpr: "literal:Due", resultIdVar: "$dueModId",
            }},
            {
              id: uid(), type: "if",
              condition: { operator: "AND", rules: [{ id: uid(), left: "$dueModId", comparator: "IS_EMPTY", right: "" }] },
              then: [
                { id: uid(), type: "action", config: {
                    type: "CREATE_MODULE", nameExpr: "literal:Due", role: "container", kind: "list",
                    extra: { meta: { scheduleDueContainer: true } },
                }},
                { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$dueModId", expr: "$lastCreatedModuleId" } },
              ],
              else: [],
            },
            { id: uid(), type: "action", config: {
                type: "FIND_OCCURRENCE",
                targetIdExpr: "$dueModId",
                dateFieldId, dateExpr: "$schedDate",
                resultIdVar: "$dueOccId",
            }},
            {
              id: uid(), type: "if",
              condition: { operator: "AND", rules: [{ id: uid(), left: "$dueOccId", comparator: "IS_EMPTY", right: "" }] },
              then: [
                { id: uid(), type: "action", config: {
                    type: "CREATE_OCCURRENCE_FOR_MODULE",
                    moduleIdExpr: "$dueModId",
                    parentIdExpr: "$schedPageId",
                    dateFieldId, dateExpr: "$schedDate",
                    insertAtIndex: 0,
                    resultIdVar: "$dueOccId",
                }},
                { id: uid(), type: "action", config: {
                    type: "SET_FIELD_VALUE",
                    occurrenceIdExpr: "$dueOccId",
                    fieldId: timeslotFieldId,
                    valueExpr: "literal:Due",
                }},
              ],
              else: [],
            },

            // Build all 48 timeslots in a single loop. The slot array is embedded at
            // seed time so the loop runs without per-iteration module lookups.
            // CREATE_OCCURRENCE_FOR_MODULE stamps the date field automatically via
            // dateFieldId/dateExpr — only the timeslot label needs an explicit SET.
            { id: uid(), type: "action", config: {
                type: "INIT_VAR", name: "$slots",
                arrayOf: timeSlots.map(s => ({
                  moduleId: schedContainers[`slot_${s.hour}_${s.minute}`].id,
                  label: s.label,
                })),
            }},
            {
              id: uid(), type: "loop", overExpr: "$slots", as: "$slot",
              body: [
                { id: uid(), type: "action", config: {
                    type: "FIND_OCCURRENCE",
                    targetIdExpr: "$slot.moduleId",
                    dateFieldId, dateExpr: "$schedDate",
                    resultIdVar: "$slotOccId",
                }},
                {
                  id: uid(), type: "if",
                  condition: { operator: "AND", rules: [{ id: uid(), left: "$slotOccId", comparator: "IS_EMPTY", right: "" }] },
                  then: [
                    { id: uid(), type: "action", config: {
                        type: "CREATE_OCCURRENCE_FOR_MODULE",
                        moduleIdExpr: "$slot.moduleId",
                        parentIdExpr: "$schedPageId",
                        dateFieldId, dateExpr: "$schedDate",
                        resultIdVar: "$newSlotOccId",
                    }},
                    { id: uid(), type: "action", config: {
                        type: "SET_FIELD_VALUE",
                        occurrenceIdExpr: "$newSlotOccId",
                        fieldId: timeslotFieldId,
                        valueExpr: "$slot.label",
                    }},
                  ],
                  else: [],
                },
              ],
            },

            // Sweep todos with dueDate === active date into Due.
            { id: uid(), type: "action", config: {
                type: "FIND_OCCURRENCE",
                moduleMetaKey: "todoListContainer",
                moduleMetaValue: true,
                resultIdVar: "$todoContId",
            }},
            {
              id: uid(), type: "if",
              condition: { operator: "AND", rules: [{ id: uid(), left: "$todoContId", comparator: "IS_NOT_EMPTY", right: "" }] },
              then: [{
                id: uid(), type: "loop", overExpr: "$allOccurrences", as: "$todoItem",
                body: [{
                  id: uid(), type: "if",
                  condition: { operator: "AND", rules: [
                    { id: uid(), left: "$todoItem._ancestors", comparator: "HAS_ANCESTOR", right: "$todoContId" },
                    { id: uid(), left: `$todoItem.fields.${dueFieldId}.value`, comparator: "SAME_DAY", right: "$schedDate" },
                  ]},
                  then: [
                    { id: uid(), type: "action", config: {
                        type: "MOVE_OCCURRENCE_TO_PARENT",
                        occurrenceIdExpr: "$todoItem.id",
                        toParentOccIdExpr: "$dueOccId",
                    }},
                    { id: uid(), type: "action", config: {
                        type: "SET_FIELD_VALUE",
                        occurrenceIdExpr: "$todoItem.id",
                        fieldId: dateFieldId,
                        valueExpr: "$schedDate",
                    }},
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
    priority: 4,
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
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: "$triggerDate" } },
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$schedDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: "$today" } }],
          else: [],
        },

        // One presets array, one loop. Each preset = { moduleLabel, slotLabel }.
        { id: uid(), type: "action", config: {
            type: "INIT_VAR", name: "$presets",
            arrayOf: [
              { moduleLabel: "Drink Water",     slotLabel: "7:00am" },
              { moduleLabel: "Take Medication", slotLabel: "8:00am" },
              { moduleLabel: "Go to Gym",       slotLabel: "9:00am" },
            ],
        }},
        {
          id: uid(), type: "loop", overExpr: "$presets", as: "$preset",
          body: [
            // Resolve the source instance module by label → targetId.
            { id: uid(), type: "action", config: {
                type: "FIND_OCCURRENCE",
                moduleLabelExpr: "$preset.moduleLabel",
                resultVar: "$src",
            }},
            { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$srcModId", expr: "$src.targetId" } },

            // Skip if any occurrence of this source already exists for the day.
            { id: uid(), type: "action", config: {
                type: "FIND_OCCURRENCE",
                targetIdExpr: "$srcModId",
                dateFieldId, dateExpr: "$schedDate",
                resultIdVar: "$existing",
            }},
            {
              id: uid(), type: "if",
              condition: { operator: "AND", rules: [{ id: uid(), left: "$existing", comparator: "IS_EMPTY", right: "" }] },
              then: [
                // Locate the target slot for the day.
                { id: uid(), type: "action", config: {
                    type: "FIND_OCCURRENCE",
                    moduleMetaKey: "scheduleSlot",
                    moduleMetaValue: true,
                    moduleMetaSecondaryKey: "slotLabel",
                    moduleMetaSecondaryValue: "$preset.slotLabel",
                    dateFieldId, dateExpr: "$schedDate",
                    resultIdVar: "$slotId",
                }},
                {
                  id: uid(), type: "if",
                  condition: { operator: "AND", rules: [{ id: uid(), left: "$slotId", comparator: "IS_NOT_EMPTY", right: "" }] },
                  then: [{
                    id: uid(), type: "action", config: {
                      type: "CREATE_OCCURRENCE_FOR_MODULE",
                      moduleIdExpr: "$srcModId",
                      parentIdExpr: "$slotId",
                      dateFieldId, dateExpr: "$schedDate",
                      resultIdVar: "$newOcc",
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
      ],
      steps: [
        { id: uid(), type: "action", config: { type: "SET_FIELD_VALUE", fieldId: dateFieldId,     valueExpr: "$parentFilter.date" } },
        { id: uid(), type: "action", config: { type: "SET_FIELD_VALUE", fieldId: timeslotFieldId, valueExpr: "$containerLabel" } },
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
            type: "FIND_OCCURRENCE",
            moduleLabelExpr: "literal:Schedule",
            resultVar: "$schedPage",
            resultIdVar: "$schedPageId",
        }},
        // Walk all occurrences (enriched with _ancestors); locate the moved one by id and
        // clear its schedule fields if it no longer descends from the Schedule page.
        {
          id: uid(), type: "loop", overExpr: "$allOccurrences", as: "$item",
          body: [{
            id: uid(), type: "if",
            condition: { operator: "AND", rules: [
              { id: uid(), left: "$item.id",         comparator: "IS",                right: "$self" },
              { id: uid(), left: "$item._ancestors", comparator: "NOT_HAS_ANCESTOR",  right: "$schedPageId" },
            ]},
            then: [
              { id: uid(), type: "action", config: {
                  type: "SET_FIELD_VALUE",
                  occurrenceIdExpr: "$self",
                  fieldId: dateFieldId,
                  value: null,
              }},
              { id: uid(), type: "action", config: {
                  type: "SET_FIELD_VALUE",
                  occurrenceIdExpr: "$self",
                  fieldId: timeslotFieldId,
                  value: null,
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
