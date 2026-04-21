// scripts/createTestGrid.js
// ============================================================
// Creates a deterministic minimal test grid for any user. Used by
// resetData.js to seed both josh@jpoms.com and test@moduli.test
// with the same fixture, and runnable standalone via:
//
//   node --env-file=.env scripts/createTestGrid.js                 # default user (josh)
//   node --env-file=.env scripts/createTestGrid.js test@moduli.test
//
// Creates only — does NOT drop existing data. Running this against a
// user that already has a "Test Grid" will leave the old one in place
// and create a second grid with the same name. To wipe + recreate for
// both seeded users, use scripts/resetTestGridData.js instead.
//
// Layout (2×3):
//   [0,0] Daily Toolkit  — Physical (Drink Water, Morning Run, Vitamins, Stretch)
//   [1,0] Todo List      — General (6 todos)
//   [0,1] Center Hub ×2  — Schedule (48 slots, partially populated) | Notes
//   [0,2] Daily Goals    — Physical (Water + Tasks total displays)
//
// Schedule pre-fill (for onLoad-driven Water/Tasks aggregations):
//   7:00am  Drink Water (16oz, completed)
//   8:30am  Morning Run (completed)
//   9:00am  Drink Water (16oz, completed)
//   11:00am Take Vitamins (completed)
//   12:00pm Drink Water (16oz, completed)
//   1:30pm  Stretch (not completed)
//   3:00pm  Drink Water (8oz, completed)
//   5:00pm  Drink Water (8oz, not completed)
// Expected: Water Today = 56oz / 64oz; Tasks Completed = 6 / 6
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
import { makeLoopCountTrueOp, generateTimeSlots } from "../utils/operationBuilders.js";

const DEFAULT_USER_EMAIL = "josh@jpoms.com";
const DEFAULT_GRID_NAME = "Test Grid";
const uid = () => nanoid(12);

// Schedule pre-fill recipe — instance kind + slot time + field overrides
const SCHEDULE_PREFILL = [
  { instance: "drinkWater", hour: 7,  minute: 0,  water: 16, completed: true  },
  { instance: "morningRun", hour: 8,  minute: 30, completed: true             },
  { instance: "drinkWater", hour: 9,  minute: 0,  water: 16, completed: true  },
  { instance: "vitamins",   hour: 11, minute: 0,  completed: true             },
  { instance: "drinkWater", hour: 12, minute: 0,  water: 16, completed: true  },
  { instance: "stretch",    hour: 13, minute: 30, completed: false            },
  { instance: "drinkWater", hour: 15, minute: 0,  water: 8,  completed: true  },
  { instance: "drinkWater", hour: 17, minute: 0,  water: 8,  completed: false },
];

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
    { id: todoGeneralContId,  userId, gridId, role: "container", kind: "list", label: "General", defaultDragMode: "move" },
    ...timeSlots.map(slot => ({ id: schedContainers[`slot_${slot.hour}_${slot.minute}`].id, userId, gridId, role: "container", kind: "list", label: slot.label })),
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
    occurrences: [drinkWaterOccId, morningRunOccId, vitaminsOccId, stretchOccId],
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

  // Schedule slot container occurrences (created before pre-fill so we know each slot's id)
  const slotOccByKey = {};
  const scheduleOccIds = [];
  for (const slot of timeSlots) {
    const key = `slot_${slot.hour}_${slot.minute}`;
    const occId = await mkOcc({
      targetType: "module", targetId: schedContainers[key].id,
      fields: {
        [dateFieldId]: { value: today.toISOString(), flow: "in" },
        [timeslotFieldId]: { value: slot.label, flow: "in" },
      },
    });
    slotOccByKey[key] = { occId, slotModuleId: schedContainers[key].id, label: slot.label };
    scheduleOccIds.push(occId);
  }

  // ── STEP 6b: Pre-fill schedule slots with sample tasks/waters ──────────────
  // Each instance gets date = today so onLoad daily aggregations pick it up.
  const instanceModuleByName = {
    drinkWater: drinkWaterModId,
    morningRun: morningRunModId,
    vitamins:   vitaminsModId,
    stretch:    stretchModId,
  };

  for (const entry of SCHEDULE_PREFILL) {
    const key = `slot_${entry.hour}_${entry.minute}`;
    const slot = slotOccByKey[key];
    if (!slot) continue;
    const moduleId = instanceModuleByName[entry.instance];
    if (!moduleId) continue;

    const fields = {
      [dateFieldId]: { value: today.toISOString(), flow: "in", timestamp: new Date() },
      [timeslotFieldId]: { value: slot.label, flow: "in", timestamp: new Date() },
    };
    if (entry.water !== undefined) {
      fields[waterFieldId] = { value: entry.water, flow: "in", timestamp: new Date() };
    }
    if (entry.completed !== undefined) {
      fields[completedFieldId] = { value: entry.completed, flow: "in", timestamp: new Date() };
    }

    const instOccId = await mkOcc({
      targetType: "module", targetId: moduleId,
      meta: { containerId: slot.slotModuleId },
      fields,
    });

    await Occurrence.findOneAndUpdate(
      { id: slot.occId },
      { $push: { occurrences: instOccId } }
    );
  }

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
  const opArgs = { userId, gridId };

  await new Operation({
    id: uid(), userId, gridId, name: "Water Today",
    description: "Sum daily water oz — only for occurrences under the Schedule page",
    triggerType: "onChange",
    triggerTypes: ["onChange", "onFilterChange", "onLoad"],
    triggerConfig: { onChange: { allowedFields: [waterFieldId, completedFieldId] } },
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$total", value: 0 } },
        { id: uid(), type: "action", config: {
            type: "FIND_OCCURRENCE",
            moduleLabelExpr: "literal:Schedule",
            resultVar: "$schedPage",
            resultIdVar: "$schedPageId",
        }},
        {
          id: uid(), type: "loop",
          over: "field_occurrences", fieldId: waterFieldId, timeFilter: "daily", flowFilter: "any", as: "$item",
          body: [{
            id: uid(), type: "if",
            condition: {
              operator: "AND",
              rules: [
                { comparator: "IS_NOT_EMPTY", left: "$item.value" },
                { comparator: "IS", left: `$item.${completedFieldId}`, right: true },
                { comparator: "HAS_ANCESTOR", left: "$item._ancestors", right: "$schedPageId" },
              ],
            },
            then: [{ id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$total", expr: "$item.value" } }],
            else: [],
          }],
        },
        { id: uid(), type: "action", config: {
            type: "SHOW_VALUE", targetFieldId: totalWaterFieldId,
            sourceExpr: "$total", targetValue: 64, targetPeriod: "daily",
        }},
      ],
    },
  }).save();

  await new Operation(makeLoopCountTrueOp({
    name: "Tasks Completed Today",
    targetFieldId: totalTasksCompletedFieldId,
    fieldId: completedFieldId,
    timeFilter: "daily",
    targetValue: 6,
    targetPeriod: "daily",
    pageLabel: "Schedule",
    ...opArgs,
  })).save();

  await new Operation({
    id: uid(), userId, gridId, name: "Schedule: Stamp Date & Time Slot",
    triggerType: "onCreate", triggerTypes: ["onCreate"],
    triggerConfig: { onCreate: { panelId: centerHubId } }, enabled: true,
    pipeline: { sources: [], steps: [
      { id: uid(), type: "action", config: { type: "SET_FIELD_VALUE", fieldId: dateFieldId, valueExpr: "$parentFilter.date" } },
      { id: uid(), type: "action", config: { type: "SET_FIELD_VALUE", fieldId: timeslotFieldId, valueExpr: "$trigger.containerLabel" } },
    ]},
  }).save();

  await new Operation({
    id: uid(), userId, gridId, name: "Schedule: Clear Date & Time Slot",
    triggerType: "onMove", triggerTypes: ["onMove"],
    triggerConfig: { onMove: { fromPanelId: centerHubId } }, enabled: true,
    pipeline: { sources: [], steps: [
      { id: uid(), type: "action", config: { type: "SET_FIELD_VALUE", fieldId: dateFieldId, value: null } },
      { id: uid(), type: "action", config: { type: "SET_FIELD_VALUE", fieldId: timeslotFieldId, value: null } },
    ]},
  }).save();

  return {
    gridId,
    gridName,
    schedPageOccId,
    fieldIds: { dateFieldId, waterFieldId, completedFieldId, timeslotFieldId, dueFieldId, totalWaterFieldId, totalTasksCompletedFieldId },
    panelOccIds,
    prefillCount: SCHEDULE_PREFILL.length,
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

    const result = await createTestGrid(userId);

    console.log("=".repeat(50));
    console.log("✅ Test grid created!");
    console.log(`   Grid ID: ${result.gridId}`);
    console.log(`   Schedule pre-fill: ${result.prefillCount} occurrences`);
    console.log("=".repeat(50));
    console.log("Layout (2×3):");
    console.log("  [0,0] Daily Toolkit  — Physical → Drink Water, Morning Run, Take Vitamins, Stretch");
    console.log("  [1,0] Todo List      — General (6 items)");
    console.log("  [0,1] Center Hub ×2  — Schedule (8 pre-filled slots) | Notes");
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
