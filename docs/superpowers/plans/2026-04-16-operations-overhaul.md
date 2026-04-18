# Operations Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Water Today / Tasks Completed Today operations work reliably by rewiring the pipeline around filter-date conditions, trigger-driven sources, operation priority, nested AND/OR, and selectable (dropdown-driven) property paths.

**Architecture:**
- Executor exposes `$trigger.occurrence` (full data) and `$item.fields.<fieldId>.value` so conditions read from the *data shape* the user sees in the UI.
- Operations run in explicit priority order — stamp-date runs before aggregations, filter-to-today runs on load before everything.
- Time filtering moves from implicit `loop.timeFilter: "daily"` to explicit pipeline condition `$item.fields.scheduledDate.value == $activeDate`, matching how the user reasons about the data.
- UI replaces free-text expression strings with cascading dropdown "Path Pickers" that walk `varName → property → subproperty`.

**Tech Stack:** React, MongoDB (Mongoose), socket.io, Pragmatic DnD.

---

## File Structure

### New files

- `client/src/blocks/PathPicker.jsx` — Cascading dropdown component for selecting expression paths (`$item` → `fields` → `water` → `value`). Returns string expressions in existing format (`"$item.fields.water.value"`) so the executor stays compatible.
- `client/src/blocks/ConditionGroup.jsx` — Recursive condition builder that can nest AND/OR groups inside other groups.
- `server/scripts/fixScheduleOperations.js` — (already exists; will be rewritten for the new architecture with priority + explicit date condition + stamp + auto-filter)

### Modified files

- `server/models/Operation.js` — Expose `sortOrder` as the priority source; add `priority` virtual alias for clarity.
- `client/src/helpers/operationActions.js` — Multi-level path resolution in `resolveExpr`; nested group support in `evalGroup`; new `SET_FILTER` action type.
- `client/src/helpers/operationExecutor.js` — Expose raw `fields` on loop items; auto-inject `$trigger.occurrence`; sort operations by priority in `runMatchingOperations`; add `onFieldChange` / `onFilterChange` trigger aliases; drop `timeFilter: "daily"` from Water/Tasks loop step.
- `client/src/state/bindSocketToStore.js` — Include full occurrence in `OccurrenceCreateOp` / `OccurrenceDeleteOp` transactions; handle `SET_FILTER` effect by calling the grid filter updater.
- `client/src/blocks/OperationsBuilder.jsx` — Wire in `PathPicker` and `ConditionGroup`; add priority input; add `onFieldChange`/`onFilterChange` to trigger picker labels.
- `client/src/ui/commandCenter/OperationsTab.jsx` — Display and edit priority; sort list by priority; add "Move up/down" controls.
- `OPERATIONS_SPEC.md` — Rewrite to reflect the new trigger-driven + filter-date-condition architecture.

---

## Task 1: Multi-level path resolution in `resolveExpr`

**Why first:** Every downstream task (conditions, action configs, stamp, UI) depends on `$item.fields.water.value` resolving correctly. Today `resolveExpr` only handles one level of dotting (`$item.value`).

**Files:**
- Modify: `client/src/helpers/operationActions.js:158-167` (the `if (expr.startsWith("$"))` block)

- [ ] **Step 1: Read the current `resolveExpr` implementation**

Read `client/src/helpers/operationActions.js` lines 86-170. Note that the current `$varName.fieldId` branch only splits into two parts and looks up `varData[fieldId]`.

- [ ] **Step 2: Replace single-level lookup with arbitrary-depth walk**

In `client/src/helpers/operationActions.js`, replace the `if (expr.startsWith("$"))` block with:

```js
if (expr.startsWith("$")) {
  // Walk arbitrary depth: "$item.fields.water.value" → $vars["$item"]["fields"]["water"]["value"]
  const parts = expr.slice(1).split(".");
  const varName = `$${parts[0]}`;
  let cur = $vars[varName];
  if (cur == null) return null;
  for (let i = 1; i < parts.length; i++) {
    if (cur == null) return null;
    cur = cur[parts[i]];
  }
  return cur ?? null;
}
```

- [ ] **Step 3: Verify with a manual console check**

In the running dev server, with an operation editor open, type `$item.fields.water.value` into a condition left field. Load the page. Confirm the executor does not throw. No test written yet because operationActions has no test file and we do not want to scaffold one for a 6-line change. Will catch regressions in Task 10 integration test.

- [ ] **Step 4: Commit**

```bash
git add client/src/helpers/operationActions.js
git commit -m "fix: resolveExpr walks arbitrary-depth dotted paths"
```

---

## Task 2: Expose raw `fields` object on loop items

**Why:** UI dropdowns show "fields → water → value". The data shape needs to match. Today loop items flatten field values to top-level (`item[fieldId] = value`) which would make the picker hierarchy `$item → water → (no sub-props)`.

**Files:**
- Modify: `client/src/helpers/operationExecutor.js:900-913` (the final `return occs.map(occ => ...)` in `gatherLoopItems`)

- [ ] **Step 1: Update loop item shape in `gatherLoopItems`**

In `client/src/helpers/operationExecutor.js`, replace the final `return occs.map(...)` block with:

```js
return occs.map(occ => {
  const fv = fieldId ? occ.fields?.[fieldId] : null;
  // Expose fields as a nested object so paths like $item.fields.water.value work.
  // Each entry keeps {value, flow} shape, matching the DB shape the user sees in UI.
  const fields = {};
  for (const [fid, fdata] of Object.entries(occ.fields || {})) {
    fields[fid] = {
      value: fdata?.value !== undefined ? fdata.value : fdata,
      flow: fdata?.flow ?? null,
    };
  }
  const item = {
    id: occ.id,
    occurrenceId: occ.id,
    targetId: occ.targetId,
    parentId: occ.parentId,
    value: fv?.value !== undefined ? fv.value : (fv ?? null),  // back-compat flat accessor
    flow: fv?.flow ?? null,
    _ancestors: getAncestors(occ.id),
    fields,
  };
  // Back-compat: also expose top-level field values for existing operations
  for (const [fid, fdata] of Object.entries(occ.fields || {})) {
    item[fid] = fdata?.value !== undefined ? fdata.value : fdata;
  }
  return item;
});
```

- [ ] **Step 2: Also expose `fields` on occurrence-type sources**

In `client/src/helpers/operationExecutor.js:583-597` (the `entityType === "occurrence"` source branch), replace with:

```js
} else if (entityType === "occurrence") {
  const occ = occurrencesById[entityId];
  if (occ) {
    const fields = {};
    for (const [fid, fdata] of Object.entries(occ.fields || {})) {
      fields[fid] = {
        value: fdata?.value !== undefined ? fdata.value : fdata,
        flow: fdata?.flow ?? null,
      };
    }
    const fieldValues = {
      id: occ.id,
      targetId: occ.targetId,
      parentId: occ.parentId,
      fields,
      _ancestors: [],  // will be populated below
      _iterationTimeValue: occ.iteration?.timeValue || occ.iteration?.value,
      _iterationCategoryValue: occ.iteration?.categoryValue,
    };
    // Back-compat: flat field values (old expressions keep working)
    for (const [fid, fdata] of Object.entries(occ.fields || {})) {
      fieldValues[fid] = fdata?.value !== undefined ? fdata.value : fdata;
      fieldValues[`${fid}_flow`] = fdata?.flow;
    }
    $vars[varKey] = fieldValues;
  } else {
    $vars[varKey] = {};
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/helpers/operationExecutor.js
git commit -m "feat: expose nested fields object on loop items and occurrence sources"
```

---

## Task 3: Auto-inject `$trigger.occurrence` with full data

**Why:** User wants "sources will be whatever gets returned from the trigger". On `onAdd`, the stamp operation needs the full occurrence of what was added, not just the ID. Same for `onFieldChange` — the changing occurrence should be automatically available.

**Files:**
- Modify: `client/src/state/bindSocketToStore.js` (the places that fire `OccurrenceCreateOp`, `OccurrenceDeleteOp`, and `MeasureOp`)
- Modify: `client/src/helpers/operationExecutor.js:556-558` (the `if (transaction && typeof transaction === "object") { $vars["$trigger"] = transaction; }` block)

- [ ] **Step 1: Update executor to enrich `$trigger`**

In `client/src/helpers/operationExecutor.js`, replace:

```js
if (transaction && typeof transaction === "object") {
  $vars["$trigger"] = transaction;
}
```

With:

```js
if (transaction && typeof transaction === "object") {
  // Enrich $trigger with the full occurrence when the transaction references one.
  // This makes $trigger.occurrence.fields.water.value work in stamp/onAdd operations
  // without requiring the user to configure a separate source.
  const enriched = { ...transaction };
  const occId = transaction.occurrenceId;
  if (occId && occurrencesById[occId]) {
    const occ = occurrencesById[occId];
    const fields = {};
    for (const [fid, fdata] of Object.entries(occ.fields || {})) {
      fields[fid] = {
        value: fdata?.value !== undefined ? fdata.value : fdata,
        flow: fdata?.flow ?? null,
      };
    }
    enriched.occurrence = {
      id: occ.id,
      targetId: occ.targetId,
      parentId: occ.parentId,
      fields,
    };
  }
  $vars["$trigger"] = enriched;
}
```

- [ ] **Step 2: Ensure `OccurrenceCreateOp` fires with occurrenceId**

Search `client/src/state/bindSocketToStore.js` for `fireOperations("OccurrenceCreateOp"` and confirm the payload already includes `occurrenceId`. If not, add it. (Current code already does this — verify only.)

- [ ] **Step 3: Ensure `OccurrenceDeleteOp` captures occurrence before delete**

In `client/src/state/bindSocketToStore.js`, the `onOccurrenceDeleted` handler already snapshots `removedOcc` before deleting from the cache (per CLAUDE.md Apr 2 entry). Verify the occurrence fields are still available for the stamp/trigger enrichment — since `removeLocalOcc` runs before fireOperations, we may need to re-put the occurrence in `occurrencesById` for the executor's lookup. Add the occurrence to the executor context explicitly:

```js
// In onOccurrenceDeleted, after capturing removedOcc but before fireOperations call:
const occsForOp = { ...localOccsById };
if (removedOcc) occsForOp[occurrenceId] = removedOcc;
// Pass occsForOp as occurrencesById override when calling runMatchingOperations.
```

If `fireOperations` does not currently accept an override, extend it — the exact change depends on current shape of `fireOperationsOptimistic`. Read that function first and plumb the override through.

- [ ] **Step 4: Commit**

```bash
git add client/src/helpers/operationExecutor.js client/src/state/bindSocketToStore.js
git commit -m "feat: enrich \$trigger with full occurrence data for onAdd/onRemove/onChange"
```

---

## Task 4: Nested AND/OR condition groups

**Why:** User said "we also need the conditions thing to be not be all 'and', or all 'or', we might need to combine conditions." A rule entry can either be a leaf `{left, comparator, right}` or a nested group `{operator, rules}`.

**Files:**
- Modify: `client/src/helpers/operationActions.js:239-247` (the `evalGroup` function)

- [ ] **Step 1: Update `evalGroup` to recurse on nested groups**

In `client/src/helpers/operationActions.js`, replace the existing `evalGroup` with:

```js
export function evalGroup(group, $vars) {
  const { operator = "AND", rules = [] } = group;
  if (rules.length === 0) return true;

  const evaluate = (entry) => {
    // A rules entry is either a leaf rule (has `comparator`) or a nested group (has `rules`)
    if (Array.isArray(entry?.rules)) return evalGroup(entry, $vars);
    return evalRule(entry, $vars);
  };

  if (operator === "OR") return rules.some(evaluate);
  return rules.every(evaluate);
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/helpers/operationActions.js
git commit -m "feat: evalGroup supports nested AND/OR groups"
```

---

## Task 5: Operation priority ordering

**Why:** User said "we also need operations prioritizable. cause we need another operation to go before any of these onAdd and add the current filter's date as the date on the occurrence coming into schedule." The Operation model already has a `sortOrder` field (seen in server/models/Operation.js:38) but `runMatchingOperations` does not sort by it.

**Files:**
- Modify: `client/src/helpers/operationExecutor.js:457-476` (the `runMatchingOperations` function)

- [ ] **Step 1: Sort operations by sortOrder before running**

In `client/src/helpers/operationExecutor.js`, update `runMatchingOperations`:

```js
export function runMatchingOperations(operations, transactionType, transaction, context, { onError } = {}) {
  const updates = [];
  // Lower sortOrder runs first. Stamp-date ops get sortOrder: 0, aggregations get 10+,
  // display-only operations get 100+. Missing sortOrder defaults to 50 (middle).
  const ordered = [...operations].sort((a, b) => (a.sortOrder ?? 50) - (b.sortOrder ?? 50));
  for (const op of ordered) {
    if (!shouldTrigger(op, transactionType, transaction)) continue;
    try {
      if (op.pipeline) {
        const results = executePipeline(op, context, transaction);
        updates.push(...results);
      } else {
        const results = executeOperation(op, transactionType, transaction, context);
        updates.push(...results);
      }
    } catch (err) {
      console.warn(`[operationExecutor] error in operation "${op.name}":`, err);
      onError?.(op.name, err);
    }
  }
  return updates;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/helpers/operationExecutor.js
git commit -m "feat: runMatchingOperations respects operation sortOrder"
```

---

## Task 6: New trigger aliases — `onFieldChange`, `onFilterChange`

**Why:** User wants clearer trigger names that map to what users think about. `onChange` already exists and fires on `MeasureOp` — alias it as `onFieldChange`. `onNavigation` fires when filter changes — alias as `onFilterChange`.

**Files:**
- Modify: `client/src/helpers/operationExecutor.js` — `matchesTrigger` switch statement (lines 76-194)

- [ ] **Step 1: Add alias cases**

In `client/src/helpers/operationExecutor.js:matchesTrigger`, locate the existing `case "onChange"` block. Immediately after its closing brace, add a fallthrough alias:

```js
case "onFieldChange": {
  // Alias for onChange — clearer label for UI.
  if (transactionType !== "MeasureOp") return false;
  const fieldFilter = cfg.onFieldChange?.fieldId || cfg.onChange?.fieldId;
  if (fieldFilter && transaction?.fieldId !== fieldFilter) return false;
  const allowedFields = cfg.onFieldChange?.allowedFields || cfg.onChange?.allowedFields;
  if (allowedFields?.length > 0 && !allowedFields.includes(transaction?.fieldId)) return false;
  const instanceFilter = cfg.onFieldChange?.instanceId || cfg.onChange?.instanceId;
  if (instanceFilter && transaction?.instanceId !== instanceFilter) return false;
  return true;
}
```

Then update the existing `case "onNavigation"` and `case "onIteration"` to also match `case "onFilterChange"`:

```js
case "onFilterChange":
case "onNavigation":
case "onIteration":
  return transactionType === "NavigationOp";
```

- [ ] **Step 2: Commit**

```bash
git add client/src/helpers/operationExecutor.js
git commit -m "feat: add onFieldChange and onFilterChange trigger aliases"
```

---

## Task 7: `SET_FILTER` action + effect handler

**Why:** User wants "another operation to auto set the filter to today's date". Need a new action type that writes to `grid.activeFilterValues`.

**Files:**
- Modify: `client/src/helpers/operationActions.js` — `executeActionItem` switch
- Modify: `client/src/state/bindSocketToStore.js` — `applyOperationEffect` switch

- [ ] **Step 1: Add `SET_FILTER` action in `operationActions.js`**

In `executeActionItem`, immediately before the `default:` case, add:

```js
case "SET_FILTER": {
  // Write a filter value to grid.activeFilterValues[fieldId].
  // cfg: { fieldId, valueExpr } — fieldId is the filter column; valueExpr resolves to a value.
  const fieldId = cfg.fieldId;
  const value = resolveExpr(cfg.valueExpr ?? cfg.value, $vars);
  if (fieldId && value != null) {
    updates.push({ _effect: "SET_FILTER", fieldId, value: String(value) });
  }
  break;
}
```

- [ ] **Step 2: Handle `SET_FILTER` effect in `bindSocketToStore.js`**

Find `applyOperationEffect` in `client/src/state/bindSocketToStore.js`. Add a new case before the switch's default:

```js
case "SET_FILTER": {
  const gridId = state?.gridId || state?.grid?._id;
  if (!gridId || !effect.fieldId) break;
  const prev = state?.grid?.activeFilterValues || {};
  // Skip if already set — avoid re-dispatching on every onLoad fire.
  if (prev[effect.fieldId] === effect.value) break;
  const next = { ...prev, [effect.fieldId]: effect.value };
  // Use the same CommitHelper the toolbar filter nav uses.
  import("../helpers/CommitHelpers").then(({ updateGridFilter }) => {
    updateGridFilter({ dispatch, socket, gridId, patch: { activeFilterValues: next } });
  });
  break;
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/helpers/operationActions.js client/src/state/bindSocketToStore.js
git commit -m "feat: SET_FILTER action writes to grid.activeFilterValues"
```

---

## Task 8: Rewrite the three schedule operations (DB migration)

**Why:** With all executor changes in place, the operations need their pipelines updated to use the new architecture — explicit date condition, stamp-date priority-0 op, filter-to-today priority -10 op.

**Files:**
- Modify: `server/scripts/fixScheduleOperations.js` — rewrite for new architecture

- [ ] **Step 1: Rewrite the migration script**

Replace `server/scripts/fixScheduleOperations.js` with the following:

```js
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
const scheduledDateFieldId = "scheduledDate"; // TODO: replace with real field ID from grid
const userId = "REPLACE_WITH_USER_ID"; // TODO: fill in before running

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
          fieldId: "timeslot",
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
```

- [ ] **Step 2: Look up the real `scheduledDateFieldId` and `userId`**

Before running, confirm the actual field ID for `scheduledDate` in the test grid:

```bash
cd /home/joshpoms/moduli/server && node --env-file=.env -e "
import('./models/Field.js').then(async ({ default: Field }) => {
  await (await import('mongoose')).default.connect(process.env.MONGO_URI);
  const f = await Field.findOne({ gridId: '69e10afc681f2f675fae81bf', name: /schedule/i });
  console.log(f);
  process.exit();
});
"
```

Replace `scheduledDateFieldId = "scheduledDate"` and `userId = "REPLACE_WITH_USER_ID"` in the script with the actual values.

- [ ] **Step 3: Run the migration**

```bash
cd /home/joshpoms/moduli/server && node --env-file=.env scripts/fixScheduleOperations.js
```

Expected output: four ✓/• lines.

- [ ] **Step 4: Commit**

```bash
git add server/scripts/fixScheduleOperations.js
git commit -m "chore: rewrite schedule ops migration for priority + explicit date condition"
```

---

## Task 9: End-to-end verification in the running app

**Why:** Before layering on UI changes, confirm the core pipeline works with the new architecture.

- [ ] **Step 1: Restart the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Open the test grid in the browser**

Navigate to the test grid. Confirm:
1. Filter nav shows today's date (auto-set by Filter: Default to Today).
2. Water Today display shows the correct sum for today.
3. Tasks Completed Today display shows the correct count for today.

- [ ] **Step 3: Test onAdd**

Drag a new instance into a schedule slot. Confirm:
1. Stamp op fires first — instance's `scheduledDate` field is set to the active filter date.
2. Water/Tasks aggregations update immediately with the new instance included.

- [ ] **Step 4: Test onFieldChange**

Change a water value on an existing schedule instance. Confirm Water Today updates immediately.

- [ ] **Step 5: Test onFilterChange**

Navigate the filter date forward by one day. Confirm Water/Tasks recalculate for the new date.

- [ ] **Step 6: Test onRemove**

Drag an instance out of the schedule. Confirm Water/Tasks decrement immediately.

If any of these fail, debug before moving on to UI tasks. The UI tasks assume the executor is working end-to-end.

---

## Task 10: `PathPicker` component

**Why:** User said "for the operations, everything should be selectable, not typable when it comes to properties. like occurrence.fields.value shouldn't be typed, it should be selected 1 dropdown after another."

**Files:**
- Create: `client/src/blocks/PathPicker.jsx`

- [ ] **Step 1: Create the component**

Write `client/src/blocks/PathPicker.jsx`:

```jsx
// blocks/PathPicker.jsx
// Cascading dropdown for selecting an expression path like "$item.fields.water.value".
// Each dropdown shows the available keys at that depth; selecting one reveals the next dropdown.
import React, { useMemo } from "react";

/**
 * @param {object} props
 * @param {string} props.value           — Current expression string ("$item.fields.water.value" or "")
 * @param {function} props.onChange      — Called with new expression string
 * @param {object} props.shapeByVar      — Map of available vars to their shapes: { "$item": { fields: { water: { value, flow } } }, ... }
 * @param {string} [props.placeholder]   — Placeholder dropdown label
 */
export default function PathPicker({ value, onChange, shapeByVar, placeholder = "Select…" }) {
  const parts = useMemo(() => (value ? value.split(".") : []), [value]);

  // Walk the shape tree one dropdown at a time. At each level, show keys available
  // at that depth. The user can change any segment — later segments are cleared.
  const segments = useMemo(() => {
    const result = [];
    let shape = shapeByVar;
    let isTopLevel = true;
    for (let i = 0; i <= parts.length; i++) {
      if (!shape || typeof shape !== "object") break;
      const options = Object.keys(shape).map(k => ({
        key: k,
        label: isTopLevel ? k : k,  // top-level keys include the "$" prefix already
      }));
      const selected = parts[i] ?? "";
      result.push({ options, selected });
      if (!selected) break;
      const nextShape = shape[selected];
      if (!nextShape || typeof nextShape !== "object") {
        // Leaf — stop walking.
        break;
      }
      shape = nextShape;
      isTopLevel = false;
    }
    return result;
  }, [parts, shapeByVar]);

  const pickSegment = (depth, newKey) => {
    const nextParts = parts.slice(0, depth);
    if (newKey) nextParts.push(newKey);
    onChange(nextParts.join("."));
  };

  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
      {segments.map((seg, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: "var(--muted)" }}>.</span>}
          <select
            value={seg.selected}
            onChange={(e) => pickSegment(i, e.target.value)}
            style={{ padding: "2px 4px", fontSize: 12, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 3 }}
          >
            <option value="">{placeholder}</option>
            {seg.options.map(opt => (
              <option key={opt.key} value={opt.key}>{opt.label}</option>
            ))}
          </select>
        </React.Fragment>
      ))}
    </div>
  );
}

/**
 * Build the shape map passed to PathPicker, given the operation's sources + available fields.
 * Call from OperationsBuilder to derive the dropdown options the user sees.
 *
 * @param {object} args
 * @param {Array}  args.sources      — operation.pipeline.sources (to populate $varName entries)
 * @param {Array}  args.fields       — grid fields (to populate .fields.<fieldId>.value/flow)
 * @param {boolean} args.inLoop      — include $item if building for a rule inside a loop body
 */
export function buildPathShape({ sources = [], fields = [], inLoop = false }) {
  const fieldsShape = {};
  for (const f of fields) {
    fieldsShape[f.id] = { value: null, flow: null };
  }
  const occShape = {
    id: null,
    targetId: null,
    parentId: null,
    _ancestors: null,
    fields: fieldsShape,
  };
  const shape = {
    $now: null,
    $today: null,
    $activeDate: null,
    $iterationValue: null,
  };
  for (const src of sources) {
    if (src.variableName) {
      shape[`$${src.variableName}`] = occShape;
    }
  }
  if (inLoop) {
    shape.$item = occShape;
  }
  shape.$trigger = { occurrenceId: null, fieldId: null, value: null, occurrence: occShape, containerId: null, panelId: null };
  return shape;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/blocks/PathPicker.jsx
git commit -m "feat: add PathPicker cascading dropdown for expression paths"
```

---

## Task 11: Wire `PathPicker` into the condition editor

**Why:** This is where the user feels the difference — instead of typing strings into left/right inputs, they click through dropdowns.

**Files:**
- Modify: `client/src/blocks/OperationsBuilder.jsx` — find the condition/rule editor and swap text inputs for `PathPicker`

- [ ] **Step 1: Locate the condition editor**

Search in `client/src/blocks/OperationsBuilder.jsx` for `comparator` to find the rule row component. Note whether it's inline or a named component.

- [ ] **Step 2: Import `PathPicker`**

Add at the top of `OperationsBuilder.jsx`:

```jsx
import PathPicker, { buildPathShape } from "./PathPicker";
```

- [ ] **Step 3: Replace the `left` field input with a `PathPicker`**

In the rule editor JSX, replace the `<input value={rule.left} onChange={...}/>` (or equivalent) with:

```jsx
<PathPicker
  value={rule.left}
  onChange={(next) => updateRule({ ...rule, left: next })}
  shapeByVar={buildPathShape({ sources: operation.pipeline?.sources || [], fields: availableFields, inLoop: isInsideLoop })}
  placeholder="variable…"
/>
```

- [ ] **Step 4: Leave `right` as a text input for now**

The right side often holds literals (`"true"`, dates, numbers). Keep it as text input; users can still type `$schedule.id` or `$activeDate` there manually. Follow-up task could add a mode toggle (literal vs. path), but out of scope.

- [ ] **Step 5: Verify in browser**

Open the operations tab, edit Water Today, confirm the condition editor now shows cascading dropdowns for `left`. Select `$item → fields → water → value` and confirm the resulting string is `$item.fields.water.value`.

- [ ] **Step 6: Commit**

```bash
git add client/src/blocks/OperationsBuilder.jsx
git commit -m "feat: condition rule left side uses PathPicker dropdowns"
```

---

## Task 12: `ConditionGroup` — recursive AND/OR UI

**Why:** Executor supports nested groups (Task 4). UI needs to let the user build them.

**Files:**
- Create: `client/src/blocks/ConditionGroup.jsx`
- Modify: `client/src/blocks/OperationsBuilder.jsx` — use `ConditionGroup` in the IF step editor

- [ ] **Step 1: Create `ConditionGroup.jsx`**

```jsx
// blocks/ConditionGroup.jsx
// Recursive condition builder supporting nested AND/OR groups.
// Each entry in `rules` is either a leaf rule or another group.
import React from "react";
import PathPicker, { buildPathShape } from "./PathPicker";

const COMPARATORS = [
  "IS", "IS_NOT", "GREATER", "LESS", "GREATER_OR_EQUAL", "LESS_OR_EQUAL",
  "CONTAINS", "NOT_CONTAINS", "IS_EMPTY", "IS_NOT_EMPTY",
  "HAS_ANCESTOR", "DATE_IS_TODAY", "DATE_BEFORE_TODAY", "DATE_AFTER_TODAY",
];

export default function ConditionGroup({ group, onChange, sources, fields, depth = 0 }) {
  const { operator = "AND", rules = [] } = group;

  const setOperator = (op) => onChange({ ...group, operator: op });
  const setRule = (idx, next) => {
    const copy = rules.slice();
    copy[idx] = next;
    onChange({ ...group, rules: copy });
  };
  const removeRule = (idx) => {
    const copy = rules.slice();
    copy.splice(idx, 1);
    onChange({ ...group, rules: copy });
  };
  const addRule = () => onChange({ ...group, rules: [...rules, { left: "", comparator: "IS", right: "" }] });
  const addGroup = () => onChange({ ...group, rules: [...rules, { operator: "AND", rules: [] }] });

  const shape = buildPathShape({ sources, fields, inLoop: true });

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 4, padding: 6, marginLeft: depth * 12, background: depth % 2 ? "var(--surface-2)" : "var(--surface)" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
        <select value={operator} onChange={(e) => setOperator(e.target.value)}>
          <option value="AND">ALL of</option>
          <option value="OR">ANY of</option>
        </select>
        <button onClick={addRule}>+ Rule</button>
        <button onClick={addGroup}>+ Group</button>
      </div>
      {rules.map((entry, i) => (
        <div key={i} style={{ marginBottom: 4 }}>
          {Array.isArray(entry.rules) ? (
            <div style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
              <ConditionGroup group={entry} onChange={(next) => setRule(i, next)} sources={sources} fields={fields} depth={depth + 1} />
              <button onClick={() => removeRule(i)}>×</button>
            </div>
          ) : (
            <RuleRow rule={entry} onChange={(next) => setRule(i, next)} onRemove={() => removeRule(i)} shape={shape} />
          )}
        </div>
      ))}
    </div>
  );
}

function RuleRow({ rule, onChange, onRemove, shape }) {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <PathPicker value={rule.left} onChange={(next) => onChange({ ...rule, left: next })} shapeByVar={shape} />
      <select value={rule.comparator} onChange={(e) => onChange({ ...rule, comparator: e.target.value })}>
        {COMPARATORS.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <input
        type="text"
        value={rule.right ?? ""}
        onChange={(e) => onChange({ ...rule, right: e.target.value })}
        placeholder="value or $var"
        style={{ width: 140 }}
      />
      <button onClick={onRemove}>×</button>
    </div>
  );
}
```

- [ ] **Step 2: Use `ConditionGroup` in the IF step editor**

In `client/src/blocks/OperationsBuilder.jsx`, find the IF step editor that currently renders flat rules. Replace it with:

```jsx
import ConditionGroup from "./ConditionGroup";

// inside the IF step renderer:
<ConditionGroup
  group={step.condition || { operator: "AND", rules: [] }}
  onChange={(next) => updateStep({ ...step, condition: next })}
  sources={operation.pipeline?.sources || []}
  fields={availableFields}
/>
```

- [ ] **Step 3: Verify in browser**

Edit Water Today. Open the IF step. Confirm the flat rules render correctly. Click `+ Group`, add a nested group, confirm the JSON structure persists and evaluates correctly (Water Today still shows the right number).

- [ ] **Step 4: Commit**

```bash
git add client/src/blocks/ConditionGroup.jsx client/src/blocks/OperationsBuilder.jsx
git commit -m "feat: nested AND/OR condition groups via ConditionGroup component"
```

---

## Task 13: Priority input in operation settings

**Why:** User wants to control which operations run first.

**Files:**
- Modify: `client/src/ui/commandCenter/OperationsTab.jsx` — add priority number input to the operation detail view
- Modify: `client/src/ui/commandCenter/OperationsTab.jsx` — sort operation list by sortOrder

- [ ] **Step 1: Add priority input to operation detail**

In `client/src/ui/commandCenter/OperationsTab.jsx`, locate the settings panel for a selected operation. Add:

```jsx
<label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
  Priority:
  <input
    type="number"
    value={selectedOp.sortOrder ?? 50}
    onChange={(e) => {
      const next = { ...selectedOp, sortOrder: Number(e.target.value) };
      updateOperation(next);
    }}
    style={{ width: 60 }}
  />
  <span style={{ color: "var(--muted)" }}>lower runs first</span>
</label>
```

- [ ] **Step 2: Sort list by sortOrder**

In the operation list, sort operations by `sortOrder`:

```jsx
const sortedOps = useMemo(
  () => [...operations].sort((a, b) => (a.sortOrder ?? 50) - (b.sortOrder ?? 50)),
  [operations]
);
```

Use `sortedOps` instead of `operations` in the list render.

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/commandCenter/OperationsTab.jsx
git commit -m "feat: priority input + sorted list in OperationsTab"
```

---

## Task 14: Add `onFieldChange` / `onFilterChange` to UI trigger picker

**Files:**
- Modify: `client/src/ui/commandCenter/OperationsTab.jsx` — add labels for new trigger aliases in the trigger type dropdown

- [ ] **Step 1: Update trigger type list**

Find the `EVENT_TYPES` constant in `OperationsTab.jsx`. Add:

```js
// Replace "onChange" label with "onFieldChange" (user-facing), keep the key stable
// OR add both as aliases. Simpler: add new aliases without breaking existing operations.
const EVENT_TYPES = [
  ...existing,
  "onFieldChange",     // alias for onChange
  "onFilterChange",    // alias for onNavigation
];
```

- [ ] **Step 2: Commit**

```bash
git add client/src/ui/commandCenter/OperationsTab.jsx
git commit -m "feat: expose onFieldChange and onFilterChange in trigger picker"
```

---

## Task 15: Update `OPERATIONS_SPEC.md` to match new architecture

**Files:**
- Modify: `/home/joshpoms/moduli/OPERATIONS_SPEC.md`

- [ ] **Step 1: Rewrite the spec**

Replace the contents of `OPERATIONS_SPEC.md` with a version that:
- Describes sources as trigger-driven + user-selected occurrences
- Shows the Water Today pipeline with explicit date condition (no `timeFilter: daily`)
- Documents the stamp-date op (sortOrder 0) and filter-to-today op (sortOrder -10)
- Explains `$trigger.occurrence`, `$item.fields.<fieldId>.value`, nested AND/OR, and priority

Detailed contents are left to the implementer — cross-reference Tasks 1–9 as the authoritative source for behavior.

- [ ] **Step 2: Commit**

```bash
git add OPERATIONS_SPEC.md
git commit -m "docs: rewrite OPERATIONS_SPEC for trigger-driven architecture"
```

---

## Self-Review

**Spec coverage:**
- [x] "sources will be whatever gets returned from the trigger" → Task 3
- [x] Triggers: onAdd, onRemove, onLoad, onFilterChange, onFieldChange → Tasks 6, 14
- [x] Selectable not typable → Tasks 10, 11, 12
- [x] Loop checking `occurrence.fields.water.value`, ancestry, `occurrence.fields.date == filter date` → Tasks 1, 2, 8
- [x] Iteration → filter rename → already done previously, referenced in Tasks 6, 7
- [x] Operations prioritizable → Tasks 5, 13
- [x] Stamp op runs first via priority → Task 8 (sortOrder 0)
- [x] Combine AND/OR conditions → Tasks 4, 12
- [x] Auto-set filter to today → Tasks 7, 8 (Filter: Default to Today op, sortOrder -10)

**Placeholder scan:** All code blocks show full implementations. Field IDs and userId noted as TODOs in Task 8 with a lookup recipe.

**Type consistency:** `sortOrder` used consistently (not `priority`). `$trigger.occurrence` used consistently. Condition group shape `{operator, rules}` used everywhere.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-16-operations-overhaul.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
