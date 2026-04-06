# client/src/state — State CLAUDE.md

_Updated: 2026-04-02. Check this file before re-reading source._

## Recent Changes (Apr 2 2026 — Operations Update on Delete)
- **bindSocketToStore.js**: `onOccurrenceDeleted` now saves `removedOcc = localOccsById[occurrenceId]` BEFORE deleting from cache. After `OccurrenceDeleteOp` fires, iterates `removedOcc.fields` and fires `MeasureOp` per field. Fixes aggregation operations (e.g. water total) not recalculating when a scheduled occurrence is removed.

## Recent Changes (Apr 2 2026 — CREATE_OCCURRENCE_FOR_MODULE Effect Handler)
- **bindSocketToStore.js**: Added `case "CREATE_OCCURRENCE_FOR_MODULE"` in `applyOperationEffect` (after existing `CREATE_OCCURRENCE` case). Creates a new occurrence for an **existing** module (no new module created). Emits `create_occurrence` socket event with `targetType: "module"`, `targetId: effect.moduleId`, and supports `effect.parentId`, `effect.viewId`, `effect.fields`, `effect.textmap`, `effect.occurrenceId`. Sets `meta: { createdByOperation: true }`. Designed for use by the Day Page Auto-Create operation pipeline.

## Recent Changes (Mar 31 2026 — Offline Queue Flush + Optimistic Operations)
- **bindSocketToStore.js**: Imported `flushOfflineQueue` from `offlineQueue.js`. After `full_state` is processed and operations execute (double-rAF deferred), calls `flushOfflineQueue(socket)` to replay any mutations queued while offline. Ensures queued changes are applied on top of fresh server state, not overwritten by it.
- **bindSocketToStore.js**: Added `operationsBridge` module-level export (`{ fireOperations, updateLocalOcc }`). `fireOperations` exposed as `fireOperationsOptimistic` which tracks fired occurrences in `optimisticFiredSet` to prevent double-firing on server echo. `onOccurrenceUpdated` skips MeasureOp fire if `optimisticFiredSet.has(occurrence.id)`. Added memoized map caching (`_cachedFieldsById`, `_cachedOperationsById`, `_cachedBaseOccsById`) — maps only rebuilt when source arrays change by reference. Cleared on cleanup.

## Recent Changes (Mar 26 2026 — Page Module Integration)
- **selectors.js**: `autofillOccurrence.fillFromModule` now includes page role check: `lookups.pagesById?.[mod.id] || mod.role === "page"` → `filled.page = mod`. Was missing — page occurrences didn't get role metadata.
- **selectors.js**: `createLookupsFromState` already populates `pagesById` bucket for page modules.
- **masterReducer.js**: `deriveRoleArrays` includes `pages` array. LOGOUT clears `pages: []`. `_appendOcc`/`_removeOcc` hints work for page operations.

## Recent Changes (Mar 22 2026 — Dynamic Page Creation via Operations Pipeline)
- **bindSocketToStore.js**: Added `CREATE_MODULE` effect handler — emits `create_module` + `create_occurrence` socket events to create module + occurrence in one shot. Removed `CREATE_DAY_PAGE_OCCURRENCE` and `NAVIGATE_DAY_PAGE` effect handlers (replaced by generic CREATE_MODULE + UPDATE_VIEW pipeline).

## Recent Changes (Mar 20 2026 — Trash Filtering in Selectors)
- **selectors.js**: `createLookupsFromState` fallback loop (line 46) now skips `m.trashed` modules — trashed modules no longer appear in `panelsById`/`containersById`/`instancesById` role buckets.
- **selectors.js**: `computeRoleByModuleId` fallback loop (line 91) now skips `mod.trashed` — trashed modules excluded from role map.

## Recent Changes (Mar 20 2026 — Load Speed Optimization)
- **bindSocketToStore.js**: Operation execution on `full_state` now deferred via double `requestAnimationFrame` instead of `Promise.resolve().then()`. The grid renders and paints FIRST, then computed values populate. Users see the grid layout immediately instead of waiting for all operations to finish.
- **socket.js**: Added `reconnectionDelay: 100` (was default 1000), `reconnectionDelayMax: 2000` (was 5000), `timeout: 5000` (was 20000) for faster initial connection and retry on flaky networks.

## Recent Changes (Mar 19 2026 — Batch Module Update)
- **actions.js**: Added `BATCH_UPDATE_MODULES` to `ActionTypes`. Added `batchUpdateModulesAction(modules)` action creator.
- **masterReducer.js**: Added `BATCH_UPDATE_MODULES` reducer case — merges array of module updates in a single dispatch + single `deriveRoleArrays()` call. Used by `cyclePanelStack` for instant panel stack switching.

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
