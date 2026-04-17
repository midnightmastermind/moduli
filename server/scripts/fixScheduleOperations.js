// scripts/fixScheduleOperations.js
// Rewrites the Water Today / Tasks Completed / Schedule Stamp operations
// using the new trigger-driven, filter-date-condition architecture.
// Also creates a new "Filter: Default to Today" operation.
//
// Run: node --env-file=.env scripts/fixScheduleOperations.js

import mongoose from "mongoose";
import Operation from "../models/Operation.js";
import { nanoid } from "nanoid";

const uid = () => nanoid(12);

await mongoose.connect(process.env.MONGO_URI);

const testGridId = "69e10afc681f2f675fae81bf";
const scheduleOccId = "atZKQpmthMgM";
const schedulePanelId = "cZNdjD-MJvyv";
const waterFieldId = "dmc4Tj15C9Oq";
const completedFieldId = "LEbHAatN6n-I";
const scheduledDateFieldId = "5qNJnmEJCkYr";
const timeslotFieldId = "C3feKJSSnpX3";
const userId = "699bbdfbf62b06018225b91a";

const scheduleSource = {
  variableName: "schedule",
  entityType: "occurrence",
  entityId: scheduleOccId,
};

// ---- Water Today ----
// Triggers: onLoad, onFieldChange (water/completed), onAdd/onRemove to schedule, onFilterChange.
// Condition: $item has water field, is inside schedule page, and scheduledDate matches $activeDate.
const waterOp = await Operation.findOne({ name: "Water Today", gridId: testGridId });
if (waterOp) {
  const showStep = waterOp.pipeline?.steps?.find(s => s.config?.type === "SHOW_VALUE");
  const targetFieldId = showStep?.config?.targetFieldId;
  const targetValue = showStep?.config?.targetValue;
  const targetPeriod = showStep?.config?.targetPeriod;

  waterOp.sortOrder = 10;
  waterOp.triggerTypes = ["onLoad", "onFieldChange", "onAdd", "onRemove", "onFilterChange"];
  waterOp.triggerConfig = {
    onFieldChange: { allowedFields: [waterFieldId, completedFieldId] },
    onAdd:         { panelId: schedulePanelId },
    onRemove:      { panelId: schedulePanelId },
  };

  waterOp.pipeline = {
    sources: [scheduleSource],
    steps: [
      { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$total", value: 0 } },
      {
        id: uid(), type: "loop",
        over: "field_occurrences", fieldId: waterFieldId, flowFilter: "any", as: "$item",
        body: [{
          id: uid(), type: "if",
          condition: {
            operator: "AND",
            rules: [
              { comparator: "HAS_ANCESTOR", left: "$item._ancestors", right: "$schedule.id" },
              { comparator: "IS_NOT_EMPTY", left: `$item.fields.${waterFieldId}.value` },
              { comparator: "IS",           left: `$item.fields.${scheduledDateFieldId}.value`, right: "$activeDate" },
            ],
          },
          then: [{ id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$total", expr: `$item.fields.${waterFieldId}.value` } }],
          else: [],
        }],
      },
      { id: uid(), type: "action", config: { type: "SHOW_VALUE", targetFieldId, sourceExpr: "$total", ...(targetValue != null ? { targetValue, targetPeriod } : {}) } },
    ],
  };
  waterOp.markModified("pipeline");
  waterOp.markModified("triggerTypes");
  waterOp.markModified("triggerConfig");
  await waterOp.save();
  console.log("✓ Water Today updated");
} else {
  console.log("✗ Water Today not found");
}

// ---- Tasks Completed Today ----
// Same trigger/source pattern; condition checks completed == true.
const tasksOp = await Operation.findOne({ name: "Tasks Completed Today", gridId: testGridId });
if (tasksOp) {
  const showStep = tasksOp.pipeline?.steps?.find(s => s.config?.type === "SHOW_VALUE");
  const targetFieldId = showStep?.config?.targetFieldId;
  const targetValue = showStep?.config?.targetValue;
  const targetPeriod = showStep?.config?.targetPeriod;

  tasksOp.sortOrder = 10;
  tasksOp.triggerTypes = ["onLoad", "onFieldChange", "onAdd", "onRemove", "onFilterChange"];
  tasksOp.triggerConfig = {
    onFieldChange: { allowedFields: [completedFieldId] },
    onAdd:         { panelId: schedulePanelId },
    onRemove:      { panelId: schedulePanelId },
  };

  tasksOp.pipeline = {
    sources: [scheduleSource],
    steps: [
      { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$count", value: 0 } },
      {
        id: uid(), type: "loop",
        over: "field_occurrences", fieldId: completedFieldId, flowFilter: "any", as: "$item",
        body: [{
          id: uid(), type: "if",
          condition: {
            operator: "AND",
            rules: [
              { comparator: "HAS_ANCESTOR", left: "$item._ancestors", right: "$schedule.id" },
              { comparator: "IS",           left: `$item.fields.${completedFieldId}.value`, right: true },
              { comparator: "IS",           left: `$item.fields.${scheduledDateFieldId}.value`, right: "$activeDate" },
            ],
          },
          then: [{ id: uid(), type: "action", config: { type: "INCREMENT_VAR", name: "$count", by: 1 } }],
          else: [],
        }],
      },
      { id: uid(), type: "action", config: { type: "SHOW_VALUE", targetFieldId, sourceExpr: "$count", ...(targetValue != null ? { targetValue, targetPeriod } : {}) } },
    ],
  };
  tasksOp.markModified("pipeline");
  tasksOp.markModified("triggerTypes");
  tasksOp.markModified("triggerConfig");
  await tasksOp.save();
  console.log("✓ Tasks Completed Today updated");
} else {
  console.log("✗ Tasks Completed Today not found");
}

// ---- Schedule: Stamp Date & Time Slot ----
// Priority 0 so it runs BEFORE aggregations. Sets scheduledDate = $activeDate
// on the occurrence being added. Aggregations see the stamped date immediately.
const stampOp = await Operation.findOne({ name: "Schedule: Stamp Date & Time Slot", gridId: testGridId });
if (stampOp) {
  stampOp.sortOrder = 0;
  stampOp.triggerTypes = ["onAdd"];
  stampOp.triggerConfig = { onAdd: { panelId: schedulePanelId } };

  stampOp.pipeline = {
    sources: [],
    steps: [
      {
        id: uid(), type: "action",
        config: {
          type: "SET_FIELD_VALUE",
          occurrenceIdExpr: "$trigger.occurrenceId",
          fieldId: scheduledDateFieldId,
          valueExpr: "$activeDate",
        },
      },
      {
        id: uid(), type: "action",
        config: {
          type: "SET_FIELD_VALUE",
          occurrenceIdExpr: "$trigger.occurrenceId",
          fieldId: timeslotFieldId,
          valueExpr: "$trigger.containerLabel",
        },
      },
    ],
  };
  stampOp.markModified("pipeline");
  stampOp.markModified("triggerTypes");
  stampOp.markModified("triggerConfig");
  await stampOp.save();
  console.log("✓ Schedule: Stamp updated (sortOrder 0)");
} else {
  console.log("✗ Schedule: Stamp not found");
}

// ---- Filter: Default to Today (NEW) ----
// Priority -10 so it runs BEFORE stamp/aggregation on onLoad. Sets the date filter
// to today if not already set, so Water/Tasks start with the right $activeDate.
let filterOp = await Operation.findOne({ name: "Filter: Default to Today", gridId: testGridId });
if (!filterOp) {
  filterOp = new Operation({
    id: uid(),
    userId,
    gridId: testGridId,
    name: "Filter: Default to Today",
    sortOrder: -10,
    enabled: true,
    triggerTypes: ["onLoad"],
    triggerConfig: {},
    pipeline: {
      sources: [],
      steps: [
        {
          id: uid(), type: "action",
          config: { type: "SET_FILTER", fieldId: scheduledDateFieldId, valueExpr: "$today" },
        },
      ],
    },
  });
  await filterOp.save();
  console.log("✓ Filter: Default to Today created");
} else {
  console.log("• Filter: Default to Today already exists");
}

await mongoose.disconnect();
console.log("Done.");
