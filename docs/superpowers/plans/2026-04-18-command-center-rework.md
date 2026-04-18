# Command Center Rework + Operations & Filter Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the command center rework spec (`docs/superpowers/specs/2026-04-18-command-center-rework-design.md`), and — as a larger, higher-priority slice alongside it — fix the operations and filter pipelines so aggregations actually re-run on user activity and so child occurrences obey the active filter date.

**Architecture:** Two tracks executed in the same branch:
- **Track A — Data pipeline (operations + filters).** Diagnose why triggers only fire on load, fix trigger dispatch, wire the child-filter cascade end-to-end (`filterOverride` already exists on the Occurrence schema), retire the dead instance-level `iteration` concept, and make aggregation operations resolve `$activeDate` from the **operation's own occurrence** (walking its parent chain) — not the grid-global filter. Water Today on the Goals panel counts water relative to the Goals filter, not whichever panel the user just advanced.
- **Track B — Command Center UI shell.** Transform-based slide animation, preload of the 4 hot tab chunks, shared primitives in `commandCenter/ui.jsx`, tab roster (delete 3, add Templates + Trash), rebindable shortcuts via new `Shortcut` model + `useShortcut` hook. Redesign `ConditionGroup` so AND/OR nesting matches the rest of the Operations editor. **Kill the dot-chain:** every input in the operations/filter editors becomes a typed picker (OccurrencePicker / FieldPicker / VariablePicker / ValuePicker) showing readable module + field names — the user never types `$x.y.z` again.

Track A lands first because Track B's tab rewraps and the `ConditionGroup` redesign need the operations path to be trustworthy for smoke testing.

**Tech Stack:** React 18, TipTap, Socket.io, Mongoose, Vitest, Playwright.

---

## File Structure

### New files
- `client/src/ui/commandCenter/ui.jsx` — shared layout primitives (TabShell, Section, FormGrid, Field, Row, TextInput, NumberInput, SelectInput, Toggle, Pill)
- `client/src/ui/commandCenter/TemplatesTab.jsx` — new tab (source of truth: `grid.templates`)
- `client/src/ui/commandCenter/TrashTab.jsx` — new tab (source of truth: `modulesById` filtered by `trashed`)
- `client/src/ui/commandCenter/tabPreload.js` — `preloadHotTabs()` / `preloadAllTabs()` dynamic imports
- `client/src/hooks/useShortcut.js` — subscribes the document keydown listener for one actionId
- `client/src/state/shortcutReducer.js` *(or addition to `masterReducer.js`)* — `shortcut_updated` handler
- `server/models/Shortcut.js` — mongoose model
- `server/socketHandlers/shortcuts.js` — `update_shortcut` + `reset_shortcut` handlers
- `server/utils/ensureDefaultShortcuts.js` — idempotent seeder called on login
- `client/src/blocks/ConditionEditor.jsx` — replacement for `ConditionGroup.jsx` using the primitives from `commandCenter/ui.jsx` and the existing PathPicker
- `client/src/blocks/OccurrencePicker.jsx`, `FieldPicker.jsx`, `VariablePicker.jsx`, `ValuePicker.jsx` — typed reference pickers that replace every freeform path input in OperationsBuilder (B6a)
- `server/scripts/migrateOperationsToStructuredRefs.js` — one-shot migration that rewrites saved `$x.y.z` strings in op pipelines into structured `{kind, ref}` objects
- `client/src/__tests__/filterCascade.test.js`
- `client/src/__tests__/useShortcut.test.js`

### Modified files (hot list — not exhaustive)
- `client/src/helpers/operationExecutor.js` — trigger matcher bug fix; date source hydration
- `client/src/state/bindSocketToStore.js` — make sure every relevant transaction path calls `fireOperations` (triage first)
- `client/src/helpers/CommitHelpers.js` — `updateShortcut`, `resetShortcut`, `setFilterValue` clarity
- `client/src/state/selectors.js` — `getEffectiveFilterForOccurrence(occ)` walks parent chain using `filterOverride`
- `client/src/modules/ModuleContainer.jsx` — filter visibility now uses selector
- `client/src/ui/CommandCenter.jsx` — transform animation, preload wiring, tab roster, no more `tree`/`files`/`tree-components`
- `client/src/ui/FilterNav.jsx` — no structural change, but confirm it dispatches a single `NavigationOp` transaction
- `client/src/ui/commandCenter/FieldsTab.jsx` — rewrap in TabShell + FormGrid + Field (kills the viewport-stretching name input)
- `client/src/ui/commandCenter/OperationsTab.jsx` — rewrap in TabShell; swap `ConditionGroup` → `ConditionEditor`
- `client/src/ui/commandCenter/FiltersTab.jsx` — rewrap in TabShell; swap `ConditionGroup` → `ConditionEditor`
- `client/src/ui/commandCenter/GridSettingsTab.jsx`, `AppearanceTab.jsx`, `UserSettingsTab.jsx`, `ConnectionsTab.jsx`, `ListsTab.jsx` — TabShell rewrap
- `client/src/ui/commandCenter/ShortcutsTab.jsx` — full rewrite (editable rows)
- `client/src/App.jsx`, `Toolbar.jsx` — replace inline `Ctrl+Z` / `Ctrl+Y` / `Ctrl+[` / `Ctrl+]` / `Escape` / `Ctrl+.` handlers with `useShortcut`
- `client/src/ui/IterationNav.jsx`, `IterationSettings.jsx`, `LocalIterationNav.jsx`, `client/src/helpers/IterationHelpers.js` — delete; surviving references consolidate into filter flow
- `client/src/blocks/OperationsBuilder.jsx` — remove `iteration*` source option for instance occurrences; keep grid/panel/container filter references
- `client/src/modules/Instance.jsx`, `ModuleInstance.jsx` — drop iteration UI; instances read parent's effective filter
- `server/models/Grid.js` — confirm `namedFilters`, `activeFilterId`, `activeFilterValues` are the single source of truth (already are; verify only)
- `server/socketHandlers/state.js` — include `shortcutsById` in `full_state`
- `server/utils/createDefaultUserData.js` — seed default shortcuts + remove any remaining `iteration: {...}` on instance occurrences

### Deleted files
- `client/src/ui/commandCenter/EntityTreeTab.jsx`
- `client/src/ui/commandCenter/FilesTab.jsx`
- `client/src/ui/commandCenter/ComponentsTab.jsx`
- `client/src/blocks/ConditionGroup.jsx` (replaced by `ConditionEditor.jsx`)
- `client/src/ui/IterationNav.jsx`, `IterationSettings.jsx`, `LocalIterationNav.jsx`
- `client/src/helpers/IterationHelpers.js`

---

# TRACK A — Data pipeline (operations + filters)

## Task A0: Capture baseline with a failing smoke test

**Files:**
- Create: `client/src/__tests__/operationsSmoke.test.js`

- [ ] **Step 1: Write a smoke test that reproduces the "only fires on load" bug**

```js
// client/src/__tests__/operationsSmoke.test.js
import { describe, it, expect, vi } from "vitest";
import { runMatchingOperations, shouldTrigger } from "../helpers/operationExecutor";

const baseOp = {
  id: "op_water_today",
  enabled: true,
  name: "Water Today",
  sortOrder: 10,
  triggerTypes: ["onFieldChange", "onLoad", "onFilterChange"],
  triggerConfig: {},
  pipeline: { sources: [], steps: [] },
};

describe("operation trigger dispatch", () => {
  it("matches onFieldChange when a MeasureOp arrives", () => {
    expect(shouldTrigger(baseOp, "MeasureOp", { fieldId: "water", instanceId: "inst1" })).toBe(true);
  });

  it("matches onFilterChange when a NavigationOp arrives", () => {
    expect(shouldTrigger(baseOp, "NavigationOp", { activeFilterValues: { date: "2026-04-18" } })).toBe(true);
  });

  it("still matches onLoad when transactionType is null", () => {
    expect(shouldTrigger(baseOp, null, null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test**

```
npm --prefix ./client run test -- operationsSmoke
```

Expected: the third case passes. The first two **may** fail — capture the actual output in a comment at the top of the file. This is the baseline.

- [ ] **Step 3: Commit the failing baseline**

```
git add client/src/__tests__/operationsSmoke.test.js
git commit -m "test: baseline smoke test for operation trigger dispatch"
```

---

## Task A1: Fix `matchesTrigger` for `onFilterChange`

**Files:**
- Modify: `client/src/helpers/operationExecutor.js` (the `matchesTrigger` switch)
- Modify: `client/src/__tests__/operationsSmoke.test.js`

**Context:** The spec says `onFilterChange` is an alias for the `NavigationOp` transaction (toolbar date arrows / named-filter change). Today the switch in `matchesTrigger` has no `onFilterChange` case, so ops that list `"onFilterChange"` in their `triggerTypes` silently do nothing — which matches the user's symptom ("only fires on load"). Verify this is the shape of the bug in A0; if the bug is actually elsewhere, write a targeted fix instead of this task.

- [ ] **Step 1: Add the failing test**

```js
// add inside the existing describe block in operationsSmoke.test.js
it("maps onFilterChange → NavigationOp transactions", () => {
  expect(shouldTrigger({
    ...baseOp,
    triggerTypes: ["onFilterChange"],
  }, "NavigationOp", { type: "NavigationOp" })).toBe(true);
});
```

- [ ] **Step 2: Run it — confirm failure**

Expected: `received: false`.

- [ ] **Step 3: Add the case in `matchesTrigger`**

In `client/src/helpers/operationExecutor.js`, after the `onNavigation` case add:

```js
case "onFilterChange":
  // Alias of onNavigation — same match semantics.
  return transactionType === "NavigationOp";
```

If the executor also handles filter-specific config (e.g. `cfg.onFilterChange?.filterId`), mirror the pattern of the `onChange` case.

- [ ] **Step 4: Re-run test**

Expected: pass.

- [ ] **Step 5: Commit**

```
git add client/src/helpers/operationExecutor.js client/src/__tests__/operationsSmoke.test.js
git commit -m "fix: operation trigger onFilterChange maps to NavigationOp"
```

---

## Task A2: Verify — and if needed, repair — `fireOperations` call sites

**Files:**
- Modify: `client/src/state/bindSocketToStore.js` (only if a gap is found)

**Context:** `bindSocketToStore.js` already calls `fireOperations(...)` for `ModuleOp`, `OccurrenceCreateOp`, `MeasureOp`, `OccurrenceDeleteOp`, `NavigationOp`, and on `transaction_created`. Do not refactor for fun — verify each call site still runs by hand-tracing, and only fix what's actually missing.

- [ ] **Step 1: Add a guarded console trace**

In `fireOperations` prepend:

```js
if (import.meta.env.DEV) console.log("[ops] fire", transactionType, Object.keys(transaction || {}));
```

- [ ] **Step 2: Run the dev server**

```
npm run dev
```

Exercise: (a) change a field on an instance (expect `MeasureOp`), (b) drop a new instance into a container (expect `OccurrenceListOp`), (c) advance the toolbar date (expect `NavigationOp`), (d) check a completion checkbox (expect `MeasureOp`).

- [ ] **Step 3: Log what actually fires**

Record the output in the PR description. If any expected transaction type does not fire, open a focused fix in the matching socket handler and write a regression test in `bindSocketToStore.test.js`.

- [ ] **Step 4: Remove the DEV log; commit any real fixes together**

```
git add -p client/src/state/bindSocketToStore.js
git commit -m "fix: fire operations on <event> (was silently dropped)"
```

If nothing was missing, this task ends with no commit and a note in the PR description: "A2 verified — all transaction types fire on their expected events."

---

## Task A3: Retire instance-level `iteration`

**Files:**
- Delete: `client/src/ui/IterationNav.jsx`, `IterationSettings.jsx`, `LocalIterationNav.jsx`
- Delete: `client/src/helpers/IterationHelpers.js`
- Modify: `client/src/modules/Instance.jsx`, `ModuleInstance.jsx`
- Modify: `client/src/blocks/OperationsBuilder.jsx` — remove `iteration*` source kinds on instance entity
- Modify: `server/utils/createDefaultUserData.js` — strip any trailing `iteration: {}` that slipped through

**Context:** The `Occurrence` schema no longer has an `iteration` field (confirmed in `server/models/Occurrence.js`), but the client still renders iteration pickers in Instance and OperationsBuilder — they read `occurrence.iteration?.timeFilter` etc. and always resolve to undefined. For an instance, iteration has been subsumed by the filter system (grid `activeFilterValues` + `occurrence.filterOverride`). Delete the dead UI and the helpers it calls.

- [ ] **Step 1: Grep every reference**

```
rg -n "IterationNav|IterationSettings|LocalIterationNav|IterationHelpers|\\.iteration\\.(timeFilter|timeValue|categoryKey|mode)" client/src server
```

Record the results list in a scratch note and decide per-site.

- [ ] **Step 2: Delete the four files**

```
rm client/src/ui/IterationNav.jsx
rm client/src/ui/IterationSettings.jsx
rm client/src/ui/LocalIterationNav.jsx
rm client/src/helpers/IterationHelpers.js
```

- [ ] **Step 3: Remove every import / render of those files**

Use your editor to follow the grep output from Step 1. Most call sites render the component inline in a form; delete the block and any surrounding label. Do NOT leave shim components behind.

- [ ] **Step 4: Remove `iteration*` sources from `OperationsBuilder.jsx`**

In `ENTITY_TYPES`, delete any entry for iteration-style sources on the `instance` or `occurrence` entity. Keep filter-style sources (`$grid.activeFilterValues`, `$container.filterOverride`, etc.) intact — add them if missing.

- [ ] **Step 5: Run the client tests**

```
npm --prefix ./client run test
```

Expected: green. Fix any test that relied on the deleted helpers by rewriting it against the filter API.

- [ ] **Step 6: Run the dev server**

Smoke-check an instance: the pencil menu + context menu should no longer offer "Iteration" options; fields render as before.

- [ ] **Step 7: Commit**

```
git add -A
git commit -m "refactor: remove dead instance-level iteration UI (filter system is canonical)"
```

---

## Task A4: Implement `getEffectiveFilterForOccurrence(occ, state)`

**Files:**
- Modify: `client/src/state/selectors.js`
- Create: `client/src/__tests__/filterCascade.test.js`

**Context:** `Occurrence.filterOverride` semantics:
- `null` → inherit parent's effective filter (walk up via `parentId`, falling back to `grid.activeFilterValues` at the root)
- `{}` → this occurrence (and descendants) show everything regardless of active filter — "unlocked"
- `{ [fieldId]: value }` → use these specific values, merged over the inherited ones

Today nothing reads this. Add one selector, tested.

- [ ] **Step 1: Write tests first**

```js
// client/src/__tests__/filterCascade.test.js
import { describe, it, expect } from "vitest";
import { getEffectiveFilterForOccurrence } from "../state/selectors";

const grid = { activeFilterValues: { scheduledDate: "2026-04-18" } };

const makeState = (occs) => ({
  grid,
  occurrencesById: Object.fromEntries(occs.map(o => [o.id, o])),
});

describe("getEffectiveFilterForOccurrence", () => {
  it("inherits grid values when the whole chain is filterOverride:null", () => {
    const state = makeState([
      { id: "a", parentId: null, filterOverride: null },
      { id: "b", parentId: "a", filterOverride: null },
    ]);
    expect(getEffectiveFilterForOccurrence(state.occurrencesById.b, state))
      .toEqual({ scheduledDate: "2026-04-18" });
  });

  it("empty object at any level breaks inheritance (unlocked)", () => {
    const state = makeState([
      { id: "a", parentId: null, filterOverride: {} },
      { id: "b", parentId: "a", filterOverride: null },
    ]);
    expect(getEffectiveFilterForOccurrence(state.occurrencesById.b, state))
      .toEqual({});
  });

  it("specific values override inherited ones by field", () => {
    const state = makeState([
      { id: "a", parentId: null, filterOverride: null },
      { id: "b", parentId: "a", filterOverride: { scheduledDate: "2026-04-20" } },
    ]);
    expect(getEffectiveFilterForOccurrence(state.occurrencesById.b, state))
      .toEqual({ scheduledDate: "2026-04-20" });
  });
});
```

- [ ] **Step 2: Run — confirm failure**

```
npm --prefix ./client run test -- filterCascade
```

- [ ] **Step 3: Implement the selector**

```js
// append to client/src/state/selectors.js
export function getEffectiveFilterForOccurrence(occ, { grid, occurrencesById }) {
  if (!occ) return grid?.activeFilterValues || {};
  const chain = [];
  let cur = occ;
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    chain.push(cur);
    cur = cur.parentId ? occurrencesById[cur.parentId] : null;
  }
  // Start with grid defaults, walk from root downward applying overrides.
  let effective = { ...(grid?.activeFilterValues || {}) };
  for (let i = chain.length - 1; i >= 0; i--) {
    const o = chain[i].filterOverride;
    if (o == null) continue;                 // inherit
    if (Object.keys(o).length === 0) {       // unlocked: clear
      effective = {};
      continue;
    }
    effective = { ...effective, ...o };      // specific
  }
  return effective;
}
```

- [ ] **Step 4: Run — green**

- [ ] **Step 5: Commit**

```
git add client/src/state/selectors.js client/src/__tests__/filterCascade.test.js
git commit -m "feat(filter): effective-filter selector walks filterOverride chain"
```

---

## Task A5: Wire visibility through the selector

**Files:**
- Modify: `client/src/modules/ModuleContainer.jsx`, `ModulePanel.jsx`, `ModulePage.jsx`
- Modify: `client/src/helpers/CalculationHelpers.js` (`isOccurrenceVisible` callers)

**Context:** Today some code calls `isOccurrenceVisible(occ, effectiveFilters)` but `effectiveFilters` is recomputed ad-hoc (sometimes it's `grid.activeFilterValues`; sometimes it's `{}`). Make every render call the selector from A4.

- [ ] **Step 1: Find every caller**

```
rg -n "isOccurrenceVisible|effectiveFilters" client/src
```

- [ ] **Step 2: At each caller, replace the ad-hoc computation with the selector**

Example (`ModuleContainer.jsx`):

```jsx
import { getEffectiveFilterForOccurrence } from "../state/selectors";
// inside the component:
const effectiveFilter = useMemo(
  () => getEffectiveFilterForOccurrence(containerOccurrence, { grid, occurrencesById }),
  [containerOccurrence, grid, occurrencesById]
);
// pass `effectiveFilter` where the old ad-hoc object was used.
```

- [ ] **Step 3: Manual test**

1. Open the app.
2. Set the toolbar filter to Daily, advance to a date with existing schedule data.
3. Confirm only occurrences with matching `scheduledDate` show.
4. On a container, right-click → Filter → "Show everything". Confirm its children now show regardless of date.
5. Right-click → Filter → "Use specific date" → pick a different day. Confirm that container's descendants show for the chosen day only.

If the UI for (4)/(5) doesn't exist yet, note that it will land in Task A7 (Filter controls on occurrences).

- [ ] **Step 4: Commit**

```
git add -A
git commit -m "feat(filter): occurrence visibility uses cascade selector"
```

---

## Task A6: Scope `$activeDate` to the operation's OWN occurrence, not the grid

**Files:**
- Modify: `client/src/helpers/operationExecutor.js` (`executePipeline` built-in vars)
- Modify: `client/src/state/selectors.js` — reuse `getEffectiveFilterForOccurrence` from Task A4
- Modify: `client/src/__tests__/operationExecutor.test.js` — add two regression tests

**Context:** Today `$activeDate` (if it's set at all) reads `grid.activeFilterValues[primaryDateFieldId]` — the *grid-global* filter. That is wrong.

Operations are attached to a target occurrence (the Water Goal instance lives inside the **Goals** panel/container). When the op runs, it should count water relative to **the Goals panel's effective filter**, not whichever panel the user happens to have advanced. If the user advances the Schedule panel's date to April 18 but the Goals panel is still inheriting April 15, the Water Today total must be computed for April 15 — because the goal *lives* on April 15.

Resolution rule (single source of truth):

1. The executor knows `operation.targetOccurrenceId` (the occurrence the op is bound to — already on the operation record).
2. Call `getEffectiveFilterForOccurrence(state, operation.targetOccurrenceId)` from Task A4 — this walks up the parent chain, applying `filterOverride` at each level, and lands on the filter that applies where the op runs.
3. `$activeDate` = `effectiveFilter[primaryDateFieldId]` where `primaryDateFieldId` comes from `grid.namedFilters[activeFilterId]`.
4. Any other filter axis the op needs is on the same `effectiveFilter` object (exposed as `$activeFilter` so ops can also branch on e.g. `$activeFilter.context`).

This also means NavigationOp transactions that change *only the Schedule panel's* filter do not re-run the Goals op. The dispatcher from Task A1 filters by `overlappingOccurrenceIds(transaction, op.targetOccurrenceId)` — if the advanced occurrence is not an ancestor of the op's target, skip. (If A1 currently re-runs every op on every NavigationOp, tighten it here.)

- [ ] **Step 1: Write the "different panel, different answer" regression test**

```js
// inside operationExecutor.test.js
it("resolves $activeDate from the operation's owning occurrence, not grid-global", () => {
  // Water goal lives in Goals panel (filter locked to 2026-04-15).
  // User just advanced Schedule panel to 2026-04-18.
  const state = makeStateWithTwoPanels({
    goalsPanelFilter: { date: "2026-04-15" },
    schedulePanelFilter: { date: "2026-04-18" },
    waterEntries: [
      { date: "2026-04-15", amount: 3 },
      { date: "2026-04-18", amount: 7 },
    ],
  });
  const op = waterTodayOpFixture({ targetOccurrenceId: "water-goal-occ" });
  const [effect] = runMatchingOperations([op], "NavigationOp",
    { type: "NavigationOp", occurrenceId: "schedule-panel-occ" }, state);

  // Goal counts its own day (April 15 = 3), not the Schedule panel's day (April 18 = 7).
  expect(effect.value).toBe(3);
});
```

- [ ] **Step 2: Write the "ancestor filter change DOES re-run" test**

```js
it("re-runs when the op's own ancestor filter changes", () => {
  const state = makeStateWithFilter("2026-04-18", { targetOccurrenceId: "water-goal-occ" });
  const op = waterTodayOpFixture({ targetOccurrenceId: "water-goal-occ" });
  const [effect] = runMatchingOperations([op], "NavigationOp",
    { type: "NavigationOp", occurrenceId: "goals-panel-occ" /* ancestor of water-goal-occ */ },
    state);
  expect(effect).toBeDefined();  // op fired
});
```

If `waterTodayOpFixture`/`makeStateWithTwoPanels`/`makeStateWithFilter` don't exist, build them from the canonical example in OPERATIONS_SPEC § "Water Today". Test data must have water entries on both dates.

- [ ] **Step 3: Run — these should fail against current code**

```
npm --prefix ./client run test -- operationExecutor
```

Expected: both fail. Current code either reads grid-global filter, or re-runs every NavigationOp regardless of ancestry.

- [ ] **Step 4: Fix the executor**

In `operationExecutor.js` `executePipeline`, replace any grid-global `$activeDate` seeding with:

```js
import { getEffectiveFilterForOccurrence } from "../state/selectors";
// ...
const effectiveFilter = getEffectiveFilterForOccurrence(state, operation.targetOccurrenceId);
const primaryDateFieldId = state.grid?.namedFilters
  ?.find(f => f.id === state.grid.activeFilterId)?.primaryDateFieldId;
const activeDate = primaryDateFieldId ? effectiveFilter[primaryDateFieldId] : null;
vars.$activeDate = activeDate;
vars.$activeFilter = effectiveFilter;
```

In `runMatchingOperations` (or wherever A1's dispatcher lives), tighten the NavigationOp branch:

```js
if (transactionType === "NavigationOp") {
  const changedOccId = transaction.occurrenceId;
  if (!isAncestorOrSelf(state, changedOccId, op.targetOccurrenceId)) continue;
}
```

`isAncestorOrSelf` walks `parentId` up from `op.targetOccurrenceId` and returns true if `changedOccId` is hit (add to `selectors.js` — it's two lines).

- [ ] **Step 5: Run tests — both pass**

```
npm --prefix ./client run test -- operationExecutor
```

- [ ] **Step 6: Commit**

```
git add client/src/__tests__/operationExecutor.test.js client/src/helpers/operationExecutor.js client/src/state/selectors.js
git commit -m "fix(ops): scope \$activeDate to operation's owning occurrence"
```

---

## Task A7: Per-occurrence filter controls (the lock/unlock UX)

**Files:**
- Modify: `client/src/ui/LayoutForm.jsx` (panels), `ContainerForm.jsx` (containers), `InstanceForm.jsx` (instances)
- Modify: `client/src/helpers/CommitHelpers.js` — add `updateOccurrence({ id, filterOverride })`

**Context:** The `filterOverride` is authoritative but the user has no way to set it per-occurrence today. Add a small "Filter" section to each form:

- Radio: **Inherit** (`null`) / **Show everything** (`{}`) / **Specific** (`{fieldId: value}`)
- When **Specific** is selected, render a field picker (only date + select fields from `grid.namedFilters[activeFilterId].filterKeys`) and a value input.

- [ ] **Step 1: Add the commit helper**

```js
// client/src/helpers/CommitHelpers.js
export function updateOccurrenceFilterOverride({ socket, dispatch, id, filterOverride }) {
  dispatch({ type: "UPDATE_OCCURRENCE", occurrence: { id, filterOverride } });
  socket.emit("update_occurrence", { id, patch: { filterOverride } });
}
```

- [ ] **Step 2: Add a `<Section title="Filter">` to each form using the TabShell primitives landing in Task B3**

**Important:** this task depends on `commandCenter/ui.jsx` existing. If executing strictly top-to-bottom, defer steps 2–4 until after Task B3. Do Step 1 now; leave a TODO comment in the forms until the primitives ship.

- [ ] **Step 3: Manual test — the lock/unlock flow**

1. Change a container's filter to "Specific" → water on April 16.
2. Advance the grid's filter to April 18.
3. Confirm the rest of the grid shows April 18 items but that container still shows April 16 items.
4. Set it back to "Inherit". Confirm it flips to April 18.
5. Set it to "Show everything". Confirm it shows regardless of date.

- [ ] **Step 4: Commit**

```
git add -A
git commit -m "feat(filter): per-occurrence filter override UI (lock/unlock)"
```

---

# TRACK B — Command Center UI shell

## Task B1: Transform-based slide animation

**Files:**
- Modify: `client/src/ui/CommandCenter.jsx`

- [ ] **Step 1: Replace `max-height` with `transform`**

```jsx
// top of CommandCenter.jsx:
const DRAWER_HEIGHT = isMobile ? "70vh" : "50vh";

// wrapper style:
style={{
  position: "absolute",
  top: "100%",
  left: 0, right: 0,
  height: DRAWER_HEIGHT,
  transform: open ? "translateY(0)" : "translateY(-100%)",
  transition: `transform ${isMobile ? "0.12s" : "0.2s"} cubic-bezier(0.2, 0.8, 0.2, 1)`,
  willChange: "transform",
  background: "var(--body-bg)",
  borderBottom: "1px solid var(--border-default)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
  visibility: open ? "visible" : "hidden",  // set by transitionend when closing
  zIndex: 200,
}}
onTransitionEnd={(e) => {
  if (e.propertyName === "transform" && !open) setInternalVisible(false);
}}
```

Track a local `internalVisible` state: set `true` immediately on `open=true`; set `false` only after the close transition ends. The JSX uses `visibility: internalVisible ? "visible" : "hidden"`.

- [ ] **Step 2: Ensure the parent has `overflow: hidden`**

The parent (`App.jsx` `.grid-frame`) already has it. Verify visually: when closed, the drawer must not paint above the toolbar.

- [ ] **Step 3: Manual test**

Toggle CC open/close with `Ctrl+.`. Confirm a GPU-smooth slide, no reflow stutter, content underneath never interactable when closed.

- [ ] **Step 4: Commit**

```
git add client/src/ui/CommandCenter.jsx
git commit -m "perf(command-center): transform-based slide animation"
```

---

## Task B2: Tab chunk preload

**Files:**
- Create: `client/src/ui/commandCenter/tabPreload.js`
- Modify: `client/src/App.jsx`, `client/src/Toolbar.jsx`

- [ ] **Step 1: Create the preload module**

```js
// client/src/ui/commandCenter/tabPreload.js
const HOT = [
  () => import("./FieldsTab"),
  () => import("./OperationsTab"),
  () => import("./FiltersTab"),
  () => import("./GridSettingsTab"),
];

const COLD = [
  () => import("./TemplatesTab"),
  () => import("./TrashTab"),
  () => import("./AppearanceTab"),
  () => import("./ConnectionsTab"),
  () => import("./ListsTab"),
  () => import("./UserSettingsTab"),
  () => import("./ShortcutsTab"),
];

let hotDone = false;
let allDone = false;

export function preloadHotTabs() {
  if (hotDone) return;
  hotDone = true;
  const fire = () => HOT.forEach(fn => fn());
  if (typeof requestIdleCallback === "function") requestIdleCallback(fire);
  else setTimeout(fire, 200);
}

export function preloadAllTabs() {
  if (allDone) return;
  allDone = true;
  [...HOT, ...COLD].forEach(fn => fn());
}
```

- [ ] **Step 2: Wire `preloadHotTabs()` into `App.jsx`**

```jsx
// top of App mount effect:
useEffect(() => { preloadHotTabs(); }, []);
```

- [ ] **Step 3: Wire `preloadAllTabs()` on CC button hover**

In `Toolbar.jsx`, on the Command Center button:

```jsx
<button
  onPointerEnter={preloadAllTabs}
  onFocus={preloadAllTabs}
  onClick={onToggleCommandCenter}
>
```

- [ ] **Step 4: Confirm Suspense fallback is `null` (already is)**

Visual: opening CC never shows a blank frame.

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "perf(command-center): preload hot tab chunks on idle + all on hover"
```

---

## Task B3: Shared primitives in `commandCenter/ui.jsx`

**Files:**
- Create: `client/src/ui/commandCenter/ui.jsx`

**Context:** This is the dependency for every subsequent tab-rewrap task. Keep primitives minimal — no extra abstractions.

- [ ] **Step 1: Write the file**

```jsx
// client/src/ui/commandCenter/ui.jsx
import React from "react";

const INPUT_STYLE = {
  background: "var(--input-bg)",
  border: "1px solid var(--input-border)",
  color: "var(--text-primary)",
  padding: "6px 8px",
  borderRadius: 4,
  fontSize: 12,
  width: "100%",
  boxSizing: "border-box",
};

export function TabShell({ width = "narrow", children }) {
  const max = width === "wide" ? 960 : 640;
  return (
    <div style={{ maxWidth: max, margin: "0 auto", padding: "14px 18px", width: "100%", boxSizing: "border-box" }}>
      {children}
    </div>
  );
}

export function Section({ title, children, right = null }) {
  return (
    <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 12, marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)" }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

export function FormGrid({ children, maxWidth = 480 }) {
  return <div style={{ maxWidth, display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>;
}

export function Field({ label, children, hint = null }) {
  return (
    <label style={{ display: "grid", gridTemplateColumns: "120px 1fr", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
      <div>{children}{hint && <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 2 }}>{hint}</div>}</div>
    </label>
  );
}

export function Row({ gap = 6, align = "center", children }) {
  return <div style={{ display: "flex", gap, alignItems: align }}>{children}</div>;
}

export function TextInput(props)   { return <input {...props} style={{ ...INPUT_STYLE, ...(props.style||{}) }} />; }
export function NumberInput(props) { return <input type="number" {...props} style={{ ...INPUT_STYLE, ...(props.style||{}) }} />; }
export function SelectInput({ children, ...props }) {
  return <select {...props} style={{ ...INPUT_STYLE, ...(props.style||{}) }}>{children}</select>;
}
export function Toggle({ checked, onChange }) {
  return <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />;
}
export function Pill({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "3px 8px", borderRadius: 999, fontSize: 11,
        background: active ? "var(--accent-blue-bg)" : "transparent",
        color: active ? "var(--accent-blue-text)" : "var(--text-muted)",
        border: "1px solid " + (active ? "var(--accent-blue-border)" : "var(--border-subtle)"),
        cursor: "pointer",
      }}
    >{children}</button>
  );
}
```

- [ ] **Step 2: Add a tiny unit test to lock in the width cap**

```js
// client/src/__tests__/commandCenterUi.test.jsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TabShell } from "../ui/commandCenter/ui";

describe("TabShell", () => {
  it("caps narrow width at 640", () => {
    const { container } = render(<TabShell width="narrow">x</TabShell>);
    expect(container.firstChild.style.maxWidth).toBe("640px");
  });
  it("caps wide width at 960", () => {
    const { container } = render(<TabShell width="wide">x</TabShell>);
    expect(container.firstChild.style.maxWidth).toBe("960px");
  });
});
```

- [ ] **Step 3: Run tests — green**

- [ ] **Step 4: Commit**

```
git add client/src/ui/commandCenter/ui.jsx client/src/__tests__/commandCenterUi.test.jsx
git commit -m "feat(command-center): shared layout primitives (TabShell, Section, FormGrid, Field)"
```

---

## Task B4: Tab roster — delete 3, add Templates + Trash

**Files:**
- Delete: `client/src/ui/commandCenter/EntityTreeTab.jsx`, `FilesTab.jsx`, `ComponentsTab.jsx`
- Create: `client/src/ui/commandCenter/TemplatesTab.jsx`, `TrashTab.jsx`
- Modify: `client/src/ui/CommandCenter.jsx`

- [ ] **Step 1: Delete the three tab files and their lazy imports**

```
rm client/src/ui/commandCenter/EntityTreeTab.jsx
rm client/src/ui/commandCenter/FilesTab.jsx
rm client/src/ui/commandCenter/ComponentsTab.jsx
```

In `CommandCenter.jsx` remove the three `const ...Tab = lazy(...)` lines, the three `TABS` entries (`tree`, `files`, and Components-if-separate), and the three conditional `{activeTab === ... && ...}` lines.

- [ ] **Step 2: Write `TemplatesTab.jsx`**

```jsx
// client/src/ui/commandCenter/TemplatesTab.jsx
import React, { useContext } from "react";
import { TabShell, Section, Row, TextInput } from "./ui";
import { GridActionsContext } from "../../GridActionsContext";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import { BookMarked, Trash2 } from "lucide-react";

export function TemplatesTab() {
  const { state, socket, dispatch } = useContext(GridActionsContext);
  const templates = state.grid?.templates || [];

  const rename = (id, name) => CommitHelpers.updateGrid({
    socket, dispatch,
    patch: { templates: templates.map(t => t.id === id ? { ...t, name } : t) },
  });
  const remove = (id) => CommitHelpers.updateGrid({
    socket, dispatch,
    patch: { templates: templates.filter(t => t.id !== id) },
  });

  return (
    <TabShell width="wide">
      <Section title="Templates">
        {templates.length === 0 && <div style={{ color: "var(--text-faint)", fontSize: 12 }}>No templates yet. Right-click a container → Save as template.</div>}
        {templates.map(t => (
          <Row key={t.id}>
            <BookMarked size={14} />
            <TextInput value={t.name || ""} onChange={(e) => rename(t.id, e.target.value)} />
            <button onClick={() => remove(t.id)} title="Delete template" style={{ background: "transparent", border: "none", color: "var(--danger)", cursor: "pointer" }}>
              <Trash2 size={14} />
            </button>
          </Row>
        ))}
      </Section>
    </TabShell>
  );
}
```

- [ ] **Step 3: Write `TrashTab.jsx`**

```jsx
// client/src/ui/commandCenter/TrashTab.jsx
import React, { useContext, useMemo } from "react";
import { TabShell, Section, Row } from "./ui";
import { GridActionsContext } from "../../GridActionsContext";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import { LayoutPanelLeft, Layers, Box, FileText, RotateCcw, Trash2 } from "lucide-react";

const ROLE_ORDER = ["panel", "container", "instance", "page"];
const ROLE_LABEL = { panel: "Panels", container: "Containers", instance: "Instances", page: "Pages" };
const ROLE_ICON  = { panel: LayoutPanelLeft, container: Layers, instance: Box, page: FileText };

export function TrashTab() {
  const { state, socket, dispatch } = useContext(GridActionsContext);
  const byRole = useMemo(() => {
    const out = { panel: [], container: [], instance: [], page: [] };
    for (const m of Object.values(state.modulesById || {})) {
      if (!m.trashed) continue;
      const r = m.role && out[m.role] ? m.role : "instance";
      out[r].push(m);
    }
    return out;
  }, [state.modulesById]);

  const restore = (id) => CommitHelpers.restoreModule({ socket, dispatch, id });
  const destroy = (id) => {
    if (!window.confirm("Permanently delete this module? This cannot be undone.")) return;
    CommitHelpers.deleteModule({ socket, dispatch, id });
  };

  const total = Object.values(byRole).reduce((a, b) => a + b.length, 0);

  return (
    <TabShell width="wide">
      {total === 0 && <div style={{ color: "var(--text-faint)", fontSize: 12 }}>Nothing in the trash.</div>}
      {ROLE_ORDER.map(role => byRole[role].length > 0 && (
        <Section key={role} title={ROLE_LABEL[role]}>
          {byRole[role].map(m => {
            const Icon = ROLE_ICON[role];
            return (
              <Row key={m.id}>
                <Icon size={14} />
                <span style={{ flex: 1, fontSize: 12 }}>{m.label || m.id}</span>
                <button onClick={() => restore(m.id)} title="Restore"><RotateCcw size={14} /></button>
                <button onClick={() => destroy(m.id)} title="Permanently delete" style={{ color: "var(--danger)" }}><Trash2 size={14} /></button>
              </Row>
            );
          })}
        </Section>
      ))}
    </TabShell>
  );
}
```

If `CommitHelpers.restoreModule`/`deleteModule` don't already exist, add them — they emit `restore_module` / `delete_module` (handlers already exist server-side per `server/CLAUDE.md`).

- [ ] **Step 4: Register the new tabs in `CommandCenter.jsx`**

```jsx
const TemplatesTab = lazy(() => import("./commandCenter/TemplatesTab").then(m => ({ default: m.TemplatesTab })));
const TrashTab     = lazy(() => import("./commandCenter/TrashTab").then(m => ({ default: m.TrashTab })));

// In TABS array replace the old `tree`/`files`/`components` slots. Final roster per spec:
const TABS = [
  { id: "grid",        label: "Grid",          icon: LayoutGrid },
  { id: "fields",      label: "Fields",        icon: Settings2 },
  { id: "operations",  label: "Operations",    icon: Workflow },
  { id: "filters",     label: "Filters",       icon: Filter },
  { id: "templates",   label: "Templates",     icon: BookMarked },
  { id: "appearance",  label: "Appearance",    icon: Palette },
  { id: "connections", label: "Connections",   icon: Link2 },
  { id: "trash",       label: "Trash",         icon: Trash2 },
  { id: "lists",       label: "Lists",         icon: List },
  { id: "settings",    label: "User Settings", icon: User },
  { id: "shortcuts",   label: "Shortcuts",     icon: Keyboard },
];
```

Add `&& <TemplatesTab />` and `&& <TrashTab />` in the conditional render block.

- [ ] **Step 5: Manual test**

1. Delete a container → reappears in Trash tab → Restore → it comes back.
2. Right-click a container → Save as template → appears in Templates tab → rename → persists after reload.

- [ ] **Step 6: Commit**

```
git add -A
git commit -m "feat(command-center): tab roster — add Templates + Trash, remove tree/files/components"
```

---

## Task B5: Rewrap `FieldsTab` with primitives

**Files:**
- Modify: `client/src/ui/commandCenter/FieldsTab.jsx`

**Context:** The spec calls out specifically: the name input stretches full viewport. Wrapping `FieldDetail` in `TabShell width="wide"` + `FormGrid` + `Field label="Name"` fixes it.

- [ ] **Step 1: Delete the local `inputStyle` / `labelStyle` constants**

- [ ] **Step 2: Wrap the outer tab in `TabShell width="wide"`**

```jsx
export function FieldsTab() {
  // existing state...
  return (
    <TabShell width="wide">
      {/* existing category-column content */}
    </TabShell>
  );
}
```

- [ ] **Step 3: Reshape `FieldDetail` to a labelled form**

```jsx
function FieldDetail({ field, onSave, onDelete, categoryFolders }) {
  // existing state...
  return (
    <TabShell width="wide">
      <Section title="Field">
        <FormGrid>
          <Field label="Name"><TextInput value={local.name} onChange={(e) => setLocal({ ...local, name: e.target.value })} /></Field>
          <Field label="Type">
            <SelectInput value={local.type} onChange={...}>
              {/* existing options */}
            </SelectInput>
          </Field>
          <Field label="Unit"><TextInput value={local.unit || ""} onChange={...} /></Field>
          {/* display/input toggles as Field rows */}
        </FormGrid>
      </Section>
      {/* Type-specific section: select options / module filter / rating max / etc. */}
      {/* Display config section (aggregation, targetValue, targetPeriod) */}
    </TabShell>
  );
}
```

- [ ] **Step 4: Manual test at multiple widths**

Resize to 320px, 1280px, 2560px. Name input must never exceed 480px (FormGrid cap minus label column).

- [ ] **Step 5: Commit**

```
git add client/src/ui/commandCenter/FieldsTab.jsx
git commit -m "ui(fields-tab): wrap in TabShell + FormGrid; caps name input width"
```

---

## Task B6: Redesign `ConditionGroup` → `ConditionEditor`

**Files:**
- Create: `client/src/blocks/ConditionEditor.jsx`
- Modify: `client/src/blocks/OperationsBuilder.jsx` and `client/src/ui/commandCenter/FiltersTab.jsx` (swap import)
- Delete: `client/src/blocks/ConditionGroup.jsx`

**Context:** Today `ConditionGroup` is a box with alternating background colors per depth, raw `<select>`/`<button>` elements, and a cramped layout. The rest of the Operations editor uses step cards with a left gutter, subtle dividers, and the primitives from B3. Match that.

- [ ] **Step 1: Write `ConditionEditor.jsx`**

```jsx
// client/src/blocks/ConditionEditor.jsx
import React from "react";
import { Row, SelectInput, Pill, TextInput } from "../ui/commandCenter/ui";
import PathPicker, { buildPathShape } from "./PathPicker";
import { Plus, X } from "lucide-react";

const COMPARATORS = [
  "IS", "IS_NOT", "GREATER", "LESS", "GREATER_OR_EQUAL", "LESS_OR_EQUAL",
  "CONTAINS", "NOT_CONTAINS", "IS_EMPTY", "IS_NOT_EMPTY",
  "HAS_ANCESTOR", "ARRAY_INCLUDES",
  "DATE_IS_TODAY", "DATE_BEFORE_TODAY", "DATE_AFTER_TODAY", "DATE_WITHIN_DAYS",
];

export default function ConditionEditor({ group, onChange, sources, fields, depth = 0 }) {
  const { operator = "AND", rules = [] } = group;
  const shape = buildPathShape({ sources, fields, inLoop: true });

  const setOperator = (op) => onChange({ ...group, operator: op });
  const setRule = (idx, next) => onChange({ ...group, rules: rules.map((r, i) => i === idx ? next : r) });
  const removeRule = (idx) => onChange({ ...group, rules: rules.filter((_, i) => i !== idx) });
  const addRule = () => onChange({ ...group, rules: [...rules, { left: "", comparator: "IS", right: "" }] });
  const addGroup = () => onChange({ ...group, rules: [...rules, { operator: "AND", rules: [] }] });

  return (
    <div style={{
      borderLeft: "2px solid var(--border-subtle)",
      paddingLeft: 10,
      marginLeft: depth === 0 ? 0 : 6,
    }}>
      <Row gap={4}>
        <Pill active={operator === "AND"} onClick={() => setOperator("AND")}>ALL</Pill>
        <Pill active={operator === "OR"}  onClick={() => setOperator("OR")}>ANY</Pill>
        <button onClick={addRule}   title="Add rule"  style={iconBtn}><Plus size={12} /> rule</button>
        <button onClick={addGroup}  title="Add group" style={iconBtn}><Plus size={12} /> group</button>
      </Row>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
        {rules.map((entry, i) => Array.isArray(entry.rules) ? (
          <div key={i} style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
            <ConditionEditor group={entry} onChange={(next) => setRule(i, next)} sources={sources} fields={fields} depth={depth + 1} />
            <button onClick={() => removeRule(i)} style={iconBtn} title="Remove group"><X size={12} /></button>
          </div>
        ) : (
          <RuleRow key={i} rule={entry} onChange={(next) => setRule(i, next)} onRemove={() => removeRule(i)} shape={shape} />
        ))}
      </div>
    </div>
  );
}

function RuleRow({ rule, onChange, onRemove, shape }) {
  const unary = rule.comparator === "IS_EMPTY" || rule.comparator === "IS_NOT_EMPTY"
             || rule.comparator === "DATE_IS_TODAY" || rule.comparator === "DATE_BEFORE_TODAY"
             || rule.comparator === "DATE_AFTER_TODAY";
  return (
    <Row gap={4}>
      <PathPicker value={rule.left} onChange={(next) => onChange({ ...rule, left: next })} shapeByVar={shape} />
      <SelectInput value={rule.comparator} onChange={(e) => onChange({ ...rule, comparator: e.target.value })} style={{ width: "auto" }}>
        {COMPARATORS.map(c => <option key={c} value={c}>{c.toLowerCase().replace(/_/g, " ")}</option>)}
      </SelectInput>
      {!unary && (
        <ValuePicker value={rule.right} onChange={(next) => onChange({ ...rule, right: next })} shapeByVar={shape} />
      )}
      <button onClick={onRemove} style={iconBtn} title="Remove rule"><X size={12} /></button>
    </Row>
  );
}
```

`ValuePicker` is the typed RHS picker introduced in **Task B6a** — it never accepts a raw dot-chain string; the user picks *literal* (with a type-appropriate input) / *variable* / *path* from a kind toggle and the picker renders the right sub-editor. Import it from the same folder:

```jsx
import ValuePicker from "./ValuePicker";

const iconBtn = {
  display: "inline-flex", alignItems: "center", gap: 2,
  padding: "2px 6px", borderRadius: 4, cursor: "pointer",
  background: "transparent", border: "1px solid var(--border-subtle)",
  color: "var(--text-muted)", fontSize: 11,
};
```

Key style decisions (matches the rest of the Operations editor):
- Left gutter bar (`borderLeft` on a 2px subtle border) instead of alternating backgrounds
- Pills (not `<select>`) for AND/OR toggle — friendlier and matches the pill-style used in trigger picker
- Icon + verb buttons ("+ rule" / "+ group" / "×") using the same `iconBtn` shape

- [ ] **Step 2: Swap imports**

In `OperationsBuilder.jsx`:
```diff
- import ConditionGroup from "./ConditionGroup";
+ import ConditionEditor from "./ConditionEditor";
```
Rename JSX usages (`<ConditionGroup>` → `<ConditionEditor>`).

Repeat in `FiltersTab.jsx`.

- [ ] **Step 3: Delete `ConditionGroup.jsx`**

```
rm client/src/blocks/ConditionGroup.jsx
```

- [ ] **Step 4: Manual test**

Open Operations tab → a loop-based op → click into its `IF` step → confirm the condition editor looks like the rest of the step list (single left rail, pill-style AND/OR, consistent input heights). Nested groups should still be legible.

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "ui(conditions): redesign condition editor to match operations step style"
```

---

## Task B6a: Typed inputs throughout the operations editor — kill the dot-chain

**Files:**
- Create: `client/src/blocks/ValuePicker.jsx`
- Create: `client/src/blocks/OccurrencePicker.jsx`
- Create: `client/src/blocks/FieldPicker.jsx`
- Create: `client/src/blocks/VariablePicker.jsx`
- Modify: `client/src/blocks/PathPicker.jsx` — enforce tree-only interaction, remove any free-text fallback
- Modify: `client/src/blocks/OperationsBuilder.jsx` — every `<input>` / `<TextInput>` that currently accepts a `$x.y.z` string gets replaced with a typed picker
- Modify: `client/src/blocks/ConditionEditor.jsx` — wire in `ValuePicker` (already imported in B6)

**Context:** Today the operations editor has free-text inputs scattered everywhere — source paths, variable refs, `SHOW_VALUE` targets, `ADD_TO_VAR` amounts, `SET_FIELD_VALUE` field refs, `IF` RHS — all of which let the user type raw strings like `$item.fields.date.value` or `$grid.activeFilterValues.scheduledDate`. This is:

- **Unreadable.** You can't tell what module or field that path refers to without running the op.
- **Un-refactorable.** Rename a field → every typed string breaks silently.
- **Error-prone.** One typo means the op silently no-ops (part of why "operations only run on load" *felt* true — some of them were never running at all).

The fix: **the user never types a path string.** Every reference — source, field, variable, occurrence, target — is picked from a typed component that shows human labels (module name, kind, container context, field name) and stores the structured reference in state.

### The picker taxonomy

| Picker | What it picks | Label format |
|---|---|---|
| `OccurrencePicker` | a single occurrence (or a source reference) | `{moduleName} · {kind} · in {parentContainerName}` |
| `FieldPicker` | a field on a module / occurrence | `{fieldName} ({fieldType})` |
| `VariablePicker` | a declared `$var` from the current pipeline scope | `$varName` with inferred-type badge |
| `PathPicker` (existing) | drill-down path (e.g. `$item → fields → amount → value`) — used *only* where the target is an arbitrary leaf | tree nodes, never a text fallback |
| `ValuePicker` | an RHS value: composite of *literal* \| *variable* \| *path* | kind toggle + inline sub-editor |

None of them accept free-text path strings. They all return structured `{ kind, ref }` objects that the executor reads directly — the executor no longer splits `"$x.y.z"` strings.

- [ ] **Step 1: Write `OccurrencePicker.jsx`**

```jsx
// client/src/blocks/OccurrencePicker.jsx
import React, { useMemo } from "react";
import { useSelector } from "react-redux";
import { SelectInput } from "../ui/commandCenter/ui";
import { selectOccurrenceLabels } from "../state/selectors";

export default function OccurrencePicker({ value, onChange, filter = () => true }) {
  const labels = useSelector(selectOccurrenceLabels);   // precomputed in selectors.js
  const options = useMemo(() => labels.filter(filter), [labels, filter]);
  return (
    <SelectInput value={value || ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— pick an occurrence —</option>
      {options.map(o => (
        <option key={o.id} value={o.id} title={o.tooltip}>
          {o.moduleName} · {o.kind}{o.parentName ? ` · in ${o.parentName}` : ""}
        </option>
      ))}
    </SelectInput>
  );
}
```

Add the selector in `client/src/state/selectors.js`:

```js
export const selectOccurrenceLabels = (state) => {
  const { occurrencesById, modulesById } = state;
  return Object.values(occurrencesById).map(occ => {
    const mod = modulesById[occ.targetId];
    const parent = occurrencesById[occ.parentId];
    const parentMod = parent ? modulesById[parent.targetId] : null;
    return {
      id: occ.id,
      moduleName: mod?.name ?? "(unnamed)",
      kind: mod?.kind ?? mod?.role ?? "—",
      parentName: parentMod?.name ?? null,
      tooltip: mod?.fileRef || mod?.description || "",
    };
  });
};
```

- [ ] **Step 2: Write `FieldPicker.jsx`**

```jsx
// client/src/blocks/FieldPicker.jsx
import React from "react";
import { useSelector } from "react-redux";
import { SelectInput } from "../ui/commandCenter/ui";

export default function FieldPicker({ value, onChange, filterType }) {
  const fields = useSelector(s => Object.values(s.fieldsById || {}));
  const options = filterType ? fields.filter(f => f.type === filterType) : fields;
  return (
    <SelectInput value={value || ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— pick a field —</option>
      {options.map(f => (
        <option key={f.id} value={f.id}>{f.name} ({f.type})</option>
      ))}
    </SelectInput>
  );
}
```

- [ ] **Step 3: Write `VariablePicker.jsx`**

```jsx
// client/src/blocks/VariablePicker.jsx
import React from "react";
import { SelectInput } from "../ui/commandCenter/ui";

export default function VariablePicker({ value, onChange, variables }) {
  // variables = [{ name, inferredType }] — computed by walking prior steps in OperationsBuilder
  return (
    <SelectInput value={value || ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— pick a variable —</option>
      {variables.map(v => (
        <option key={v.name} value={v.name}>${v.name}{v.inferredType ? ` : ${v.inferredType}` : ""}</option>
      ))}
    </SelectInput>
  );
}
```

- [ ] **Step 4: Write `ValuePicker.jsx` (the composite RHS)**

```jsx
// client/src/blocks/ValuePicker.jsx
import React from "react";
import { Row, Pill, TextInput, NumberInput } from "../ui/commandCenter/ui";
import PathPicker from "./PathPicker";
import VariablePicker from "./VariablePicker";

// value shape: { kind: "literal" | "variable" | "path", ref: <kind-specific> }
export default function ValuePicker({ value, onChange, shapeByVar, variables = [], literalType = "text" }) {
  const v = value ?? { kind: "literal", ref: "" };
  const setKind = (kind) => onChange({ kind, ref: kind === "literal" ? "" : null });

  return (
    <Row gap={4}>
      <Pill active={v.kind === "literal"}  onClick={() => setKind("literal")}>literal</Pill>
      <Pill active={v.kind === "variable"} onClick={() => setKind("variable")}>variable</Pill>
      <Pill active={v.kind === "path"}     onClick={() => setKind("path")}>path</Pill>
      {v.kind === "literal" && literalType === "number" && (
        <NumberInput value={v.ref ?? ""} onChange={(e) => onChange({ kind: "literal", ref: Number(e.target.value) })} />
      )}
      {v.kind === "literal" && literalType !== "number" && (
        <TextInput value={v.ref ?? ""} onChange={(e) => onChange({ kind: "literal", ref: e.target.value })} />
      )}
      {v.kind === "variable" && (
        <VariablePicker value={v.ref} onChange={(ref) => onChange({ kind: "variable", ref })} variables={variables} />
      )}
      {v.kind === "path" && (
        <PathPicker value={v.ref} onChange={(ref) => onChange({ kind: "path", ref })} shapeByVar={shapeByVar} />
      )}
    </Row>
  );
}
```

- [ ] **Step 5: Harden `PathPicker` — tree-only, no free text**

Audit `client/src/blocks/PathPicker.jsx`. If it exposes any `<input type="text">` or "manual" fallback that lets the user type a path, delete it. The picker should render one `<select>` (or dropdown) per segment; drilling into a segment reveals the next one. The stored value is the structured array, not a joined string.

- [ ] **Step 6: Sweep `OperationsBuilder.jsx` — replace every freeform path/field/occurrence input**

Walk the step renderers. For each step type, identify every string input that today accepts an identifier and replace it with the right picker:

| Step type | Field | Today | Replace with |
|---|---|---|---|
| `INIT_VAR` | `name` | text | keep `TextInput` (variable *declaration*) |
| `INIT_VAR` | `value` | text | `<ValuePicker>` |
| `LOOP` | `source` | text | `<OccurrencePicker filter={isSourceLike}>` |
| `LOOP` | `itemVar` | text | keep `TextInput` (declaration) |
| `IF` | rules | text | already `ConditionEditor` (handled in B6) |
| `SET_FIELD_VALUE` | `target.occurrence` | text | `<OccurrencePicker>` |
| `SET_FIELD_VALUE` | `target.field` | text | `<FieldPicker>` |
| `SET_FIELD_VALUE` | `value` | text | `<ValuePicker>` |
| `ADD_TO_VAR` | `var` | text | `<VariablePicker>` |
| `ADD_TO_VAR` | `amount` | text | `<ValuePicker literalType="number">` |
| `SHOW_VALUE` | `var` | text | `<VariablePicker>` |
| `SHOW_VALUE` | `targetOccurrence` | text | `<OccurrencePicker>` (defaults to op's `targetOccurrenceId`) |
| `SHOW_VALUE` | `targetField` | text | `<FieldPicker>` |

After this pass, grep to confirm there are no remaining text inputs named `path`, `source`, `target`, `field`, or `var` that accept freeform strings:

```
rg -n 'TextInput|<input' client/src/blocks/OperationsBuilder.jsx | rg -v 'label|name|itemVar'
```

The only remaining string inputs should be **declarations** (`name`, `itemVar`, op `name`, `description`) — never references.

- [ ] **Step 7: Update the executor to read structured refs, not paths**

The executor likely has a `resolvePath(value, scope)` that splits `"$x.y.z"` strings. Update it to branch on the structured shape:

```js
function resolveValue(v, scope) {
  if (v == null) return undefined;
  if (v.kind === "literal")  return v.ref;
  if (v.kind === "variable") return scope.vars[v.ref];
  if (v.kind === "path")     return walkStructuredPath(v.ref, scope);
  // legacy fallback for old ops saved before this migration
  if (typeof v === "string" && v.startsWith("$")) return walkDottedString(v, scope);
  return v;
}
```

Keep the legacy string branch behind a warning log — it's for old saved ops until the migration in Step 8 runs. Remove it once no warnings fire in the wild.

- [ ] **Step 8: Write a one-shot migration for existing saved ops**

```
server/scripts/migrateOperationsToStructuredRefs.js
```

Walks every `Operation` document, converts any string path (`"$x.y.z"`) in pipeline steps into the structured equivalent. Idempotent — safe to re-run. Run it once against the local DB:

```
node server/scripts/migrateOperationsToStructuredRefs.js
```

- [ ] **Step 9: Manual test**

1. Open the Water Today op in the editor. Every field should show readable labels — "Water entries · list · in Schedule", "amount (number)", "$sum : number". No `$item.fields.date.value` anywhere.
2. Create a new op from scratch. Try to leave a picker empty and save → it's flagged (each picker contributes to a validation list the builder already surfaces).
3. Rename a field in FieldsTab. Re-open the op — the picker still shows the current name (it reads from store, not a frozen string).

- [ ] **Step 10: Commit**

```
git add -A
git commit -m "ui(ops): typed pickers everywhere — no more dot-path strings in the editor"
```

---

## Task B7: Rewrap `OperationsTab` and `FiltersTab`

**Files:**
- Modify: `client/src/ui/commandCenter/OperationsTab.jsx`
- Modify: `client/src/ui/commandCenter/FiltersTab.jsx`

- [ ] **Step 1: OperationsTab — outer wrap**

Wrap the whole return in `<TabShell width="wide">`. Delete the local `inputStyle` / `labelStyle` / section-chrome constants. Replace inline form sections with `<Section>` + `<FormGrid>` + `<Field>`. Priority input, name, trigger-types, sources, steps, category picker — each a `<Field>` row.

- [ ] **Step 2: FiltersTab — outer wrap**

Same pattern. Named filter list rows use `<Row>` with `<Pill>` for active toggle. Filter editor (when expanded) uses `<Section title="Conditions">` + the new `ConditionEditor`.

- [ ] **Step 3: Manual test**

Resize the window to 2560px. Confirm content stays centered with the wide 960px cap on both tabs.

- [ ] **Step 4: Commit**

```
git add client/src/ui/commandCenter/OperationsTab.jsx client/src/ui/commandCenter/FiltersTab.jsx
git commit -m "ui(ops/filters): wrap in TabShell + primitives"
```

---

## Task B8: Rewrap remaining tabs

**Files:**
- Modify: `GridSettingsTab.jsx`, `AppearanceTab.jsx`, `UserSettingsTab.jsx`, `ConnectionsTab.jsx`, `ListsTab.jsx`

- [ ] **Step 1: Apply TabShell + primitives to each**

For each, delete the local `inputStyle`/`labelStyle` constants, wrap in `<TabShell width="narrow">`, reshape forms into `<FormGrid>` + `<Field>` rows. Copy the pattern from `FieldsTab`.

- [ ] **Step 2: Manual regression**

Quick smoke of each tab — edits still persist, no layout blowups.

- [ ] **Step 3: Commit**

```
git add -A
git commit -m "ui(command-center): rewrap narrow tabs in TabShell"
```

---

# TRACK C — Shortcuts (editable)

## Task C1: Server model + defaults

**Files:**
- Create: `server/models/Shortcut.js`
- Create: `server/utils/ensureDefaultShortcuts.js`
- Modify: `server/utils/createDefaultUserData.js` (call the seeder for new users)
- Modify: `server/server.js` (call `ensureDefaultShortcuts(userId)` on login/connect)
- Modify: `server/socketHandlers/state.js` (include `shortcutsById` in `full_state`)

- [ ] **Step 1: Write the model**

```js
// server/models/Shortcut.js
import mongoose from "mongoose";
const ShortcutSchema = new mongoose.Schema({
  id: { type: String, required: true, index: true, unique: true },
  userId:   { type: String, required: true, index: true },
  actionId: { type: String, required: true },
  binding:  { type: String, required: true },
  enabled:  { type: Boolean, default: true },
}, { timestamps: true });
ShortcutSchema.index({ userId: 1, actionId: 1 }, { unique: true });
export default mongoose.model("Shortcut", ShortcutSchema);
```

- [ ] **Step 2: Write the default-seed helper**

```js
// server/utils/ensureDefaultShortcuts.js
import Shortcut from "../models/Shortcut.js";
import { randomUUID } from "crypto";

export const DEFAULT_SHORTCUTS = [
  { actionId: "undo",               binding: "Ctrl+Z" },
  { actionId: "redo",               binding: "Ctrl+Y" },
  { actionId: "redoAlt",            binding: "Ctrl+Shift+Z" },
  { actionId: "openCommandCenter",  binding: "Ctrl+." },
  { actionId: "closeAll",           binding: "Escape" },
  { actionId: "prevFilter",         binding: "Ctrl+[" },
  { actionId: "nextFilter",         binding: "Ctrl+]" },
  { actionId: "togglePomodoro",     binding: "Ctrl+Shift+P" },
  { actionId: "zoomOutGrid",        binding: "Ctrl+Shift+M" },
  { actionId: "focusSearch",        binding: "Ctrl+K" },
];

export async function ensureDefaultShortcuts(userId) {
  const existing = await Shortcut.find({ userId }).lean();
  const have = new Set(existing.map(s => s.actionId));
  const missing = DEFAULT_SHORTCUTS.filter(d => !have.has(d.actionId));
  if (!missing.length) return;
  await Shortcut.insertMany(missing.map(d => ({ id: randomUUID(), userId, ...d, enabled: true })));
}
```

- [ ] **Step 3: Call it on connect**

In `server/server.js` after `loadUserIntoCache(userId)` resolves, call `await ensureDefaultShortcuts(userId)` and include the result in the user cache.

- [ ] **Step 4: Include shortcuts in `full_state`**

In `full_state` assembly:

```js
const shortcutsRaw = await Shortcut.find({ userId }).lean();
const shortcutsById = Object.fromEntries(shortcutsRaw.map(s => [s.actionId, s]));
// add to payload:
full_state = { ...full_state, shortcutsById };
```

- [ ] **Step 5: Commit**

```
git add server/models/Shortcut.js server/utils/ensureDefaultShortcuts.js server/server.js server/socketHandlers/state.js server/utils/createDefaultUserData.js
git commit -m "feat(shortcuts): server model + default seed + full_state payload"
```

---

## Task C2: Socket handlers `update_shortcut` / `reset_shortcut`

**Files:**
- Create: `server/socketHandlers/shortcuts.js`
- Modify: `server/server.js` (register)

- [ ] **Step 1: Write the handlers**

```js
// server/socketHandlers/shortcuts.js
import Shortcut from "../models/Shortcut.js";
import { DEFAULT_SHORTCUTS } from "../utils/ensureDefaultShortcuts.js";

export function registerShortcutHandlers(io, socket) {
  socket.on("update_shortcut", async ({ actionId, binding, enabled }) => {
    const userId = socket.userId;
    await Shortcut.findOneAndUpdate(
      { userId, actionId },
      { $set: { binding, enabled: enabled !== false } },
      { upsert: true }
    );
    const s = await Shortcut.findOne({ userId, actionId }).lean();
    io.to(`user:${userId}`).emit("shortcut_updated", { shortcut: s });
  });

  socket.on("reset_shortcut", async ({ actionId }) => {
    const userId = socket.userId;
    const def = DEFAULT_SHORTCUTS.find(d => d.actionId === actionId);
    if (!def) return;
    await Shortcut.findOneAndUpdate(
      { userId, actionId },
      { $set: { binding: def.binding, enabled: true } },
      { upsert: true }
    );
    const s = await Shortcut.findOne({ userId, actionId }).lean();
    io.to(`user:${userId}`).emit("shortcut_updated", { shortcut: s });
  });
}
```

- [ ] **Step 2: Register in `server.js`**

```js
import { registerShortcutHandlers } from "./socketHandlers/shortcuts.js";
// inside io.on("connection"):
registerShortcutHandlers(io, socket);
```

- [ ] **Step 3: Commit**

```
git add server/socketHandlers/shortcuts.js server/server.js
git commit -m "feat(shortcuts): update_shortcut / reset_shortcut socket handlers"
```

---

## Task C3: Client state + `useShortcut` hook

**Files:**
- Modify: `client/src/state/masterReducer.js` (add `shortcut_updated` case + initial state)
- Modify: `client/src/helpers/CommitHelpers.js` (add `updateShortcut`, `resetShortcut`)
- Create: `client/src/hooks/useShortcut.js`
- Create: `client/src/__tests__/useShortcut.test.js`

- [ ] **Step 1: Test-first — binding matcher**

```js
// client/src/__tests__/useShortcut.test.js
import { describe, it, expect } from "vitest";
import { matchesBinding, serializeEvent } from "../hooks/useShortcut";

describe("matchesBinding", () => {
  it("matches Ctrl+Shift+Z against a keyboard event", () => {
    const e = { ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, key: "z" };
    expect(matchesBinding("Ctrl+Shift+Z", e)).toBe(true);
  });
  it("rejects plain z against Ctrl+Z", () => {
    expect(matchesBinding("Ctrl+Z", { ctrlKey: false, key: "z" })).toBe(false);
  });
  it("matches Escape", () => {
    expect(matchesBinding("Escape", { key: "Escape" })).toBe(true);
  });
});

describe("serializeEvent", () => {
  it("produces Ctrl+Shift+K", () => {
    expect(serializeEvent({ ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, key: "k" })).toBe("Ctrl+Shift+K");
  });
});
```

- [ ] **Step 2: Implement the hook**

```js
// client/src/hooks/useShortcut.js
import { useEffect, useContext } from "react";
import { GridLiveContext } from "../GridLiveContext";

export function serializeEvent(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  const key = e.key;
  if (key === " ") parts.push("Space");
  else if (key.length === 1) parts.push(key.toUpperCase());
  else parts.push(key);                 // "Escape", "Enter", "ArrowLeft"…
  return parts.join("+");
}

export function matchesBinding(binding, e) {
  return serializeEvent(e).toLowerCase() === binding.toLowerCase();
}

export function useShortcut(actionId, handler, deps = [], { allowInFields = false } = {}) {
  const { shortcutsById } = useContext(GridLiveContext) || {};
  const binding = shortcutsById?.[actionId]?.binding;
  const enabled = shortcutsById?.[actionId]?.enabled !== false;

  useEffect(() => {
    if (!binding || !enabled) return;
    const onKey = (e) => {
      if (!allowInFields) {
        const t = e.target;
        const tag = t?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      }
      if (matchesBinding(binding, e)) handler(e);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binding, enabled, allowInFields, ...deps]);
}
```

- [ ] **Step 3: Masterreducer — handle `shortcut_updated`**

```js
// in masterReducer initial state:
shortcutsById: {},

// add case:
case "SHORTCUT_UPDATED":
  return { ...state, shortcutsById: { ...state.shortcutsById, [action.shortcut.actionId]: action.shortcut } };

// on full_state:
case "FULL_STATE":
  return { ...state, ..., shortcutsById: action.payload.shortcutsById || {} };
```

In `bindSocketToStore.js` add `socket.on("shortcut_updated", ({ shortcut }) => dispatch({ type: "SHORTCUT_UPDATED", shortcut }))`.

Expose `shortcutsById` through `GridLiveContext` (so `useShortcut` consumers don't re-bind on unrelated state changes).

- [ ] **Step 4: CommitHelpers**

```js
export function updateShortcut({ socket, actionId, binding, enabled = true }) {
  socket.emit("update_shortcut", { actionId, binding, enabled });
}
export function resetShortcut({ socket, actionId }) {
  socket.emit("reset_shortcut", { actionId });
}
```

- [ ] **Step 5: Run tests — green**

- [ ] **Step 6: Commit**

```
git add -A
git commit -m "feat(shortcuts): useShortcut hook + reducer + commit helpers"
```

---

## Task C4: Migrate inline keydown handlers

**Files:**
- Modify: `client/src/App.jsx` (undo/redo/redoAlt/closeAll)
- Modify: `client/src/Toolbar.jsx` (prevFilter/nextFilter/openCommandCenter)

- [ ] **Step 1: In `App.jsx`, remove inline `useEffect` listeners for Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z / Escape**

Replace with:

```jsx
useShortcut("undo", (e) => { e.preventDefault(); undo(); }, [undo]);
useShortcut("redo", (e) => { e.preventDefault(); redo(); }, [redo]);
useShortcut("redoAlt", (e) => { e.preventDefault(); redo(); }, [redo]);
useShortcut("closeAll", () => {
  if (historyOpen) setHistoryOpen(false);
  else if (commandCenterOpen) setCommandCenterOpen(false);
});
```

Leave `RadialMenu.jsx` / `QuickAddMenu.jsx` inline Escape handlers alone — those are component-local dismiss logic, not global actions (matches the spec's non-goal note).

- [ ] **Step 2: In `Toolbar.jsx`, migrate `Ctrl+[` / `Ctrl+]` and CC toggle**

```jsx
useShortcut("prevFilter", () => onSelectFilter(prevFilterId()), [grid.activeFilterId, grid.namedFilters]);
useShortcut("nextFilter", () => onSelectFilter(nextFilterId()), [grid.activeFilterId, grid.namedFilters]);
useShortcut("openCommandCenter", onToggleCommandCenter, [onToggleCommandCenter]);
```

- [ ] **Step 3: Manual verification**

All rebindable shortcuts still work at their defaults.

- [ ] **Step 4: Commit**

```
git add client/src/App.jsx client/src/Toolbar.jsx
git commit -m "refactor(shortcuts): inline keydowns → useShortcut"
```

---

## Task C5: Rewrite `ShortcutsTab`

**Files:**
- Modify: `client/src/ui/commandCenter/ShortcutsTab.jsx`

- [ ] **Step 1: Replace the static doc list with an editable list**

```jsx
// client/src/ui/commandCenter/ShortcutsTab.jsx
import React, { useContext, useState } from "react";
import { TabShell, Section, Row } from "./ui";
import { GridLiveContext } from "../../GridLiveContext";
import { GridActionsContext } from "../../GridActionsContext";
import { updateShortcut, resetShortcut } from "../../helpers/CommitHelpers";
import { serializeEvent } from "../../hooks/useShortcut";
import { RotateCcw } from "lucide-react";

const LABELS = {
  undo: "Undo", redo: "Redo", redoAlt: "Redo (alt)",
  openCommandCenter: "Open Command Center", closeAll: "Close / dismiss",
  prevFilter: "Previous filter", nextFilter: "Next filter",
  togglePomodoro: "Toggle Pomodoro", zoomOutGrid: "Zoom out grid",
  focusSearch: "Focus search",
};

export function ShortcutsTab() {
  const { shortcutsById } = useContext(GridLiveContext);
  const { socket } = useContext(GridActionsContext);
  const [capturing, setCapturing] = useState(null);
  const [conflict, setConflict] = useState(null);

  const rows = Object.values(shortcutsById || {}).sort((a, b) => (LABELS[a.actionId] || a.actionId).localeCompare(LABELS[b.actionId] || b.actionId));

  const onKeyDownCapture = (e, actionId) => {
    e.preventDefault();
    e.stopPropagation();
    const next = serializeEvent(e);
    if (next === "Escape") { setCapturing(null); return; }
    const conflictRow = rows.find(r => r.actionId !== actionId && r.binding === next);
    if (conflictRow) { setConflict({ actionId, binding: next, conflictWith: conflictRow }); return; }
    updateShortcut({ socket, actionId, binding: next });
    setCapturing(null);
  };

  return (
    <TabShell width="narrow">
      <Section title="Rebindable shortcuts">
        {rows.map(s => (
          <Row key={s.actionId}>
            <span style={{ flex: 1, fontSize: 12 }}>{LABELS[s.actionId] || s.actionId}</span>
            <button
              onClick={() => setCapturing(s.actionId)}
              onKeyDown={capturing === s.actionId ? (e) => onKeyDownCapture(e, s.actionId) : undefined}
              autoFocus={capturing === s.actionId}
              style={{
                padding: "2px 8px", borderRadius: 4, fontSize: 11,
                background: capturing === s.actionId ? "var(--accent-blue-bg)" : "var(--input-bg)",
                border: "1px solid var(--border-default)", fontFamily: "var(--font-mono)",
              }}
            >
              {capturing === s.actionId ? "press keys…" : s.binding}
            </button>
            <button onClick={() => resetShortcut({ socket, actionId: s.actionId })} title="Reset to default" style={{ background: "transparent", border: "none", cursor: "pointer" }}>
              <RotateCcw size={12} />
            </button>
          </Row>
        ))}
        {conflict && (
          <div style={{ marginTop: 8, padding: 8, background: "var(--danger-bg)", border: "1px solid var(--danger-border)", color: "var(--danger-text)", fontSize: 11, borderRadius: 4 }}>
            {conflict.binding} is already bound to {LABELS[conflict.conflictWith.actionId]}.{" "}
            <button onClick={() => {
              resetShortcut({ socket, actionId: conflict.conflictWith.actionId });
              updateShortcut({ socket, actionId: conflict.actionId, binding: conflict.binding });
              setConflict(null); setCapturing(null);
            }}>Swap</button>{" "}
            <button onClick={() => { setConflict(null); setCapturing(null); }}>Cancel</button>
          </div>
        )}
      </Section>

      <Section title="Built-in (not rebindable)">
        <ul style={{ fontSize: 11, color: "var(--text-muted)", paddingLeft: 16, lineHeight: 1.6 }}>
          <li>Drag: handle → grab + drop into panel / container / tree</li>
          <li>Editor: Bold/Italic/Code via TipTap shortcuts (Ctrl+B / Ctrl+I / Ctrl+E)</li>
          <li>Editor: Headings via Markdown shortcuts (`# `, `## `)</li>
          <li>@ in doc to insert a field pill</li>
        </ul>
      </Section>
    </TabShell>
  );
}
```

- [ ] **Step 2: Manual test**

Rebind Undo to `Ctrl+Shift+U`. Confirm Undo works on the new binding and `Ctrl+Z` no longer triggers Undo. Reset — confirm default restored. Rebind one shortcut to a binding already in use — confirm the Swap prompt appears and works.

- [ ] **Step 3: Commit**

```
git add client/src/ui/commandCenter/ShortcutsTab.jsx
git commit -m "feat(shortcuts): editable shortcut rows with conflict detection"
```

---

## Task D1: Update CLAUDE.md files

**Files:**
- Modify: `client/src/CLAUDE.md`, `client/src/ui/CLAUDE.md`, `client/src/helpers/CLAUDE.md`, `client/src/state/CLAUDE.md`, `server/CLAUDE.md`, `client/src/blocks/CLAUDE.md`

- [ ] **Step 1: Record deletions and additions at the top "Recent Changes" block**

Each file's new block should note (as applicable):

- Deleted `EntityTreeTab`, `FilesTab`, `ComponentsTab`, `ConditionGroup`, `IterationNav`, `IterationSettings`, `LocalIterationNav`, `IterationHelpers`.
- Added `commandCenter/ui.jsx` primitives; `TemplatesTab.jsx`, `TrashTab.jsx`, `ConditionEditor.jsx`.
- Operations trigger dispatch fix (`onFilterChange` now mapped to `NavigationOp`).
- Filter cascade selector `getEffectiveFilterForOccurrence`.
- `useShortcut` hook + `Shortcut` model + `shortcutsById` in full_state.

- [ ] **Step 2: Commit**

```
git add **/CLAUDE.md
git commit -m "docs: update CLAUDE.md for cc-rework + ops/filter fixes"
```

---

## Task D2: Verification pass

- [ ] **Step 1: Run all tests**

```
npm --prefix ./client run test
npm --prefix ./server run test
```

Both green.

- [ ] **Step 2: `npm run dev` — manual smoke**

Walk the checklist in the spec's "Testing plan > Manual" plus the operations/filter flows:

1. CC open/close animation is smooth at 60fps.
2. Field name input does not exceed 480px at any viewport width.
3. Trash + Templates tabs work end-to-end.
4. Rebind Undo; confirm new keys trigger and old keys don't.
5. Change the toolbar date — Water Today goal updates to reflect entries from that date.
6. Lock a container to a specific date — confirm its children show that date regardless of grid filter.
7. Unlock a container (filterOverride = {}) — confirm all its descendants show regardless of date.
8. Edit a water entry; confirm Water Today recomputes immediately (not just on reload).

- [ ] **Step 3: Commit only if the smoke reveals a fix**

No cleanup-for-cleanup commits.

---

## Rollout notes

- Single branch, no feature flag. The changes are user-visible in the CC UI and in filter behavior; both improve the current broken state rather than regress it.
- If any one of Tasks A1, A4, A5, A6 lands without the others, filtering or operations will look half-working — keep A1–A6 as an atomic merge group. Track B and C tasks can ship incrementally under the same branch.
- **B6a (typed pickers) is atomic with its migration script.** Landing the editor changes without running `migrateOperationsToStructuredRefs.js` means existing ops render as empty pickers (the executor keeps the legacy string fallback, but the editor can't round-trip them). Run the migration in the same deploy.
- After merge, delete `docs/superpowers/plans/2026-04-16-operations-overhaul.md` is **not** required — it stays as historical context.

## Open follow-ups (explicitly out of scope here)

- Auto-purge trashed modules after N days.
- Splitting `OperationsTab` / `FieldsTab` into sub-files per concern.
- Full shortcut refactor (every keydown through the registry).
- Tab drag-reorder / user-pinned tabs.
- Global search (the `focusSearch` shortcut is seeded but has no consumer yet).
