# Per-Component Filter System — Design Spec

**Date:** 2026-04-20
**Status:** Approved for implementation planning

---

## Problem

The current filter system is global: `grid.namedFilters`, `grid.activeFilterId`, and `grid.activeFilterValues` define one filter that applies to the entire workspace. This makes it impossible to show different date ranges in different panels simultaneously, and it hardcodes date-field semantics into what should be a generic field-matching system. The old iteration nav (per-panel date arrows) was removed and needs to be replaced with something more powerful.

---

## Solution Overview

Replace the global filter system with a **per-occurrence filter cascade**. Every occurrence (grid, panel, page, container) can define its own set of filters. Children automatically inherit all ancestor filters. Each filter is a field + condition tree + optional navigation UI. Nav values live in ephemeral state (not persisted), initialized from a configurable default.

The system is fully field-type-agnostic — date, select, number, boolean, rating, text, duration fields all work the same way. The nav UI adapts to the field type.

---

## Data Model

### Occurrence schema — new `filters` field

```js
// server/models/Occurrence.js — add to schema
filters: [{
  id: String,                // uid, stable across saves
  fieldId: String,           // which field to filter on
  active: Boolean,           // is this filter contributing to visibility?
  showNav: Boolean,          // render nav control in module header?
  timeUnit: String,          // only for date fields: "day" | "week" | "month" | "year"
  defaultNavValue: String,   // "today" | "startOfWeek" | "startOfMonth" | ISO date | null
  condition: Mixed,          // ConditionGroup — same structure as operations conditions
}]
```

### Grid schema — remove global filter fields

Remove from `server/models/Grid.js`:
- `namedFilters`
- `activeFilterId`
- `activeFilterValues`

These are replaced entirely by `occurrence.filters`.

### Client state — ephemeral nav values

```js
// Added to Redux state shape (masterReducer.js)
filterNavState: {
  [filterId]: value   // current nav value, initialized from defaultNavValue on load
}
```

`filterNavState` is never persisted. On reload, each filter initializes its nav value from `defaultNavValue`:
- `"today"` → `new Date()` at day boundary
- `"startOfWeek"` → Monday of current week
- `"startOfMonth"` → 1st of current month
- ISO string → that specific date/value
- `null` → no initial value (filter starts with no nav value set, conditions using `$nav` pass all occurrences)

---

## Cascade Algorithm

### Collecting effective filters

When rendering container C, the effective filter set is:

```
effectiveFilters(C) =
  [all active filters from Grid occurrence]
  + [all active filters from Panel occurrence]
  + [all active filters from Page occurrence (if any)]
  + [all active filters from C itself]
```

Walk the `parentId` chain from C up to grid root. Collect every `filter` where `active: true`. The result is an ordered list of filter objects with their current nav values resolved from `filterNavState`.

### Visibility check

An occurrence is visible in container C if it satisfies **all** filters in `effectiveFilters(C)`.

For each filter in the set:
1. Resolve `$nav` → `filterNavState[filter.id]` (or null if unset)
2. Resolve `$field.value` → `occurrence.fields[filter.fieldId]?.value`
3. Evaluate `filter.condition` against those resolved values using the existing `evalGroup` logic from `operationActions.js`

No hardcoded null/date logic — the condition tree handles everything via comparators. "Show when unscheduled" is expressed as an `IS_EMPTY` rule in an `OR` group alongside the `EQUALS $nav` rule.

### Nav value for "locked" components

A component is **locked** to an ancestor's nav if it has no own `active: true` filter for a given fieldId. The UI detects this by checking whether the component's own `filters` array contains an active filter for that fieldId. If not, it walks up the chain to find the nearest ancestor with one.

"Unlock" = set `filter.active = true` on the component's own filter for that fieldId (creating it if it doesn't exist), initialized with the ancestor's current navValue.

---

## `$nav` in Conditions

The condition tree uses `$nav` as a special variable that resolves to the filter's current nav value from `filterNavState`. This is evaluated in the visibility check, not stored.

For select fields with multi-select nav, `$nav` is an array of selected option strings. The condition uses `IN` (field value is one of the selected options) or `IS_EMPTY`. When `$nav` is an empty array, the filter passes all occurrences.

Example condition for "show occurrences scheduled on the nav date OR with no date set":

```js
condition: {
  operator: "OR",
  rules: [
    { left: "$field.value", comparator: "DATE_EQUALS", right: "$nav" },
    { left: "$field.value", comparator: "IS_EMPTY" },
  ]
}
```

Example condition for "show only items with rating >= nav value":

```js
condition: {
  operator: "AND",
  rules: [
    { left: "$field.value", comparator: "GREATER_OR_EQUAL", right: "$nav" },
  ]
}
```

The condition evaluator receives `$nav` as a variable in its context — the same way `$trigger` and `$activeDate` are injected in the operations pipeline.

---

## Nav UI — Field Type Adaptations

When `showNav: true`, the filter renders a navigation control in the module header dropdown. The control is determined by the field type:

| Field type | Nav control | `$nav` value type |
|------------|-------------|-------------------|
| `date` | Prev/Next arrows + date label. Step size from `timeUnit` (day/week/month/year). | ISO date string `"2026-04-20"` |
| `select` | Multi-select chip list — tap to toggle each option on/off. | Array of selected option strings |
| `number` | Decrement/Increment buttons. Step = 1 (or configurable). | Number |
| `boolean` | Toggle button (true/false). | Boolean |
| `rating` | Prev/Next through 1–5. | Number 1–5 |
| `text` | Text input, no arrows. | String |
| `duration` | +/- buttons in configurable step. | Duration object |

All nav controls write to `filterNavState[filterId]` in the Redux store via a new `SET_FILTER_NAV` action. No socket emit.

---

## UI Components

### FilterButton (in module header)

Small button in the header row of every panel, page, and container (not individual instances). Shows:
- A filter icon + count of active own filters (if any)
- A lock icon if the component is locked to a parent nav (for quick visual scan)

Clicking opens **FilterDropdown**.

### FilterDropdown (popover from FilterButton)

Popover anchored to FilterButton. Contains:

**For each filter in effectiveFilters (showing origin label):**
- If `showNav: true`:
  - The nav control for that field type (prev/next arrows, toggle, etc.)
  - Current value display
  - Lock/Unlock icon button:
    - Locked (inheriting ancestor) → clicking creates/activates own filter, copies navValue
    - Unlocked (own active filter) → clicking deactivates own filter (reverts to ancestor)
- If `showNav: false`: just a label showing field name + current condition summary

**Footer:**
- "+ Add filter" → opens FilterEditor with a blank new filter
- "Edit filters" → opens FilterEditor showing all this component's own filters

### FilterEditor (full-panel overlay)

Replaces the panel content area (not a modal — fills the panel's content zone). Triggered by "Edit filters" in FilterDropdown.

Layout:
- Back button (closes editor, returns to panel content)
- For each filter in this component's own `filters` array:
  - **Active toggle** (on/off)
  - **Field picker** — dropdown of all bound fields in scope
  - **Show nav toggle** — whether to render nav in header
  - **Time unit selector** — (date fields only) day / week / month / year
  - **Default nav value selector** — Today / Start of Week / Start of Month / specific value / None
  - **Condition builder** — ConditionGroup component (same as operations). Hint: use `$nav` as a value in any rule's right-hand side to reference the current nav value
- "+ Add filter" button
- Delete (×) button per filter

Saving commits to server via `update_occurrence` (same as any other occurrence field change).

### Header integration

The filter button sits in the existing `module-header-row` alongside the label, drag handle, and radial menu. It is:
- Hidden when the component has no own filters AND no ancestor has any active filters
- Shown (lock icon, muted) when only inheriting ancestor filters
- Shown (filter icon, active) when component has its own active filters

---

## Selector — `getEffectiveFiltersForContainer`

New selector in `client/src/state/selectors.js`:

```js
export function getEffectiveFiltersForContainer(containerOcc, { occurrencesById, filterNavState }) {
  // Walk parentId chain from containerOcc up to grid root
  // Collect all active filters from each ancestor + self
  // Resolve $nav for each filter from filterNavState
  // Return array of { filter, navValue, originLabel } objects
}
```

Used by Container.jsx and ModuleContainer.jsx to determine which occurrences to show.

---

## Visibility — `isOccurrenceVisibleForFilter`

New function (or replacement for existing `isOccurrenceVisible`):

```js
export function isOccurrenceVisibleForFilter(occ, effectiveFilters, filterNavState) {
  for (const { filter, navValue } of effectiveFilters) {
    const fieldValue = occ.fields?.[filter.fieldId]?.value ?? null;
    const ctx = { $nav: navValue, "$field.value": fieldValue };
    if (!evalGroup(filter.condition, ctx)) return false;
  }
  return true;
}
```

This replaces `isOccurrenceVisible` (old iteration-based logic). Called in Container.jsx during the render of each instance occurrence.

---

## State Actions

### New actions in `client/src/state/actions.js`

```js
SET_FILTER_NAV    // payload: { filterId, value } — update filterNavState
INIT_FILTER_NAV   // payload: { filterNavMap } — batch-initialize on full_state load
```

### masterReducer.js

Add `filterNavState: {}` to initial state. Handle `SET_FILTER_NAV` and `INIT_FILTER_NAV`.

---

## Removed / Replaced

### Removed from server
- `Grid.namedFilters`, `Grid.activeFilterId`, `Grid.activeFilterValues` fields
- `update_grid_filter` socket event handler
- Any server logic that reads `namedFilters`

### Removed from client
- `ui/FilterNav.jsx` — the global toolbar filter nav
- `ui/LocalFilterNav.jsx` — the per-occurrence filter nav we just built (replaced by FilterDropdown)
- `ui/commandCenter/FiltersTab.jsx` — global filter preset management
- `FiltersTab` entry from CommandCenter.jsx TABS array
- `handleSelectFilter`, `handleFilterValueChange` from App.jsx
- Filter props from Toolbar.jsx
- `getEffectiveFilterForOccurrence` (replaced by `getEffectiveFiltersForContainer`)

### Replaced
- `occurrence.filterOverride` → `occurrence.filters` (new structure is a superset)

---

## Migration — Example Data

In `server/utils/createDefaultUserData.js`:

1. Remove `namedFilters`, `activeFilterId`, `activeFilterValues` from grid seed
2. Add `filters` to the Schedule panel occurrence:
   ```js
   filters: [{
     id: uid(),
     fieldId: scheduledDateFieldId,
     active: true,
     showNav: true,
     timeUnit: "day",
     defaultNavValue: "today",
     condition: {
       operator: "OR",
       rules: [
         { left: "$field.value", comparator: "DATE_EQUALS", right: "$nav" },
         { left: "$field.value", comparator: "IS_EMPTY" },
       ]
     }
   }]
   ```
3. Remove any `filterOverride` fields from existing occurrences

---

## What Does NOT Change

- Operations pipeline (`operationExecutor.js`, `operationActions.js`) — unchanged
- Field types and values — unchanged
- ConditionGroup component — used as-is in FilterEditor
- Drag and drop — unchanged
- The rest of CommandCenter tabs — unchanged
- `occurrence.fields` value storage — unchanged
- `evalGroup` / `evalRule` from `operationActions.js` — reused for visibility checks

---

## Open Questions (deferred to implementation)

1. **Grid-level filters**: Does the Grid record itself get a `filters` array, or do we treat the top-level panel occurrences as the root? For now: panels are the root — no filter at the Grid level. Can add later.

2. **Instance-level filtering**: Should instances also have `filters`? For now: no — filters live on containers (which control which instances are visible). Instances don't filter their own children.

3. **Operations `$activeDate`**: The `$activeDate` built-in variable in `operationExecutor.js` currently reads from `filterOverride` chain. After migration, it should read from `filterNavState` for the relevant filter on the operation's target occurrence. This is an implementation detail for the operations track.
