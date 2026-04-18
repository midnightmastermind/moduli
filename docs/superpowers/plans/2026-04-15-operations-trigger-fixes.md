# Operations Trigger Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three operation trigger bugs: completed field toggle not recalculating goals, delete/remove not recalculating goals, and add a Tasks Completed goal to the test grid with proper conditional logic.

**Architecture:** Two independent layers need changes. (1) Client-side: `CommitHelpers.deleteOccurrence` must fire operations optimistically just like `setOccurrenceFieldValue` does — the server only echoes `occurrence_deleted` to OTHER sockets, never back to the initiating one. (2) Data: the Water Today operation in `createTestGrid.js` needs `completedFieldId` added to `allowedFields` and a completed-check condition in the loop body. A new Tasks Completed operation/field/instance is added to the test grid.

**Tech Stack:** React, Socket.io, MongoDB/Mongoose, custom pipeline executor (`operationExecutor.js`)

---

## Root Cause Summary

| Bug | Root Cause | File |
|-----|-----------|------|
| Completed toggle doesn't recalculate | `allowedFields: [waterFieldId]` — completedFieldId not included | `createTestGrid.js` operation data |
| Loop counts water regardless of completed | No `IS completed === true` guard in loop body | `createTestGrid.js` operation pipeline |
| Delete/remove doesn't recalculate | `deleteOccurrence` never calls `operationsBridge.fireOperations` (server emits `occurrence_deleted` only to OTHER sockets via `socket.to()`) | `CommitHelpers.js` |

---

## File Map

| File | Change |
|------|--------|
| `client/src/state/bindSocketToStore.js` | Expose `removeLocalOcc` on `operationsBridge` |
| `client/src/helpers/CommitHelpers.js` | Call `removeLocalOcc` + `fireOperations` in `deleteOccurrence` and `removeOccurrence` |
| `server/scripts/createTestGrid.js` | Update Water Today op (allowedFields + completed condition); add Tasks Completed field + op + goal instance |

---

## Task 1: Expose removeLocalOcc on operationsBridge

**Why:** `CommitHelpers.deleteOccurrence` needs to remove an occurrence from `localOccsById` (the live cache that `fireOperations` reads) BEFORE firing operations. Without this, the deleted occurrence would still be in the cache during recalculation, inflating the total.

**Files:**
- Modify: `client/src/state/bindSocketToStore.js`

- [ ] **Step 1: Find the operationsBridge export and the localOccsById declaration**

In `bindSocketToStore.js`:
- `operationsBridge` is exported at module level (line ~28): `export const operationsBridge = { fireOperations: null };`
- `localOccsById` is declared inside `bindSocketToStore` function (line ~44)
- `operationsBridge.fireOperations` and `operationsBridge.updateLocalOcc` are assigned later inside the function (line ~31 of the offline queue changes)

Grep to confirm location:
```bash
grep -n "operationsBridge\|updateLocalOcc\|localOccsById" client/src/state/bindSocketToStore.js | head -30
```

- [ ] **Step 2: Add removeLocalOcc to operationsBridge initial export**

Find:
```js
export const operationsBridge = { fireOperations: null };
```

Replace with:
```js
export const operationsBridge = { fireOperations: null, updateLocalOcc: null, removeLocalOcc: null };
```

- [ ] **Step 3: Wire removeLocalOcc inside bindSocketToStore function**

Find the block that assigns `operationsBridge.fireOperations` and `operationsBridge.updateLocalOcc` (it's near where `fireOperations` function is defined, around line 662+). Find the assignment block that looks like:

```js
operationsBridge.fireOperations = fireOperationsOptimistic;
operationsBridge.updateLocalOcc = (occ) => { localOccsById[occ.id] = { ...occ }; };
```

Add `removeLocalOcc` immediately after `updateLocalOcc`:
```js
operationsBridge.removeLocalOcc = (occurrenceId) => { delete localOccsById[occurrenceId]; };
```

- [ ] **Step 4: Verify the pattern by reading the assignment block**

Run:
```bash
grep -n "operationsBridge\." client/src/state/bindSocketToStore.js
```

You should see `operationsBridge.fireOperations`, `operationsBridge.updateLocalOcc`, and now `operationsBridge.removeLocalOcc` all assigned.

---

## Task 2: Fire operations on delete in CommitHelpers

**Why:** When a user deletes or removes an occurrence from the schedule, the initiating socket never receives `occurrence_deleted` back from the server (server uses `socket.to()` which excludes the sender). So `onOccurrenceDeleted` in bindSocketToStore never fires, and operations never recalculate. We need to do it optimistically in CommitHelpers the same way `setOccurrenceFieldValue` does.

**Files:**
- Modify: `client/src/helpers/CommitHelpers.js`

- [ ] **Step 1: Read the current deleteOccurrence and removeOccurrence functions**

Current `deleteOccurrence` (around line 121):
```js
export function deleteOccurrence({ dispatch, socket, occurrenceId, emit = true }) {
  if (!occurrenceId) return;
  dispatch?.(deleteOccurrenceAction(occurrenceId));
  if (shouldEmit(emit)) safeEmit(socket, "delete_occurrence", { occurrenceId });
}
```

Current `removeOccurrence` (around line 128):
```js
export function removeOccurrence({ dispatch, socket, occurrenceId, parentOccurrence, grid, emit = true }) {
  if (!occurrenceId) return;
  // Update parent's occurrences array optimistically
  if (parentOccurrence) {
    const updatedOccs = (parentOccurrence.occurrences || []).filter(id => id !== occurrenceId);
    dispatch?.(updateOccurrenceAction({ id: parentOccurrence.id, occurrences: updatedOccs }));
  } else if (grid) {
    const gid = grid._id?.toString?.() || grid.id;
    const updatedGridOccs = (grid.occurrences || []).filter(id => id !== occurrenceId);
    dispatch?.(updateGridAction({ gridId: gid, grid: { occurrences: updatedGridOccs } }));
  }
  // Delete the occurrence (server cascades children + cleans parent)
  dispatch?.(deleteOccurrenceAction(occurrenceId));
  if (shouldEmit(emit)) safeEmit(socket, "delete_occurrence", { occurrenceId });
}
```

- [ ] **Step 2: Understand the setOccurrenceFieldValue pattern to mirror**

The pattern from `setOccurrenceFieldValue` (around line 346):
```js
operationsBridge.updateLocalOcc?.(updatedOcc);
operationsBridge.fireOperations?.("MeasureOp", {
  type: "MeasureOp",
  occurrenceId,
  instanceId: occ.targetId,
});
```

We need to do the equivalent for delete: remove from local cache, then fire MeasureOp for each field the occurrence had.

- [ ] **Step 3: Update deleteOccurrence to fire operations optimistically**

The function needs access to the occurrence's field data to fire per-field MeasureOps. The `stateRef` isn't available in CommitHelpers, but `operationsBridge` has the local cache. We need to read from the cache before removing.

Add a new helper `getLocalOcc` to `operationsBridge` OR read from `occurrencesById` passed in context. The cleanest approach: accept an optional `occurrence` param (the full occ object, caller provides it) and use it directly.

Replace `deleteOccurrence`:
```js
export function deleteOccurrence({ dispatch, socket, occurrenceId, occurrence, emit = true }) {
  if (!occurrenceId) return;
  // Remove from local cache BEFORE dispatch so fireOperations sees the updated state
  operationsBridge.removeLocalOcc?.(occurrenceId);
  dispatch?.(deleteOccurrenceAction(occurrenceId));
  if (shouldEmit(emit)) safeEmit(socket, "delete_occurrence", { occurrenceId });
  // Fire operations for each field that was set on the removed occurrence
  // (mirrors what onOccurrenceDeleted does in bindSocketToStore for other windows)
  if (occurrence?.fields) {
    for (const fieldId of Object.keys(occurrence.fields)) {
      operationsBridge.fireOperations?.("MeasureOp", {
        type: "MeasureOp",
        occurrenceId,
        instanceId: occurrence.targetId,
        fieldId,
      });
    }
  }
}
```

- [ ] **Step 4: Update removeOccurrence to fire operations optimistically**

Replace `removeOccurrence`:
```js
export function removeOccurrence({ dispatch, socket, occurrenceId, occurrence, parentOccurrence, grid, emit = true }) {
  if (!occurrenceId) return;
  // Remove from local cache BEFORE dispatch so fireOperations sees the updated state
  operationsBridge.removeLocalOcc?.(occurrenceId);
  // Update parent's occurrences array optimistically
  if (parentOccurrence) {
    const updatedOccs = (parentOccurrence.occurrences || []).filter(id => id !== occurrenceId);
    dispatch?.(updateOccurrenceAction({ id: parentOccurrence.id, occurrences: updatedOccs }));
  } else if (grid) {
    const gid = grid._id?.toString?.() || grid.id;
    const updatedGridOccs = (grid.occurrences || []).filter(id => id !== occurrenceId);
    dispatch?.(updateGridAction({ gridId: gid, grid: { occurrences: updatedGridOccs } }));
  }
  // Delete the occurrence (server cascades children + cleans parent)
  dispatch?.(deleteOccurrenceAction(occurrenceId));
  if (shouldEmit(emit)) safeEmit(socket, "delete_occurrence", { occurrenceId });
  // Fire operations for each field that was set on the removed occurrence
  if (occurrence?.fields) {
    for (const fieldId of Object.keys(occurrence.fields)) {
      operationsBridge.fireOperations?.("MeasureOp", {
        type: "MeasureOp",
        occurrenceId,
        instanceId: occurrence.targetId,
        fieldId,
      });
    }
  }
}
```

- [ ] **Step 5: Find all callers of deleteOccurrence and removeOccurrence that should pass occurrence**

The callers that delete instance occurrences (schedule items) need to pass the occurrence object. Panel/container/page deletes don't affect field aggregations, so they're low priority. The primary callers for this fix are:

```bash
grep -rn "deleteOccurrence\|removeOccurrence" client/src/ --include="*.js" --include="*.jsx" | grep -v "CommitHelpers\|test\|spec"
```

The most important caller is `DragProvider.jsx` when moving an occurrence OUT of a container (the old `fromC` occurrence gets removed). Also any `RadialMenu` / context menu "Delete" action.

For each caller that deletes instance occurrences: add `occurrence: theOccurrenceObject` to the call. Look for pattern like:
```js
deleteOccurrence({ dispatch, socket, occurrenceId: occ.id })
// becomes:
deleteOccurrence({ dispatch, socket, occurrenceId: occ.id, occurrence: occ })
```

- [ ] **Step 6: Check DragProvider for removeOccurrence call on drag-move (remove from source)**

In `DragProvider.jsx`, when an instance is moved (not copied), the old occurrence is removed from the source container. Find this call — it should look like:

```js
removeOccurrence({ dispatch, socket, occurrenceId, parentOccurrence: fromCOcc })
```

Update to pass the full occurrence:
```js
// First find the occurrence object:
const occObj = occurrencesById[occurrenceId];
removeOccurrence({ dispatch, socket, occurrenceId, occurrence: occObj, parentOccurrence: fromCOcc })
```

The `occurrencesById` is available in `DragProvider` via the session ref. Use `stateRef.current?.occurrencesById?.[occurrenceId]` if needed.

- [ ] **Step 7: Verify dev server still starts**

```bash
cd /home/joshpoms/moduli && npm run dev 2>&1 | head -20
```

Expected: no compilation errors.

---

## Task 3: Update Water Today operation and add Tasks Completed to createTestGrid.js

**Why:** The Water Today operation needs two data-level fixes: (1) `completedFieldId` in `allowedFields` so toggling completed triggers recalculation, (2) `IS completed === true` guard in the loop body. A new Tasks Completed goal shows count of completed instances for today.

**Files:**
- Modify: `server/scripts/createTestGrid.js`

**Context about `$item` in field_occurrences loops:**  
`gatherLoopItems` maps each occurrence to an item object that includes ALL field values by their fieldId key (line ~878 in operationExecutor.js):
```js
for (const [fid, fdata] of Object.entries(occ.fields || {})) {
  item[fid] = fdata?.value !== undefined ? fdata.value : fdata;
}
```
So `$item[completedFieldId]` is available inside the loop body. Since `completedFieldId` is a dynamic variable in the script, the rule string is built with template literals: `` `$item.${completedFieldId}` ``.

- [ ] **Step 1: Add totalTasksCompletedFieldId to pre-generated IDs**

Find the ID pre-generation block at the top of `createTestGrid`:
```js
const totalWaterFieldId = uid();
```

Add after it:
```js
const totalTasksCompletedFieldId = uid();
```

- [ ] **Step 2: Add the totalTasksCompleted display field to Field.insertMany**

Find the Field.insertMany call and add a new field entry after `totalWaterFieldId`:
```js
{ id: totalTasksCompletedFieldId, userId, gridId, name: "Tasks Completed", type: "number", inputEnabled: false, displayEnabled: true,
  displayConfig: { showArrows: true, arrowColor: "green", targetValue: 6, targetPeriod: "daily" }, meta: {} },
```

(targetValue 6 = the 6 todo instances that have `completed` bindings)

- [ ] **Step 3: Add a tasksGoalModId and tasksGoalOccId**

Find the instance module IDs block:
```js
const waterGoalModId  = uid();
```

Add after it:
```js
const tasksGoalModId  = uid();
```

- [ ] **Step 4: Add the Tasks Completed goal module to Module.insertMany (instance modules)**

Find the waterGoalModId module entry:
```js
{
  id: waterGoalModId, userId, gridId, role: "instance", kind: "list", label: "Physical Wellness",
  ...
},
```

Add a sibling entry for the tasks goal:
```js
{
  id: tasksGoalModId, userId, gridId, role: "instance", kind: "list", label: "Task Progress",
  defaultDragMode: "move",
  fieldBindings: [
    { fieldId: totalTasksCompletedFieldId, role: "display", order: 0 },
  ],
},
```

- [ ] **Step 5: Create the tasksGoalOccId occurrence**

Find:
```js
// Water goal → Physical goal container
const waterGoalOccId = await mkOcc({
  targetType: "module", targetId: waterGoalModId,
  meta: { containerId: physicalGoalContId },
  fields: { [scheduledDateFieldId]: { value: today.toISOString(), flow: "in", timestamp: new Date() } },
});
```

Add after it:
```js
// Tasks goal → Physical goal container
const tasksGoalOccId = await mkOcc({
  targetType: "module", targetId: tasksGoalModId,
  meta: { containerId: physicalGoalContId },
  fields: {},
});
```

- [ ] **Step 6: Add tasksGoalOccId to physGoalContOccId's occurrences array**

Find:
```js
const physGoalContOccId = await mkOcc({
  targetType: "module", targetId: physicalGoalContId,
  meta: {}, occurrences: [waterGoalOccId],
});
```

Change to:
```js
const physGoalContOccId = await mkOcc({
  targetType: "module", targetId: physicalGoalContId,
  meta: {}, occurrences: [waterGoalOccId, tasksGoalOccId],
});
```

- [ ] **Step 7: Replace Water Today operation with completed-conditional version**

Find the STEP 12 operations block:
```js
await new Operation(makeLoopSumOp({ name: "Water Today", targetFieldId: totalWaterFieldId, fieldId: waterFieldId, timeFilter: "daily", flowFilter: "any", targetValue: 64, targetPeriod: "daily", ...opArgs })).save();
```

Replace with a custom inline operation that:
- Triggers on BOTH `waterFieldId` AND `completedFieldId` changes
- Only adds to total when `completed === true`

```js
// Water Today — only counts water when completed checkbox is ticked
await new Operation({
  id: uid(), userId, gridId, name: "Water Today",
  description: "Sum daily water oz — only for occurrences where completed = true",
  triggerType: "onChange",
  triggerTypes: ["onChange", "onIteration", "onLoad"],
  triggerConfig: { onChange: { allowedFields: [waterFieldId, completedFieldId] } },
  enabled: true,
  pipeline: {
    sources: [],
    steps: [
      { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$total", value: 0 } },
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
            ],
          },
          then: [{ id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$total", expr: "$item.value" } }],
          else: [],
        }],
      },
      { id: uid(), type: "action", config: { type: "SHOW_VALUE", targetFieldId: totalWaterFieldId, sourceExpr: "$total", targetValue: 64, targetPeriod: "daily" } },
    ],
  },
}).save();
```

- [ ] **Step 8: Add Tasks Completed operation after the Water Today operation**

Add after the Water Today operation save:
```js
// Tasks Completed Today — count occurrences where completed = true
await new Operation(makeLoopCountTrueOp({
  name: "Tasks Completed Today",
  targetFieldId: totalTasksCompletedFieldId,
  fieldId: completedFieldId,
  timeFilter: "daily",
  targetValue: 6,
  targetPeriod: "daily",
  ...opArgs,
})).save();
```

Note: `makeLoopCountTrueOp` is already exported from `operationBuilders.js`. Add it to the import at the top of createTestGrid.js:
```js
import { makeLoopSumOp, makeLoopCountTrueOp, generateTimeSlots } from "../utils/operationBuilders.js";
```

- [ ] **Step 9: Re-run createTestGrid.js to create a fresh test grid**

```bash
cd /home/joshpoms/moduli/server && node --env-file=.env scripts/createTestGrid.js
```

Expected output:
```
✅ Connected
✅ Found user: <userId>
==================================================
✅ Test grid created!
   Grid ID: <gridId>
==================================================
```

If an error occurs about `makeLoopCountTrueOp` not being found, check the import line at the top of the script.

- [ ] **Step 10: Switch to the new test grid in the browser**

The script creates a NEW grid (doesn't delete old ones). In the browser:
1. Open the grid switcher (Toolbar → gear icon → Grid Settings, or via the grid select dropdown)
2. Select the newly created grid (it will have the most recent timestamp)

Or update the `activeFilterId` in the browser URL/localStorage if there's a grid switcher shortcut.

---

## Task 4: Verify all three triggers work

**Manual test steps — no automated tests for UI behavior, verify in browser.**

- [ ] **Step 1: Verify completed toggle triggers Water Today recalculation**

1. Start dev server: `npm run dev`
2. Open the test grid in browser
3. Drag "Drink Water" from Daily Toolkit into any schedule slot
4. Enter water value: 10 oz, check completed = true
5. Confirm Water Today goal shows 10 oz
6. **Now uncheck completed** on the drink water occurrence
7. Confirm Water Today goal drops to 0 (or reflects only other completed instances)
8. **Re-check completed**
9. Confirm Water Today goal goes back to 10 oz

- [ ] **Step 2: Verify delete/remove triggers recalculation**

1. With a Drink Water occurrence in the schedule (completed=true, 10oz)
2. Confirm Water Today = 10 oz
3. Delete or drag the occurrence back out of the schedule
4. Confirm Water Today drops to 0 immediately (no page refresh needed)

- [ ] **Step 3: Verify Tasks Completed goal updates**

1. In the Daily Goals panel, confirm "Task Progress" shows 0
2. Check the `completed` checkbox on "Morning Run" in the toolkit (or in the schedule)
3. Confirm Task Progress increments to 1
4. Uncheck it
5. Confirm Task Progress drops to 0

- [ ] **Step 4: Verify non-completed water doesn't count**

1. Drag Drink Water into schedule, enter 10oz but leave completed UNCHECKED
2. Confirm Water Today = 0 (water doesn't count unless completed)
3. Check completed
4. Confirm Water Today = 10 oz

---

## Task 5: Update CLAUDE.md files

- [ ] **Step 1: Update client/src/helpers/CLAUDE.md**

Add to Recent Changes at the top:
```
## Recent Changes (Apr 15 2026 — Delete Fires Operations Optimistically)
- **CommitHelpers.js**: `deleteOccurrence` + `removeOccurrence` now accept optional `occurrence` param. Before dispatching delete, call `operationsBridge.removeLocalOcc(occurrenceId)` to evict from local cache, then fire `MeasureOp` for each field the occurrence had. Mirrors what `onOccurrenceDeleted` does in bindSocketToStore for other windows — fixes operations not recalculating when the initiating client deletes an occurrence (server uses `socket.to()` which excludes sender).
```

- [ ] **Step 2: Update client/src/state/CLAUDE.md**

Add to Recent Changes at the top:
```
## Recent Changes (Apr 15 2026 — operationsBridge removeLocalOcc)
- **bindSocketToStore.js**: Added `removeLocalOcc: null` to `operationsBridge` initial export. Wired inside `bindSocketToStore` as `operationsBridge.removeLocalOcc = (id) => { delete localOccsById[id]; }`. Used by CommitHelpers.deleteOccurrence to evict deleted occurrences from the local cache before firing operations.
```

- [ ] **Step 3: Commit**

```bash
cd /home/joshpoms/moduli
git add client/src/state/bindSocketToStore.js client/src/helpers/CommitHelpers.js server/scripts/createTestGrid.js client/src/helpers/CLAUDE.md client/src/state/CLAUDE.md
git commit -m "fix: operations retrigger on completed toggle and occurrence delete

- CommitHelpers.deleteOccurrence/removeOccurrence fire MeasureOp for each
  field of the removed occurrence (mirrors onOccurrenceDeleted for other windows)
- operationsBridge.removeLocalOcc evicts deleted occurrence from local cache
  before fireOperations runs, so loops don't see the deleted occurrence
- createTestGrid.js: Water Today op now requires completed=true to count water;
  allowedFields includes completedFieldId so toggle fires recalculation
- createTestGrid.js: added Tasks Completed Today op + totalTasksCompleted field
  + Task Progress goal instance

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
