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
//   • Date filtering for goals: drive the date off the goal item's own
//     `$goalItem._effectiveFilter.<dateFieldId>` (resolves the full
//     instance → container → page → grid chain via the occurrences[] reverse
//     map), then fall back to `$trigger.date`, then `$today`. Do NOT use
//     `$parentFilter` for goals — it is anchored on the trigger occurrence,
//     so a MeasureOp from a Schedule task resolves to Schedule's date, not
//     the goal's effective filter.
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
  const dayPagesFolderId = uid();
  const tasksFolderId    = uid();
  const trackersFolderId = uid();
  const interfacesFolderId = uid();

  // ── STEP 1: Grid ────────────────────────────────────────────────────────────
  const schedFilterId = uid();
  const timeslotFilterId = uid();

  // Time slots are needed BOTH for the schedule subtree (~line 309) and for
  // the per-occurrence timeslot filter's pre-baked option list. Hoist so
  // both call sites use the same source.
  const timeSlots = generateTimeSlots();
  const timeslotLabels = timeSlots.map(s => s.label);

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
    // Leave empty — client init resolves to local-tz today on every load.
    // Seeding a literal date "bakes in" the seed day and shows yesterday after
    // midnight passes.
    activeFilterValues: {},
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
  // timeSlots is hoisted near the grid namedFilters so the timeslot filter
  // can bake its label list at filter-definition time. Reuse it here.
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
  // Root tree organization: Tasks / Trackers / Interfaces / Notes / Day Pages.
  await new Folder({ id: tasksFolderId,     userId, gridId, parentId: rootFolderId, name: "Tasks",      folderType: "normal", sortOrder: 0, isExpanded: true }).save();
  await new Folder({ id: trackersFolderId,  userId, gridId, parentId: rootFolderId, name: "Trackers",   folderType: "normal", sortOrder: 1, isExpanded: true }).save();
  await new Folder({ id: interfacesFolderId,userId, gridId, parentId: rootFolderId, name: "Interfaces", folderType: "normal", sortOrder: 2, isExpanded: true }).save();
  await new Folder({ id: notesFolderId, userId, gridId, parentId: rootFolderId, name: "Notes", folderType: "normal", sortOrder: 3, isExpanded: true }).save();
  // Day Pages folder — the "Day Page: Build" op drops one doc page per date here.
  await new Folder({ id: dayPagesFolderId, userId, gridId, parentId: rootFolderId, name: "Day Pages", folderType: "day-pages", sortOrder: 4, isExpanded: true }).save();

  // ── STEP 7b: Templates manifest ─────────────────────────────────────────────
  // The templates manifest holds the "Daily Routine" template subtree. The
  // APPLY_TEMPLATE action looks up the template occurrence by id from occurrencesById,
  // so we just need the occurrence to exist in the DB with meta.templateName set.
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

  // ── "Daily Routine" template — the FULL schedule subtree ─────────────────
  // Root: container "Daily Routine" (page-kind so it visually mirrors the
  //   schedule page when previewed)
  // Children: 48 slot containers (cloned shape — same as live slot containers)
  // Within slot containers: the routine instances pre-placed (Drink Water in
  //   6:00am + 7:00am slots, Take Medication in 8:00am, Go to Gym in 9:00am)
  // Build Day applies this via APPLY_TEMPLATE with unwrapRoot:true so the
  // 48 slot containers land directly under the schedule page (no wrapper).
  const tplRoutineRootModId = uid();
  await new Module({
    id: tplRoutineRootModId, userId, gridId,
    role: "page", kind: "board", label: "Daily Routine",
    meta: { templateModule: true },
  }).save();

  const tplRoutineRootOccId = uid();

  // Per-slot routine items: which routine instances live in which slot label
  const routineBySlot = {
    "6:00am": [{ sourceModId: drinkWaterModId,     label: "Drink Water",     completed: true, water: 10 }],
    "7:00am": [{ sourceModId: drinkWaterModId,     label: "Drink Water" }],
    "8:00am": [{ sourceModId: takeMedicationModId, label: "Take Medication" }],
    "9:00am": [{ sourceModId: goToGymModId,        label: "Go to Gym" }],
  };

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
      const srcMod = await Module.findOne({ id: r.sourceModId, gridId }).lean();
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
      if (r.completed) initialFields[completedFieldId] = { value: true, flow: "in" };
      if (r.water != null) initialFields[waterFieldId] = { value: r.water, flow: "in" };
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

  // ── STEP 8: Page modules + page occurrences ─────────────────────────────────
  // Date-filter scope rule (per user): only Schedule + Daily Goals pages
  // (and the toolbar/grid filter) are allowed to actively filter by date.
  // Every other page declares BOTH:
  //   1. `filterOverride: {}` — clears any inherited grid date so the page's
  //      own children aren't hidden by date.
  //   2. `filterNavConfig: { filter_daily: { visible: false } }` — explicitly
  //      hides the date nav widget that LocalFilterNav would otherwise render
  //      by default (any active grid filter with `isNav: true` conditions
  //      shows nav everywhere unless explicitly hidden per-occurrence).
  // Without (2), the user could nav-arrow these pages and silently re-add
  // dateFieldId back into filterOverride, undoing (1).
  const toolkitPageModId = uid(); const toolkitPageOccId = uid();
  await new Module({ id: toolkitPageModId, userId, gridId, role: "page", kind: "board", label: "Daily Toolkit" }).save();
  await mkOcc({ id: toolkitPageOccId, moduleId: toolkitPageModId, parentId: tasksFolderId, sortOrder: 0, occurrences: [physContOccId], iteration: { mode: "persistent" }, fields: {}, filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } } });

  const goalsPageModId = uid(); const goalsPageOccId = uid();
  await new Module({ id: goalsPageModId, userId, gridId, role: "page", kind: "board", label: "Daily Goals" }).save();
  await mkOcc({ id: goalsPageOccId, moduleId: goalsPageModId, parentId: trackersFolderId, sortOrder: 0, occurrences: [physGoalContOccId], iteration: { mode: "persistent" }, fields: {} });

  const todoPageModId = uid(); const todoPageOccId = uid();
  await new Module({ id: todoPageModId, userId, gridId, role: "page", kind: "board", label: "Todo List" }).save();
  await mkOcc({ id: todoPageOccId, moduleId: todoPageModId, parentId: tasksFolderId, sortOrder: 1, occurrences: [todoContOccId], iteration: { mode: "persistent" }, fields: {}, filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } } });

  const schedPageModId = uid(); const schedPageOccId = uid();
  await new Module({ id: schedPageModId, userId, gridId, role: "page", kind: "board", label: "Schedule" }).save();
  await mkOcc({
    id: schedPageOccId, moduleId: schedPageModId,
    parentId: interfacesFolderId, sortOrder: 0, occurrences: scheduleOccIds,
    iteration: { mode: "persistent" }, fields: {},
    filters: [
      // Date filter — existed before, kept as-is.
      {
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
      },
      // Time Slot filter — local to the schedule page only. Renders as a
      // <select> dropdown over the 48 slot labels. Picking a slot writes
      // filterOverride[timeslotFieldId] which `isOccurrenceVisible` matches
      // against each slot container's stored `fields.timeslot.value`. The
      // "— any —" option clears the override and restores all slots.
      {
        id: timeslotFilterId,
        fieldId: timeslotFieldId,
        active: true,
        showNav: true,
        style: "select",
        options: timeslotLabels,
        condition: null, // no extra rule — comparator is exact match via filterOverride
      },
    ],
  });

  const notesPageModId = uid(); const notesPageOccId = uid();
  await new Module({ id: notesPageModId, userId, gridId, role: "page", kind: "doc", label: "Notes" }).save();
  await mkOcc({ id: notesPageOccId, moduleId: notesPageModId, parentId: notesFolderId, sortOrder: 0, iteration: { mode: "persistent" }, textmap: { type: "doc", content: [{ type: "paragraph" }] }, fields: {}, filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } } });

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
    parentId: interfacesFolderId,
    sortOrder: 1,
    iteration: { mode: "persistent" },
    occurrences: [canvasNoteAOccId, canvasNoteBOccId],
    fields: {},
    // Canvas Test is a scratchpad — explicit `{}` override blocks the grid's
    // daily date filter from cascading down, matching the Physical (Daily
    // Toolkit) + General (Todo List) container behaviour. Without this, the
    // canvas inherits the date filter and the notes vanish on any non-today
    // navigation. filterNavConfig also hides the date nav widget so the user
    // can't accidentally re-add a date override via nav arrows.
    filterOverride: {},
    filterNavConfig: { filter_daily: { visible: false } },
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
        // totalWater field binding). $goalDate is driven off its own
        // _effectiveFilter (instance → Physical container → Daily Goals page).
        { id: uid(), type: "action", config: {
            type: "FIND",
            over: "$allInstances",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "label", comparator: "IS", right: "Physical Wellness" },
            ]},
            itemIdVar: "$goalId",
            itemVar: "$goalItem",
        }},
        // $goalDate = the goal item's OWN effective filter. $goalItem is the
        // "Physical Wellness" display instance; its ancestor chain is
        //   instance → Physical goal container → Daily Goals page → grid.
        // getEffectiveFilterForOccurrence now walks that chain via the
        // occurrences[]-derived reverse map (not parentId, which is unset on
        // containers/pages), so a date filter set at ANY level — the Physical
        // container OR the Daily Goals page — is picked up here. We do NOT use
        // $parentFilter: it is anchored on the TRIGGER occurrence, so a
        // MeasureOp from logging water on a Schedule task would resolve to
        // Schedule's date (e.g. tomorrow) and write tomorrow's aggregate into
        // the goal the user is viewing for today.
        // Order: $goalItem._effectiveFilter → $trigger.date → today.
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

        // No self-heal: Schedule: Build Day now includes routine seeding at priority 1
        // via APPLY_TEMPLATE, so by the time this tracker runs at priority 3
        // the schedule items already exist in the live overlay.

        {
          id: uid(), type: "if",
          condition: {
            operator: "OR",
            rules: [
              // Bulk events: always run. No trigger item to date-gate on.
              { id: uid(), left: "$trigger.type", comparator: "IS", right: "onLoad" },
              { id: uid(), left: "$trigger.type", comparator: "IS", right: "NavigationOp" },
              // Item-bearing events: only run when the trigger item's date matches
              // the goal date. Otherwise we'd recompute today's water sum every
              // time a tomorrow-dated water entry changes — wasted churn.
              {
                id: uid(), operator: "AND",
                rules: [
                  { id: uid(), left: "$trigger.type", comparator: "IS", right: "OccurrenceCreateOp" },
                  { id: uid(), left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$goalDate" },
                ],
              },
              {
                id: uid(), operator: "AND",
                rules: [
                  { id: uid(), left: "$trigger.type", comparator: "IS", right: "OccurrenceDeleteOp" },
                  { id: uid(), left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$goalDate" },
                ],
              },
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
                  { id: uid(), left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$goalDate" },
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
        // $goalDate = the goal item's OWN effective filter. $goalItem is the
        // "Task Progress" display instance; its ancestor chain is
        //   instance → Physical goal container → Daily Goals page → grid.
        // getEffectiveFilterForOccurrence now walks that chain via the
        // occurrences[]-derived reverse map (not parentId, which is unset on
        // containers/pages), so a date filter set at ANY level — the Physical
        // container OR the Daily Goals page — is picked up here. We do NOT use
        // $parentFilter: it is anchored on the TRIGGER occurrence, so a
        // MeasureOp from checking off a Schedule task would resolve to
        // Schedule's date (e.g. tomorrow) and write tomorrow's aggregate into
        // the goal the user is viewing for today.
        // Order: $goalItem._effectiveFilter → $trigger.date → today.
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

        // No self-heal: Schedule: Build Day seeds the routine at priority 1 via
        // APPLY_TEMPLATE, so items already exist by the time this runs at priority 3.

        {
          id: uid(), type: "if",
          condition: {
            operator: "OR",
            rules: [
              // Bulk events: always run. No trigger item to date-gate on.
              { id: uid(), left: "$trigger.type", comparator: "IS", right: "onLoad" },
              { id: uid(), left: "$trigger.type", comparator: "IS", right: "NavigationOp" },
              // Item-bearing events: only run when the trigger item's date matches
              // the goal date. Without this gate, completing a tomorrow-dated task
              // while viewing today re-aggregates today's count and re-writes the
              // same value back to the goal record — wasted churn that the user
              // perceives as "today's goal updating from a tomorrow action".
              {
                id: uid(), operator: "AND",
                rules: [
                  { id: uid(), left: "$trigger.type", comparator: "IS", right: "OccurrenceCreateOp" },
                  { id: uid(), left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$goalDate" },
                ],
              },
              {
                id: uid(), operator: "AND",
                rules: [
                  { id: uid(), left: "$trigger.type", comparator: "IS", right: "OccurrenceDeleteOp" },
                  { id: uid(), left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$goalDate" },
                ],
              },
              {
                id: uid(), operator: "AND",
                rules: [
                  { id: uid(), left: "$trigger.type",    comparator: "IS", right: "MeasureOp" },
                  { id: uid(), left: "$trigger.fieldId", comparator: "IS", right: completedFieldId },
                  { id: uid(), left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$goalDate" },
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
  // Two responsibilities:
  //   1. Ensure the schedule shell exists (Due + 48 timeslot containers, created ONCE).
  //   2. Seed the Daily Routine instances for the active date via APPLY_TEMPLATE
  //      (idempotent: skips if routine instances for that date already exist).
  // Also sweeps todos whose dueDate matches the active date into Due.
  // "Schedule: Seed Daily Routine" has been removed; this op now owns both jobs.
  await new Operation({
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
  }).save();


  // ── Day Page: Build ──────────────────────────────────────────────────────
  // Same trigger surface + $date resolution chain as "Schedule: Build Day".
  // Per active date: ensure a doc page "Day Page - <date>" exists in the Day
  // Pages folder. If missing, APPLY_TEMPLATE the "Day Page" template as a fresh
  // standalone page (rootParent = Day Pages folder, rootLabel = the dated
  // name) with replacements { "{Date}": "$dayDate" } so the cloned textblock
  // H1 reads "Day Page - <date>". Idempotent: the existence FIND is by the
  // deterministic page label.
  await new Operation({
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
                    parentId: panelOccIds.hub,
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
