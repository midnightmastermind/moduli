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
//   [1,2] Canvas Test    — free-form canvas page seeded with two draggable notes
//
// Schedule slots and the preset routine (Drink Water / Take Medication / Go to Gym)
// are created automatically by the "Schedule: Auto-Build for Active Date" operation
// the first time the user opens or navigates to a given date. Re-running the
// operation on the same date is a no-op.
//
// ─── Seed conventions for operations defined here ──────────────────────────
//   • FIND `predicate.rules[].left` is a bare record path: `label`,
//     `id`, `templateId`, `meta.<k>`, `fields.<fid>.value`, `_ancestors`.
//     No `$item.` prefix on FIND predicate left-sides — predicates evaluate
//     against the candidate record directly (operationActions.js → evalGroupAgainstRecord).
//   • Loop-body IF `condition.rules[].left` IS prefixed (`$item.fields.X.value`,
//     `$item._ancestors`) — IF evaluates via resolveExpr against `$vars`.
//   • UPDATE writes to a real DB record via a `$<var>.fields.<fid>.value` path
//     anchored on a FOUND occurrence (e.g. `$goalItem.fields.<fid>.value`).
//     Use JS `null` (not `"literal:null"`) to clear a field.
//   • Date filtering for goals: prefer `$parentFilter.<dateFieldId>` (walks
//     trigger ancestors merging filterOverride), fall back to
//     `$goalItem._effectiveFilter.<dateFieldId>`, then `$trigger.date`,
//     then `$today`.
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
  // Local-tz YYYY-MM-DD — not toISOString().slice(0,10), which converts to UTC
  // and can roll forward/backward by a day at TZ boundaries (the same bug
  // operationExecutor's $today fix dealt with, see helpers/CLAUDE.md Apr 29).
  const todayLocalISO = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;

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
  const canvasPanelId  = uid();

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
  const canvasNoteAModId    = uid();
  const canvasNoteBModId    = uid();

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
    activeFilterValues: { [dateFieldId]: todayLocalISO },
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
    // Schedulable physical instances all bind dateFieldId (hidden) so the
    // Date field exists on the occurrence when the seed CREATEs a copy in a
    // slot. Without the binding the seed's `date: { fieldId: dateFieldId, ... }`
    // value is still written, but the UI has no way to render or read it via
    // the module binding chain — and the existence-check FIND in seed (which
    // matches `fields.<dateFieldId>.value SAME_DAY $schedDate`) returns null,
    // causing duplicate CREATEs on every run.
    {
      id: morningRunModId, userId, gridId, role: "instance", kind: "list", label: "Morning Run",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: completedFieldId, role: "input", order: 0 },
        { fieldId: dateFieldId, role: "input", order: 1, hidden: true },
      ],
    },
    {
      id: vitaminsModId, userId, gridId, role: "instance", kind: "list", label: "Take Vitamins",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: completedFieldId, role: "input", order: 0 },
        { fieldId: dateFieldId, role: "input", order: 1, hidden: true },
      ],
    },
    {
      id: stretchModId, userId, gridId, role: "instance", kind: "list", label: "Stretch",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: completedFieldId, role: "input", order: 0 },
        { fieldId: dateFieldId, role: "input", order: 1, hidden: true },
      ],
    },
    {
      id: takeMedicationModId, userId, gridId, role: "instance", kind: "list", label: "Take Medication",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: completedFieldId, role: "input", order: 0 },
        { fieldId: dateFieldId, role: "input", order: 1, hidden: true },
      ],
    },
    {
      id: goToGymModId, userId, gridId, role: "instance", kind: "list", label: "Go to Gym",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: completedFieldId, role: "input", order: 0 },
        { fieldId: dateFieldId, role: "input", order: 1, hidden: true },
      ],
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
    // Canvas test instances — used to verify drag-to and drag-from canvas.
    {
      id: canvasNoteAModId, userId, gridId, role: "instance", kind: "list", label: "Canvas Note A",
      defaultDragMode: "move",
      // dateFieldId is hidden but bound so the schedule's drop-stamp logic
      // can populate it when the note is dragged into a slot — required for
      // Tracker: Tasks Completed Today's `date SAME_DAY $goalDate` predicate.
      fieldBindings: [
        { fieldId: completedFieldId, role: "input", order: 0 },
        { fieldId: dateFieldId,      role: "input", order: 1, hidden: true },
      ],
    },
    {
      id: canvasNoteBModId, userId, gridId, role: "instance", kind: "list", label: "Canvas Note B",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: completedFieldId, role: "input", order: 0 },
        { fieldId: dateFieldId,      role: "input", order: 1, hidden: true },
      ],
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
    { id: canvasPanelId,  userId, gridId, role: "panel", kind: "board", label: "Panel E", defaultDragMode: "move", layout: panelLayout("Panel E") },
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

  // Pre-generate container occurrence IDs so each instance occurrence can
  // declare its parentId at creation time. parentId points at the parent
  // occurrence (not the parent module) — same convention CREATE pipelines use.
  const physContOccId = uid();
  const physGoalContOccId = uid();
  const todoContOccId = uid();

  // Toolkit Physical container instances
  const drinkWaterOccId = await mkOcc({
    moduleId: drinkWaterModId,
    parentId: physContOccId, fields: {},
  });
  const morningRunOccId = await mkOcc({
    moduleId: morningRunModId,
    parentId: physContOccId, fields: {},
  });
  const vitaminsOccId = await mkOcc({
    moduleId: vitaminsModId,
    parentId: physContOccId,
    fields: { [completedFieldId]: { value: true, flow: "in", timestamp: new Date() } },
  });
  const stretchOccId = await mkOcc({
    moduleId: stretchModId,
    parentId: physContOccId, fields: {},
  });
  const takeMedicationOccId = await mkOcc({
    moduleId: takeMedicationModId,
    parentId: physContOccId, fields: {},
  });
  const goToGymOccId = await mkOcc({
    moduleId: goToGymModId,
    parentId: physContOccId, fields: {},
  });

  // Goals container instances — goals are persistent (no date field), so they
  // remain visible regardless of the active filter date.
  const waterGoalOccId = await mkOcc({
    moduleId: waterGoalModId,
    parentId: physGoalContOccId,
    fields: {},
  });
  const tasksGoalOccId = await mkOcc({
    moduleId: tasksGoalModId,
    parentId: physGoalContOccId, fields: {},
  });

  await mkOcc({
    id: physContOccId,
    moduleId: physicalContId,
    occurrences: [drinkWaterOccId, morningRunOccId, vitaminsOccId, stretchOccId, takeMedicationOccId, goToGymOccId],
    filterOverride: {}
  });
  await mkOcc({
    id: physGoalContOccId,
    moduleId: physicalGoalContId,
    occurrences: [waterGoalOccId, tasksGoalOccId],
  });

  // Todo instances
  const todoGroceriesOccId = await mkOcc({
    moduleId: todoGroceriesModId,
    parentId: todoContOccId,
    fields: { [dueFieldId]: { value: in2Days.toISOString(), flow: "in", timestamp: new Date() } },
  });
  const todoDentistOccId = await mkOcc({
    moduleId: todoDentistModId,
    parentId: todoContOccId,
    fields: { [dueFieldId]: { value: in7Days.toISOString(), flow: "in", timestamp: new Date() } },
  });
  const todoReviewPROccId = await mkOcc({
    moduleId: todoReviewPRModId,
    parentId: todoContOccId,
    fields: { [dueFieldId]: { value: in1Day.toISOString(), flow: "in", timestamp: new Date() } },
  });
  const todoBillsOccId = await mkOcc({
    moduleId: todoBillsModId,
    parentId: todoContOccId,
    fields: {
      [completedFieldId]: { value: true, flow: "in", timestamp: new Date() },
      [dueFieldId]: { value: today.toISOString(), flow: "in", timestamp: new Date() },
    },
  });
  const todoReadOccId = await mkOcc({
    moduleId: todoReadModId,
    parentId: todoContOccId, fields: {},
  });
  const todoEmailOccId = await mkOcc({
    moduleId: todoEmailModId,
    parentId: todoContOccId, fields: {},
  });

  await mkOcc({
    id: todoContOccId,
    moduleId: todoGeneralContId,
    occurrences: [todoReviewPROccId, todoBillsOccId, todoGroceriesOccId, todoDentistOccId, todoReadOccId, todoEmailOccId],
    filterOverride: {}
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
  await mkOcc({ id: toolkitPageOccId, moduleId: toolkitPageModId, parentId: rootFolderId, sortOrder: 0, occurrences: [physContOccId], iteration: { mode: "persistent" }, fields: {}, filterOverride: {} });

  const goalsPageModId = uid(); const goalsPageOccId = uid();
  await new Module({ id: goalsPageModId, userId, gridId, role: "page", kind: "board", label: "Daily Goals" }).save();
  await mkOcc({ id: goalsPageOccId, moduleId: goalsPageModId, parentId: rootFolderId, sortOrder: 1, occurrences: [physGoalContOccId], iteration: { mode: "persistent" }, fields: {} });

  const todoPageModId = uid(); const todoPageOccId = uid();
  await new Module({ id: todoPageModId, userId, gridId, role: "page", kind: "board", label: "Todo List" }).save();
  await mkOcc({ id: todoPageOccId, moduleId: todoPageModId, parentId: rootFolderId, sortOrder: 2, occurrences: [todoContOccId], iteration: { mode: "persistent" }, fields: {}, filterOverride: {} });

  const schedPageModId = uid(); const schedPageOccId = uid();
  await new Module({ id: schedPageModId, userId, gridId, role: "page", kind: "board", label: "Schedule" }).save();
  await mkOcc({
    id: schedPageOccId, moduleId: schedPageModId,
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
  await mkOcc({ id: notesPageOccId, moduleId: notesPageModId, parentId: notesFolderId, sortOrder: 0, iteration: { mode: "persistent" }, textmap: { type: "doc", content: [{ type: "paragraph" }] }, fields: {} });

  // Canvas test page — placed in [1,2] (bottom-right). Two seed instances pinned
  // at meta.x/y so drag-FROM-canvas can be exercised; the empty space on the
  // dot-grid is the drop zone for drag-TO-canvas (from CC, pool, other panels).
  const canvasPageModId = uid(); const canvasPageOccId = uid();
  await new Module({ id: canvasPageModId, userId, gridId, role: "page", kind: "canvas", label: "Canvas Test" }).save();

  const canvasNoteAOccId = await mkOcc({
    moduleId: canvasNoteAModId,
    parentId: canvasPageOccId,
    fields: {},
    meta: { x: 60, y: 60 },
  });
  const canvasNoteBOccId = await mkOcc({
    moduleId: canvasNoteBModId,
    parentId: canvasPageOccId,
    fields: {},
    meta: { x: 240, y: 140 },
  });

  await mkOcc({
    id: canvasPageOccId,
    moduleId: canvasPageModId,
    parentId: rootFolderId,
    sortOrder: 4,
    iteration: { mode: "persistent" },
    occurrences: [canvasNoteAOccId, canvasNoteBOccId],
    fields: {},
    // Canvas Test is a scratchpad — explicit `{}` override blocks the grid's
    // daily date filter from cascading down, matching the Physical (Daily
    // Toolkit) + General (Todo List) container behaviour. Without this, the
    // canvas inherits the date filter and the notes vanish on any non-today
    // navigation.
    filterOverride: {},
  });

  await new View({ id: centerHubViewId, userId, gridId, viewType: "board", activeOccurrenceId: schedPageOccId }).save();

  // ── STEP 9: Panel occurrences (grid placements) ─────────────────────────────
  const panelOccIds = {};
  const placements = [
    { key: "toolkit",  panelId: toolkitPanelId, row: 0, col: 0, width: 1, height: 1, viewId: null            },
    { key: "todo",     panelId: todoPanelId,    row: 1, col: 0, width: 1, height: 1, viewId: null            },
    { key: "hub",      panelId: centerHubId,    row: 0, col: 1, width: 1, height: 2, viewId: centerHubViewId },
    { key: "goals",    panelId: goalsPanelId,   row: 0, col: 2, width: 1, height: 1, viewId: null            },
    { key: "canvas",   panelId: canvasPanelId,  row: 1, col: 2, width: 1, height: 1, viewId: null            },
  ];

  const gridOccIds = [];
  for (const p of placements) {
    const occId = await mkOcc({
      moduleId: p.panelId,
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
  await Occurrence.findOneAndUpdate({ id: panelOccIds.canvas },  { $set: { occurrences: [canvasPageOccId] } });

  // ── STEP 11: Finalize grid ──────────────────────────────────────────────────
  await Grid.findByIdAndUpdate(grid._id, { $set: { occurrences: gridOccIds } });

  // ── STEP 12: Operations ─────────────────────────────────────────────────────

  await new Operation({
    id: uid(), userId, gridId, name: "Tracker: Water Today",
    description: "Sum water oz under the Schedule page for the date the Daily Goals page is showing.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    // Per-trigger priority 3: runs AFTER seed (priority 2) on the same Daily
    // Goals filter change, so the new occurrences are present in the live overlay
    // when this aggregates. onAdd/onDelete catch drag-into-Schedule and item
    // removal — without them, dragging a pre-completed water item into a slot
    // never recounts the total (the create's MeasureOps fire against pre-stamp
    // fields and only `onChange` listened, not `OccurrenceCreateOp`).
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: waterFieldId,    priority: 3 },
      { eventType: "onChange",       subjectType: "field",     targetId: completedFieldId, priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Daily Goals", priority: 3 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 3 },
    ],
    enabled: true,
    pipeline: {
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$total", value: 0 } },

        // The Schedule page is where the data lives — used for the HAS_ANCESTOR scope
        // so we only sum entries written into the schedule.
        { id: uid(), type: "action", config: {
            type: "FIND",
            over: "$allPages",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "label", comparator: "IS", right: "Schedule" },
            ]},
            itemIdVar: "$schedPageId",
        }},

        // Locate the goal display item — this is the UPDATE target (carries the
        // totalWater field binding). Its ancestor chain (the Daily Goals page)
        // is what we honour via $parentFilter.
        { id: uid(), type: "action", config: {
            type: "FIND",
            over: "$allInstances",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "label", comparator: "IS", right: "Physical Wellness" },
            ]},
            itemIdVar: "$goalId",
            itemVar: "$goalItem",
        }},
        // $goalDate must come from the GOAL ITEM's effective filter — the
        // date the Daily Goals page is showing — NOT from $parentFilter.
        // $parentFilter walks the *trigger's* ancestor chain, so on a
        // MeasureOp from the Schedule page (e.g. logging water) it resolves
        // to the schedule's filter, which is the wrong source for a goal
        // aggregation that should honour the Daily Goals page's filter.
        // Order: goalItem._effectiveFilter → $parentFilter → trigger.date → today.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalDate", expr: `$goalItem._effectiveFilter.${dateFieldId}` } },
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$goalDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalDate", expr: `$parentFilter.${dateFieldId}` } }],
          else: [],
        },
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

        // No self-heal: Seed Daily Routine subscribes directly to onFilterChange
        // on Daily Goals at priority 2, so by the time this op runs at priority 3
        // the schedule items already exist in the live overlay.

        {
          id: uid(), type: "if",
          condition: {
            operator: "OR",
            rules: [
              { id: uid(), left: "$trigger.type", comparator: "IS", right: "onLoad" },
              { id: uid(), left: "$trigger.type", comparator: "IS", right: "NavigationOp" },
              { id: uid(), left: "$trigger.type", comparator: "IS", right: "OccurrenceCreateOp" },
              { id: uid(), left: "$trigger.type", comparator: "IS", right: "OccurrenceDeleteOp" },
              {
                id: uid(), operator: "AND",
                rules: [
                  { id: uid(), left: "$trigger.type", comparator: "IS", right: "MeasureOp" },
                  {
                    id: uid(), operator: "OR",
                    rules: [
                      { id: uid(), left: "$trigger.fieldId", comparator: "IS", right: waterFieldId },
                      { id: uid(), left: "$trigger.fieldId", comparator: "IS", right: completedFieldId },
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
                    { id: uid(), left: `$item.fields.${dateFieldId}.value`,      comparator: "SAME_DAY",     right: "$goalDate" },
                    { id: uid(), left: "$item._ancestors",                       comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                  ],
                },
                then: [{ id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$total", expr: `$item.fields.${waterFieldId}.value` } }],
                else: [],
              }],
            },
            // Write the aggregated total to the goal record itself.
            { id: uid(), type: "action", config: {
                type: "UPDATE",
                path: `$goalItem.fields.${totalWaterFieldId}.value`,
                value: "$total",
            }},
          ],
          else: [],
        },
      ],
    },
  }).save();

  await new Operation({
    id: uid(), userId, gridId, name: "Tracker: Tasks Completed Today",
    description: "Count completed tasks under the Schedule page for the date the Daily Goals page is showing.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    // Per-trigger priority 3: runs AFTER seed (priority 2) on a Daily Goals
    // filter change so newly-seeded occurrences are visible in the live overlay.
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: completedFieldId, priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Daily Goals", priority: 3 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 3 },
    ],
    enabled: true,
    pipeline: {
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$count", value: 0 } },

        // The Schedule page is the data source — used for the HAS_ANCESTOR scope.
        { id: uid(), type: "action", config: {
            type: "FIND",
            over: "$allPages",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "label", comparator: "IS", right: "Schedule" },
            ]},
            itemIdVar: "$schedPageId",
        }},

        // Locate the goal display item; its own effective filter date is what we
        // aggregate for. The goal page is independent of the schedule page.
        { id: uid(), type: "action", config: {
            type: "FIND",
            over: "$allInstances",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "label", comparator: "IS", right: "Task Progress" },
            ]},
            itemIdVar: "$goalId",
            itemVar: "$goalItem",
        }},
        // $goalDate must come from the GOAL ITEM's effective filter — the
        // date the Daily Goals page is showing — NOT from $parentFilter.
        // $parentFilter walks the *trigger's* ancestor chain, so on a
        // MeasureOp from the Schedule page (e.g. checking off a task) it
        // resolves to the schedule's filter, which is the wrong source for
        // a goal aggregation that should honour the Daily Goals page's filter.
        // Order: goalItem._effectiveFilter → $parentFilter → trigger.date → today.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalDate", expr: `$goalItem._effectiveFilter.${dateFieldId}` } },
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$goalDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalDate", expr: `$parentFilter.${dateFieldId}` } }],
          else: [],
        },
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

        // No self-heal: Seed Daily Routine fires first at priority 2 on the same
        // Daily Goals onFilterChange, so the schedule items already exist.

        {
          id: uid(), type: "if",
          condition: {
            operator: "OR",
            rules: [
              { id: uid(), left: "$trigger.type", comparator: "IS", right: "onLoad" },
              { id: uid(), left: "$trigger.type", comparator: "IS", right: "NavigationOp" },
              { id: uid(), left: "$trigger.type", comparator: "IS", right: "OccurrenceCreateOp" },
              { id: uid(), left: "$trigger.type", comparator: "IS", right: "OccurrenceDeleteOp" },
              {
                id: uid(), operator: "AND",
                rules: [
                  { id: uid(), left: "$trigger.type",    comparator: "IS", right: "MeasureOp" },
                  { id: uid(), left: "$trigger.fieldId", comparator: "IS", right: completedFieldId },
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
                    { id: uid(), left: `$item.fields.${dateFieldId}.value`,      comparator: "SAME_DAY",     right: "$goalDate" },
                    { id: uid(), left: "$item._ancestors",                       comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                  ],
                },
                then: [{ id: uid(), type: "action", config: { type: "INCREMENT_VAR", name: "$count", by: 1 } }],
                else: [],
              }],
            },
            // Write the count to the goal record itself.
            { id: uid(), type: "action", config: {
                type: "UPDATE",
                path: `$goalItem.fields.${totalTasksCompletedFieldId}.value`,
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
    triggerTypes: ["onLoad"],
    triggerObjects: [
      { eventType: "onLoad", subjectType: "grid", targetId: "", priority: 1 },
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

        // $schedDate fallback chain:
        //   1. Schedule page's effective filter (page filterOverride layered on grid filter)
        //   2. $trigger.date (set on NavigationOp by LocalFilterNav)
        //   3. $today
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: `$schedPage._effectiveFilter.${dateFieldId}` } },
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$schedDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: "$trigger.date" } }],
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
                    over: "$allContainers",
                    predicate: { operator: "AND", rules: [
                      { id: uid(), left: "meta.scheduleSlot", comparator: "IS", right: true },
                      { id: uid(), left: "meta.slotLabel",    comparator: "IS", right: "$slot.label" },
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
                        fieldHidden: { [timeslotFieldId]: true },
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
                          type: "CREATE",
                          name: "$todoLabel",
                          role: "instance",
                          kind: "list",
                          parent: "$dueId",
                          // Stamp both: dateFieldId for the schedule's date
                          // cascade, dueFieldId so the visible "Due" field on
                          // the swept copy renders the actual date (instead
                          // of the empty field-name fallback). The original
                          // todo's dueDate matched $schedDate to be swept.
                          fields: {
                            [dateFieldId]: "$schedDate",
                            [dueFieldId]:  "$schedDate",
                          },
                          fieldHidden: { [dateFieldId]: true },
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
    // Per-trigger priority 2: runs after auto-build (1) creates the slots but
    // BEFORE goal aggregations (3) read the data. Two ancestor-scoped
    // onFilterChange entries — Schedule page change re-seeds for the new date,
    // and Daily Goals page change re-seeds before the trackers aggregate.
    triggerTypes: ["onLoad", "onFilterChange"],
    triggerObjects: [
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 2 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Schedule",    priority: 2 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Daily Goals", priority: 2 },
    ],
    enabled: true,
    pipeline: {
      steps: [
        // $schedDate fallback chain — trigger-aware so a filter change on
        // Daily Goals (or one of its descendants like Physical) seeds for the
        // GOAL'S date, not the Schedule page's date. Otherwise the trackers
        // ran against the new goal date but found 0 items because the seed
        // had built for the schedule's stale filter.
        //
        // Resolution order:
        //   1. $parentFilter.<dateFieldId> — walks the trigger occurrence's
        //      ancestor chain, so an onFilterChange from Daily Goals resolves
        //      to Daily Goals' override; from Schedule resolves to Schedule's.
        //   2. $schedPage._effectiveFilter.<dateFieldId> — onLoad fallback,
        //      since transaction.occurrenceId is null then and $parentFilter
        //      degrades to grid.activeFilterValues. Without this onLoad
        //      seeded for grid date even when Schedule had its own override.
        //   3. $trigger.date / $today — last-resort fallbacks.
        { id: uid(), type: "action", config: {
            type: "FIND",
            over: "$allPages",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "label", comparator: "IS", right: "Schedule" },
            ]},
            itemIdVar: "$schedPageId",
            itemVar: "$schedPage",
        }},
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: `$parentFilter.${dateFieldId}` } },
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$schedDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: `$schedPage._effectiveFilter.${dateFieldId}` } }],
          else: [],
        },
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$schedDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: "$trigger.date" } }],
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
                over: "$allInstances",
                predicate: { operator: "AND", rules: [
                  { id: uid(), left: "label", comparator: "IS", right: "$preset.moduleLabel" },
                ]},
                itemVar: "$src",
            }},
            { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$srcTemplateId", expr: "$src.templateId" } },

            // Skip if a copy of this preset already lives in this preset's slot
            // FOR THE ACTIVE DATE. The FIND must include a SAME_DAY rule on the
            // occurrence's date field — without it, today's 6am Drink Water
            // matches every other day's lookup and the seed silently does
            // nothing on any non-today date. (FIND no longer reads cfg.scope —
            // date filtering belongs in the predicate now.)
            //
            // _ancestors HAS_ANCESTOR $schedPageId scopes the FIND to occurrences
            // living under Schedule. Without this scope, a stray occurrence with
            // the same template + slot label + date elsewhere in the grid would
            // satisfy the dedup check and skip the CREATE — duplicating across
            // unrelated panels. With it, the FIND looks only inside the schedule.
            { id: uid(), type: "action", config: {
                type: "FIND",
                over: "$allInstances",
                predicate: { operator: "AND", rules: [
                  { id: uid(), left: "templateId",                      comparator: "IS",           right: "$srcTemplateId" },
                  { id: uid(), left: `fields.${timeslotFieldId}.value`, comparator: "IS",           right: "$preset.slotLabel" },
                  { id: uid(), left: `fields.${dateFieldId}.value`,     comparator: "SAME_DAY",     right: "$schedDate" },
                  { id: uid(), left: "_ancestors",                      comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                ]},
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
                    over: "$allContainers",
                    predicate: { operator: "AND", rules: [
                      { id: uid(), left: "meta.scheduleSlot", comparator: "IS", right: true },
                      { id: uid(), left: "meta.slotLabel",    comparator: "IS", right: "$preset.slotLabel" },
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
                      // Stamp the slot label so the FIND above can de-dupe per
                      // (template, slot) pair, and pass through preset-level
                      // initial field values (date/water/completed). resolveExpr
                      // returns null for absent preset keys so unset fields are
                      // skipped on the create.
                      fields: {
                        [dateFieldId]:     "$schedDate",
                        [timeslotFieldId]: "$preset.slotLabel",
                        [waterFieldId]:    "$preset.water",
                        [completedFieldId]: "$preset.completed",
                      },
                      // Date + Time Slot are stamping metadata, not user-
                      // facing inputs. Mark them hidden so the template's
                      // fieldBindings render only Completed + Water.
                      fieldHidden: {
                        [dateFieldId]: true,
                        [timeslotFieldId]: true,
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
        // No trailing RUN_OPERATION fan-out — the trackers now subscribe
        // directly to onFilterChange on Daily Goals at priority 3, and seed
        // runs first at priority 2 on the same trigger.
      ],
    },
  }).save();

  await new Operation({
    id: uid(), userId, gridId, name: "Schedule: Stamp Date & Time Slot",
    triggerTypes: ["onCreate"],
    // Per-trigger priority 2: field stamps run after auto-build (1).
    triggerObjects: [
      { eventType: "onCreate", subjectType: "module", subjectRole: "panel", targetId: centerHubId, priority: 2 },
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
  }).save();

  await new Operation({
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
    console.log("  [1,2] Canvas Test    — free-form canvas page (Canvas Note A, B pinned)");
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
