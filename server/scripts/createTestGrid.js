// scripts/createTestGrid.js
// ============================================================
// Creates a minimal test grid for josh@jpoms.com with:
//   - Daily Toolkit: 1 container (Physical) with Drink Water only
//   - Daily Goals: 1 goal container showing water total
//   - Schedule: 48 time slot containers (center hub, left page tab)
//   - Notes: 1 empty doc page (center hub, right page tab)
//   - Todo List: 1 general container
//
// Does NOT delete existing data. Adds a second grid for the user.
// Run: node --env-file=.env scripts/createTestGrid.js
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
import { makeLoopSumOp, generateTimeSlots } from "../utils/operationBuilders.js";

const TARGET_USER_EMAIL = "josh@jpoms.com";
const uid = () => nanoid(12);

async function createTestGrid(userId) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  // ── Pre-generate IDs ────────────────────────────────────────────────────────
  const scheduledDateFieldId = uid();
  const waterFieldId = uid();
  const completedFieldId = uid();
  const timeslotFieldId = uid();
  const dueFieldId = uid();
  const totalWaterFieldId = uid();

  // Panel module IDs
  const toolkitPanelId = uid();
  const goalsPanelId   = uid();
  const todoPanelId    = uid();
  const centerHubId    = uid();

  // Container module IDs
  const physicalContId     = uid();
  const physicalGoalContId = uid();
  const todoGeneralContId  = uid();

  // Instance module IDs
  const drinkWaterModId = uid();
  const waterGoalModId  = uid();

  // View / manifest / folder IDs
  const centerHubViewId = uid();
  const manifestId      = uid();
  const rootFolderId    = uid();
  const notesFolderId   = uid();

  // ── STEP 1: Grid ────────────────────────────────────────────────────────────
  const grid = new Grid({
    userId, rows: 2, cols: 3,
    namedFilters: [
      { id: "filter_daily",  name: "Daily",  conditions: [{ fieldId: scheduledDateFieldId, comparator: "same_day" }],  timeScale: "daily"  },
      { id: "filter_weekly", name: "Weekly", conditions: [{ fieldId: scheduledDateFieldId, comparator: "same_week" }], timeScale: "weekly" },
      { id: "filter_all",    name: "All",    conditions: [], timeScale: null },
    ],
    activeFilterId: "filter_all",
    activeFilterValues: { [scheduledDateFieldId]: today.toISOString() },
    templates: [], occurrences: [],
    manifestId,
  });
  await grid.save();
  const gridId = grid._id.toString();

  // ── STEP 2: Fields ──────────────────────────────────────────────────────────
  await Field.insertMany([
    { id: scheduledDateFieldId, userId, gridId, name: "Scheduled Date", type: "date", inputEnabled: true, displayEnabled: false },
    { id: waterFieldId, userId, gridId, name: "Water", type: "number", inputEnabled: true, displayEnabled: false, meta: { postfix: " oz", increment: 8, flow: "in" } },
    { id: completedFieldId, userId, gridId, name: "Completed", type: "boolean", inputEnabled: true, displayEnabled: false },
    { id: timeslotFieldId, userId, gridId, name: "Time Slot", type: "text", inputEnabled: true, displayEnabled: false },
    { id: dueFieldId, userId, gridId, name: "Due", type: "date", inputEnabled: true, displayEnabled: false },
    { id: totalWaterFieldId, userId, gridId, name: "Daily Water", type: "number", inputEnabled: false, displayEnabled: true,
      displayConfig: { showArrows: true, arrowColor: "green", targetValue: 64, targetPeriod: "daily" }, meta: { postfix: " oz" } },
  ]);

  // ── STEP 3: Instance modules ────────────────────────────────────────────────
  await Module.insertMany([
    {
      id: drinkWaterModId, userId, gridId, role: "instance", kind: "list", label: "Drink Water",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: completedFieldId, role: "input", order: 0 },
        { fieldId: waterFieldId, role: "input", order: 1 },
        { fieldId: scheduledDateFieldId, role: "input", order: 2, hidden: true },
      ],
    },
    {
      id: waterGoalModId, userId, gridId, role: "instance", kind: "list", label: "Physical Wellness",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: totalWaterFieldId, role: "display", order: 0 },
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

  // Drink Water → Physical container
  const drinkWaterOccId = await mkOcc({
    targetType: "module", targetId: drinkWaterModId,
    meta: { containerId: physicalContId },
    fields: { [scheduledDateFieldId]: { value: today.toISOString(), flow: "in", timestamp: new Date() } },
  });

  // Water goal → Physical goal container
  const waterGoalOccId = await mkOcc({
    targetType: "module", targetId: waterGoalModId,
    meta: { containerId: physicalGoalContId },
    fields: { [scheduledDateFieldId]: { value: today.toISOString(), flow: "in", timestamp: new Date() } },
  });

  // Physical container occurrence (for toolkit panel)
  const physContOccId = await mkOcc({
    targetType: "module", targetId: physicalContId,
    meta: {}, occurrences: [drinkWaterOccId],
  });

  // Physical goal container occurrence (for goals panel)
  const physGoalContOccId = await mkOcc({
    targetType: "module", targetId: physicalGoalContId,
    meta: {}, occurrences: [waterGoalOccId],
  });

  // Todo general container occurrence
  const todoContOccId = await mkOcc({
    targetType: "module", targetId: todoGeneralContId,
    meta: {}, occurrences: [],
  });

  // Schedule time slot container occurrences
  const scheduleOccIds = [];
  for (const slot of timeSlots) {
    const key = `slot_${slot.hour}_${slot.minute}`;
    const occId = await mkOcc({
      targetType: "module", targetId: schedContainers[key].id,
      meta: {},
      fields: {
        [scheduledDateFieldId]: { value: today.toISOString(), flow: "in" },
        [timeslotFieldId]: { value: slot.label, flow: "in" },
      },
    });
    scheduleOccIds.push(occId);
  }

  // ── STEP 7: Manifest + folders + notebook module+occ ───────────────────────
  await new Manifest({ id: manifestId, userId, gridId, manifestType: "user", rootFolderId }).save();
  await new Folder({ id: rootFolderId, userId, gridId, name: "Root", parentId: null, folderType: "normal", sortOrder: 0, isExpanded: true }).save();
  await new Folder({ id: notesFolderId, userId, gridId, parentId: rootFolderId, name: "Notes", folderType: "normal", sortOrder: 0, isExpanded: true }).save();

  // ── STEP 8: Page modules + page occurrences ─────────────────────────────────
  // Toolkit page
  const toolkitPageModId = uid(); const toolkitPageOccId = uid();
  await new Module({ id: toolkitPageModId, userId, gridId, role: "page", kind: "board", label: "Daily Toolkit" }).save();
  await mkOcc({ id: toolkitPageOccId, targetType: "module", targetId: toolkitPageModId, parentId: rootFolderId, sortOrder: 0, occurrences: [physContOccId], iteration: { mode: "persistent" }, fields: {} });

  // Goals page
  const goalsPageModId = uid(); const goalsPageOccId = uid();
  await new Module({ id: goalsPageModId, userId, gridId, role: "page", kind: "board", label: "Daily Goals" }).save();
  await mkOcc({ id: goalsPageOccId, targetType: "module", targetId: goalsPageModId, parentId: rootFolderId, sortOrder: 1, occurrences: [physGoalContOccId], iteration: { mode: "persistent" }, fields: {} });

  // Todo page
  const todoPageModId = uid(); const todoPageOccId = uid();
  await new Module({ id: todoPageModId, userId, gridId, role: "page", kind: "board", label: "Todo List" }).save();
  await mkOcc({ id: todoPageOccId, targetType: "module", targetId: todoPageModId, parentId: rootFolderId, sortOrder: 2, occurrences: [todoContOccId], iteration: { mode: "persistent" }, fields: {} });

  // Schedule page (tab 1 of center hub)
  const schedPageModId = uid(); const schedPageOccId = uid();
  await new Module({ id: schedPageModId, userId, gridId, role: "page", kind: "board", label: "Schedule" }).save();
  await mkOcc({ id: schedPageOccId, targetType: "module", targetId: schedPageModId, parentId: rootFolderId, sortOrder: 3, occurrences: scheduleOccIds, iteration: { mode: "persistent" }, fields: {} });

  // Notes page (tab 2 of center hub) — empty doc
  const notesPageModId = uid(); const notesPageOccId = uid();
  await new Module({ id: notesPageModId, userId, gridId, role: "page", kind: "doc", label: "Notes" }).save();
  await mkOcc({ id: notesPageOccId, targetType: "module", targetId: notesPageModId, parentId: notesFolderId, sortOrder: 0, iteration: { mode: "persistent" }, textmap: { type: "doc", content: [{ type: "paragraph" }] }, fields: {} });

  // Center hub view — Schedule active by default
  await new View({ id: centerHubViewId, userId, gridId, viewType: "board", activeOccurrenceId: schedPageOccId }).save();

  // ── STEP 9: Panel occurrences (grid placements) ─────────────────────────────
  // Layout (2 rows × 3 cols):
  // | Toolkit(0,0)  | CenterHub(0,1, h=2) | Goals(0,2) |
  // | Todo(1,0)     | CenterHub cont.     |            |
  const panelOccIds = {};
  const placements = [
    { key: "toolkit",  panelId: toolkitPanelId, row: 0, col: 0, width: 1, height: 1, viewId: null,          filterOverride: null },
    { key: "todo",     panelId: todoPanelId,    row: 1, col: 0, width: 1, height: 1, viewId: null,          filterOverride: null },
    { key: "hub",      panelId: centerHubId,    row: 0, col: 1, width: 1, height: 2, viewId: centerHubViewId, filterOverride: { [scheduledDateFieldId]: today.toISOString() } },
    { key: "goals",    panelId: goalsPanelId,   row: 0, col: 2, width: 1, height: 1, viewId: null,          filterOverride: null },
  ];

  const gridOccIds = [];
  for (const p of placements) {
    const occId = await mkOcc({
      targetType: "module", targetId: p.panelId,
      placement: { row: p.row, col: p.col, width: p.width, height: p.height },
      ...(p.viewId && { viewId: p.viewId }),
      ...(p.filterOverride && { filterOverride: p.filterOverride }),
    });
    panelOccIds[p.key] = occId;
    gridOccIds.push(occId);
  }

  // ── STEP 10: Wire page occurrences into panel occurrences ───────────────────
  // NOW the panel occurrences exist — update them with their page lists
  await Occurrence.findByIdAndUpdate(
    (await Occurrence.findOne({ id: panelOccIds.toolkit }))._id,
    { $set: { occurrences: [toolkitPageOccId] } }
  );
  await Occurrence.findByIdAndUpdate(
    (await Occurrence.findOne({ id: panelOccIds.todo }))._id,
    { $set: { occurrences: [todoPageOccId] } }
  );
  await Occurrence.findByIdAndUpdate(
    (await Occurrence.findOne({ id: panelOccIds.hub }))._id,
    { $set: { occurrences: [schedPageOccId, notesPageOccId] } }
  );
  await Occurrence.findByIdAndUpdate(
    (await Occurrence.findOne({ id: panelOccIds.goals }))._id,
    { $set: { occurrences: [goalsPageOccId] } }
  );

  // ── STEP 11: Finalize grid ───────────────────────────────────────────────────
  await Grid.findByIdAndUpdate(grid._id, { $set: { occurrences: gridOccIds } });

  // ── STEP 12: Operations ─────────────────────────────────────────────────────
  const opArgs = { userId, gridId };
  await new Operation(makeLoopSumOp({ name: "Water Today", targetFieldId: totalWaterFieldId, fieldId: waterFieldId, timeFilter: "daily", flowFilter: "any", targetValue: 64, targetPeriod: "daily", ...opArgs })).save();

  await new Operation({
    id: uid(), userId, gridId, name: "Schedule: Stamp Date & Time Slot",
    triggerType: "onCreate", triggerTypes: ["onCreate"],
    triggerConfig: { onCreate: { panelId: centerHubId } }, enabled: true,
    pipeline: { sources: [], steps: [
      { id: uid(), type: "action", config: { type: "SET_FIELD_VALUE", fieldId: scheduledDateFieldId, valueExpr: "$activeDate" } },
      { id: uid(), type: "action", config: { type: "SET_FIELD_VALUE", fieldId: timeslotFieldId, valueExpr: "$trigger.containerLabel" } },
    ]},
  }).save();

  await new Operation({
    id: uid(), userId, gridId, name: "Schedule: Clear Date & Time Slot",
    triggerType: "onMove", triggerTypes: ["onMove"],
    triggerConfig: { onMove: { fromPanelId: centerHubId } }, enabled: true,
    pipeline: { sources: [], steps: [
      { id: uid(), type: "action", config: { type: "SET_FIELD_VALUE", fieldId: scheduledDateFieldId, value: null } },
      { id: uid(), type: "action", config: { type: "SET_FIELD_VALUE", fieldId: timeslotFieldId, value: null } },
    ]},
  }).save();

  return { gridId };
}

async function main() {
  console.log("🔄 Creating minimal test grid...\n");
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected\n");

    const user = await User.findOne({ email: TARGET_USER_EMAIL });
    if (!user) throw new Error(`User not found: ${TARGET_USER_EMAIL}`);
    const userId = user._id.toString();
    console.log(`✅ Found user: ${userId}\n`);

    const { gridId } = await createTestGrid(userId);

    console.log("=".repeat(50));
    console.log("✅ Test grid created!");
    console.log(`   Grid ID: ${gridId}`);
    console.log("=".repeat(50));
    console.log("Layout (2×3):");
    console.log("  [0,0] Daily Toolkit  — Physical → Drink Water");
    console.log("  [1,0] Todo List      — General (empty)");
    console.log("  [0,1] Center Hub ×2  — Schedule | Notes pages");
    console.log("  [0,2] Daily Goals    — Physical → Water total");
    console.log("=".repeat(50));
  } catch (err) {
    console.error("❌ Failed:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("✅ Disconnected");
  }
}

main();
