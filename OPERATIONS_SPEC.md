# Operations Pipeline Spec

Authoritative reference for how the operations pipeline is wired after the
`2026-04-16-operations-overhaul` rewrite. Cross-reference the plan at
`docs/superpowers/plans/2026-04-16-operations-overhaul.md` for task-level detail.

---

## Core model

An **operation** is a declarative pipeline:

```
{
  id, gridId, name,
  sortOrder,              // priority — lower runs first (default 50)
  triggers: [ ... ],      // which transaction types (re)run this op
  pipeline: {
    sources: [ ... ],     // named inputs resolved per run ($var bindings)
    steps:   [ ... ]      // ordered list of action / if / loop steps
  }
}
```

The executor lives in `client/src/helpers/operationExecutor.js` and is invoked
from `bindSocketToStore.js` whenever a matching transaction fires. Emitted side
effects are applied via `operationsBridge` → `CommitHelpers` (the single socket
boundary).

---

## Sources

Sources are the only state a pipeline has before its steps run. There are two
ways a source is populated:

1. **Trigger-driven** — the transaction that fired the op seeds them. In
   particular `$trigger` is always injected, and **`$trigger.occurrence`** is
   auto-hydrated with the full occurrence record (including its raw
   `fields` map) whenever the triggering transaction carries an
   `occurrenceId`. You never have to wire this source manually.

2. **User-selected** — an author-declared source such as
   `{ variableName: "schedulePage", entityType: "occurrence", entityId: "atZKQpmthMgM" }`.
   These resolve once per run from the current redux-like state maps. Entity
   types: `occurrence`, `field`, `panel`, `container`, `grid`, `module`.

In addition, the following built-ins are always present on `$vars`:

```
$now, $today, $activeDate, $iterationValue,
$currentDate, $currentHour, $currentTime
```

`$today` / `$activeDate` are the currently-active filter date (not the wall
clock) — the canonical value to compare `date` fields against.

---

## Expression paths

Any string that starts with `$` is an expression. Paths are resolved top-down
through `$vars` and then property access, so the **same syntax** works across
sources, loop items, and the trigger:

```
$trigger.occurrence.fields.date.value
$item.fields.water.value
$schedulePage.fields.completed.value
$today
```

The executor handles `.field.value`, `.field.flow`, array indexing, and any
deeper property walk. The UI `PathPicker` (`client/src/blocks/PathPicker.jsx`)
builds these cascading menus from a `buildPathShape({ sources, fields, inLoop })`
call, so authors pick paths instead of typing them.

---

## Conditions — nested AND/OR

Conditions are expressed as a recursive group:

```
{
  operator: "AND" | "OR",
  rules: [
    { left, comparator, right },        // leaf rule
    { operator, rules: [...] }           // nested group
  ]
}
```

The UI component is `ConditionGroup.jsx` (recursive, alternating background per
depth). Supported comparators:

```
IS, IS_NOT, GREATER, LESS, GREATER_OR_EQUAL, LESS_OR_EQUAL,
CONTAINS, NOT_CONTAINS, IS_EMPTY, IS_NOT_EMPTY,
HAS_ANCESTOR, ARRAY_INCLUDES,
DATE_IS_TODAY, DATE_BEFORE_TODAY, DATE_AFTER_TODAY, DATE_WITHIN_DAYS
```

`HAS_ANCESTOR` walks the executor's reverse parent map (`_parentByChildId`)
built from `occurrences[]` arrays — it works even when `parentId` is null.

---

## Triggers

The trigger list is an array of aliases stored on the operation. The ones the
UI picker surfaces (see `EVENT_TYPES` in `OperationsTab.jsx`):

| Alias | Transaction type | Notes |
|-------|------------------|-------|
| `onChange` / `onFieldChange` | `MeasureOp` | Scoped by the op's `allowedFields` when set |
| `onAdd` | `OccurrenceCreateOp` | |
| `onRemove` | `OccurrenceRemoveOp` | Detachment from a parent |
| `onDelete` | `OccurrenceDeleteOp` | Permanent |
| `onMove` | `OccurrenceMoveOp` | |
| `onComplete` / `onUncomplete` | `MeasureOp` (value truthy / reversed) | |
| `onLoad` | null | Fires once on `full_state` hydrate |
| `onIteration` / `onFilterChange` | `NavigationOp` | Fires when the active filter or filter value changes |
| `onSchedule` | `ScheduleOp` | 60-second tick, optional hour/minute match |
| `onWebhook`, `onButton`, `onNodeInput`, `manual` | — | Author-controlled |

`onFieldChange` and `onFilterChange` are aliases — the executor maps them to
`onChange` (with `allowedFields` semantics) and `onNavigation` respectively
(see `operationExecutor.js::matchesTrigger`).

---

## Priority (`sortOrder`)

Operations are sorted ascending by `sortOrder` before dispatch. Lower numbers
run first. Default is 50. The field is editable in the OperationEditor
("Priority" input, caption: "lower runs first"). The operations list in
`OperationsTab.jsx` is also sorted by `sortOrder` so authors see the actual
run order.

This matters when one op produces state another op depends on — e.g. the stamp
op below must run before any aggregation op that filters on
`date == $today`.

---

## Canonical Example: Water Today / Tasks Completed Today

Three cooperating operations in the test grid:

### 1. Filter: Default to Today (`sortOrder: -10`)

```
triggers: ["onLoad"]
steps:
  - SET_FILTER { filterValue: "$today" }
```

Runs first on hydrate. Makes the active filter date = today so
`$today` / `$activeDate` resolve predictably for every downstream op.

### 2. Schedule Stamp (`sortOrder: 0`)

```
triggers: ["onAdd"]
condition:
  AND
    $trigger.occurrence.parentId   HAS_ANCESTOR   <schedulePanelOccId>
steps:
  - SET_FIELD_VALUE
      occurrenceIdExpr: "$trigger.occurrenceId"
      fieldId: <date>
      valueExpr: "$activeDate"
  - SET_FIELD_VALUE
      occurrenceIdExpr: "$trigger.occurrenceId"
      fieldId: <timeslot>
      valueExpr: "$trigger.occurrence.parent.label"   // or similar resolver
```

Runs on every drop into the schedule panel. Stamps the currently-active date
into the new occurrence's `date` field before any aggregation op sees
it.

### 3. Water Today (`sortOrder: 10`)

```
triggers: ["onLoad", "onFieldChange", "onAdd", "onRemove", "onFilterChange"]

steps:
  - INIT_VAR   $total = 0
  - FIND_OCCURRENCE  { moduleLabel: "Schedule page board", resultIdVar: "$schedulePageId" }
  - LOOP  over field_occurrences  { fieldId: <water>, as: $item }
      IF (ALL of):
        $item._ancestors                        HAS_ANCESTOR     $schedulePageId
        $item.fields.water.value                IS_NOT_EMPTY
        $item.fields.date.value        IS               $activeDate
      THEN:
        ADD_TO_VAR  $total  $item.fields.water.value
  - SHOW_VALUE
      sourceExpr: "$total"
      targetFieldId: <Daily Water display>
      targetValue: 64
      targetPeriod: "daily"
```

Note three important differences from the old pipeline:

- The loop no longer uses `timeFilter: "daily"`. The date match is an
  **explicit condition** (`$item.fields.date.value IS $activeDate`),
  so it composes with the existing ancestor check in the same AND group.
- Values are read as `$item.fields.<fieldId>.value` — the raw `fields` map is
  exposed on every loop item (Task 2).
- The triggers list includes `onFilterChange` so advancing the toolbar date
  arrows re-runs the aggregation.

**Tasks Completed Today** follows the same shape: loop over the `completed`
field, filter by ancestry + `date == $activeDate`, increment `$count`
when `$item.fields.completed.value IS true`, SHOW_VALUE into the display
field.

---

## New executor primitives

### `$item._ancestors`

Ordered array of ancestor occurrence IDs for every loop item, closest first.
Built from the reverse parent map. See `HAS_ANCESTOR` above.

### `$trigger.occurrence`

Full occurrence record attached to `$trigger` when the triggering transaction
carries an `occurrenceId`. Gives you `fields`, `parentId`, `meta`, `dragMode`,
etc. without a separate source.

### `SET_FILTER` action

```
{ type: "action", config: { type: "SET_FILTER", filterValue: "$today" } }
```

Emits a `SET_FILTER` effect handled in `bindSocketToStore.js` →
`CommitHelpers.setFilterValue`. Used by the "Filter: Default to Today" op
above.

### `FIND_OCCURRENCE` — `moduleLabel` option

```
{ type: "FIND_OCCURRENCE", moduleLabel: "Schedule page board", resultIdVar: "$schedulePageId" }
```

Finds the first non-template occurrence of a module by label. Falls back to
`targetIdExpr` when both are provided.

---

## Grid scoping

`occurrencesById` is already grid-scoped on the server — `full_state` only
hydrates occurrences for the active grid, so the executor doesn't re-filter.
