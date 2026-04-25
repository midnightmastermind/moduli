# Operations & Filters Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all four test grid operations end-to-end (Water Today, Tasks Completed Today, Schedule Stamp, Schedule Clear) and wire up the toolbar global date nav so that navigating dates actually re-runs operations.

**Architecture:** Six independent fixes, each with a clear blast radius. The panelId hierarchy walk fix (Tasks 3 & 4) is the load-bearing change for Schedule Stamp and Schedule Clear. The filterNavState → NavigationOp bridge (Task 5) is what makes Water Today and Tasks Completed Today react to date navigation. createTestGrid.js must be updated to match the DB fix already applied in Apr 16 so re-running the script doesn't revert it.

**Tech Stack:** React, Redux-style dispatch, Socket.io, Mongoose, Playwright E2E

---

## File Map

| File | Change |
|------|--------|
| `server/scripts/createTestGrid.js` | Rewrite Water Today loop to use FIND_OCCURRENCE + HAS_ANCESTOR |
| `server/utils/operationBuilders.js` | Rewrite `makeLoopCountTrueOp` to accept `pageLabel` instead of `pageOccId` |
| `client/src/state/bindSocketToStore.js` | Fix `onOccurrenceCreated` panelId resolution via reverse-map walk |
| `client/src/helpers/dropHandlers.js` | Fix `handleInstanceDrop` panelId + apply SET_FIELD_VALUE effects |
| `client/src/App.jsx` | Add useEffect: fire NavigationOp when `filterNavState` changes |
| `client/src/Toolbar.jsx` | Add global date nav (prev/next/date display) |
| `client/src/ui/commandCenter/OperationsTab.jsx` | Rename "On Iteration" → "On Navigation"; rename subject "iteration" → "filter" |

---

## Background: Why Each Operation Is Broken

### Water Today & Tasks Completed Today
Both use `pageOccId` on the loop step, which `gatherLoopItems` silently ignores (not destructured). The DB was patched Apr 16 with FIND_OCCURRENCE + HAS_ANCESTOR but the **script** was never updated — re-running creates broken operations again.

Also: `onIteration` trigger only fires when `filterNavState` changes, but there is no listener that converts `filterNavState` changes into `NavigationOp` calls. So date navigation does nothing.

### Schedule Stamp
Trigger `{ onCreate: { panelId: centerHubId } }`. When an instance is dropped into a schedule slot, `onOccurrenceCreated` walks ONE level up from the slot container → finds `schedPageOcc` (role="page"), uses its `targetId = schedPageModId`. This never equals `centerHubId`, so the trigger never fires.

### Schedule Clear
Same panelId bug in `dropHandlers.js`. Additionally, even if the trigger fired, the `_effect: "SET_FIELD_VALUE"` entries in the updates array are passed to `dispatch({ type: "SET_COMPUTED_VALUES" })` which discards them — the field is never actually cleared.

### Panel Hierarchy (why 1-level walk fails)
The schedule has 4 levels, not 2:
```
Grid.occurrences → panelOcc (targetId=centerHubId, parentId=null)
  panelOcc.occurrences → schedPageOcc (targetId=schedPageModId, parentId=rootFolderId)
    schedPageOcc.occurrences → slotContainerOcc
      slotContainerOcc.occurrences → instanceOcc
```
`schedPageOcc.parentId = rootFolderId` (a folder, not a panel), so `parentId` chain-walking fails. The correct approach: use the reverse map built from `occ.occurrences[]` arrays, then walk until finding an occurrence that is a direct child of `grid.occurrences`.

---

## Task 1: Fix `createTestGrid.js` — Water Today operation

**Files:**
- Modify: `server/scripts/createTestGrid.js`

- [ ] **Step 1.1: Open the file and find the Water Today operation**

  Lines 484–515. The loop step at line 496 has `pageOccId: schedPageOccId` which is ignored.

- [ ] **Step 1.2: Replace the Water Today operation with FIND_OCCURRENCE + HAS_ANCESTOR**

  Replace the entire `new Operation({...}).save()` block for "Water Today" (lines 484–515) with:

  ```js
  await new Operation({
    id: uid(), userId, gridId, name: "Water Today",
    description: "Sum daily water oz — only for occurrences under the Schedule page",
    triggerType: "onChange",
    triggerTypes: ["onChange", "onIteration", "onLoad"],
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
  ```

- [ ] **Step 1.3: Verify the script runs without error**

  ```bash
  cd /home/joshpoms/moduli/server
  node --env-file=.env scripts/createTestGrid.js 2>&1 | head -20
  ```
  Expected: `✅ Test grid created!` (or the "already exists" behavior from `dropExistingTestGrid`)

---

## Task 2: Fix `operationBuilders.js` — `makeLoopCountTrueOp` add pageLabel support

**Files:**
- Modify: `server/utils/operationBuilders.js`

- [ ] **Step 2.1: Replace `makeLoopCountTrueOp` signature and body**

  Replace the entire function (lines 77–104) with:

  ```js
  /**
   * Count occurrences where boolean field === true.
   * Pass `pageLabel` to scope the loop to descendants of a named page occurrence.
   * (pageOccId is no longer used — use pageLabel instead)
   */
  export function makeLoopCountTrueOp({ name, targetFieldId, fieldId, timeFilter = "daily", folderId = null, targetValue, targetPeriod = "daily", userId, gridId, pageLabel = null }) {
    const findStep = pageLabel ? [{
      id: uid(), type: "action", config: {
        type: "FIND_OCCURRENCE",
        moduleLabelExpr: `literal:${pageLabel}`,
        resultVar: "$scopePage",
        resultIdVar: "$scopePageId",
      },
    }] : [];

    const ancestorRule = pageLabel
      ? [{ comparator: "HAS_ANCESTOR", left: "$item._ancestors", right: "$scopePageId" }]
      : [];

    return {
      id: uid(), userId, gridId, name, folderId,
      description: `Count completed (true) ${name} occurrences (${timeFilter}) — granular LOOP pipeline`,
      triggerType: "onChange",
      triggerTypes: ["onChange", "onIteration", "onLoad"],
      triggerConfig: { onChange: { allowedFields: [fieldId] } },
      enabled: true,
      pipeline: {
        sources: [],
        steps: [
          { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$count", value: 0 } },
          ...findStep,
          {
            id: uid(), type: "loop",
            over: "field_occurrences", fieldId, timeFilter, flowFilter: "any", as: "$item",
            body: [{
              id: uid(), type: "if",
              condition: {
                operator: "AND",
                rules: [
                  { comparator: "IS", left: "$item.value", right: true },
                  ...ancestorRule,
                ],
              },
              then: [{ id: uid(), type: "action", config: { type: "INCREMENT_VAR", name: "$count", by: 1 } }],
              else: [],
            }],
          },
          { id: uid(), type: "action", config: { type: "SHOW_VALUE", targetFieldId, sourceExpr: "$count", ...(targetValue != null ? { targetValue, targetPeriod } : {}) } },
        ],
      },
    };
  }
  ```

- [ ] **Step 2.2: Update `createTestGrid.js` to use `pageLabel` instead of `pageOccId`**

  In `createTestGrid.js`, the `Tasks Completed Today` operation call (lines 517–526):

  ```js
  // BEFORE:
  await new Operation(makeLoopCountTrueOp({
    name: "Tasks Completed Today",
    targetFieldId: totalTasksCompletedFieldId,
    fieldId: completedFieldId,
    timeFilter: "daily",
    targetValue: 6,
    targetPeriod: "daily",
    pageOccId: schedPageOccId,   // ← remove this
    ...opArgs,
  })).save();

  // AFTER:
  await new Operation(makeLoopCountTrueOp({
    name: "Tasks Completed Today",
    targetFieldId: totalTasksCompletedFieldId,
    fieldId: completedFieldId,
    timeFilter: "daily",
    targetValue: 6,
    targetPeriod: "daily",
    pageLabel: "Schedule",       // ← use module label instead
    ...opArgs,
  })).save();
  ```

- [ ] **Step 2.3: Run the test grid script again to verify no errors**

  ```bash
  cd /home/joshpoms/moduli/server
  node --env-file=.env scripts/resetTestGridData.js 2>&1 | tail -10
  ```
  If `resetTestGridData.js` doesn't exist, run `createTestGrid.js` directly. Expected: success output.

- [ ] **Step 2.4: Commit**

  ```bash
  git add server/scripts/createTestGrid.js server/utils/operationBuilders.js
  git commit -m "fix: update test grid ops to use FIND_OCCURRENCE+HAS_ANCESTOR scope"
  ```

---

## Task 3: Fix panelId hierarchy walk in `bindSocketToStore.js`

**Files:**
- Modify: `client/src/state/bindSocketToStore.js`

The bug: `onOccurrenceCreated` walks only one `parentId` step to find the panel. For schedule slots (4 levels deep), this finds `schedPageOcc` instead of the actual panel occurrence.

The fix: build a reverse map from `occ.occurrences[]` arrays, then walk up until finding an occurrence that is in `grid.occurrences` (i.e., a direct child of the grid = a panel occurrence).

- [ ] **Step 3.1: Add `_buildReverseMap` helper before `bindSocketToStore`**

  Insert this function at module scope, before the `bindSocketToStore` export (around line 35):

  ```js
  /** Build { childOccId → parentOccId } from all occ.occurrences[] arrays */
  function _buildReverseMap(occArr) {
    const map = {};
    for (const occ of occArr) {
      for (const childId of (occ.occurrences || [])) {
        map[childId] = occ.id;
      }
    }
    return map;
  }

  /** Walk up the reverse map until we find an occurrence that is in gridOccSet (= panel level) */
  function _findGridPanelOcc(startOcc, reverseMap, occById, gridOccSet) {
    if (!startOcc) return null;
    let curId = reverseMap[startOcc.id];
    for (let i = 0; i < 8; i++) {
      if (!curId) return null;
      const cur = occById[curId];
      if (!cur) return null;
      if (gridOccSet.has(cur.id)) return cur;
      curId = reverseMap[curId];
    }
    return null;
  }
  ```

- [ ] **Step 3.2: Replace the panelOcc resolution in `onOccurrenceCreated`**

  The current code (lines 199–213):
  ```js
  const _stateNow = stateRef.current || {};
  const _occById = { ...Object.fromEntries((_stateNow.occurrences||[]).map(o=>[o.id,o])), ...localOccsById };
  const _modsArr = _stateNow.modules || [];
  const _containerOcc = occurrence.parentId ? _occById[occurrence.parentId] : null;
  const _containerMod = _containerOcc ? _modsArr.find(m => m.id === _containerOcc.targetId) : null;
  const _panelOcc = _containerOcc?.parentId ? _occById[_containerOcc.parentId] : null;
  const _panelMod = _panelOcc ? _modsArr.find(m => m.id === _panelOcc.targetId) : null;
  ```

  Replace with:
  ```js
  const _stateNow = stateRef.current || {};
  const _occById = { ...Object.fromEntries((_stateNow.occurrences||[]).map(o=>[o.id,o])), ...localOccsById };
  const _modsArr = _stateNow.modules || [];
  const _containerOcc = occurrence.parentId ? _occById[occurrence.parentId] : null;
  const _containerMod = _containerOcc ? _modsArr.find(m => m.id === _containerOcc.targetId) : null;
  // Walk up via reverse map to find the actual panel occurrence (handles N-level page hierarchies)
  const _revMap = _buildReverseMap(Object.values(_occById));
  const _gridOccSet = new Set(_stateNow.grid?.occurrences || []);
  const _panelOcc = _findGridPanelOcc(_containerOcc, _revMap, _occById, _gridOccSet);
  const _panelMod = _panelOcc ? _modsArr.find(m => m.id === _panelOcc.targetId) : null;
  ```

- [ ] **Step 3.3: Verify the fireOperations call below is unchanged**

  Lines 206–214 should still read:
  ```js
  fireOperations("OccurrenceCreateOp", {
    type: "OccurrenceCreateOp",
    occurrenceId: occurrence.id,
    instanceId: occurrence.targetId,
    containerId: occurrence.parentId,
    panelId: _panelOcc?.targetId || occurrence.panelId,
    containerLabel: _containerMod?.label || "",
    panelLabel: _panelMod?.label || "",
  });
  ```
  No change needed here — just verify it's intact.

- [ ] **Step 3.4: Smoke-test manually**

  Start the app. Open the Test Grid. Drag "Drink Water" from Daily Toolkit into a Schedule slot. Open the Operation Log in the Command Center for "Schedule: Stamp Date & Time Slot". Verify it shows a run entry with the OccurrenceCreateOp trigger.

---

## Task 4: Fix panelId walk + effect application in `dropHandlers.js`

**Files:**
- Modify: `client/src/helpers/dropHandlers.js`

Two bugs: (1) same panelId walk issue as Task 3, (2) `SET_FIELD_VALUE` effects discarded by `SET_COMPUTED_VALUES` dispatch.

- [ ] **Step 4.1: Import `CommitHelpers` at the top of `dropHandlers.js` (if not already)**

  Check line 1–30 of `dropHandlers.js`. If `CommitHelpers` is not imported:
  ```js
  import * as CommitHelpers from "./CommitHelpers";
  ```

- [ ] **Step 4.2: Find the OccurrenceMoveOp block in `handleInstanceDrop`**

  Lines 398–416 (the cross-container move block). Current code:
  ```js
  const allOccs = Object.values(occurrencesById);
  const fromPanelOcc = fromCOcc.parentId ? allOccs.find(o => o.id === fromCOcc.parentId) : null;
  const toPanelOcc = toCOcc.parentId ? allOccs.find(o => o.id === toCOcc.parentId) : null;
  const tx = {
    type: "OccurrenceMoveOp", occurrenceId, instanceId: draggedInstanceId,
    fromContainerId: fromC.id, toContainerId: toC.id,
    fromPanelId: fromPanelOcc?.targetId || null, toPanelId: toPanelOcc?.targetId || null,
  };
  const operations = Object.values(state?.operationsById || {});
  const fieldsById = Object.fromEntries((state?.fields || []).map(f => [f.id, f]));
  const allUpdates = runMatchingOperations(operations, "OccurrenceMoveOp", tx, {
    state, fieldsById, operationsById: state?.operationsById || {}, occurrencesById: { ...occurrencesById },
  });
  if (allUpdates?.length) {
    dispatch({ type: "SET_COMPUTED_VALUES", updates: allUpdates });
  }
  ```

- [ ] **Step 4.3: Replace the OccurrenceMoveOp block**

  Replace everything from `const allOccs` through the closing `}` of the `if (allUpdates?.length)` block with:

  ```js
  // Build reverse map to walk up N-level page hierarchies to find the panel
  const allOccs = Object.values(occurrencesById);
  const _revMap = {};
  for (const occ of allOccs) {
    for (const childId of (occ.occurrences || [])) { _revMap[childId] = occ.id; }
  }
  const _gridOccSet = new Set(state?.grid?.occurrences || []);
  function _findPanel(startOcc) {
    if (!startOcc) return null;
    let curId = _revMap[startOcc.id];
    for (let i = 0; i < 8; i++) {
      if (!curId) return null;
      const cur = occurrencesById[curId];
      if (!cur) return null;
      if (_gridOccSet.has(cur.id)) return cur;
      curId = _revMap[curId];
    }
    return null;
  }
  const fromPanelOcc = _findPanel(fromCOcc);
  const toPanelOcc = _findPanel(toCOcc);

  const tx = {
    type: "OccurrenceMoveOp", occurrenceId, instanceId: draggedInstanceId,
    fromContainerId: fromC.id, toContainerId: toC.id,
    fromPanelId: fromPanelOcc?.targetId || null,
    toPanelId: toPanelOcc?.targetId || null,
  };
  const operations = Object.values(state?.operationsById || {});
  const fieldsById = Object.fromEntries((state?.fields || []).map(f => [f.id, f]));
  const allUpdates = runMatchingOperations(operations, "OccurrenceMoveOp", tx, {
    state, fieldsById, operationsById: state?.operationsById || {}, occurrencesById: { ...occurrencesById },
  });
  if (allUpdates?.length) {
    // Split display updates (SHOW_VALUE) from effect updates (SET_FIELD_VALUE)
    const displayUpdates = allUpdates.filter(u => !u._effect);
    const effectUpdates = allUpdates.filter(u => u._effect);
    if (displayUpdates.length) {
      dispatch({ type: "SET_COMPUTED_VALUES", updates: displayUpdates });
    }
    for (const eff of effectUpdates) {
      if (eff._effect === "SET_FIELD_VALUE") {
        CommitHelpers.setOccurrenceFieldValue({
          dispatch, socket, occurrencesById,
          occurrenceId: eff.occurrenceId,
          fieldId: eff.fieldId,
          value: eff.value,
          flow: eff.flow || "replace",
        });
      }
    }
  }
  ```

- [ ] **Step 4.4: Verify `socket` is available in the `handleInstanceDrop` closure**

  `dropHandlers.js` receives `ctx = { dispatch, socket, state, occurrencesById, ... }`. Confirm `socket` is destructured at the top of `handleInstanceDrop` (or look up from `ctx`). If it's on `ctx`, add it to the destructure list.

- [ ] **Step 4.5: Smoke-test manually**

  On the Test Grid, drag an instance from a schedule slot to the Todo List. Open the instance — verify its `dateFieldId` and `timeslotFieldId` are cleared (null). Check the Operation Log for "Schedule: Clear Date & Time Slot".

- [ ] **Step 4.6: Commit**

  ```bash
  git add client/src/state/bindSocketToStore.js client/src/helpers/dropHandlers.js
  git commit -m "fix: walk full occ hierarchy for panelId; apply SET_FIELD_VALUE effects from MoveOp"
  ```

---

## Task 5: Fire NavigationOp when `filterNavState` changes (App.jsx)

**Files:**
- Modify: `client/src/App.jsx`

Currently NavigationOp only fires from `onGridUpdated` when `patch.activeFilterValues` changes (old filter system). The new per-component filter nav (`filterNavState`) never triggers it.

- [ ] **Step 5.1: Import `operationsBridge` in App.jsx (if not already)**

  Near the top of `App.jsx`, add or verify:
  ```js
  import { operationsBridge } from "./state/bindSocketToStore";
  ```

- [ ] **Step 5.2: Add a ref to track previous filterNavState**

  After the existing `stateRef` setup, add:
  ```js
  const prevFilterNavRef = useRef({});
  ```

- [ ] **Step 5.3: Add useEffect after the stateRef sync effect**

  ```js
  // Fire NavigationOp when any date filter nav value changes
  useEffect(() => {
    const prev = prevFilterNavRef.current;
    const curr = state.filterNavState || {};

    const changed = Object.entries(curr).filter(([id, val]) => {
      if (!val || typeof val !== "string") return false;
      if (isNaN(Date.parse(val))) return false;
      return val !== prev[id];
    });

    if (changed.length > 0) {
      const date = changed[0][1];
      operationsBridge.fireOperations?.("NavigationOp", {
        type: "NavigationOp",
        activeFilterValues: curr,
        date,
      });
    }

    prevFilterNavRef.current = curr;
  }, [state.filterNavState]);
  ```

- [ ] **Step 5.4: Verify NavigationOp fires**

  In browser console, add a temporary `console.log` inside `operationsBridge.fireOperations` (or look at the Operation Log). Navigate the Schedule date and confirm a NavigationOp run appears in the Water Today log.

---

## Task 6: Add global date nav to Toolbar

**Files:**
- Modify: `client/src/Toolbar.jsx`

The toolbar needs a prev/next date control that dispatches `setFilterNavAction` for all date-valued entries in `filterNavState`.

- [ ] **Step 6.1: Add the required imports to Toolbar.jsx**

  ```js
  import { ChevronLeft, ChevronRight } from "lucide-react";
  import { useContext } from "react";
  import { GridActionsContext } from "./GridActionsContext";
  import { setFilterNavAction } from "./state/actions";
  ```

  Note: `ChevronLeft`/`ChevronRight` may already be imported. Check existing imports.

- [ ] **Step 6.2: Read filterNavState from context inside the Toolbar component**

  At the top of the `Toolbar` component body:
  ```js
  const { dispatch, filterNavState } = useContext(GridActionsContext);
  ```

- [ ] **Step 6.3: Add the date nav handlers**

  ```js
  // Find first date-valued entry in filterNavState for display
  const primaryFilterEntry = Object.entries(filterNavState || {}).find(([, val]) =>
    val && typeof val === "string" && !isNaN(Date.parse(val))
  );
  const primaryFilterId = primaryFilterEntry?.[0] ?? null;
  const primaryDate = primaryFilterEntry ? new Date(primaryFilterEntry[1]) : new Date();

  const formatNavDate = (d) => {
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };

  const navigateAllFilters = (deltaDays) => {
    const curr = filterNavState || {};
    Object.entries(curr).forEach(([filterId, val]) => {
      if (!val || typeof val !== "string" || isNaN(Date.parse(val))) return;
      const d = new Date(val);
      d.setDate(d.getDate() + deltaDays);
      dispatch(setFilterNavAction(filterId, d.toISOString()));
    });
  };
  ```

- [ ] **Step 6.4: Insert the date nav JSX into the toolbar's center section**

  Find where the toolbar center content is rendered (look for `className` with `flex-1` or `justify-center`). Add the date nav there:

  ```jsx
  {primaryFilterId && (
    <div className="flex items-center gap-1">
      <button
        onClick={() => navigateAllFilters(-1)}
        className="h-7 w-7 rounded flex items-center justify-center hover:bg-accent text-text-muted hover:text-foreground transition-colors"
        title="Previous day"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span
        className="text-xs font-mono text-text-primary px-1 min-w-[110px] text-center"
        title="Current filter date"
      >
        {formatNavDate(primaryDate)}
      </span>
      <button
        onClick={() => navigateAllFilters(1)}
        className="h-7 w-7 rounded flex items-center justify-center hover:bg-accent text-text-muted hover:text-foreground transition-colors"
        title="Next day"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )}
  ```

- [ ] **Step 6.5: Test in browser**

  Load the Test Grid. The toolbar should show "Mon, Apr 20" (today's date) with arrows. Click the left arrow — date goes back one day. The Schedule panel should filter to that date. The Water Today and Tasks Completed counts should update.

- [ ] **Step 6.6: Commit**

  ```bash
  git add client/src/App.jsx client/src/Toolbar.jsx
  git commit -m "feat: global date nav in toolbar fires NavigationOp on filterNavState change"
  ```

---

## Task 7: Fix Operations Editor language

**Files:**
- Modify: `client/src/ui/commandCenter/OperationsTab.jsx`

"On Iteration" is confusing — the system no longer has "iterations", it has filter-based navigation.

- [ ] **Step 7.1: Rename `onIteration` label in `EVENT_TYPES`**

  Line 52, change:
  ```js
  // BEFORE:
  { value: "onIteration",    label: "On Iteration",     desc: "Fires when the date or category filter changes" },
  // AFTER:
  { value: "onIteration",    label: "On Navigation",    desc: "Fires when the date filter nav changes (alias: onNavigation, onFilterChange)" },
  ```

  Do NOT change the `value` — operations in the DB still use `"onIteration"` as the stored value. Only the label shown in the UI changes.

- [ ] **Step 7.2: Rename `iteration` subject type in `SUBJECT_TYPES`**

  Line 66, change:
  ```js
  // BEFORE:
  { value: "iteration",   label: "Iteration",    desc: "An iteration definition or value" },
  // AFTER:
  { value: "iteration",   label: "Filter Nav",   desc: "A date filter navigation event" },
  ```

- [ ] **Step 7.3: Verify in browser**

  Open Command Center → Operations → create a new operation or click an existing one. The trigger event dropdown should now show "On Navigation" instead of "On Iteration".

- [ ] **Step 7.4: Commit**

  ```bash
  git add client/src/ui/commandCenter/OperationsTab.jsx
  git commit -m "fix: rename On Iteration → On Navigation in operations editor UI"
  ```

---

## Task 8: End-to-end verification of all 4 operations

**Files:**
- Read: `tests/e2e/` (look for existing smoke tests)
- Modify or create: `tests/e2e/operations-smoke.spec.js`

- [ ] **Step 8.1: Reset the test grid**

  ```bash
  cd /home/joshpoms/moduli/server
  node --env-file=.env scripts/resetTestGridData.js
  # or if that doesn't exist:
  node --env-file=.env scripts/createTestGrid.js
  ```

  Expected output lists all 8 pre-filled schedule slots.

- [ ] **Step 8.2: Start the dev server**

  ```bash
  cd /home/joshpoms/moduli && npm run dev &
  ```

  Wait for `Server listening on port 5000` and `VITE ready`.

- [ ] **Step 8.3: Open browser and switch to Test Grid**

  Navigate to `http://localhost:5173`. Switch to the Test Grid via the grid selector in the toolbar. The grid should show 4 panels: Daily Toolkit, Todo List, Center Hub (Schedule/Notes), Daily Goals.

- [ ] **Step 8.4: Verify Water Today**

  The Daily Goals panel should show "Physical Wellness" with a "Daily Water" field. The value should be **56 oz** (7+16+16+8+8 = 56 from completed slots; 8oz at 5pm is NOT completed). Target is 64 oz. There should be a progress bar at 56/64.

  If it shows 0: Operation Log in CC → "Water Today" → check for run entries and any errors.

- [ ] **Step 8.5: Verify Tasks Completed Today**

  The "Task Progress" instance should show **5** completed tasks (Morning Run, 2nd Water, Take Vitamins, 12pm Water, 3pm Water — stretch and 5pm water are not completed). Target is 6.

  If it shows 0: Check Operation Log for "Tasks Completed Today".

- [ ] **Step 8.6: Verify Schedule Stamp**

  Drag "Drink Water" from the Daily Toolkit into the "2:00pm" slot in the Schedule. After drop: click on the new instance and verify its `Date` field = today and `Time Slot` field = "2:00pm".

  If fields are empty: Check Operation Log for "Schedule: Stamp Date & Time Slot". If there's no run, the trigger didn't fire — double-check `panelId` matching (Task 3).

- [ ] **Step 8.7: Verify Schedule Clear**

  Drag one of the pre-filled schedule instances (e.g., 7am Drink Water) OUT of the schedule into the Daily Toolkit panel. After drop: verify the moved instance's `Date` and `Time Slot` fields are cleared (null/empty).

  If fields remain set: Check that `dropHandlers.js` changes from Task 4 are in effect. Look for the `_effect: "SET_FIELD_VALUE"` entries in the Operation Log.

- [ ] **Step 8.8: Verify date navigation updates Water Today**

  Click the left arrow in the toolbar. The date should change to yesterday. The schedule should clear (no slots shown for yesterday since they all have today's date). The Water Today count should drop to 0.

  Click the right arrow to return to today. Water Today should return to 56.

- [ ] **Step 8.9: Write a smoke test (optional but recommended)**

  Look at existing E2E tests:
  ```bash
  ls /home/joshpoms/moduli/tests/e2e/
  ```

  If there's already an `operations-smoke.spec.js` or similar, review and extend it. Otherwise create `tests/e2e/operations-smoke.spec.js`:

  ```js
  // tests/e2e/operations-smoke.spec.js
  import { test, expect } from "@playwright/test";

  test.describe("Test Grid Operations", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("http://localhost:5173");
      // Wait for grid to load
      await page.waitForSelector('[data-testid="toolbar"]');
    });

    test("Water Today shows 56 oz from pre-filled schedule", async ({ page }) => {
      // Switch to Test Grid if not already there
      const state = await page.evaluate(() => window.__moduli_state__);
      // Find the totalWaterFieldId computed value
      // This is a basic smoke test — expand with actual selectors as needed
      await expect(page.locator("text=56 oz")).toBeVisible({ timeout: 5000 });
    });

    test("Tasks Completed Today shows 5", async ({ page }) => {
      await expect(page.locator("text=5")).toBeVisible({ timeout: 5000 });
    });
  });
  ```

  Run:
  ```bash
  cd /home/joshpoms/moduli && npx playwright test tests/e2e/operations-smoke.spec.js --headed
  ```

- [ ] **Step 8.10: Final commit**

  ```bash
  git add tests/e2e/operations-smoke.spec.js
  git commit -m "test: smoke tests for Water Today, Tasks Completed Today, Stamp, Clear operations"
  ```

---

## Self-Review Checklist

### Spec Coverage
- [x] Water Today loop scoped to schedule page → Task 1
- [x] Tasks Completed Today same fix → Task 2
- [x] Schedule Stamp panelId resolution → Task 3
- [x] Schedule Clear panelId + effect application → Task 4
- [x] NavigationOp fires on date nav → Task 5
- [x] Toolbar date nav control → Task 6
- [x] Operations editor language → Task 7
- [x] End-to-end verification → Task 8

### Critical Dependencies (order matters)
1. Tasks 1+2 are independent — do first to reset DB state
2. Task 3 before Task 8.6 (Stamp verification)
3. Task 4 before Task 8.7 (Clear verification)
4. Task 5 before Task 8.8 (date nav verification)
5. Task 6 requires Task 5 to be meaningful

### Known Edge Cases
- **`_buildReverseMap` in bindSocketToStore**: Called on every `onOccurrenceCreated` — O(n) over all occs. For grids with thousands of occurrences this could be slow. If perf is an issue, cache the reverse map in `localOccsById` update hooks.
- **Toolbar nav when no date filter active**: The `{primaryFilterId && ...}` guard hides the nav when no date filters exist. On grids without the Schedule filter defined, the toolbar stays clean.
- **`navigateAllFilters` updates ALL date entries**: If two filters track different dates independently, this will sync them. Acceptable for now; fix later with named filter selection.
- **`setFilterNavAction` must be exported from `actions.js`**: Verify this is already exported (it was imported by bindSocketToStore.js in the existing code, so it should be).
