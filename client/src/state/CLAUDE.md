# client/src/state — State CLAUDE.md

_Updated: 2026-03-16. Check this file before re-reading source._

## Recent Changes (Mar 16 2026 — History/Toast/Delta)
- **bindSocketToStore.js**: Removed `addNotification` import + all `addNotification` calls. Removed bell/notification system entirely.
- **bindSocketToStore.js**: `onTransactionCreated` now fires a `toast()` per transaction type: MeasureOp → "FieldName: prev → next", OccurrenceListOp → "Moved: label", EntityOp → "Updated: label", DocEditOp → "Doc edited". Duration 2500ms.
- **notificationsStore.js**: DELETED — no longer needed.
- **onSyncState**: Simplified — just calls `socket.emit("request_full_state")`, no notification calls.

## Recent Changes (Mar 14 2026 — Cleanup Sprint)
- **masterReducer.js**: Removed `docs = []` and `artifacts = []` from FULL_STATE destructuring — these were always-empty zombie arrays.
- **GridActionsContext.js**: Removed `docsById` and `artifactsById` from context defaults.
- **selectors.js**: No changes (already clean).

## Recent Changes (Mar 14 2026 — Role/Kind Architecture Refactor)
- **selectors.js**: Added `computeRoleByModuleId(grid, occurrencesById, modulesById)` — traverses occurrence hierarchy to build `{ [moduleId]: "panel"|"container"|"instance" }` map. Falls back to `module.role` for unplaced modules.
- **selectors.js**: Updated `createLookupsFromState` — now populates `panelsById`/`containersById`/`instancesById` from hierarchy traversal first, then falls back to `module.role`. More accurate for modules that lack role.
- **selectors.js**: Updated `autofillOccurrence.fillFromModule` — uses `lookups.panelsById` etc. as canonical role source before `mod.role`.
- **App.jsx**: Added `roleByModuleId` useMemo (calls `computeRoleByModuleId`). Passed in `actionsValue` and dependency array.
- **GridActionsContext.js**: Added `roleByModuleId: Object.create(null)` to context defaults.

## Key Files

| File | Purpose | Last Changed |
|------|---------|--------------|
| `actions.js` | Action type constants. All action names as string constants. | Recent |
| `masterReducer.js` | Main Redux-style reducer. Handles all entity maps: grids, panels, containers, instances, occurrences, fields, manifests, views, docs, folders, artifacts, operations. | Recent |
| `initialState.js` | Initial state shape. All entity maps start empty `{}`. | Stable |
| `bindSocketToStore.js` | Maps incoming socket events to dispatch calls. Pattern: socket.on("X_created", data => dispatch(createXAction(data))). | Recent |
| `selectors.js` | Occurrence resolution helpers. resolveEffectiveIteration, occurrenceMatchesIteration. | Stable |

## State Shape (top level)
```js
{
  userId, grid,
  panelsById, containersById, instancesById,
  occurrencesById, fieldsById,
  manifestsById, viewsById, docsById, foldersById, artifactsById,
  operationsById,
  transactions: [],
}
```

## Patterns
- All entity maps are `{ [id]: entity }` — flat lookups, no nesting
- Actions follow: `CREATE_X`, `UPDATE_X`, `DELETE_X` pattern
- `UPDATE_CONTAINER_OCCURRENCES` (not UPDATE_CONTAINER_ITEMS — renamed)
- bindSocketToStore is the only place that connects socket events to state

## Recent Changes (Mar 13 2026 — NavigationOp Fires on Filter Date Change)
- **bindSocketToStore.js**: In `onGridUpdated`, replaced old `isIterationChange` block (checked `currentIterationValue`/`selectedIterationId` etc.) with new check: if `patch.activeFilterValues !== undefined`, fire `fireOperations("NavigationOp", { type: "NavigationOp", activeFilterValues: patch.activeFilterValues, date: <extracted ISO date> })`. This makes `onNavigation` operations (including `navigate_day_page`) fire automatically when the user navigates dates in the filter toolbar.

## Recent Changes (Mar 14 2026 — selectors.js Dead Code Cleanup + useOccurrenceData.js Deleted)
- **selectors.js**: Removed all dead functions: `getOccurrencesForGrid`, `autofillGrid`, `autofillPanel`, `autofillContainer`, `getPanelById`, `getContainerById`, `getInstanceById`, `getOccurrenceById`, `getPanelContainers` (selectors version), `getContainerInstances`, `getFieldById`, `getFieldsForInstance`, `getFieldsInScope`, `getFieldValueFromOccurrence`, `getOccurrencesForInstance`, `CalcHelpers` re-export.
- **hooks/useOccurrenceData.js**: DELETED — dead hook, nothing imported it.
- **selectors.js live exports** (only 6 remain): `createLookupsFromState`, `autofillOccurrence`, `getGridPanels`, `calculateDerivedField`, `resolveEffectiveFilters`, `isOccurrenceVisible`.

## Recent Changes (Mar 13 2026 — Filter System Selectors)
- **selectors.js**: Added `resolveEffectiveFilters(occurrence, parentFilterValues)` — computes effective filter values with override chain (`filterOverride: null` = inherit, `{}` = clear, `{fieldId: val}` = own).
- **selectors.js**: Added `isOccurrenceVisible(occurrence, effectiveFilters)` — visibility check: `occurrence.hidden` = false, no field value = persistent (pass), date values compared by same-day (getFullYear/Month/Date), string values by strict equality, arrays by inclusion.

## Recent Changes (Mar 2026 — Local Occurrence Cache for Race Fix)
- **bindSocketToStore.js**: Added `localOccsById` map (plain object). Populated from `payload.occurrences` in `onFullState` (clears and rebuilds). Updated synchronously in `onOccurrenceCreated`, `onOccurrenceUpdated`, `onOccurrenceDeleted` BEFORE `socketDispatch`. `fireOperations` now builds `occurrencesById` from `state.occurrences` (base) then overlays `localOccsById` (`Object.assign`). Fixes race condition where `transaction_created` fires before React re-renders `stateRef.current` — operations now always see the latest occurrence values.

## Recent Changes (Mar 2026 — Server Error Toast)
- **bindSocketToStore.js**: Added `import { toast } from "sonner"`. `onServerError` now calls `toast.error(msg, { duration: 4000 })` for non-grid-not-found errors. Users see toast notifications when socket handler errors occur.

## Recent Changes (Mar 2026 — New Transaction Types)
- **bindSocketToStore.js**: `onOccurrenceCreated` now fires `runMatchingOperations("OccurrenceCreateOp", { occurrenceId, instanceId, containerId, panelId })` after dispatch.
- **bindSocketToStore.js**: `onOccurrenceDeleted` now fires `runMatchingOperations("OccurrenceDeleteOp", { occurrenceId, instanceId, containerId })` after dispatch.
- **bindSocketToStore.js**: `onModuleUpdated` now fires `runMatchingOperations("ModuleOp", { moduleId, moduleRole, label, kind })` after dispatch.

## Recent Changes (Mar 2026 — previous)
- **bindSocketToStore.js**: `applyOperationEffect` now calls CommitHelpers functions instead of duplicating socket/dispatch logic. Imports: `setOccurrenceFieldValue`, `moveOccurrence`, `createOccurrenceInContainer`, `deleteOccurrence`, `updateModule`, `deleteModule`.

## Recent Changes (Feb 21-22)
- operationsById added to state and reducer
- bindSocketToStore: operation_created/updated/deleted events wired
- `computedValues: {}` added to state (client-only, key = fieldId or "fieldId:occId")
- `SET_COMPUTED_VALUES` action added (batch update by operationExecutor)
- bindSocketToStore: `transaction_created` → fires runMatchingOperations → dispatches SET_COMPUTED_VALUES
- bindSocketToStore: `full_state` → also fires onLoad operations via Promise.resolve()
- bindSocketToStore now accepts `stateRef` as 3rd param (from App.jsx)
