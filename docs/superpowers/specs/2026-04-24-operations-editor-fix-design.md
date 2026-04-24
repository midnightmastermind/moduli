# Operations Editor Fix — Design

_Date: 2026-04-24_
_Scope: `client/src/blocks/OperationsBuilder.jsx`, `client/src/blocks/ConditionGroup.jsx`, `client/src/ui/SelectDrilldown.jsx`, `client/src/ui/Select.jsx`, `client/src/ui/Multiselect.jsx`, `client/src/ui/commandCenter/OperationsTab.jsx`, `client/src/ui/commandCenter/OperationLogPanel.jsx`, `client/src/helpers/operationExecutor.js`, `client/src/helpers/labelHelpers.js` (new), `server/scripts/createTestGrid.js`._
_Explicitly out of scope: `server/utils/createDefaultUserData.js`, `server/utils/operationBuilders.js`._

## Problem

Three defects compound to make the operations editor untrustworthy:

1. **Editor can't display the Water op faithfully.** `createTestGrid.js`'s "Water Today" op uses the executor's legacy typed loop (`step.over: "field_occurrences"` + `step.fieldId`). The editor's `LoopStep` only reads `step.overExpr`, so the loop input renders blank. The IF rule shows `$item.value` (implicit — the loop-field's value), which can't be understood without reading the executor source. Users open the editor, see missing data, and can't tell the op from a broken one.
2. **Trigger UI collects data the executor ignores.** `OperationEditor` writes event/subject/role/targetId to `local.triggerObjects[]`. The executor's `matchesTrigger` reads `triggerConfig.onChange.allowedFields` and similar. The two sides never meet — "onChange for Field = Water" in the UI is decorative; whether the op actually fires is decided by a second, shadow config.
3. **Path picker is inconsistently applied.** `ConditionRule.left` and a handful of action slots use `SelectDrilldown` / `ExprOrPath`. Loop `overExpr`, all variable action expressions, condition right-sides, and SHOW_VALUE source expressions are free-text `ExprInput`. The path picker also labels items by raw ID (`a8f3b2c1-...value`) instead of by name (`Water · a8f3b2 · value`).

As a result, the Water op runs (by accident, via the legacy codepath), but the Completion Rate op — which uses the same shape — either silently produces NaN (`0/0` in `DIV_VAR`) or compares against a stringified `"true"` where the seed wrote a boolean, and never fires through to `SHOW_VALUE`.

## Goals

- Editor renders every op in `createTestGrid.js` faithfully: every stored field is reflected in a UI element, and every UI element drives stored data.
- The Trigger UI's event/subject/role/targetId *is* the gate — no shadow `triggerConfig`.
- The path picker replaces free text in expression slots and labels items by human-readable names.
- `createDefaultUserData.js` operations continue to run unchanged (legacy executor path preserved).

## Non-goals

- Rewriting `operationBuilders.js` or the 26 ops in `createDefaultUserData.js`.
- Removing the executor's legacy `over: "field_occurrences"` codepath — `gatherLoopItems` still supports it for back-compat.
- Nested AND/OR at the trigger level — top-level triggers remain a flat OR over `triggerObjects`. Nested groups apply only to IF steps inside a pipeline.
- Server-side schema changes. `Operation.pipeline` is already `Mixed`, and `triggerObjects` is simply a new field on the Operation document.

---

## Design

### 1. Data shape + trigger wiring

`triggerObjects[]` becomes the single source of truth for what gates an operation run.

```js
Operation {
  // Derived from triggerObjects[].eventType on save.
  // Retained so shouldTrigger's dispatch-by-type path doesn't need to scan triggerObjects.
  triggerTypes: ["onChange", "onFilterChange", "onLoad"],

  // Authoritative trigger gate.
  triggerObjects: [
    { eventType: "onChange",       subjectType: "field",     subjectRole: null,     targetId: "<waterFieldId>" },
    { eventType: "onChange",       subjectType: "field",     subjectRole: null,     targetId: "<completedFieldId>" },
    { eventType: "onFilterChange", subjectType: "filterNav", subjectRole: null,     targetId: "" },
    { eventType: "onLoad",         subjectType: "grid",      subjectRole: null,     targetId: "" },
  ],

  // Kept only for event configs without subject/target semantics.
  triggerConfig: { onSchedule: { hour, minute }, onWebhook: { ... } },

  pipeline: { sources, steps },
}
```

**Executor (`operationExecutor.js`) — additive change.** `shouldTrigger` passes the full `operation` into `matchesTrigger`; `matchesTrigger` now reads `operation.triggerObjects`:

- Filter `triggerObjects` to those with `eventType === t`.
- If the subset is **non-empty**, fire iff at least one member matches its subject/target filter (see table below).
- If the subset is **empty**, fall through to the existing `triggerConfig` logic (back-compat for ops in `createDefaultUserData.js`).

Subject → filter mapping. In every row, an empty `targetId` (`""`) means "no filter — match any":

| `subjectType` | `eventType` | Filter on `transaction` |
|---|---|---|
| `field` | `onChange` / `onFieldChange` / `onComplete` / `onUncomplete` | `fieldId === targetId` |
| `module` (`role=instance`) | `onChange` | `instanceId === targetId` |
| `module` (`role=container`) | `onAdd` / `onRemove` / `onDelete` | `containerId === targetId` |
| `module` (`role=container`) | `onMove` | `fromContainerId === targetId` (direction defaults to "from") |
| `module` (`role=panel`) | `onCreate` / `onAdd` | `toPanelId === targetId`, else `panelId === targetId` |
| `module` (`role=panel`) | `onMove` | `fromPanelId === targetId` |
| `grid` | any | no filter |
| `filterNav` | `onFilterChange` | no filter |

A later version may add an explicit `direction: "from" | "to"` flag on the triggerObject for `onMove`; today the event name implies direction.

### 2. `createTestGrid.js` op rewrites

All four ops use the new shape. All loops iterate `$allOccurrences` and filter inside the IF. Sources bind trigger sub-fields to named vars so the sanity-check IF reads as plain code.

**Op 1 — "Water Today"**

```js
{
  id: uid(), userId, gridId, name: "Water Today",
  triggerTypes: ["onChange", "onFilterChange", "onLoad"],
  triggerObjects: [
    { eventType: "onChange",       subjectType: "field",     targetId: waterFieldId },
    { eventType: "onChange",       subjectType: "field",     targetId: completedFieldId },
    { eventType: "onFilterChange", subjectType: "filterNav", targetId: "" },
    { eventType: "onLoad",         subjectType: "grid",      targetId: "" },
  ],
  enabled: true,
  pipeline: {
    sources: [
      { id: uid(), variableName: "triggerType",    entityType: "trigger", triggerProp: "type" },
      { id: uid(), variableName: "triggerFieldId", entityType: "trigger", triggerProp: "fieldId" },
    ],
    steps: [
      { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$total", value: 0 } },
      { id: uid(), type: "action", config: {
          type: "FIND_OCCURRENCE", moduleLabelExpr: "literal:Schedule",
          resultVar: "$schedPage", resultIdVar: "$schedPageId",
      }},
      {
        id: uid(), type: "if",
        condition: {
          operator: "OR",
          rules: [
            { id: uid(), left: "$triggerType", comparator: "IS", right: "onLoad" },
            { id: uid(), left: "$triggerType", comparator: "IS", right: "NavigationOp" },
            {
              id: uid(), operator: "AND",
              rules: [
                { id: uid(), left: "$triggerType", comparator: "IS", right: "MeasureOp" },
                {
                  id: uid(), operator: "OR",
                  rules: [
                    { id: uid(), left: "$triggerFieldId", comparator: "IS", right: waterFieldId },
                    { id: uid(), left: "$triggerFieldId", comparator: "IS", right: completedFieldId },
                  ],
                },
              ],
            },
          ],
        },
        then: [
          {
            id: uid(), type: "loop", overExpr: "$allOccurrences", as: "$item",
            body: [{
              id: uid(), type: "if",
              condition: {
                operator: "AND",
                rules: [
                  { id: uid(), left: `$item.fields.${waterFieldId}.value`,     comparator: "IS_NOT_EMPTY", right: "" },
                  { id: uid(), left: `$item.fields.${completedFieldId}.value`, comparator: "IS",           right: true },
                  { id: uid(), left: "$item._ancestors",                       comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                ],
              },
              then: [{ id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$total", expr: `$item.fields.${waterFieldId}.value` } }],
              else: [],
            }],
          },
          { id: uid(), type: "action", config: {
              type: "SHOW_VALUE", targetFieldId: totalWaterFieldId,
              sourceExpr: "$total", targetValue: 64, targetPeriod: "daily",
          }},
        ],
        else: [],
      },
    ],
  },
}
```

**Op 2 — "Tasks Completed Today"** (inline rewrite; replaces the `makeLoopCountTrueOp` call)

Same structure as Water Today, substituting:
- First pipeline step is `INIT_VAR $count = 0` (replacing `$total = 0`).
- `triggerObjects` includes the same `onChange/field`, `onFilterChange`, `onLoad` entries as Water Today (scoped to `completedFieldId`), plus:
  - `{ eventType: "onAdd",    subjectType: "module", subjectRole: "container", targetId: "" }`
  - `{ eventType: "onDelete", subjectType: "module", subjectRole: "container", targetId: "" }`

  `targetId: ""` means "any container" — an empty `targetId` is treated as "no filter" per the Section 1 subject-filter table. Scope-to-Schedule is enforced inside the loop by the ancestor rule (same as Water Today), so a container-level filter here would be redundant and brittle if schedule container IDs change.
- Sanity-check IF branch for `onChange` checks only `$triggerFieldId IS completedFieldId`.
- Loop body IF omits the water rule; keeps `completed === true` + ancestor.
- Loop body then-branch uses `INCREMENT_VAR $count += 1` instead of `ADD_TO_VAR`.
- Trailing `SHOW_VALUE` writes `$count` to `totalTasksCompletedFieldId` with `targetValue: 6`, `targetPeriod: "daily"`.

**Op 3 — "Schedule: Stamp Date & Time Slot"**

```js
{
  triggerTypes: ["onCreate"],
  triggerObjects: [
    { eventType: "onCreate", subjectType: "module", subjectRole: "panel", targetId: centerHubId },
  ],
  pipeline: {
    sources: [
      { id: uid(), variableName: "containerLabel", entityType: "trigger", triggerProp: "containerLabel" },
    ],
    steps: [
      { id: uid(), type: "action", config: { type: "SET_FIELD_VALUE", fieldId: dateFieldId,     valueExpr: "$parentFilter.date" } },
      { id: uid(), type: "action", config: { type: "SET_FIELD_VALUE", fieldId: timeslotFieldId, valueExpr: "$containerLabel" } },
    ],
  },
}
```

**Op 4 — "Schedule: Clear Date & Time Slot"**

```js
{
  triggerTypes: ["onMove"],
  triggerObjects: [
    { eventType: "onMove", subjectType: "module", subjectRole: "panel", targetId: centerHubId },
  ],
  pipeline: {
    sources: [],
    steps: [
      { id: uid(), type: "action", config: { type: "SET_FIELD_VALUE", fieldId: dateFieldId,     value: null } },
      { id: uid(), type: "action", config: { type: "SET_FIELD_VALUE", fieldId: timeslotFieldId, value: null } },
    ],
  },
}
```

The `onMove` + `subjectRole: "panel"` combination is interpreted by the executor as `fromPanelId === targetId`, preserving current semantics.

### 3. Editor changes

#### 3a. Path picker: name-primary labels

`SelectDrilldown.buildPathConfig` currently emits items as `{ value: k, title: k }` where `k` is the raw ID. Three changes:

1. `buildPathConfig(sources, fields, inLoop, modulesById)`: item `title` resolves to `field.name ?? modulesById[segId]?.label ?? segId`; item `sub` is `segId.slice(0,6)` (short ID suffix). `value` stays the raw ID so emitted paths remain stable.
2. `Select.jsx` / `Multiselect.jsx`: render `title` as the primary label (current size, foreground color), `sub` as a faint monospace suffix. Skip `sub` if it matches `title` (prevents `Water · Water`).
3. `SelectDrilldown` chip chain (closed state): use a `resolveSegmentLabel(chain, depth)` helper exported from `buildPathConfig` to translate each segment. Chip renders `$item › fields › Water › value`; the `title=` attribute carries the full dotted path for keyboard/hover inspection.

Stored data shape does not change — chains remain arrays of raw IDs, serialized via `chainToPathString` to dotted strings.

#### 3b. Path picker is the default for expression slots

Replace `ExprInput` with `ExprOrPath` at these sites in `OperationsBuilder.jsx`:

- `LoopStep` over-expression input (currently the big free-text box labelled "$allOccurrences or any array").
- `ActionConfig` variable expression inputs: `INIT_VAR.expr`, `SET_VAR.expr`, `ADD_TO_VAR.expr`, `SUBTRACT_FROM_VAR.expr`, `MULTIPLY_VAR.expr`, `DIV_VAR.by`, `INCREMENT_VAR.by`, `DECREMENT_VAR.by`, `PUSH_TO_VAR.expr`.
- `SHOW_VALUE.sourceExpr`.
- `ConditionRule.right` in `OperationsBuilder.jsx` *and* `RuleRow.right` in `ConditionGroup.jsx`.

`ExprOrPath` already picks initial mode by whether the value starts with `$`. Extend the heuristic so strings starting with `literal:` also default to text mode. Toggling the button switches any value back and forth; the two modes emit the same underlying string.

Action config slots that already use `ExprOrPath` (MOVE_OCCURRENCE, CREATE_OCCURRENCE, SET_FIELD_VALUE) stay as-is.

#### 3c. Legacy loop conversion pill

In `LoopStep`, when `step.over && !step.overExpr`:

- Render the loop header with a small badge: `"Legacy loop — click to convert"`.
- On click: rewrite the step to `{ overExpr: "$allOccurrences", as: step.as, body: [...body] }` and prepend an IF to the body that mirrors the former filter:
  - `over: "field_occurrences"` + `fieldId` → prepend `IS_NOT_EMPTY $item.fields.<fieldId>.value`.
  - `timeFilter` + `flowFilter` stay as-is inside the body check.
- Save emits the new shape. No in-memory hack — the user explicitly opts in.

This means `createDefaultUserData.js` ops stay unmodified on disk until a user edits one.

#### 3d. Nested AND/OR is made visible

`ConditionGroup.jsx` already supports nested groups via `+ Group`. Two cosmetic changes:

1. `IfStep` header currently reads `"all/any of the following are true:"`. Replace with a live readout of the top-level operator: `"if ALL of:"` or `"if ANY of:"`, updated when the top group's operator changes.
2. `+ Group` button gets a distinct style (dashed purple border, `color: rgba(167,139,250,0.7)`) to visually separate "add rule at this level" from "add nested group". No data change.

#### 3e. Trigger editor writes `triggerObjects` only

In `OperationsTab.OperationEditor`:

- `toggleTriggerType` → `addTriggerObject(eventType)` / `removeTriggerObject(index)`. Both regenerate `triggerTypes = [...new Set(triggerObjects.map(t => t.eventType))]` for the save payload.
- The existing subject/role/targetId dropdowns already write to `triggerObjects[idx]`. Keep that. Delete any code that also writes to `triggerConfig.onChange.allowedFields` or equivalents.
- `onSchedule` and `onWebhook` configs remain in `triggerConfig`.
- Add a read-only inline label per trigger row: once event, subject, and target are all set, display `"onChange · Field · Water"` to the right of the dropdowns.

#### 3f. Operation Log Panel reflects the new data shape

The log panel (`OperationLogPanel.jsx`) currently renders raw IDs everywhere and doesn't surface which `triggerObject` caused a run. Two changes to keep the log honest with the rest of the editor:

**3f-i. Resolve IDs to names in log rows.** Add `modulesById` to the `useContext` destructure. Extract a shared helper to `client/src/helpers/labelHelpers.js` so `SelectDrilldown` chip rendering (Section 3a) and the log panel agree on how to resolve IDs:

```js
// labelHelpers.js
export function labelForId(id, { fieldsById, modulesById, occurrencesById }) {
  if (!id) return null;
  const shortId = String(id).slice(-6);
  const f = fieldsById?.[id];    if (f) return { label: f.name,  shortId, kind: "field" };
  const m = modulesById?.[id];   if (m) return { label: m.label, shortId, kind: m.role ?? "module" };
  const occ = occurrencesById?.[id];
  if (occ) {
    const targetMod = modulesById?.[occ.targetId];
    return { label: targetMod?.label ?? "occurrence", shortId, kind: "occurrence" };
  }
  return { label: null, shortId, kind: "unknown" };
}
```

Four log-render sites become name-primary with `shortId` as a faint suffix:

- `EffectRow` — `fid` and `occ` render via `labelForId`: `Water · …a8f3b2` instead of `…a8f3b2`.
- `LogEntry.start` body — the inline `field:` and `occ:` tags use `labelForId`.
- `LogEntry.sources` body — when a var's scalar value matches a known field/module/occurrence ID via `labelForId`, render the resolved label (`$triggerFieldId = Water · …a8f3b2`). Non-ID values continue through `summarize()`.
- `LogEntry.end` updates — same treatment as `EffectRow`.

The raw ID is preserved in `title=` tooltips and the existing `raw` JSON expander. Nothing is lost.

**3f-ii. Surface the matched `triggerObject`.** A tiny executor-side change piggy-backs on Phase A:

- Change `matchesTrigger` return type from `boolean` to `false | { matched: true, triggerObject: <TriggerObject|null> }`. For back-compat matches via `triggerConfig` only, `triggerObject` is `null`.
- `shouldTrigger` threads the matched object back to `runMatchingOperations`, which passes it into the `start` log entry: `logger.add("start", { ..., matchedTriggerObject })`.

In `RunRow`, replace the middle-column text (currently `{trigger} · {fmtRelative}`) with a richer readout built from `matchedTriggerObject.{eventType, subjectType, labelForId(targetId)}`:

```
onChange · Field · Water · 2s ago
```

If `matchedTriggerObject` is `null` (legacy fallback), fall back to the existing `{transactionType}` string. `LogEntry.start` shows both `trigger: MeasureOp` *and* a new `matched: onChange · Field · Water` line so the two views are visible side by side.

**Out of scope for this panel:** full rule-by-rule tracing of IF conditions (which rule in the group evaluated true/false). Useful for debugging nested sanity-check IFs but bigger than this spec — the `if` entry keeps rendering only the branch taken.

### 4. Implementation order

**Phase A — Executor (additive).** Extend `matchesTrigger` to read `operation.triggerObjects` with fallback to existing `triggerConfig`. Change its return type from `boolean` to `false | { matched: true, triggerObject: <TriggerObject|null> }` (per 3f-ii) and thread the matched object through `shouldTrigger` → `runMatchingOperations` → `logger.add("start", { ..., matchedTriggerObject })`. Add 8–10 unit tests in `operationExecutor.test.js` covering each subjectType × eventType pair, a back-compat case where only `triggerConfig.onChange.allowedFields` is set (returns `{ matched: true, triggerObject: null }`), and a negative case. No other files touched. Existing ops keep working.

**Phase B — `createTestGrid.js` rewrite.** Replace the four ops with the Section 2 shapes. Run `node --env-file=.env scripts/resetTestGridData.js` (or the create script) and open the grid. Verify `Water Today = 56 / 64`, `Tasks Completed = 6 / 6`, and drag-stamp behavior still works.

**Phase C — Editor (split for review).**

1. `client/src/helpers/labelHelpers.js` (new): export `labelForId({ fieldsById, modulesById, occurrencesById })`. Imported by both the path picker and the log panel.
2. `SelectDrilldown.jsx` + `Select.jsx` + `Multiselect.jsx`: `title` / `sub` rendering.
3. `buildPathConfig`: emit `title` and `sub`; export `resolveSegmentLabel` (uses `labelForId` under the hood).
4. `OperationsBuilder.jsx`: swap `ExprInput` → `ExprOrPath` at the sites in Section 3b.
5. `OperationsBuilder.jsx` `LoopStep`: add the legacy-loop conversion pill.
6. `ConditionGroup.jsx` + `OperationsBuilder.jsx` `IfStep`: wording + `+ Group` styling.
7. `OperationsTab.jsx`: trigger UI writes `triggerObjects` only, derives `triggerTypes`, adds inline English label, stops writing `triggerConfig` for filterable subjects.
8. `OperationLogPanel.jsx`: import `labelForId`; name-resolve the four render sites in 3f-i; render `matchedTriggerObject` in `RunRow` and `LogEntry.start`. Add `modulesById` to the `useContext` destructure.

**Phase D — Validation.**

- `npm --prefix ./client test -- operationExecutor.test.js` after Phase A.
- After Phase C: open each of the four `createTestGrid.js` ops in the editor; confirm:
  - Sources populate (`$triggerType`, `$triggerFieldId`).
  - Loop shows `$allOccurrences`.
  - IF shows nested groups with readable path chips (e.g., `$item › fields › Water › value`).
  - Trigger rows show `"onChange · Field · Water"` and similar.
  - Run the op once; log panel's RunRow shows the matched triggerObject (`onChange · Field · Water · 2s ago`), and entry rows show `Water · …a8f3b2` instead of raw IDs.
  - Legacy ops from `createDefaultUserData.js` still show in their panel's log — RunRow falls back to the `transactionType` string (no `matchedTriggerObject`).
- Reset test grid; modify field values via the UI; confirm `Water Today` and `Tasks Completed` totals update in real time and the drag-stamp operations still fire when dropping containers into the Center Hub panel.

### 5. Safety / rollback

- Phase A is additive. Ops without `triggerObjects` hit the existing `triggerConfig` path.
- `createDefaultUserData.js` is untouched. Its ops continue through `gatherLoopItems`' legacy `over: "field_occurrences"` branch.
- Phase C changes affect only the editor UI. Runtime behavior is unchanged for any op whose data is not re-saved through the editor.
- Rollback for any phase is `git revert` of that phase's commit; no data migration is required.

### 6. Open items

- `onMove` semantics: does `subjectRole: "panel"` default to matching `fromPanelId`, `toPanelId`, or both? Section 1 says "from" by default, preserving current `triggerConfig.onMove.fromPanelId`. A future revision may add an explicit `direction` flag on the triggerObject.
- Whether the legacy-loop conversion pill should also appear for ops saved by earlier versions of the editor that already used `overExpr` but still contain the now-deprecated field-scope flags. Current design: no — pill only fires when `step.over` is set and `step.overExpr` is not.
