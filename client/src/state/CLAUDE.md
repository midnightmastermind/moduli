# client/src/state — State CLAUDE.md

_Updated: 2026-05-18. Check this file before re-reading source._

## Recent Changes (May 18 2026 — applyEffectsToLiveOccs carries role/kind/label on CREATE_ITEM)
- **operationExecutor.js (`applyEffectsToLiveOccs` `CREATE_ITEM`)**: New occurrence stub now copies `role / kind / label / linkedGroupId` from `effect.template` (or `inst.*` for COPY_LINK which uses `template: null`), and honors `inst.occurrences[]` when the producer inlined children. Without these stamps, the next op in a `runMatchingOperations` batch couldn't see APPLY_TEMPLATE's clones via `$allInstances` / `$allContainers` / etc., because the `allItems` setup in `executePipeline` reads `occ.role ?? tpl?.role` — `tpl` is looked up in `state.modules`, which only updates after `applyOperationEffect` dispatches Redux (which happens AFTER all ops finish running). Symptom: SCHED-TABLE saw 360 instances (toolkit/todo/etc) but ZERO of BUILD-DAY's freshly-created Schedule tasks, so its `_ancestors HAS_ANCESTOR $schedPageId AND SAME_DAY $schedDate` predicate matched nothing → empty Schedule Table. Same shape as the role-stamping already done in bindSocketToStore's CREATE_ITEM handler (line 777-779) — this brings the live overlay into parity.

## Recent Changes (May 18 2026 — UPDATE_ITEM_META mirrors writes into localOccsById)
- **bindSocketToStore.js (`applyOperationEffect` `UPDATE_ITEM_META`)**: Now writes the freshly-computed `nextMeta` back into `localOccsById[effect.itemId]` BEFORE calling `updateOccurrence`. Without this mirror, two `UPDATE_ITEM_META` effects emitted in the same effect batch (e.g. the Schedule Table op writing 4 cells per row) both read the pre-write meta from the overlay, recompute `nextMeta` from that stale snapshot, and silently overwrite each other's cell entries — only the LAST write per batch survived (`cellsPersisted: 1` for a 6-row × 4-col rebuild). The Redux dispatch already updates React's render layer; this overlay mirror keeps the executor's view fresh too. No behavior change for callers that emit a single UPDATE_ITEM_META at a time (write applied immediately to both layers as before).

## Recent Changes (May 18 2026 — fieldVisibility cascade selectors)
- **selectors.js**: `getEffectiveFieldVisibilityForOccurrence(occ, { occurrencesById, parentByChildId })` — walks leaf→root via the shared `buildParentMap` (same authoritative occurrences[]-reverse-map + parentId-fallback as `getEffectiveFilterForOccurrence`); returns the FIRST non-null `occ.fieldVisibility` in the chain. `{mode:"off"}` short-circuits to `null` ("show all here + descendants until re-overridden"). `fieldPassesVisibility(fieldId, fv)` — pure predicate (null/off/empty = pass; show=whitelist; hide=blacklist). Tests in `__tests__/fieldVisibilityCascade.test.js` (9 cases).

## Recent Changes (2026-05-17 — Period-shape filter values in cascade)
- **`selectors.js` (`isOccurrenceVisible`)**: Both the condition-based path and the legacy direct-equality path now detect `{value, unit}` filter values and route through `evalRule({..., comparator: "DATE_IN_PERIOD", right})` so weekly/monthly/yearly periods broaden visibility correctly. Bare YYYY-MM-DD strings keep the existing SAME_DAY path; only object-shape values flip to period matching.
- **`bindSocketToStore.js` (`onFullState` bootstrap)**: `hasValue` helper now treats both bare-string `"YYYY-MM-DD"` AND object-shape `{value, unit}` as "set" so the bootstrap only fills missing fieldIds — no clobbering of unit-carrying values on reload.

## Recent Changes (2026-05-17 — migrateFieldOptionsSource)
- **`migrateFieldOptionsSource.js` (NEW)**: pure helper rewriting legacy field shapes to the new `meta.optionsSource` schema. Manual: `meta.options[]` → `{ mode: "manual", values }`. Pool: `sourceType: "pool"` + `poolContainerIds[]` → `{ mode: "find", over: "$allInstances", predicate: { operator: "OR", rules: [HAS_ANCESTOR per id] }, valuePath: "id", labelPath: "label" }`. Module type: `type: "module"` → `type: "occurrence"` with collection derived from `meta.roleFilter`. Idempotent — already-migrated fields are identity returns.
- **`bindSocketToStore.js`**: `onFullState` handler now runs `migrateFieldOptionsSource` over `payload.fields`, persists rewrites via `safeEmit(socket, "update_field", ...)`, and dispatches the migrated array. First load after deploy: every legacy field rewrites once; subsequent loads short-circuit.

## Recent Changes (May 15 2026 — Bootstrap grid.activeFilterValues from nav-driven filter defaults)
- **bindSocketToStore.js (`onFullState`)**: After populating `state.filterNavState` from per-occurrence `defaultNavValue`, now also bootstraps `grid.activeFilterValues` for the active named filter's `isNav` conditions. For each nav condition's `fieldId` not already set in `activeFilterValues`, writes `localDay(now)` (today, local-tz) and persists via `update_grid` socket emit. The bug this fixes was decisive (`[VIS-DIAG]` log captured `effectiveFilters: {}`, `conditionRightVal: undefined`): the seed leaves `activeFilterValues:{}` so the value resolves "on every load" — but only `filterNavState` (the widget's display state) was being initialized; `activeFilterValues` (what `isOccurrenceVisible` reads via the cascade) stayed empty. Result: nav widget showed "May 15" but the cascade had no date target → `if (rightVal == null) continue;` in `isOccurrenceVisible` skipped the date condition → ALL dates passed through Schedule's filter, so May 16 routine instances created by Build Day appeared next to May 15 instances. Bootstrap only fills missing fieldIds — never overwrites a user-set value, so toolbar navs still persist across reloads. Regression test in `__tests__/filterCascade.test.js` ("undefined filter rightVal makes isOccurrenceVisible pass everything").

## Recent Changes (May 15 2026 — CREATE_ITEM threads linkedGroupId through to server)
- **bindSocketToStore.js (`CREATE_ITEM` effect)**: New `linkedGroupId: inst.linkedGroupId || null` field on the constructed `newOcc` so it (a) lands in the optimistic Redux dispatch + `localOccsById` overlay and (b) flows through the existing `socket.emit("create_occurrence", { ...newOcc })` spread to the server. Server's `createOccurrenceData` (crud.js:751) already extracted `linkedGroupId` when present — there's no schema change. This wiring is what makes the new COPY_LINK pipeline action (helpers/operationActions.js) actually persist its linked-group membership. Default `null` keeps every existing CREATE_ITEM caller unaffected (independent occurrences).

## Recent Changes (May 15 2026 — Ancestor-walk consolidated to one builder + getParentOccurrence)
- **selectors.js**: New exported `getParentOccurrence(occ, { occurrencesById, parentByChildId })` — THE single "who is my parent" answer (occurrences[] reverse map via shared `helpers/dragHitTesting.buildParentMap`, parentId fallback). `getEffectiveFilterForOccurrence` now uses `buildParentMap` (dropped the hand-rolled inline reverse-map build). selectors.js imports `buildParentMap` from `../helpers/dragHitTesting` (leaf module, zero imports — no cycle).
- **Uniformity**: all 5 ancestor-walk sites now use the one `buildParentMap` + `pbc[id] ?? parentId` idiom — `operationExecutor.ancestorsFor` (already), `CommitHelpers._ancestorChain` (already), `getEffectiveFilterForOccurrence`, `effectiveFilterFor`, and `FiltersSection` (parentEffectiveFilter + ancestorRows). No more parallel parentId-only walks. 556/556 client tests green.

## Recent Changes (May 15 2026 — getEffectiveFilterForOccurrence walks occurrences[] reverse map)
- **selectors.js (`getEffectiveFilterForOccurrence`)**: Ancestor walk no longer uses `cur.parentId` only. New optional `parentByChildId` option; when absent the function builds the reverse map lazily from every occurrence's `occurrences[]`. Walk step is now `nextId = pbc[cur.id] ?? cur.parentId`. Root-cause fix for the goal-tracker date bug: containers/pages have no `parentId` (children linked via `occurrences[]`), so the old walk stopped at the first container and a deep instance never saw the page/grid filter. Backward compatible — all existing parentId-fixture tests pass; 2 regression tests added in `__tests__/filterCascade.test.js`. Callers in operationExecutor.js pass the prebuilt `parentByChildId` (avoids O(N²) over `$allItems`); render/dropHandlers/FiltersSection callers get the lazy build (single occ, fine).

## Recent Changes (May 14 2026 — Local filter conditions threaded into visibility)
- **selectors.js (`isOccurrenceVisible`)** — added an early `continue` when the condition's resolved `rightVal` is null/undefined. Mirror of the user's "trust the filter cascade" rule: clearing a local filter (e.g. Time Slot select "— any —" writes `filterOverride[fieldId] = null` → `resolveEffectiveFilters` deletes the key → rightVal lands as undefined) now reads as "no filter target" and passes, rather than failing-all via the strict `leftVal === undefined` comparison. Date conditions with no nav value also benefit — they no longer hide every occurrence that has a date field but no active nav target.
- **selectors.js (`getLocalFilterConditions`)** — new export. Returns synthesized `{ fieldId, comparator: "IS" }` rows for any `occ.filters[]` entry that has `active: true`, a `fieldId`, and `condition == null`. The schedule-page Time Slot filter (seeded in `createTestGrid.js`) is the driving example — it relies on filterOverride writes for visibility, not its own rule tree. Entries with an explicit `condition` (e.g. the legacy `schedFilterId` OR-block) are intentionally skipped — they're either evaluated via their own rule tree or are dead-code shadow filters of the active grid filter.

## Recent Changes (May 13 2026 — Templates v2 effect routing)
- **bindSocketToStore.js** — stale `case "APPLY_TEMPLATE":` block removed (was emitting old `fill_from_template`). The new APPLY_TEMPLATE pipeline step (in operationActions.js) emits per-clone `CREATE_ITEM` + `UPDATE_OCCURRENCE` effects which the existing handlers already process. No new event listeners needed — `module_created`/`occurrence_created`/`occurrence_updated`/`module_deleted`/`occurrence_deleted` already cover all template clone broadcasts from the server's clone_subtree_as_template / apply_template / save_over_template handlers.
- **Occurrence schema field `filterNavConfig`** — keyed by filter id, value `{ visible, style?, options?, step? }`. Default `{}` on new occurrences. Drives per-occurrence FilterNavWidget rendering inside LocalFilterNav.
- **Occurrence `meta.appliedFromTemplateId`** — set by the apply_template server handler (and by the APPLY_TEMPLATE pipeline action via CREATE_ITEM's instance.meta passthrough). Lets TemplatesSection show "Save over <templateName>".

## Recent Changes (Apr 26 2026 — LINK_OCCURRENCE_TO_PARENT effect)
- **bindSocketToStore.js**: Added `case "LINK_OCCURRENCE_TO_PARENT"` in `applyOperationEffect`. Optimistic local update: if the parent's `occurrences[]` doesn't already include the child id, dispatches `updateOccurrenceAction({ id: parentId, occurrences: [...prev, childId] })` and patches `localOccsById[parentId]`. Then emits `link_occurrence_to_parent` to the server (atomic `$push` with `$ne` guard there). Effect is fully idempotent — re-runs on the same parent/child pair are no-ops. Added `updateOccurrenceAction` to the existing `actions` import.

## Recent Changes (Apr 25 2026 — Artifact + Textblock Role Buckets)
- **masterReducer.js**: `deriveRoleArrays` now buckets `role: "artifact"` and `role: "textblock"` modules into new `artifacts` / `textblocks` arrays (alongside panels/containers/instances/pages). FULL_STATE return + LOGOUT clear include the two new keys.
- **initialState.js**: Added `artifacts: []` and `textblocks: []` next to `instances: []`.
- **selectors.js**: `createLookupsFromState` returns `artifactsById` and `textblocksById`. `traverseContainerChildren` now buckets each child by its module's role (artifact / textblock / instance) instead of always tagging as `instance`. Same in `computeRoleByModuleId`.

## Recent Changes (Apr 24 2026 — isNav replaces primaryDateFieldId)
- **selectors.js**: No changes — `isOccurrenceVisible` already used `conditions` path correctly. `effectiveFilters[fieldId]` is used as rightVal when `cond.value` is null (what nav arrows write to).
- **concept**: `primaryDateFieldId` removed from all client code. Nav is now driven by `isNav: boolean` on individual filter conditions. Any condition can have `isNav: true` regardless of field type. `LocalFilterNav`, `LocalFilterButton`, `Toolbar`, `App.handleFilterNav` all updated.


## Recent Changes (Apr 23 2026 — filterNavState + INIT/SET_FILTER_NAV)
- **actions.js**: Added `INIT_FILTER_NAV` + `SET_FILTER_NAV` to `ActionTypes`. Added `initFilterNavAction(navMap)` + `setFilterNavAction(filterId, value)` action creators. Used by bindSocketToStore (on full_state) and Toolbar (on date nav buttons).
- **initialState.js**: Added `filterNavState: {}` — client-only ephemeral state keyed by filterId holding ISO date strings.
- **masterReducer.js**: Added `INIT_FILTER_NAV` case (replaces entire filterNavState map) and `SET_FILTER_NAV` case (sets single entry). Also clears `filterNavState: {}` on LOGOUT. App.jsx useEffect watches `state.filterNavState` and fires `NavigationOp` when any date entry changes.

## Recent Changes (Apr 15 2026 — operationsBridge removeLocalOcc)
- **bindSocketToStore.js**: Added `removeLocalOcc: null` to `operationsBridge` initial export. Wired inside `bindSocketToStore` as `operationsBridge.removeLocalOcc = (id) => { delete localOccsById[id]; }`. Nulled in cleanup block. Used by CommitHelpers.deleteOccurrence to evict deleted occurrences from the local cache before firing operations.

## Recent Changes (Apr 11 2026 — textmaps_batch Handler + Textmap Preservation)
- **bindSocketToStore.js**: Added `onTextmapsBatch` handler for `textmaps_batch` socket event. Dispatches `UPDATE_OCCURRENCE` for each `{ id, textmap }` entry and updates `localOccsById`. Cleanup removes the listener.
- **masterReducer.js**: `FULL_STATE` case now preserves textmaps from existing `state.occurrences` when merging (prevents viewport textmaps from priority_state getting wiped when full_state arrives without textmaps). Maps `existingTextmaps` from prior state, merges into incoming occurrences.
- **Load flow**: `priority_state` has viewport textmaps (inline DB query) → `full_state` merges without wiping them → `textmaps_batch` adds remaining non-viewport textmaps lazily.

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
