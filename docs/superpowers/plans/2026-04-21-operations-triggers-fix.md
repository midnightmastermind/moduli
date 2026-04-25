# Operations Triggers Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all four operation trigger types (onChange, onAdd, onDelete, onFilterChange) so they fire correctly at runtime, wire trigger data into the Sources section of the pipeline editor, and make the ConditionGroup UI match the rest of the editor's visual style.

**Architecture:** The root bug is that `CommitHelpers.setOccurrenceFieldValue` fires a MeasureOp transaction without `fieldId`, so operations with `allowedFields` never match on onChange. The server-echo path in `bindSocketToStore.onOccurrenceUpdated` has the same gap. Beyond that, Water Today and Tasks Completed Today are missing `onAdd`/`onDelete` from their `triggerTypes` arrays. The Sources section has no way to map `$trigger.*` properties to named vars. ConditionGroup uses wrong CSS tokens and unstyled elements.

**Tech Stack:** React, Redux-style state, Socket.io, Node.js, MongoDB/Mongoose.

---

## File Structure

| File | Change |
|------|--------|
| `client/src/helpers/CommitHelpers.js` | Add `fieldId` to optimistic MeasureOp fire (line ~383) |
| `client/src/state/bindSocketToStore.js` | Fire per-changed-field MeasureOp on server echo (line ~232) |
| `server/scripts/createTestGrid.js` | Add `onAdd`+`onDelete` triggerTypes to Water Today + Tasks Completed Today |
| `server/utils/operationBuilders.js` | Update `makeLoopCountTrueOp` to accept + include `onAdd`/`onDelete` |
| `client/src/helpers/operationExecutor.js` | Handle `"trigger"` source type in `executePipeline` sources loop |
| `client/src/blocks/OperationsBuilder.jsx` | Add `"trigger"` entry to `ENTITY_TYPES`; update `SourceRow` to show trigger property picker |
| `client/src/blocks/ConditionGroup.jsx` | Apply shared style constants; fix CSS variable names |
| `client/src/__tests__/operationExecutor.test.js` | Add tests for trigger-source mapping and onChange with fieldId |

---

### Task 1: Fix fieldId in CommitHelpers optimistic MeasureOp

The `setOccurrenceFieldValue` function fires operations without `fieldId`. The `matchesTrigger("onChange")` handler at line 125 of `operationExecutor.js` checks:
```js
if (allowedFields?.length > 0 && !allowedFields.includes(transaction?.fieldId)) return false;
```
So every operation with `allowedFields` (e.g. Water Today, Tasks Completed Today) silently rejects onChange.

**Files:**
- Modify: `client/src/helpers/CommitHelpers.js:383-387`
- Test: `client/src/__tests__/operationExecutor.test.js`

- [ ] **Step 1: Write the failing test**

Add to `operationExecutor.test.js` in the `matchesTrigger / onChange` describe block:

```js
it("fires onChange when fieldId matches allowedFields", () => {
  const op = {
    id: "op1", name: "Test", enabled: true,
    triggerTypes: ["onChange"],
    triggerConfig: { onChange: { allowedFields: ["fieldA"] } },
    pipeline: { sources: [], steps: [] },
  };
  expect(shouldTrigger(op, "MeasureOp", { type: "MeasureOp", fieldId: "fieldA" })).toBe(true);
});

it("does NOT fire onChange when fieldId is missing (transaction has no fieldId)", () => {
  const op = {
    id: "op2", name: "Test", enabled: true,
    triggerTypes: ["onChange"],
    triggerConfig: { onChange: { allowedFields: ["fieldA"] } },
    pipeline: { sources: [], steps: [] },
  };
  expect(shouldTrigger(op, "MeasureOp", { type: "MeasureOp" })).toBe(false);
});
```

- [ ] **Step 2: Run test to verify the second test fails (documents current bug)**

```bash
cd /home/joshpoms/moduli/client && npx jest --testPathPattern="operationExecutor" --testNamePattern="fieldId" 2>&1 | tail -20
```

The second test will PASS (behavior is correct — transaction without fieldId correctly rejects). The FIRST test may also already pass. Both passing = bug is in CommitHelpers not passing fieldId, not in the executor. Proceed to the fix.

- [ ] **Step 3: Add `fieldId` to CommitHelpers optimistic MeasureOp fire**

In `client/src/helpers/CommitHelpers.js`, the `setOccurrenceFieldValue` function around line 383:

Change:
```js
  operationsBridge.fireOperations?.("MeasureOp", {
    type: "MeasureOp",
    occurrenceId,
    instanceId: occ.targetId,
  });
```

To:
```js
  operationsBridge.fireOperations?.("MeasureOp", {
    type: "MeasureOp",
    occurrenceId,
    instanceId: occ.targetId,
    fieldId,
    value,
  });
```

- [ ] **Step 4: Run the executor tests to confirm nothing broke**

```bash
cd /home/joshpoms/moduli/client && npx jest --testPathPattern="operationExecutor" 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/helpers/CommitHelpers.js client/src/__tests__/operationExecutor.test.js
git commit -m "fix: include fieldId in optimistic MeasureOp so onChange allowedFields filter works"
```

---

### Task 2: Fix server-echo path — fire per-changed-field MeasureOp

When a field change arrives from ANOTHER window (server echo), `onOccurrenceUpdated` in `bindSocketToStore.js` fires a single MeasureOp with no `fieldId` (line ~232). The delete handler already does the correct thing — it loops over fields and fires per-field. Apply the same pattern here.

**Files:**
- Modify: `client/src/state/bindSocketToStore.js:215-240`

- [ ] **Step 1: Read the current onOccurrenceUpdated handler**

Look at lines 215-240 of `client/src/state/bindSocketToStore.js`:

```js
function onOccurrenceUpdated({ occurrence } = {}) {
  if (!occurrence?.id) return;
  const prevOcc = localOccsById[occurrence.id];
  const fieldsChanged = occurrence.fields && (!prevOcc || JSON.stringify(prevOcc.fields) !== JSON.stringify(occurrence.fields));
  localOccsById[occurrence.id] = occurrence;
  socketDispatch({ type: ActionTypes.UPDATE_OCCURRENCE, payload: { occurrence } });
  if (fieldsChanged && !optimisticFiredSet.has(occurrence.id)) {
    fireOperations("MeasureOp", {
      type: "MeasureOp",
      occurrenceId: occurrence.id,
      instanceId: occurrence.targetId,
    });
  }
  optimisticFiredSet.delete(occurrence.id);
}
```

- [ ] **Step 2: Replace single MeasureOp with per-changed-field fires**

Change the `if (fieldsChanged && ...)` block to:

```js
  if (fieldsChanged && !optimisticFiredSet.has(occurrence.id)) {
    const prevFields = prevOcc?.fields || {};
    const changedFieldIds = Object.keys(occurrence.fields || {}).filter(
      fid => JSON.stringify(occurrence.fields[fid]) !== JSON.stringify(prevFields[fid])
    );
    for (const fieldId of changedFieldIds) {
      fireOperations("MeasureOp", {
        type: "MeasureOp",
        occurrenceId: occurrence.id,
        instanceId: occurrence.targetId,
        fieldId,
        value: occurrence.fields[fieldId]?.value,
      });
    }
  }
```

- [ ] **Step 3: Run the executor tests**

```bash
cd /home/joshpoms/moduli/client && npx jest --testPathPattern="operationExecutor" 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add client/src/state/bindSocketToStore.js
git commit -m "fix: fire per-changed-field MeasureOp in onOccurrenceUpdated server-echo path"
```

---

### Task 3: Add onAdd + onDelete triggers to Water Today and Tasks Completed Today (createTestGrid.js)

The two core operations only have `["onChange", "onFilterChange", "onLoad"]`. Adding `onAdd` means a new task being dropped into the schedule recounts immediately. Adding `onDelete` means removing a task from the schedule also recounts.

Note: The delete path in `bindSocketToStore.onOccurrenceDeleted` already fires per-field MeasureOp after OccurrenceDeleteOp — so `onDelete` will fire the LOOP-based aggregation indirectly via onChange too. But having `onDelete` in `triggerTypes` makes the intent explicit and fires even if the deleted occurrence had no matching field.

**Files:**
- Modify: `server/scripts/createTestGrid.js:484-535`

- [ ] **Step 1: Update the Water Today operation to add onAdd + onDelete**

In `server/scripts/createTestGrid.js`, the Water Today operation (around line 484):

Change:
```js
    triggerType: "onChange",
    triggerTypes: ["onChange", "onFilterChange", "onLoad"],
    triggerConfig: { onChange: { allowedFields: [waterFieldId, completedFieldId] } },
```

To:
```js
    triggerType: "onChange",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerConfig: {
      onChange: { allowedFields: [waterFieldId, completedFieldId] },
    },
```

- [ ] **Step 2: Update the Tasks Completed Today operation**

The Tasks Completed Today operation (around line 526) uses `makeLoopCountTrueOp`. That helper will be updated in Task 4 to accept these triggers. For now, pass the new params:

Change:
```js
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
```

To:
```js
  await new Operation(makeLoopCountTrueOp({
    name: "Tasks Completed Today",
    targetFieldId: totalTasksCompletedFieldId,
    fieldId: completedFieldId,
    timeFilter: "daily",
    targetValue: 6,
    targetPeriod: "daily",
    pageLabel: "Schedule",
    includeAddDelete: true,
    ...opArgs,
  })).save();
```

- [ ] **Step 3: Run the test grid script to confirm it runs without errors**

```bash
cd /home/joshpoms/moduli && node --env-file=server/.env server/scripts/createTestGrid.js 2>&1 | tail -10
```

Expected: completes without errors.

- [ ] **Step 4: Commit**

```bash
git add server/scripts/createTestGrid.js
git commit -m "feat: add onAdd/onDelete triggers to Water Today and Tasks Completed Today in createTestGrid"
```

---

### Task 4: Update makeLoopCountTrueOp to support onAdd/onDelete triggers

**Files:**
- Modify: `server/utils/operationBuilders.js:79-125`

- [ ] **Step 1: Add `includeAddDelete` param to makeLoopCountTrueOp**

In `server/utils/operationBuilders.js`, update the function signature and `triggerTypes`:

Change:
```js
export function makeLoopCountTrueOp({ name, targetFieldId, fieldId, timeFilter = "daily", folderId = null, targetValue, targetPeriod = "daily", userId, gridId, pageLabel = null }) {
```

To:
```js
export function makeLoopCountTrueOp({ name, targetFieldId, fieldId, timeFilter = "daily", folderId = null, targetValue, targetPeriod = "daily", userId, gridId, pageLabel = null, includeAddDelete = false }) {
```

Change:
```js
    triggerType: "onChange",
    triggerTypes: ["onChange", "onFilterChange", "onLoad"],
    triggerConfig: { onChange: { allowedFields: [fieldId] } },
```

To:
```js
    triggerType: "onChange",
    triggerTypes: includeAddDelete
      ? ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"]
      : ["onChange", "onFilterChange", "onLoad"],
    triggerConfig: { onChange: { allowedFields: [fieldId] } },
```

- [ ] **Step 2: Verify createTestGrid still runs**

```bash
cd /home/joshpoms/moduli && node --env-file=server/.env server/scripts/createTestGrid.js 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/utils/operationBuilders.js
git commit -m "feat: add includeAddDelete param to makeLoopCountTrueOp for onAdd/onDelete triggers"
```

---

### Task 5: Add "trigger" source type to OperationsBuilder.jsx + wire it in the executor

The Sources section lets users bind named `$vars` from entities. Adding a "trigger" entity type lets users write `$myOccId = trigger.occurrenceId` in sources, then use `$myOccId` in pipeline conditions. This makes operations self-documenting and enables null-checks before expensive steps.

**Files:**
- Modify: `client/src/blocks/OperationsBuilder.jsx` (ENTITY_TYPES + SourceRow)
- Modify: `client/src/helpers/operationExecutor.js` (executePipeline sources loop)
- Test: `client/src/__tests__/operationExecutor.test.js`

**Available trigger properties by trigger type:**
- `onChange` / `onFieldChange`: `fieldId`, `value`, `occurrenceId`, `instanceId`
- `onAdd`: `occurrenceId`, `instanceId`, `containerId`, `panelId`
- `onDelete`: `occurrenceId`, `instanceId`, `containerId`
- `onFilterChange`: `date`, `activeFilterValues`
- (all types): `type` (the transactionType string)

- [ ] **Step 1: Add "trigger" to ENTITY_TYPES in OperationsBuilder.jsx**

In `client/src/blocks/OperationsBuilder.jsx`, `ENTITY_TYPES` array (around line 316):

Add after the `localField` entry:
```js
  { value: "trigger", label: "Trigger Event", hint: "Properties: fieldId, value, occurrenceId, instanceId, containerId, panelId, date, activeFilterValues" },
```

Full updated array:
```js
const ENTITY_TYPES = [
  { value: "instance", label: "Instance", hint: "$var.fieldId, $var.fieldId_flow" },
  { value: "container", label: "Container", hint: "$var.fieldId, $var.fieldId_flow" },
  { value: "panel", label: "Panel", hint: "$var.id, $var.label, $var.kind, $var.defaultDragMode" },
  { value: "occurrence", label: "Occurrence (by ID)", hint: "$var.id, $var.targetId, $var.fieldId, $var.fieldId_flow, $var._iterationTimeValue" },
  { value: "field", label: "Field (aggregated)", hint: "$var.id, $var.name, $var.type, $var.unit, $var.value, $var.flow" },
  { value: "grid", label: "Grid (whole grid)", hint: "$var.gridId, $var.currentIterationValue, $var.currentCategoryValue" },
  { value: "localField", label: "Local Field (node input)", hint: "$varName = value typed on the operation node — transient, not from DB" },
  { value: "trigger", label: "Trigger Event", hint: "Properties: fieldId, value, occurrenceId, instanceId, containerId, panelId, date, activeFilterValues" },
];
```

- [ ] **Step 2: Update SourceRow to show a property picker when entityType === "trigger"**

In `client/src/blocks/OperationsBuilder.jsx`, the `SourceRow` function. Find the existing `needsPicker` and entity select logic. After the entity type dropdown, add a branch for `trigger`.

Find the SourceRow render (around line 473+). After the `entityType` select and before the `→ as $varName` input, add:

```jsx
{src.entityType === "trigger" && (
  <select
    value={src.triggerProp || ""}
    onChange={e => onUpdate({ ...src, triggerProp: e.target.value })}
    style={selectSt}
  >
    <option value="">— pick property —</option>
    <option value="fieldId">fieldId</option>
    <option value="value">value</option>
    <option value="occurrenceId">occurrenceId</option>
    <option value="instanceId">instanceId</option>
    <option value="containerId">containerId</option>
    <option value="panelId">panelId</option>
    <option value="date">date</option>
    <option value="activeFilterValues">activeFilterValues</option>
    <option value="type">type (transactionType)</option>
  </select>
)}
```

Also update `needsPicker` logic so "trigger" doesn't show the entity dropdown (it has its own property picker). Find where `needsPicker` is set:
```js
const needsPicker = src.entityType !== "grid" && src.entityType !== "localField";
```

Change to:
```js
const needsPicker = src.entityType !== "grid" && src.entityType !== "localField" && src.entityType !== "trigger";
```

- [ ] **Step 3: Handle "trigger" source type in executePipeline**

In `client/src/helpers/operationExecutor.js`, find the sources resolution loop in `executePipeline` (look for the section that maps over `pipeline.sources`). The loop assigns `$vars[varKey]` based on `src.entityType`. Add a case for `"trigger"`:

Find the sources loop (search for `src.entityType` in executePipeline). After the `localField` case, add:

```js
} else if (src.entityType === "trigger" && src.triggerProp) {
  $vars[varKey] = $vars["$trigger"]?.[src.triggerProp] ?? null;
```

- [ ] **Step 4: Write a test for trigger source mapping**

Add to `client/src/__tests__/operationExecutor.test.js`:

```js
describe("executePipeline — trigger source", () => {
  it("maps trigger property into $vars", async () => {
    const op = {
      id: "op-t1", name: "TriggerTest", enabled: true,
      triggerTypes: ["onChange"],
      triggerConfig: {},
      pipeline: {
        sources: [{ entityType: "trigger", triggerProp: "fieldId", varName: "$changedField" }],
        steps: [
          { id: "s1", type: "action", config: { type: "SHOW_VALUE", targetFieldId: "displayField", sourceExpr: "$changedField" } },
        ],
      },
    };
    const ctx = makeTestContext();
    const results = await executePipeline(op.pipeline, { type: "MeasureOp", fieldId: "waterField" }, null, ctx);
    expect(results.find(r => r.fieldId === "displayField")?.value).toBe("waterField");
  });
});
```

Where `makeTestContext()` is a helper that returns a minimal context (occurrences: [], fields: [], modules: [], etc.).

- [ ] **Step 5: Run the executor tests**

```bash
cd /home/joshpoms/moduli/client && npx jest --testPathPattern="operationExecutor" 2>&1 | tail -15
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add client/src/blocks/OperationsBuilder.jsx client/src/helpers/operationExecutor.js client/src/__tests__/operationExecutor.test.js
git commit -m "feat: add trigger source type to operations editor — map \$trigger.* into named pipeline vars"
```

---

### Task 6: Fix ConditionGroup.jsx visual consistency

The ConditionGroup uses raw `<select>` and `<button>` elements with wrong CSS custom properties (`var(--border)`, `var(--surface)`, `var(--surface-2)` — these tokens don't exist in this app). The rest of the pipeline editor uses shared style constants from `OperationsBuilder.jsx`.

Because ConditionGroup is a sibling file, it can't import from OperationsBuilder. Define equivalent inline constants directly in ConditionGroup.

**Files:**
- Modify: `client/src/blocks/ConditionGroup.jsx`

**Correct CSS tokens (from OperationsBuilder.jsx):**
- Background: `var(--input-bg)` (not `var(--surface)`)
- Row background: `var(--border-subtle)` (not `var(--surface-2)`)
- Border: `var(--border-default)` (not `var(--border)`)
- Text: `var(--text-primary)`, `var(--text-muted)`, `var(--text-faint)`
- Input border: `var(--input-border)`

- [ ] **Step 1: Replace ConditionGroup.jsx with the corrected version**

```jsx
// blocks/ConditionGroup.jsx
// Recursive condition builder supporting nested AND/OR groups.
import React from "react";
import PathPicker, { buildPathShape } from "./PathPicker";

const COMPARATORS = [
  "IS", "IS_NOT", "GREATER", "LESS", "GREATER_OR_EQUAL", "LESS_OR_EQUAL",
  "CONTAINS", "NOT_CONTAINS", "IS_EMPTY", "IS_NOT_EMPTY",
  "HAS_ANCESTOR",
  "DATE_EQUALS", "DATE_IS_TODAY", "DATE_BEFORE_TODAY", "DATE_AFTER_TODAY",
];

const selectSt = {
  fontSize: 10, fontFamily: "monospace", padding: "2px 4px", borderRadius: 4,
  background: "var(--input-bg)", border: "1px solid var(--input-border)",
  color: "var(--text-primary)",
};
const inputSt = {
  fontSize: 10, fontFamily: "monospace", padding: "2px 5px", borderRadius: 4,
  background: "var(--input-bg)", border: "1px solid var(--input-border)",
  color: "var(--text-primary)", outline: "none", minWidth: 60,
};
const addBtnStyle = {
  display: "inline-flex", alignItems: "center", gap: 4,
  padding: "2px 8px", borderRadius: 4, fontSize: 10, fontFamily: "monospace",
  background: "var(--input-bg)", border: "1px dashed var(--border-default)",
  color: "var(--text-muted)", cursor: "pointer",
};
const removeBtnSt = {
  fontSize: 10, color: "rgba(255,100,100,0.5)",
  background: "none", border: "none", cursor: "pointer", padding: "0 2px", lineHeight: 1,
};
const rowStyle = {
  display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap",
  background: "var(--border-subtle)", borderRadius: 4, padding: "4px 6px",
};

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
    <div style={{
      border: "1px solid var(--border-default)", borderRadius: 4, padding: 6,
      marginLeft: depth * 12,
      background: depth % 2 ? "var(--border-subtle)" : "var(--input-bg)",
    }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
        <select value={operator} onChange={(e) => setOperator(e.target.value)} style={selectSt}>
          <option value="AND">ALL of</option>
          <option value="OR">ANY of</option>
        </select>
        <button onClick={addRule} style={addBtnStyle}>+ Rule</button>
        <button onClick={addGroup} style={addBtnStyle}>+ Group</button>
      </div>
      {rules.map((entry, i) => (
        <div key={i} style={{ marginBottom: 4 }}>
          {Array.isArray(entry.rules) ? (
            <div style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
              <ConditionGroup group={entry} onChange={(next) => setRule(i, next)} sources={sources} fields={fields} depth={depth + 1} />
              <button onClick={() => removeRule(i)} style={removeBtnSt}>×</button>
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
    <div style={rowStyle}>
      <PathPicker value={rule.left} onChange={(next) => onChange({ ...rule, left: next })} shapeByVar={shape} />
      <select value={rule.comparator} onChange={(e) => onChange({ ...rule, comparator: e.target.value })} style={selectSt}>
        {COMPARATORS.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <input
        type="text"
        value={rule.right ?? ""}
        onChange={(e) => onChange({ ...rule, right: e.target.value })}
        placeholder="value or $var"
        style={{ ...inputSt, width: 140 }}
      />
      <button onClick={onRemove} style={removeBtnSt}>×</button>
    </div>
  );
}
```

- [ ] **Step 2: Run the executor tests to confirm nothing broke**

```bash
cd /home/joshpoms/moduli/client && npx jest --testPathPattern="operationExecutor" 2>&1 | tail -5
```

Expected: all pass (ConditionGroup is UI-only, no executor impact).

- [ ] **Step 3: Verify app builds**

```bash
cd /home/joshpoms/moduli && npm run build 2>&1 | tail -15
```

Expected: build succeeds, no import errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/blocks/ConditionGroup.jsx
git commit -m "fix: ConditionGroup visual consistency — apply shared style tokens, fix CSS vars"
```

---

## Self-Review

### Spec coverage check

| Requirement | Covered by |
|-------------|-----------|
| onChange triggers don't fire | Task 1 (CommitHelpers fieldId) + Task 2 (server echo per-field) |
| onAdd trigger doesn't fire | Task 3 (createTestGrid), Task 4 (operationBuilders) |
| onDelete trigger doesn't fire | Task 3 (createTestGrid), Task 4 (operationBuilders) |
| onFilterChange trigger | Already fires via `onGridUpdated` → `fireOperations("NavigationOp")` — no code change needed |
| Sources section — wire trigger vars | Task 5 (OperationsBuilder + executePipeline) |
| ConditionGroup UI inconsistency | Task 6 |
| Water Today: all 4 trigger types | Task 3 + Task 4 |
| Tasks Completed Today: all 4 trigger types | Task 3 + Task 4 |

### Placeholder scan

None found — all steps contain complete code.

### Type consistency

- `src.triggerProp` used in both OperationsBuilder.jsx SourceRow (Step 5.2) and executePipeline source handler (Step 5.3) — consistent.
- `includeAddDelete` param used in createTestGrid.js (Task 3) and makeLoopCountTrueOp (Task 4) — consistent.
- `fieldId` + `value` added to CommitHelpers MeasureOp (Task 1) — matches what `matchesTrigger("onChange")` reads from `transaction.fieldId` (line 125 of operationExecutor.js).
