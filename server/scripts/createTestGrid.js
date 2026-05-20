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
import {
  buildGridDoc,
  buildScheduleFilters,
  buildTemplatesManifest,
  buildDailyRoutineTemplate,
  buildDayPageTemplate,
  makeScheduleBuildDayOp,
  makeDayPageBuildOp,
  makeStampDateTimeSlotOp,
  makeClearDateOnMoveOutOp,
  makeTrackerOp,
} from "../utils/liveSystemBuilders.js";

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
  // isTask: hidden boolean marker on every task module (toolkit + todos + daily
  // routine clones). Tracker: Tasks Completed includes `isTask IS true` so only
  // marked tasks count toward the goal — non-task items dragged into Schedule
  // (mood checks, journal entries, etc.) are excluded.
  const isTaskFieldId = uid();
  const totalWaterFieldId = uid();
  const totalTasksCompletedFieldId = uid();
  const libraryFieldId = uid();
  const moviesWatchedFieldId = uid();
  const moviesWatchedDisplayFieldId = uid();

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
  const watchMovieModId     = uid();
  const moviesWatchedGoalModId = uid();

  // Library page + container + 8 movie modules
  const libraryPageModId    = uid();
  const libraryContModId    = uid();
  const movieInceptionModId    = uid();
  const movieMatrixModId       = uid();
  const movieArrivalModId      = uid();
  const movieDuneModId         = uid();
  const movieInterstellarModId = uid();
  const movieBladeRunner2049ModId = uid();
  const moviePrestigeModId     = uid();
  const movieTenetModId        = uid();

  const centerHubViewId = uid();
  const manifestId      = uid();
  const rootFolderId    = uid();
  const notesFolderId   = uid();
  const dayPagesFolderId = uid();
  const tasksFolderId    = uid();
  const trackersFolderId = uid();
  const interfacesFolderId = uid();
  const libraryFolderId  = uid();

  // ── STEP 1: Grid ────────────────────────────────────────────────────────────
  const schedFilterId = uid();
  const timeslotFilterId = uid();

  // Time slots are needed BOTH for the schedule subtree (~line 309) and for
  // the per-occurrence timeslot filter's pre-baked option list. Hoist so
  // both call sites use the same source.
  const timeSlots = generateTimeSlots();
  const timeslotLabels = timeSlots.map(s => s.label);

  // Leave activeFilterValues empty (buildGridDoc default) — client init
  // resolves to local-tz today on every load. Seeding a literal date "bakes
  // in" the seed day and shows yesterday after midnight passes.
  const grid = new Grid(buildGridDoc({ userId, gridName, manifestId, dateFieldId }));
  await grid.save();
  const gridId = grid._id.toString();

  // ── STEP 2: Fields ──────────────────────────────────────────────────────────
  await Field.insertMany([
    { id: dateFieldId, userId, gridId, name: "Date", type: "date", inputEnabled: true, displayEnabled: false },
    { id: waterFieldId, userId, gridId, name: "Water", type: "number", inputEnabled: true, displayEnabled: false, meta: { postfix: " oz", increment: 8, flow: "in" } },
    { id: completedFieldId, userId, gridId, name: "Completed", type: "boolean", inputEnabled: true, displayEnabled: false },
    // isTask: hidden boolean. Pre-stamped true on all task occurrences in seed
    // and on cloned occurrences via the Daily Routine template's defaultFields.
    { id: isTaskFieldId, userId, gridId, name: "Is Task", type: "boolean", inputEnabled: true, displayEnabled: false },
    { id: timeslotFieldId, userId, gridId, name: "Time Slot", type: "text", inputEnabled: true, displayEnabled: false },
    { id: dueFieldId, userId, gridId, name: "Due", type: "date", inputEnabled: true, displayEnabled: false },
    { id: totalWaterFieldId, userId, gridId, name: "Daily Water", type: "number", inputEnabled: false, displayEnabled: true,
      displayConfig: { showArrows: true, arrowColor: "green", targetValue: 64, targetPeriod: "daily" }, meta: { postfix: " oz" } },
    { id: totalTasksCompletedFieldId, userId, gridId, name: "Tasks Completed", type: "number", inputEnabled: false, displayEnabled: true,
      displayConfig: { showArrows: true, arrowColor: "green", targetValue: 6, targetPeriod: "daily" }, meta: {} },
    // Library / Movies Watched fields
    { id: libraryFieldId, userId, gridId, name: "Library", type: "select",
      inputEnabled: true, displayEnabled: false,
      meta: { options: ["movie", "book", "tv show"], multiSelect: false } },
    { id: moviesWatchedFieldId, userId, gridId, name: "Movies Watched", type: "occurrence",
      inputEnabled: true, displayEnabled: false,
      meta: {
        multiSelect: true,
        optionsSource: {
          mode: "find",
          over: "$allInstances",
          predicate: {
            conjunction: "AND",
            rules: [
              { left: `fields.${libraryFieldId}.value`, comparator: "IS", right: "movie" },
            ],
          },
          valuePath: "id",
          labelPath: "label",
          addNew: {
            parentOccurrenceId: null, // set after libraryContOccId is created
            stampFields: { [libraryFieldId]: { value: "movie", flow: "in" } },
          },
        },
      },
    },
    { id: moviesWatchedDisplayFieldId, userId, gridId, name: "Movies Watched", type: "text",
      inputEnabled: false, displayEnabled: true, meta: {},
      displayConfig: {
        columns: [
          { path: "label", header: "Movie" },
          { path: "date",  header: "When" },
        ],
      },
    },
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
        { fieldId: isTaskFieldId, role: "input", order: 3, hidden: true },
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
        { fieldId: isTaskFieldId, role: "input", order: 2, hidden: true },
      ],
    },
    {
      id: vitaminsModId, userId, gridId, role: "instance", kind: "list", label: "Take Vitamins",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: completedFieldId, role: "input", order: 0 },
        { fieldId: dateFieldId, role: "input", order: 1, hidden: true },
        { fieldId: isTaskFieldId, role: "input", order: 2, hidden: true },
      ],
    },
    {
      id: stretchModId, userId, gridId, role: "instance", kind: "list", label: "Stretch",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: completedFieldId, role: "input", order: 0 },
        { fieldId: dateFieldId, role: "input", order: 1, hidden: true },
        { fieldId: isTaskFieldId, role: "input", order: 2, hidden: true },
      ],
    },
    {
      id: takeMedicationModId, userId, gridId, role: "instance", kind: "list", label: "Take Medication",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: completedFieldId, role: "input", order: 0 },
        { fieldId: dateFieldId, role: "input", order: 1, hidden: true },
        { fieldId: isTaskFieldId, role: "input", order: 2, hidden: true },
      ],
    },
    {
      id: goToGymModId, userId, gridId, role: "instance", kind: "list", label: "Go to Gym",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: completedFieldId, role: "input", order: 0 },
        { fieldId: dateFieldId, role: "input", order: 1, hidden: true },
        { fieldId: isTaskFieldId, role: "input", order: 2, hidden: true },
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
        { fieldId: isTaskFieldId, role: "input", order: 2, hidden: true },
      ],
    },
    {
      id: todoDentistModId, userId, gridId, role: "instance", kind: "list", label: "Call dentist",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: completedFieldId, role: "input", order: 0 },
        { fieldId: dueFieldId, role: "input", order: 1 },
        { fieldId: isTaskFieldId, role: "input", order: 2, hidden: true },
      ],
    },
    {
      id: todoReviewPRModId, userId, gridId, role: "instance", kind: "list", label: "Review open PRs",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: completedFieldId, role: "input", order: 0 },
        { fieldId: dueFieldId, role: "input", order: 1 },
        { fieldId: isTaskFieldId, role: "input", order: 2, hidden: true },
      ],
    },
    {
      id: todoBillsModId, userId, gridId, role: "instance", kind: "list", label: "Pay monthly bills",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: completedFieldId, role: "input", order: 0 },
        { fieldId: dueFieldId, role: "input", order: 1 },
        { fieldId: isTaskFieldId, role: "input", order: 2, hidden: true },
      ],
    },
    {
      id: todoReadModId, userId, gridId, role: "instance", kind: "list", label: "Read a chapter",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: completedFieldId, role: "input", order: 0 },
        { fieldId: isTaskFieldId, role: "input", order: 1, hidden: true },
      ],
    },
    {
      id: todoEmailModId, userId, gridId, role: "instance", kind: "list", label: "Clear inbox",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: completedFieldId, role: "input", order: 0 },
        { fieldId: isTaskFieldId, role: "input", order: 1, hidden: true },
      ],
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
    // Watch Movie — toolkit task that records which movies were watched today
    {
      id: watchMovieModId, userId, gridId, role: "instance", kind: "list", label: "Watch Movie",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: moviesWatchedFieldId, role: "input", order: 0 },
        { fieldId: dateFieldId,          role: "input", order: 1, hidden: true },
        { fieldId: isTaskFieldId,        role: "input", order: 2, hidden: true },
      ],
    },
    // Movies Watched goal instance
    {
      id: moviesWatchedGoalModId, userId, gridId, role: "instance", kind: "list", label: "Movies Watched",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: moviesWatchedDisplayFieldId, role: "display", order: 0 },
      ],
    },
    // Library movie modules — 8 films
    { id: movieInceptionModId,       userId, gridId, role: "instance", kind: "list", label: "Inception",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: movieMatrixModId,          userId, gridId, role: "instance", kind: "list", label: "The Matrix",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: movieArrivalModId,         userId, gridId, role: "instance", kind: "list", label: "Arrival",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: movieDuneModId,            userId, gridId, role: "instance", kind: "list", label: "Dune",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: movieInterstellarModId,    userId, gridId, role: "instance", kind: "list", label: "Interstellar",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: movieBladeRunner2049ModId, userId, gridId, role: "instance", kind: "list", label: "Blade Runner 2049",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: moviePrestigeModId,        userId, gridId, role: "instance", kind: "list", label: "The Prestige",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: movieTenetModId,           userId, gridId, role: "instance", kind: "list", label: "Tenet",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
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
    { id: libraryContModId,   userId, gridId, role: "container", kind: "list", label: "Library",
      defaultDragMode: "move" },
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
  const libraryContOccId = uid();

  // isTask flag shape — reused on every task occurrence pre-stamp so the
  // Tracker: Tasks Completed predicate can filter non-task items.
  const isTaskFv = () => ({ [isTaskFieldId]: { value: true, flow: "in", timestamp: new Date() } });

  // Toolkit Physical container instances
  const drinkWaterOccId = await mkOcc({
    moduleId: drinkWaterModId,
    parentId: physContOccId, fields: { ...isTaskFv() },
  });
  const morningRunOccId = await mkOcc({
    moduleId: morningRunModId,
    parentId: physContOccId, fields: { ...isTaskFv() },
  });
  const vitaminsOccId = await mkOcc({
    moduleId: vitaminsModId,
    parentId: physContOccId,
    fields: { [completedFieldId]: { value: true, flow: "in", timestamp: new Date() }, ...isTaskFv() },
  });
  const stretchOccId = await mkOcc({
    moduleId: stretchModId,
    parentId: physContOccId, fields: { ...isTaskFv() },
  });
  const takeMedicationOccId = await mkOcc({
    moduleId: takeMedicationModId,
    parentId: physContOccId, fields: { ...isTaskFv() },
  });
  const goToGymOccId = await mkOcc({
    moduleId: goToGymModId,
    parentId: physContOccId, fields: { ...isTaskFv() },
  });
  const watchMovieOccId = await mkOcc({
    moduleId: watchMovieModId,
    parentId: physContOccId, fields: { ...isTaskFv() },
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
  const moviesWatchedGoalOccId = await mkOcc({
    moduleId: moviesWatchedGoalModId,
    parentId: physGoalContOccId, fields: {},
  });

  await mkOcc({
    id: physContOccId,
    moduleId: physicalContId,
    occurrences: [drinkWaterOccId, morningRunOccId, vitaminsOccId, stretchOccId, takeMedicationOccId, goToGymOccId, watchMovieOccId],
    filterOverride: {}
  });
  await mkOcc({
    id: physGoalContOccId,
    moduleId: physicalGoalContId,
    occurrences: [waterGoalOccId, tasksGoalOccId, moviesWatchedGoalOccId],
  });

  // Now that libraryContOccId is known, patch the moviesWatched field's addNew.parentOccurrenceId.
  // We can't set it at Field.insertMany time because the occurrence IDs aren't minted yet at that
  // point (fields are seeded before occurrences). Using dot-notation $set here avoids nuking the
  // rest of meta.optionsSource.
  await Field.findOneAndUpdate(
    { id: moviesWatchedFieldId },
    { $set: { "meta.optionsSource.addNew.parentOccurrenceId": libraryContOccId } },
  );

  // Library — 8 movie instances (no date filter; persistent reference library)
  const movieInceptionOccId    = await mkOcc({ moduleId: movieInceptionModId,       parentId: libraryContOccId, fields: { [libraryFieldId]: { value: "movie", flow: "in", timestamp: new Date() } } });
  const movieMatrixOccId       = await mkOcc({ moduleId: movieMatrixModId,          parentId: libraryContOccId, fields: { [libraryFieldId]: { value: "movie", flow: "in", timestamp: new Date() } } });
  const movieArrivalOccId      = await mkOcc({ moduleId: movieArrivalModId,         parentId: libraryContOccId, fields: { [libraryFieldId]: { value: "movie", flow: "in", timestamp: new Date() } } });
  const movieDuneOccId         = await mkOcc({ moduleId: movieDuneModId,            parentId: libraryContOccId, fields: { [libraryFieldId]: { value: "movie", flow: "in", timestamp: new Date() } } });
  const movieInterstellarOccId = await mkOcc({ moduleId: movieInterstellarModId,    parentId: libraryContOccId, fields: { [libraryFieldId]: { value: "movie", flow: "in", timestamp: new Date() } } });
  const movieBladeRunner2049OccId = await mkOcc({ moduleId: movieBladeRunner2049ModId, parentId: libraryContOccId, fields: { [libraryFieldId]: { value: "movie", flow: "in", timestamp: new Date() } } });
  const moviePrestigeOccId     = await mkOcc({ moduleId: moviePrestigeModId,        parentId: libraryContOccId, fields: { [libraryFieldId]: { value: "movie", flow: "in", timestamp: new Date() } } });
  const movieTenetOccId        = await mkOcc({ moduleId: movieTenetModId,           parentId: libraryContOccId, fields: { [libraryFieldId]: { value: "movie", flow: "in", timestamp: new Date() } } });

  await mkOcc({
    id: libraryContOccId,
    moduleId: libraryContModId,
    occurrences: [movieInceptionOccId, movieMatrixOccId, movieArrivalOccId, movieDuneOccId, movieInterstellarOccId, movieBladeRunner2049OccId, moviePrestigeOccId, movieTenetOccId],
    filterOverride: {},
  });

  // Todo instances
  const todoGroceriesOccId = await mkOcc({
    moduleId: todoGroceriesModId,
    parentId: todoContOccId,
    fields: { [dueFieldId]: { value: in2Days.toISOString(), flow: "in", timestamp: new Date() }, ...isTaskFv() },
  });
  const todoDentistOccId = await mkOcc({
    moduleId: todoDentistModId,
    parentId: todoContOccId,
    fields: { [dueFieldId]: { value: in7Days.toISOString(), flow: "in", timestamp: new Date() }, ...isTaskFv() },
  });
  const todoReviewPROccId = await mkOcc({
    moduleId: todoReviewPRModId,
    parentId: todoContOccId,
    fields: { [dueFieldId]: { value: in1Day.toISOString(), flow: "in", timestamp: new Date() }, ...isTaskFv() },
  });
  const todoBillsOccId = await mkOcc({
    moduleId: todoBillsModId,
    parentId: todoContOccId,
    fields: {
      [completedFieldId]: { value: true, flow: "in", timestamp: new Date() },
      [dueFieldId]: { value: today.toISOString(), flow: "in", timestamp: new Date() },
      ...isTaskFv(),
    },
  });
  const todoReadOccId = await mkOcc({
    moduleId: todoReadModId,
    parentId: todoContOccId, fields: { ...isTaskFv() },
  });
  const todoEmailOccId = await mkOcc({
    moduleId: todoEmailModId,
    parentId: todoContOccId, fields: { ...isTaskFv() },
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
  // Library folder — reference library for movies, books, TV shows, etc.
  await new Folder({ id: libraryFolderId, userId, gridId, parentId: rootFolderId, name: "Library", folderType: "normal", sortOrder: 5, isExpanded: true }).save();

  // ── STEP 7b: Templates manifest + Daily Routine + Day Page templates ────────
  // Delegated to liveSystemBuilders (faithful extraction of the prior inline
  // construction). buildTemplatesManifest mints the Templates folder + manifest
  // and returns the root folder id the two template subtrees parent to.
  const { tplManifestRootFolderId } = await buildTemplatesManifest({ userId, gridId, Folder, Manifest });

  // Per-slot routine items: which routine instances live in which slot label.
  // Kept here as the caller-supplied arg (Drink Water 6/7am, Take Medication
  // 8am, Go to Gym 9am — 6:00am pre-stamped completed:true water:10).
  const routineBySlot = {
    "6:00am": [{ sourceModId: drinkWaterModId,     label: "Drink Water",     completed: true, water: 10 }],
    "7:00am": [{ sourceModId: drinkWaterModId,     label: "Drink Water" }],
    "8:00am": [{ sourceModId: takeMedicationModId, label: "Take Medication" }],
    "9:00am": [{ sourceModId: goToGymModId,        label: "Go to Gym" }],
  };

  await buildDailyRoutineTemplate({
    userId, gridId, timeSlots, timeslotFieldId, routineBySlot,
    tplManifestRootFolderId, mkOcc, Module,
    findModule: (q) => Module.findOne(q).lean(),
    completedFieldId, waterFieldId, isTaskFieldId,
  });

  await buildDayPageTemplate({ userId, gridId, tplManifestRootFolderId, mkOcc, Module });

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
    // Date filter + Time Slot filter (a <select> over the 48 slot labels).
    // See buildScheduleFilters for the exact rule shapes.
    filters: buildScheduleFilters({ schedFilterId, timeslotFilterId, dateFieldId, timeslotFieldId, timeslotLabels }),
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

  // Library page — pinned to manifest Library folder only; no grid panel (grid is fully occupied).
  // filterOverride:{} so the library is always visible regardless of the active date filter.
  const libraryPageOccId = uid();
  await new Module({ id: libraryPageModId, userId, gridId, role: "page", kind: "board", label: "Library" }).save();
  await mkOcc({
    id: libraryPageOccId,
    moduleId: libraryPageModId,
    parentId: libraryFolderId,
    sortOrder: 0,
    occurrences: [libraryContOccId],
    iteration: { mode: "persistent" },
    fields: {},
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

  // Tracker: Water Today — sum agg (Physical Wellness goal, water field).
  // Generalized into makeTrackerOp (faithful step-for-step extraction; the
  // accumulator var is $acc and triggerObjects list completed before the
  // source field — both are internal/order-insensitive, behavior identical).
  await new Operation(makeTrackerOp({
    userId, gridId, name: "Tracker: Water",
    description: "Sum water oz under the Schedule page for the date the Daily Goals page is showing.",
    goalLabel: "Physical Wellness", goalFieldId: totalWaterFieldId,
    sourceFieldId: waterFieldId, completedFieldId, dateFieldId,
    agg: "sum", timeFilter: "daily",
  })).save();

  // Tracker: Tasks Completed Today — countTrue agg (Task Progress goal).
  await new Operation(makeTrackerOp({
    userId, gridId, name: "Tracker: Tasks Completed",
    description: "Count completed tasks (isTask=true AND completed=true) under the Schedule page for the date the Daily Goals page is showing.",
    goalLabel: "Task Progress", goalFieldId: totalTasksCompletedFieldId,
    completedFieldId, dateFieldId, isTaskFieldId,
    agg: "countTrue", timeFilter: "daily",
  })).save();

  // Tracker: Movies Watched — custom string-building pipeline (not makeTrackerOp which is numeric only).
  // Trigger surface mirrors BOTH Water Today AND Tasks Completed Today so it fires on the same events.
  // Pipeline: FIND the "Movies Watched" goal instance → determine $goalDate → FIND the Watch Movie
  // occurrence(s) for that date → LOOP over each occurrence's moviesWatched array → LOOP over library
  // instances → build a comma-joined label string → UPDATE the text display field.
  await new Operation({
    userId, gridId, priority: 3,
    name: "Tracker: Movies Watched",
    description: "Build a label list of movies watched today and update the Movies Watched goal display.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",      subjectType: "field",     targetId: moviesWatchedFieldId, priority: 3 },
      { eventType: "onAdd",         subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onDelete",      subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onFilterChange",subjectType: "filterNav", targetId: "", ancestorLabel: "Daily Goals", priority: 3 },
      { eventType: "onLoad",        subjectType: "grid",      targetId: "", priority: 3 },
    ],
    pipeline: {
      sources: [],
      steps: [
        // 1. Find the Movies Watched goal instance
        {
          type: "action", action: "FIND",
          cfg: {
            over: "$allInstances",
            predicate: { conjunction: "AND", rules: [{ left: "label", comparator: "IS", right: "Movies Watched" }] },
            itemVar: "$goalItem", itemIdVar: "$goalItemId",
          },
        },
        // 2. Bail if goal not found
        {
          type: "if",
          condition: { conjunction: "AND", rules: [{ left: "$goalItemId", comparator: "IS_EMPTY", right: "" }] },
          then: [{ type: "action", action: "INIT_VAR", cfg: { name: "$earlyExit", expr: "true" } }],
          else: [],
        },
        // 3. Resolve $goalPeriod from the goal item's effective filter — full
        //    {value, unit} object (DATE_IN_PERIOD reads bare-string + object).
        {
          type: "action", action: "INIT_VAR",
          cfg: { name: "$goalPeriod", expr: `$goalItem._effectiveFilter.${dateFieldId}`, fallback: "$trigger.date", fallback2: "$today" },
        },
        // 4. Init rows accumulator
        { type: "action", action: "INIT_VAR", cfg: { name: "$rows", value: [] } },
        // 5. Find the Schedule page (needed for HAS_ANCESTOR)
        {
          type: "action", action: "FIND",
          cfg: {
            over: "$allPages",
            predicate: { conjunction: "AND", rules: [{ left: "label", comparator: "IS", right: "Schedule" }] },
            itemVar: "$schedPage", itemIdVar: "$schedPageId",
          },
        },
        // 6. Loop over Watch Movie occurrences in $goalPeriod under Schedule
        {
          type: "loop",
          overExpr: "$allInstances",
          as: "$watchInst",
          body: [
            {
              type: "if",
              condition: {
                conjunction: "AND",
                rules: [
                  { left: `$watchInst.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
                  { left: "$watchInst._ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                  { left: "$watchInst.label", comparator: "IS", right: "Watch Movie" },
                ],
              },
              then: [
                // 6a. Inner loop: iterate the moviesWatched array (array of occurrence IDs)
                {
                  type: "loop",
                  overExpr: `$watchInst.fields.${moviesWatchedFieldId}.value`,
                  as: "$movieOccId",
                  body: [
                    {
                      type: "action", action: "FIND",
                      cfg: {
                        over: "$allInstances",
                        predicate: { conjunction: "AND", rules: [{ left: "id", comparator: "IS", right: "$movieOccId" }] },
                        itemVar: "$movie", itemIdVar: "$movieId",
                      },
                    },
                    {
                      type: "if",
                      condition: { conjunction: "AND", rules: [{ left: "$movieId", comparator: "IS_NOT_EMPTY", right: "" }] },
                      then: [
                        {
                          type: "action", action: "PUSH_TO_ARRAY",
                          cfg: {
                            name: "$rows",
                            value: {
                              label: "$movie.label",
                              date: `$watchInst.fields.${dateFieldId}.value`,
                            },
                          },
                        },
                      ],
                      else: [],
                    },
                  ],
                },
              ],
              else: [],
            },
          ],
        },
        // 7. Write the rows array to the multi-column display field.
        {
          type: "action", action: "UPDATE",
          cfg: { path: `$goalItemId.fields.${moviesWatchedDisplayFieldId}.value`, value: "$rows" },
        },
      ],
    },
    enabled: true,
  }).save();

  // ── Schedule + Day-Page operations (delegated to liveSystemBuilders) ──────
  // Each factory is a faithful step-for-step extraction of the prior inline
  // pipeline literal; the produced Operation docs are structurally identical.
  await new Operation(makeScheduleBuildDayOp({ userId, gridId, dateFieldId, dueFieldId, timeslotFieldId })).save();
  await new Operation(makeDayPageBuildOp({ userId, gridId, dateFieldId, dayPagesFolderId, hubPanelOccIdVar: panelOccIds.hub })).save();
  await new Operation(makeStampDateTimeSlotOp({ userId, gridId, timeslotFieldId, hubPanelModuleId: centerHubId })).save();
  await new Operation(makeClearDateOnMoveOutOp({ userId, gridId, dateFieldId, timeslotFieldId })).save();

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
