# Per-Component Filter System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the global namedFilters system with a per-occurrence filter cascade: every panel/page/container occurrence carries its own `filters[]` array, children inherit parent filters automatically, nav values live in ephemeral Redux state (never persisted), and occurrence visibility is driven by `evalGroup` from operationActions.js.

**Architecture:** Server adds `filters[]` to the Occurrence schema and drops global fields from Grid. Client adds `filterNavState` to Redux, new selectors (`getEffectiveFiltersForContainer`, `isOccurrenceVisibleForFilter`), a `FilterButton`/`FilterDropdown` in every module header, and a `FilterEditor` full-panel overlay. The existing `evalGroup`/`evalRule`/`resolveExpr` functions from `operationActions.js` power all visibility checks — no new evaluation engine.

**Tech Stack:** React 18, Socket.io, Mongoose, Vitest.

---

## File Map

### New files
| Path | Responsibility |
|------|---------------|
| `client/src/ui/FilterButton.jsx` | Small header button — shows filter icon + count, opens FilterDropdown |
| `client/src/ui/FilterDropdown.jsx` | Popover: nav controls per active filter + lock/unlock + "Edit filters" |
| `client/src/ui/FilterEditor.jsx` | Full-panel overlay: edit this occurrence's own `filters[]` |
| `client/src/ui/FilterNavControl.jsx` | Field-type-aware nav widget (date arrows, select chips, number +/-, etc.) |
| `client/src/__tests__/filterCascade.test.js` | Unit tests for selectors and visibility logic |

### Modified files
| Path | What changes |
|------|-------------|
| `server/models/Occurrence.js` | Add `filters` array to schema |
| `server/models/Grid.js` | Remove `namedFilters`, `activeFilterId`, `activeFilterValues` |
| `server/socketHandlers/state.js` | Remove `update_grid_filter` handler; stop including namedFilters in full_state |
| `server/utils/createDefaultUserData.js` | Remove namedFilters from grid seed; add `filters[]` to Schedule panel occ |
| `client/src/state/masterReducer.js` | Add `filterNavState: {}` to initial state; handle `SET_FILTER_NAV` / `INIT_FILTER_NAV` |
| `client/src/state/actions.js` | Add `SET_FILTER_NAV`, `INIT_FILTER_NAV` action creators |
| `client/src/state/selectors.js` | Add `getEffectiveFiltersForContainer`, `isOccurrenceVisibleForFilter`; keep old for one task then remove |
| `client/src/helpers/operationActions.js` | Add `IN` comparator to `evalRule` for multi-select nav |
| `client/src/modules/ModuleContainer.jsx` | Replace `getEffectiveFilterForOccurrence` + `isOccurrenceVisible` with new selectors; add `FilterButton` |
| `client/src/modules/ModulePage.jsx` | Same swap as ModuleContainer |
| `client/src/modules/ModulePanel.jsx` | Add `FilterButton` to panel header |
| `client/src/App.jsx` | Remove `handleSelectFilter`, `handleFilterValueChange`; dispatch `INIT_FILTER_NAV` on full_state |
| `client/src/Toolbar.jsx` | Remove `FilterNav` import and props |
| `client/src/helpers/CommitHelpers.js` | Remove `updateGridFilter` |
| `client/src/helpers/operationExecutor.js` | Update `$activeDate` to read from `filterNavState` instead of `filterOverride` |

### Deleted files
| Path | Reason |
|------|--------|
| `client/src/ui/FilterNav.jsx` | Global toolbar filter nav — replaced by per-component FilterButton |
| `client/src/ui/LocalFilterNav.jsx` | Per-occ nav built on old filterOverride — replaced by FilterDropdown |
| `client/src/ui/commandCenter/FiltersTab.jsx` | Global filter preset management — no longer needed |

---

## Task F1: Add `IN` comparator to evalRule + tests

**Files:**
- Modify: `client/src/helpers/operationActions.js`
- Create: `client/src/__tests__/filterCascade.test.js` (start it here, expand in F2)

- [ ] **Step 1: Write failing test**

```js
// client/src/__tests__/filterCascade.test.js
import { describe, it, expect } from "vitest";
import { evalRule } from "../helpers/operationActions";

describe("evalRule IN comparator", () => {
  it("returns true when leftVal is in the right array", () => {
    expect(evalRule({ left: "work", comparator: "IN", right: ["work", "personal"] }, {})).toBe(true);
  });
  it("returns false when leftVal is not in the right array", () => {
    expect(evalRule({ left: "health", comparator: "IN", right: ["work", "personal"] }, {})).toBe(false);
  });
  it("returns true when right array is empty (no filter set)", () => {
    expect(evalRule({ left: "work", comparator: "IN", right: [] }, {})).toBe(true);
  });
  it("returns false when leftVal is null and right is non-empty", () => {
    expect(evalRule({ left: null, comparator: "IN", right: ["work"] }, {})).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — confirm failure**

```
npm --prefix ./client run test -- filterCascade
```

Expected: FAIL — "Unknown comparator IN".

- [ ] **Step 3: Add `IN` case to evalRule in `client/src/helpers/operationActions.js`**

Find the `switch (comparator)` block (around line 195). Add before the `default:` case:

```js
case "IN": {
  // Multi-select nav: right is an array of allowed values.
  // Empty array = no filter active → pass everything.
  if (!Array.isArray(rightVal) || rightVal.length === 0) return true;
  if (leftVal == null) return false;
  return rightVal.some(v => String(v) === String(leftVal));
}
```

- [ ] **Step 4: Run test — confirm pass**

```
npm --prefix ./client run test -- filterCascade
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```
git add client/src/__tests__/filterCascade.test.js client/src/helpers/operationActions.js
git commit -m "feat(filter): add IN comparator to evalRule for multi-select nav"
```

---

## Task F2: Add selectors — `getEffectiveFiltersForContainer` and `isOccurrenceVisibleForFilter`

**Files:**
- Modify: `client/src/state/selectors.js`
- Modify: `client/src/__tests__/filterCascade.test.js`

- [ ] **Step 1: Write failing tests**

Append to `client/src/__tests__/filterCascade.test.js`:

```js
import { getEffectiveFiltersForContainer, isOccurrenceVisibleForFilter } from "../state/selectors";

const dateFilter = {
  id: "f1",
  fieldId: "scheduledDate",
  active: true,
  showNav: true,
  timeUnit: "day",
  defaultNavValue: "today",
  condition: {
    operator: "OR",
    rules: [
      { left: "$field.value", comparator: "DATE_EQUALS", right: "$nav" },
      { left: "$field.value", comparator: "IS_EMPTY" },
    ],
  },
};

const panelOcc = { id: "panel1", parentId: null, filters: [dateFilter] };
const containerOcc = { id: "cont1", parentId: "panel1", filters: [] };
const occurrencesById = { panel1: panelOcc, cont1: containerOcc };
const filterNavState = { f1: "2026-04-20" };

describe("getEffectiveFiltersForContainer", () => {
  it("collects active filter from parent panel", () => {
    const result = getEffectiveFiltersForContainer(containerOcc, { occurrencesById, filterNavState });
    expect(result).toHaveLength(1);
    expect(result[0].filter.id).toBe("f1");
    expect(result[0].navValue).toBe("2026-04-20");
  });

  it("returns empty when no ancestor has active filters", () => {
    const result = getEffectiveFiltersForContainer(panelOcc, { occurrencesById, filterNavState });
    expect(result).toHaveLength(0); // panel itself is root — no parent to inherit from
  });

  it("includes container's own active filter", () => {
    const contWithFilter = { ...containerOcc, filters: [{ ...dateFilter, id: "f2", active: true }] };
    const result = getEffectiveFiltersForContainer(contWithFilter, {
      occurrencesById: { ...occurrencesById, cont1: contWithFilter },
      filterNavState: { f1: "2026-04-20", f2: "2026-04-21" },
    });
    expect(result).toHaveLength(2);
  });

  it("skips inactive filters", () => {
    const panelInactive = { ...panelOcc, filters: [{ ...dateFilter, active: false }] };
    const result = getEffectiveFiltersForContainer(containerOcc, {
      occurrencesById: { panel1: panelInactive, cont1: containerOcc },
      filterNavState,
    });
    expect(result).toHaveLength(0);
  });
});

describe("isOccurrenceVisibleForFilter", () => {
  it("passes occurrence with matching date field", () => {
    const occ = { fields: { scheduledDate: { value: "2026-04-20" } } };
    const ef = [{ filter: dateFilter, navValue: "2026-04-20" }];
    expect(isOccurrenceVisibleForFilter(occ, ef)).toBe(true);
  });

  it("passes occurrence with no date field (persistent)", () => {
    const occ = { fields: {} };
    const ef = [{ filter: dateFilter, navValue: "2026-04-20" }];
    expect(isOccurrenceVisibleForFilter(occ, ef)).toBe(true);
  });

  it("hides occurrence with wrong date", () => {
    const occ = { fields: { scheduledDate: { value: "2026-04-19" } } };
    const ef = [{ filter: dateFilter, navValue: "2026-04-20" }];
    expect(isOccurrenceVisibleForFilter(occ, ef)).toBe(false);
  });

  it("passes all occurrences when effectiveFilters is empty", () => {
    const occ = { fields: { scheduledDate: { value: "1999-01-01" } } };
    expect(isOccurrenceVisibleForFilter(occ, [])).toBe(true);
  });
});
```

- [ ] **Step 2: Run — confirm failure**

```
npm --prefix ./client run test -- filterCascade
```

Expected: FAIL — functions not found.

- [ ] **Step 3: Add the two selectors to `client/src/state/selectors.js`**

Append at the bottom of `selectors.js` (keep existing code intact for now):

```js
// ============================================================
// NEW FILTER SYSTEM — per-occurrence cascade
// ============================================================

/**
 * Walk the parentId chain from occ up to root.
 * Collect all active filters from each ancestor and occ itself.
 * Resolve navValue from filterNavState for each filter.
 * Returns: [{ filter, navValue, originId }]  ordered root → leaf.
 */
export function getEffectiveFiltersForContainer(occ, { occurrencesById, filterNavState }) {
  if (!occ) return [];
  // Build ancestor chain from root → occ (reverse of parentId walk)
  const chain = [];
  let cur = occ;
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    chain.unshift(cur); // prepend so chain is root-first
    cur = cur.parentId ? (occurrencesById?.[cur.parentId] ?? null) : null;
  }
  const result = [];
  for (const node of chain) {
    for (const f of (node.filters ?? [])) {
      if (!f.active) continue;
      result.push({
        filter: f,
        navValue: filterNavState?.[f.id] ?? null,
        originId: node.id,
      });
    }
  }
  return result;
}

/**
 * Check if an occurrence is visible given an effective filter list.
 * Each filter injects { $nav, "$field.value" } into evalGroup.
 * An occurrence must pass ALL filters (AND across filters, OR/AND within each condition).
 */
export function isOccurrenceVisibleForFilter(occ, effectiveFilters) {
  if (!occ) return false;
  if (!effectiveFilters || effectiveFilters.length === 0) return true;
  for (const { filter, navValue } of effectiveFilters) {
    const fieldValue = occ.fields?.[filter.fieldId]?.value ?? null;
    const ctx = {
      "$nav": navValue,
      "$field.value": fieldValue,
    };
    if (!evalGroup(filter.condition, ctx)) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run — confirm pass**

```
npm --prefix ./client run test -- filterCascade
```

Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```
git add client/src/state/selectors.js client/src/__tests__/filterCascade.test.js
git commit -m "feat(filter): getEffectiveFiltersForContainer + isOccurrenceVisibleForFilter selectors"
```

---

## Task F3: Redux — `filterNavState` + actions

**Files:**
- Modify: `client/src/state/actions.js`
- Modify: `client/src/state/masterReducer.js`

- [ ] **Step 1: Add action creators to `client/src/state/actions.js`**

Find the exports at the bottom of the file. Add:

```js
export const SET_FILTER_NAV  = "SET_FILTER_NAV";
export const INIT_FILTER_NAV = "INIT_FILTER_NAV";

export const setFilterNavAction  = (filterId, value) => ({ type: SET_FILTER_NAV,  payload: { filterId, value } });
export const initFilterNavAction = (filterNavMap)    => ({ type: INIT_FILTER_NAV, payload: filterNavMap });
```

- [ ] **Step 2: Add `filterNavState` to `client/src/state/masterReducer.js`**

Find the `initialState` object (the one with `grid`, `modules`, `occurrences`, etc.). Add:

```js
filterNavState: {},
```

Find the `switch (action.type)` block. Before the `default:` case add:

```js
case "SET_FILTER_NAV":
  return {
    ...state,
    filterNavState: {
      ...state.filterNavState,
      [action.payload.filterId]: action.payload.value,
    },
  };

case "INIT_FILTER_NAV":
  return { ...state, filterNavState: action.payload };
```

- [ ] **Step 3: Initialize nav values from `defaultNavValue` on `full_state` in `client/src/state/bindSocketToStore.js`**

Find the `socket.on("full_state", ...)` handler. After the existing dispatch of `FULL_STATE`, add a second dispatch that walks all occurrences and initializes `filterNavState`:

```js
// After the existing full_state dispatch:
const navMap = {};
function resolveDefault(defaultNavValue, timeUnit) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (!defaultNavValue || defaultNavValue === "today") {
    return now.toISOString().slice(0, 10);
  }
  if (defaultNavValue === "startOfWeek") {
    const d = new Date(now);
    const dow = d.getDay();
    d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1)); // Monday
    return d.toISOString().slice(0, 10);
  }
  if (defaultNavValue === "startOfMonth") {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  }
  // ISO date or other literal → return as-is
  return defaultNavValue;
}
for (const occ of (data.occurrences || [])) {
  for (const f of (occ.filters || [])) {
    if (f.id && f.showNav) {
      navMap[f.id] = resolveDefault(f.defaultNavValue, f.timeUnit);
    }
  }
}
dispatch(initFilterNavAction(navMap));
```

Add import at top of bindSocketToStore.js:
```js
import { initFilterNavAction } from "./actions";
```

- [ ] **Step 4: Verify by running dev server and checking Redux state**

```
npm run dev
```

Open browser devtools → check that `window.__moduli_state__` (exposed in App.jsx) has `filterNavState` populated after load.

- [ ] **Step 5: Commit**

```
git add client/src/state/actions.js client/src/state/masterReducer.js client/src/state/bindSocketToStore.js
git commit -m "feat(filter): filterNavState in Redux + INIT_FILTER_NAV on full_state"
```

---

## Task F4: Server schema — Occurrence gets `filters[]`, Grid loses global fields

**Files:**
- Modify: `server/models/Occurrence.js`
- Modify: `server/models/Grid.js`
- Modify: `server/socketHandlers/state.js`

- [ ] **Step 1: Add `filters` to Occurrence schema in `server/models/Occurrence.js`**

Find the schema definition. Add after the existing `filterOverride` field (or anywhere in the schema):

```js
filters: {
  type: [{
    id:              { type: String },
    fieldId:         { type: String },
    active:          { type: Boolean, default: false },
    showNav:         { type: Boolean, default: false },
    timeUnit:        { type: String, enum: ["day", "week", "month", "year"], default: "day" },
    defaultNavValue: { type: String, default: "today" },
    condition:       { type: mongoose.Schema.Types.Mixed, default: null },
  }],
  default: [],
},
```

- [ ] **Step 2: Remove global filter fields from Grid schema in `server/models/Grid.js`**

Remove (or comment out) these fields:
- `namedFilters`
- `activeFilterId`
- `activeFilterValues`

If other code still references them, the absence will cause harmless `undefined` returns — that's fine. Remove them cleanly.

- [ ] **Step 3: Remove `update_grid_filter` handler from `server/socketHandlers/state.js`**

Search for `"update_grid_filter"` or `update_grid_filter`. Remove the `socket.on("update_grid_filter", ...)` block entirely.

- [ ] **Step 4: Restart server and confirm no startup errors**

```
cd server && node server.js
```

Expected: starts cleanly, no schema validation errors.

- [ ] **Step 5: Commit**

```
git add server/models/Occurrence.js server/models/Grid.js server/socketHandlers/state.js
git commit -m "feat(filter): Occurrence.filters[] schema + remove global Grid filter fields"
```

---

## Task F5: Update example data — Schedule panel gets a date filter

**Files:**
- Modify: `server/utils/createDefaultUserData.js`

- [ ] **Step 1: Remove namedFilters from grid seed**

Find the grid object creation in `createDefaultUserData.js`. Remove or empty out:
- `namedFilters: [...]`
- `activeFilterId: ...`
- `activeFilterValues: ...`

- [ ] **Step 2: Find scheduledDateFieldId**

Search `createDefaultUserData.js` for the field that stores the schedule date (likely named something like `scheduledDate`, `date`, or `schedDate`). Note its variable name — e.g. `scheduledDateField.id` or a uid variable like `scheduledDateFieldId`.

- [ ] **Step 3: Add `filters[]` to the Schedule panel occurrence**

Find the occurrence object for the Schedule panel (the one used for the schedule/daily-planning panel). Add:

```js
filters: [{
  id: uid(),
  fieldId: scheduledDateFieldId,   // use the actual variable from Step 2
  active: true,
  showNav: true,
  timeUnit: "day",
  defaultNavValue: "today",
  condition: {
    operator: "OR",
    rules: [
      { left: "$field.value", comparator: "DATE_EQUALS", right: "$nav" },
      { left: "$field.value", comparator: "IS_EMPTY" },
    ],
  },
}],
```

- [ ] **Step 4: Remove any `filterOverride` fields from existing occurrence seeds**

Search for `filterOverride:` in createDefaultUserData.js. Remove those lines.

- [ ] **Step 5: Reset data and verify server loads cleanly**

```
cd server && node scripts/resetData.js && node server.js
```

Expected: no errors, server starts.

- [ ] **Step 6: Commit**

```
git add server/utils/createDefaultUserData.js
git commit -m "feat(filter): seed Schedule panel with date filter, remove namedFilters from grid"
```

---

## Task F6: Wire new selectors into ModuleContainer + ModulePage

**Files:**
- Modify: `client/src/modules/ModuleContainer.jsx`
- Modify: `client/src/modules/ModulePage.jsx`

- [ ] **Step 1: Update ModuleContainer.jsx**

Find the import line:
```js
import { getEffectiveFilterForOccurrence, isOccurrenceVisible } from "../state/selectors";
```
Change to:
```js
import { getEffectiveFiltersForContainer, isOccurrenceVisibleForFilter } from "../state/selectors";
```

Find where `filterNavState` is needed. Read it from GridActionsContext or GridLiveContext. In the component body, add:

```js
const { filterNavState } = useContext(GridActionsContext);
```

Find the `effectiveFilters` useMemo. Replace entirely with:

```js
const effectiveFilters = useMemo(
  () => getEffectiveFiltersForContainer(containerOccurrence, { occurrencesById, filterNavState }),
  [containerOccurrence, occurrencesById, filterNavState]
);
```

Find the filtered items memo (the one that calls `isOccurrenceVisible`). Replace:
```js
// OLD:
() => allItemsWithOccurrences.filter(item => isOccurrenceVisible(item.occurrence, effectiveFilters, activeFilterConditions)),
// NEW:
() => allItemsWithOccurrences.filter(item => isOccurrenceVisibleForFilter(item.occurrence, effectiveFilters)),
```

Remove `activeFilterConditions` variable and its useMemo if it exists — it's no longer needed.

- [ ] **Step 2: Update ModulePage.jsx the same way**

Find imports of `getEffectiveFilterForOccurrence` / `isOccurrenceVisible`. Replace with `getEffectiveFiltersForContainer` / `isOccurrenceVisibleForFilter`.

Apply the same effectiveFilters useMemo replacement and filtered items replacement as Step 1.

- [ ] **Step 3: Add `filterNavState` to `GridActionsContext.js` defaults**

In `client/src/GridActionsContext.js`, find the default context value. Add:
```js
filterNavState: {},
```

In `client/src/App.jsx`, find where `actionsValue` is built. Add `filterNavState: state.filterNavState` to the object.

- [ ] **Step 4: Verify in browser**

```
npm run dev
```

Reset data. Open the Schedule panel. Occurrences with today's scheduledDate should appear. Navigate a day forward (no nav UI yet — you'll manually set filterNavState via Redux devtools or wait for Task F8).

- [ ] **Step 5: Commit**

```
git add client/src/modules/ModuleContainer.jsx client/src/modules/ModulePage.jsx client/src/GridActionsContext.js client/src/App.jsx
git commit -m "feat(filter): wire new cascade selectors into ModuleContainer + ModulePage"
```

---

## Task F7: Remove global filter infrastructure

**Files:**
- Delete: `client/src/ui/FilterNav.jsx`
- Delete: `client/src/ui/LocalFilterNav.jsx`
- Delete: `client/src/ui/commandCenter/FiltersTab.jsx`
- Modify: `client/src/App.jsx`
- Modify: `client/src/Toolbar.jsx`
- Modify: `client/src/ui/CommandCenter.jsx`
- Modify: `client/src/helpers/CommitHelpers.js`

- [ ] **Step 1: Delete the three removed files**

```bash
rm client/src/ui/FilterNav.jsx
rm client/src/ui/LocalFilterNav.jsx
rm client/src/ui/commandCenter/FiltersTab.jsx
```

- [ ] **Step 2: Remove from App.jsx**

Remove:
- `handleSelectFilter` callback
- `handleFilterValueChange` callback
- Any props passing those to Toolbar or elsewhere
- The `onSelectFilter` / `onFilterValueChange` entries from `actionsValue`

- [ ] **Step 3: Remove from Toolbar.jsx**

Remove:
- `import FilterNav` line
- The `<FilterNav ...>` JSX element from the toolbar render
- `onSelectFilter` / `onFilterValueChange` from the props destructure

- [ ] **Step 4: Remove FiltersTab from CommandCenter.jsx**

In `client/src/ui/CommandCenter.jsx`:
- Remove the `const FiltersTab = lazy(...)` line
- Remove `{ id: "filters", label: "Filters", icon: Filter }` from the TABS array
- Remove `{activeTab === "filters" && <FiltersTab />}` from the content block
- Remove `Filter` from the lucide imports if no longer used

- [ ] **Step 5: Remove `updateGridFilter` from CommitHelpers.js**

Find and delete the `updateGridFilter` export function.

- [ ] **Step 6: Confirm app builds without errors**

```
npm run dev
```

Expected: no import errors, no missing-prop warnings related to filters.

- [ ] **Step 7: Commit**

```
git add -A
git commit -m "refactor(filter): remove global FilterNav, FiltersTab, updateGridFilter"
```

---

## Task F8: FilterNavControl — field-type-aware nav widget

**Files:**
- Create: `client/src/ui/FilterNavControl.jsx`

- [ ] **Step 1: Create the component**

```jsx
// client/src/ui/FilterNavControl.jsx
// Field-type-aware nav control for a filter's nav value.
// Reads field type and renders the appropriate UI.
// All writes go to filterNavState via SET_FILTER_NAV dispatch.
import React, { useContext } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { GridActionsContext } from "../GridActionsContext";
import { setFilterNavAction } from "../state/actions";

function formatDateLabel(value, timeUnit) {
  if (!value) return "—";
  const d = new Date(value + "T00:00:00");
  if (timeUnit === "week") {
    const start = new Date(d);
    start.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1));
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  }
  if (timeUnit === "month") return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  if (timeUnit === "year") return String(d.getFullYear());
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function stepDate(value, timeUnit, dir) {
  const d = new Date((value || new Date().toISOString().slice(0, 10)) + "T00:00:00");
  const n = dir === 1 ? 1 : -1;
  if (timeUnit === "week")  d.setDate(d.getDate() + n * 7);
  else if (timeUnit === "month") d.setMonth(d.getMonth() + n);
  else if (timeUnit === "year")  d.setFullYear(d.getFullYear() + n);
  else d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function FilterNavControl({ filter, field, navValue }) {
  const { dispatch } = useContext(GridActionsContext);
  const set = (val) => dispatch(setFilterNavAction(filter.id, val));

  if (!field) return null;

  // DATE
  if (field.type === "date") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button onClick={() => set(stepDate(navValue, filter.timeUnit, -1))} style={arrowBtn}>
          <ChevronLeft size={12} />
        </button>
        <span style={{ fontSize: 11, minWidth: 100, textAlign: "center", color: "var(--text-primary)", fontFamily: "monospace" }}>
          {formatDateLabel(navValue, filter.timeUnit)}
        </span>
        <button onClick={() => set(stepDate(navValue, filter.timeUnit, 1))} style={arrowBtn}>
          <ChevronRight size={12} />
        </button>
      </div>
    );
  }

  // SELECT — multi-select chip list
  if (field.type === "select") {
    const options = field.meta?.options || [];
    const selected = Array.isArray(navValue) ? navValue : [];
    const toggle = (opt) => {
      const next = selected.includes(opt) ? selected.filter(o => o !== opt) : [...selected, opt];
      set(next);
    };
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {options.map(opt => (
          <button
            key={opt}
            onClick={() => toggle(opt)}
            style={{
              padding: "2px 8px", borderRadius: 10, fontSize: 10, fontFamily: "monospace", cursor: "pointer",
              background: selected.includes(opt) ? "rgba(59,130,246,0.2)" : "var(--input-bg)",
              border: selected.includes(opt) ? "1px solid rgba(59,130,246,0.5)" : "1px solid var(--border-subtle)",
              color: selected.includes(opt) ? "rgb(147,197,253)" : "var(--text-muted)",
            }}
          >
            {opt}
          </button>
        ))}
      </div>
    );
  }

  // NUMBER / RATING / DURATION — increment/decrement
  if (field.type === "number" || field.type === "rating" || field.type === "duration") {
    const val = navValue ?? 0;
    const min = field.type === "rating" ? 1 : undefined;
    const max = field.type === "rating" ? 5 : undefined;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button onClick={() => set(min !== undefined ? Math.max(min, val - 1) : val - 1)} style={arrowBtn}>
          <ChevronLeft size={12} />
        </button>
        <span style={{ fontSize: 11, minWidth: 32, textAlign: "center", fontFamily: "monospace", color: "var(--text-primary)" }}>
          {val}
        </span>
        <button onClick={() => set(max !== undefined ? Math.min(max, val + 1) : val + 1)} style={arrowBtn}>
          <ChevronRight size={12} />
        </button>
      </div>
    );
  }

  // BOOLEAN — toggle
  if (field.type === "boolean") {
    return (
      <button
        onClick={() => set(!navValue)}
        style={{
          padding: "2px 10px", borderRadius: 10, fontSize: 11, fontFamily: "monospace", cursor: "pointer",
          background: navValue ? "rgba(34,197,94,0.15)" : "var(--input-bg)",
          border: navValue ? "1px solid rgba(34,197,94,0.4)" : "1px solid var(--border-subtle)",
          color: navValue ? "rgb(134,239,172)" : "var(--text-muted)",
        }}
      >
        {navValue ? "Yes" : "No"}
      </button>
    );
  }

  // TEXT — plain input
  return (
    <input
      type="text"
      value={navValue ?? ""}
      onChange={e => set(e.target.value)}
      style={{
        height: 24, fontSize: 11, fontFamily: "monospace",
        background: "var(--input-bg)", border: "1px solid var(--input-border)",
        borderRadius: 4, color: "var(--text-primary)", padding: "0 6px", outline: "none",
      }}
    />
  );
}

const arrowBtn = {
  display: "flex", alignItems: "center", justifyContent: "center",
  width: 22, height: 22, borderRadius: 4, cursor: "pointer",
  background: "var(--input-bg)", border: "1px solid var(--border-subtle)",
  color: "var(--text-muted)",
};
```

- [ ] **Step 2: Commit**

```
git add client/src/ui/FilterNavControl.jsx
git commit -m "feat(filter): FilterNavControl — field-type-aware nav widget"
```

---

## Task F9: FilterDropdown — popover with nav controls + lock/unlock

**Files:**
- Create: `client/src/ui/FilterDropdown.jsx`

- [ ] **Step 1: Create the component**

```jsx
// client/src/ui/FilterDropdown.jsx
// Popover showing all effective filters for a module occurrence.
// For nav filters: shows FilterNavControl + lock/unlock.
// Footer: "Edit filters" button opens FilterEditor (passed as onEdit prop).
import React, { useContext, useRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Lock, Unlock, Pencil, Plus } from "lucide-react";
import { GridActionsContext } from "../GridActionsContext";
import { getEffectiveFiltersForContainer } from "../state/selectors";
import { setFilterNavAction } from "../state/actions";
import FilterNavControl from "./FilterNavControl";
import { updateOccurrence } from "../helpers/CommitHelpers";
import { uid } from "../uid";

export default function FilterDropdown({ occurrence, anchor, onClose, onEdit }) {
  const { dispatch, socket, occurrencesById, fieldsById, filterNavState, state } = useContext(GridActionsContext);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target) && !anchor?.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, anchor]);

  const effective = getEffectiveFiltersForContainer(occurrence, { occurrencesById, filterNavState });
  const ownFilterIds = new Set((occurrence.filters || []).map(f => f.id));

  // Position below anchor
  const rect = anchor?.getBoundingClientRect?.() || { left: 0, bottom: 0 };

  const handleUnlock = (ef) => {
    // Create a copy of the ancestor filter on this occurrence with the current navValue
    const newFilter = {
      ...ef.filter,
      id: uid(),
      active: true,
    };
    dispatch(setFilterNavAction(newFilter.id, ef.navValue));
    const updated = { ...occurrence, filters: [...(occurrence.filters || []), newFilter] };
    updateOccurrence({ dispatch, socket, occurrence: updated });
  };

  const handleLock = (ef) => {
    // Remove this occurrence's own active filter for that fieldId
    const updated = {
      ...occurrence,
      filters: (occurrence.filters || []).filter(f => f.id !== ef.filter.id),
    };
    updateOccurrence({ dispatch, socket, occurrence: updated });
  };

  const content = (
    <div
      ref={ref}
      style={{
        position: "fixed",
        top: rect.bottom + 4,
        left: rect.left,
        zIndex: 1200,
        background: "var(--body-bg)",
        border: "1px solid var(--border-default)",
        borderRadius: 8,
        padding: 10,
        minWidth: 220,
        boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {effective.length === 0 && (
        <div style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "monospace" }}>
          No active filters — click "Edit" to add one.
        </div>
      )}

      {effective.map((ef, i) => {
        const field = fieldsById?.[ef.filter.fieldId];
        const isOwn = ownFilterIds.has(ef.filter.id);
        return (
          <div key={ef.filter.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "monospace", flex: 1 }}>
                {field?.name || ef.filter.fieldId}
                {!isOwn && <span style={{ opacity: 0.5 }}> (inherited)</span>}
              </span>
              {ef.filter.showNav && (
                isOwn ? (
                  <button onClick={() => handleLock(ef)} title="Lock — inherit from parent" style={iconBtn}>
                    <Unlock size={10} />
                  </button>
                ) : (
                  <button onClick={() => handleUnlock(ef)} title="Unlock — use own value" style={iconBtn}>
                    <Lock size={10} />
                  </button>
                )
              )}
            </div>
            {ef.filter.showNav && (isOwn || ef.navValue != null) && (
              <FilterNavControl filter={ef.filter} field={field} navValue={ef.navValue} />
            )}
          </div>
        );
      })}

      <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 6, display: "flex", gap: 6 }}>
        <button onClick={onEdit} style={footerBtn}>
          <Pencil size={10} /> Edit filters
        </button>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

const iconBtn = {
  background: "none", border: "none", cursor: "pointer",
  color: "var(--text-faint)", display: "flex", alignItems: "center", padding: 2,
};
const footerBtn = {
  display: "inline-flex", alignItems: "center", gap: 4,
  padding: "3px 8px", borderRadius: 4, fontSize: 10, fontFamily: "monospace",
  background: "var(--input-bg)", border: "1px solid var(--border-subtle)",
  color: "var(--text-muted)", cursor: "pointer",
};
```

- [ ] **Step 2: Commit**

```
git add client/src/ui/FilterDropdown.jsx
git commit -m "feat(filter): FilterDropdown popover with nav controls and lock/unlock"
```

---

## Task F10: FilterEditor — full-panel overlay for editing `filters[]`

**Files:**
- Create: `client/src/ui/FilterEditor.jsx`

- [ ] **Step 1: Create the component**

```jsx
// client/src/ui/FilterEditor.jsx
// Full-panel overlay — edit this occurrence's own filters[] array.
// Opened by FilterDropdown "Edit filters" button.
// Closes via Back button; saves to server on every change (optimistic).
import React, { useState, useContext } from "react";
import { ArrowLeft, Trash2, Plus } from "lucide-react";
import { GridActionsContext } from "../GridActionsContext";
import ConditionGroup from "../blocks/ConditionGroup";
import { updateOccurrence } from "../helpers/CommitHelpers";
import { uid } from "../uid";

const TIME_UNITS = ["day", "week", "month", "year"];
const DEFAULT_NAV_VALUES = [
  { value: "today",        label: "Today" },
  { value: "startOfWeek",  label: "Start of week" },
  { value: "startOfMonth", label: "Start of month" },
  { value: null,           label: "None (no default)" },
];

export default function FilterEditor({ occurrence, onClose }) {
  const { dispatch, socket, fieldsById, state } = useContext(GridActionsContext);
  const gridId = state?.gridId;

  // All fields available for this grid
  const gridFields = Object.values(fieldsById || {}).filter(f => f.gridId === gridId);

  const [filters, setFilters] = useState(() => (occurrence.filters || []).map(f => ({ ...f })));

  const save = (updated) => {
    setFilters(updated);
    updateOccurrence({ dispatch, socket, occurrence: { ...occurrence, filters: updated } });
  };

  const updateFilter = (id, patch) => save(filters.map(f => f.id === id ? { ...f, ...patch } : f));
  const deleteFilter = (id) => save(filters.filter(f => f.id !== id));
  const addFilter = () => save([...filters, {
    id: uid(),
    fieldId: gridFields[0]?.id || "",
    active: true,
    showNav: false,
    timeUnit: "day",
    defaultNavValue: "today",
    condition: { operator: "OR", rules: [] },
  }]);

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 100,
      background: "var(--body-bg)", overflowY: "auto",
      display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
        borderBottom: "1px solid var(--border-subtle)", background: "var(--body-bg)",
        position: "sticky", top: 0, zIndex: 2,
      }}>
        <button onClick={onClose} style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 12, fontFamily: "monospace" }}>
          <ArrowLeft size={13} /> Back
        </button>
        <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-primary)" }}>Edit Filters</span>
      </div>

      {/* Filters */}
      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 16 }}>
        {filters.map(f => {
          const field = fieldsById?.[f.fieldId];
          return (
            <div key={f.id} style={{ border: "1px solid var(--border-subtle)", borderRadius: 6, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {/* Row 1: active toggle + field picker + delete */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>
                  <input type="checkbox" checked={f.active} onChange={e => updateFilter(f.id, { active: e.target.checked })} />
                  Active
                </label>
                <select
                  value={f.fieldId}
                  onChange={e => updateFilter(f.id, { fieldId: e.target.value })}
                  style={selectSt}
                >
                  <option value="">— pick field —</option>
                  {gridFields.map(gf => <option key={gf.id} value={gf.id}>{gf.name || gf.type}</option>)}
                </select>
                <button onClick={() => deleteFilter(f.id)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--danger-text)" }}>
                  <Trash2 size={12} />
                </button>
              </div>

              {/* Row 2: show nav toggle */}
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>
                <input type="checkbox" checked={f.showNav} onChange={e => updateFilter(f.id, { showNav: e.target.checked })} />
                Show nav in header
              </label>

              {/* Row 3: nav options (only if showNav) */}
              {f.showNav && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingLeft: 12 }}>
                  {field?.type === "date" && (
                    <label style={labelSt}>
                      Step:&nbsp;
                      <select value={f.timeUnit || "day"} onChange={e => updateFilter(f.id, { timeUnit: e.target.value })} style={selectSt}>
                        {TIME_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </label>
                  )}
                  <label style={labelSt}>
                    Default:&nbsp;
                    <select value={f.defaultNavValue ?? "null"} onChange={e => updateFilter(f.id, { defaultNavValue: e.target.value === "null" ? null : e.target.value })} style={selectSt}>
                      {DEFAULT_NAV_VALUES.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
                    </select>
                  </label>
                </div>
              )}

              {/* Condition builder */}
              <div style={{ paddingTop: 4 }}>
                <div style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "monospace", marginBottom: 4 }}>
                  Condition — use <code>$nav</code> as the right-hand value to reference the nav input
                </div>
                <ConditionGroup
                  group={f.condition || { operator: "OR", rules: [] }}
                  onChange={cg => updateFilter(f.id, { condition: cg })}
                  sources={[]}
                  fields={gridFields}
                />
              </div>
            </div>
          );
        })}

        <button onClick={addFilter} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 12px", borderRadius: 5, fontSize: 11, fontFamily: "monospace", background: "none", border: "1px dashed var(--border-default)", color: "var(--text-faint)", cursor: "pointer", alignSelf: "flex-start" }}>
          <Plus size={10} /> Add filter
        </button>
      </div>
    </div>
  );
}

const selectSt = {
  height: 24, fontSize: 10, fontFamily: "monospace",
  background: "var(--input-bg)", border: "1px solid var(--input-border)",
  borderRadius: 4, color: "var(--text-muted)", padding: "0 5px", outline: "none",
};
const labelSt = { fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)", display: "flex", alignItems: "center" };
```

- [ ] **Step 2: Commit**

```
git add client/src/ui/FilterEditor.jsx
git commit -m "feat(filter): FilterEditor full-panel overlay for editing occurrence filters[]"
```

---

## Task F11: FilterButton — header integration

**Files:**
- Create: `client/src/ui/FilterButton.jsx`
- Modify: `client/src/modules/ModulePanel.jsx`
- Modify: `client/src/modules/ModuleContainer.jsx`

- [ ] **Step 1: Create FilterButton**

```jsx
// client/src/ui/FilterButton.jsx
// Small button in module header. Opens FilterDropdown (and indirectly FilterEditor).
import React, { useState, useRef } from "react";
import { Filter, Lock } from "lucide-react";
import { getEffectiveFiltersForContainer } from "../state/selectors";
import FilterDropdown from "./FilterDropdown";
import FilterEditor from "./FilterEditor";

export default function FilterButton({ occurrence, occurrencesById, filterNavState }) {
  const [dropOpen, setDropOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const btnRef = useRef(null);

  if (!occurrence) return null;

  const effective = getEffectiveFiltersForContainer(occurrence, { occurrencesById, filterNavState });
  const ownActive = (occurrence.filters || []).filter(f => f.active);
  const hasInherited = effective.length > ownActive.length;
  const hasOwn = ownActive.length > 0;

  // Hide entirely when no filters anywhere in chain
  if (effective.length === 0 && !hasOwn) return null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setDropOpen(o => !o)}
        title="Filters"
        style={{
          display: "flex", alignItems: "center", gap: 3,
          padding: "2px 5px", borderRadius: 4, border: "none", cursor: "pointer",
          background: hasOwn ? "rgba(59,130,246,0.12)" : "transparent",
          color: hasOwn ? "rgb(147,197,253)" : "var(--text-faint)",
          fontSize: 10, fontFamily: "monospace",
        }}
      >
        {!hasOwn && hasInherited ? <Lock size={10} /> : <Filter size={10} />}
        {ownActive.length > 0 && ownActive.length}
      </button>

      {dropOpen && !editorOpen && (
        <FilterDropdown
          occurrence={occurrence}
          anchor={btnRef.current}
          onClose={() => setDropOpen(false)}
          onEdit={() => { setDropOpen(false); setEditorOpen(true); }}
        />
      )}

      {editorOpen && (
        <FilterEditor
          occurrence={occurrence}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Add FilterButton to ModulePanel.jsx panel header**

Find the panel header row in `ModulePanel.jsx`. Import FilterButton and add it alongside the existing header controls:

```jsx
import FilterButton from "../ui/FilterButton";

// In the panel header JSX, in the right-side controls area:
<FilterButton
  occurrence={panelOccurrence}
  occurrencesById={occurrencesById}
  filterNavState={filterNavState}
/>
```

(Read `filterNavState` from GridActionsContext if not already destructured.)

- [ ] **Step 3: Add FilterButton to ModuleContainer.jsx container header**

Same pattern — import and add to the container's `ml-auto` div in the standard header:

```jsx
import FilterButton from "../ui/FilterButton";

// In the container header right section:
<FilterButton
  occurrence={containerOccurrence}
  occurrencesById={occurrencesById}
  filterNavState={filterNavState}
/>
```

- [ ] **Step 4: Test in browser**

```
npm run dev
```

1. Reset data — Schedule panel should show today's occurrences only
2. FilterButton should appear in the Schedule panel header (lock icon, inherited)
3. Click → FilterDropdown shows the date filter with today's date and prev/next arrows
4. Click prev → date goes back one day, Schedule panel shows that day's occurrences

- [ ] **Step 5: Commit**

```
git add client/src/ui/FilterButton.jsx client/src/modules/ModulePanel.jsx client/src/modules/ModuleContainer.jsx
git commit -m "feat(filter): FilterButton in panel/container headers with dropdown + editor"
```

---

## Task F12: Update `$activeDate` in operationExecutor

**Files:**
- Modify: `client/src/helpers/operationExecutor.js`

- [ ] **Step 1: Update `$activeDate` to read from `filterNavState`**

In `operationExecutor.js`, find the `$activeDate` built-in variable setup in `executePipeline`. It currently reads from `filterOverride` chain. Replace with:

```js
// Find the operation's target occurrence, then find the first date-type
// active filter in its effective filter chain, and read navValue from filterNavState.
$activeDate: (() => {
  const targetOccId = operation.targetOccurrenceId;
  const targetOcc = targetOccId ? occurrencesById[targetOccId] : null;
  if (!targetOcc) return null;
  // Walk the chain looking for an active date filter
  let cur = targetOcc;
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    for (const f of (cur.filters || [])) {
      if (!f.active || !f.showNav) continue;
      const fld = state?.fieldsById?.[f.fieldId] || Object.values(state?.fields || []).find(x => x.id === f.fieldId);
      if (fld?.type === "date") {
        const nav = state?.filterNavState?.[f.id];
        if (nav) return nav;
      }
    }
    cur = cur.parentId ? (occurrencesById[cur.parentId] || null) : null;
  }
  return null;
})(),
```

- [ ] **Step 2: Verify "Water Today" operation still runs correctly**

```
npm run dev
```

Reset data. Log water intake on an instance. Verify the Water Today aggregation operation still fires and updates its display field correctly.

- [ ] **Step 3: Commit**

```
git add client/src/helpers/operationExecutor.js
git commit -m "fix(filter): \$activeDate reads from filterNavState instead of filterOverride chain"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `occurrence.filters[]` schema | F4 |
| Remove global Grid filter fields | F4, F7 |
| `filterNavState` in Redux | F3 |
| `INIT_FILTER_NAV` on full_state | F3 |
| `SET_FILTER_NAV` action | F3, F8 |
| `getEffectiveFiltersForContainer` selector | F2 |
| `isOccurrenceVisibleForFilter` using evalGroup | F2 |
| `IN` comparator for multi-select | F1 |
| `$nav` resolves from filterNavState in conditions | F2 (injected in ctx) |
| FilterNavControl — field-type-aware nav | F8 |
| FilterDropdown — nav + lock/unlock | F9 |
| FilterEditor — full-panel overlay | F10 |
| FilterButton in headers | F11 |
| Remove FilterNav, LocalFilterNav, FiltersTab | F7 |
| Remove handleSelectFilter from App | F7 |
| Example data: Schedule panel filter | F5 |
| `$activeDate` migrated to filterNavState | F12 |
| defaultNavValue → "today"/"startOfWeek"/"startOfMonth" | F3 |
| Lock = inherit ancestor, Unlock = own active filter | F9, F11 |
| Date, select, number, boolean, rating, text, duration nav | F8 |

All spec requirements covered. No placeholders. Type names consistent across all tasks (`filterNavState`, `getEffectiveFiltersForContainer`, `isOccurrenceVisibleForFilter`, `SET_FILTER_NAV`, `INIT_FILTER_NAV`).
