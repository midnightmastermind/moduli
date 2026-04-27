# client/src/helpers — Helpers CLAUDE.md

_Updated: 2026-04-25. Check this file before re-reading source._

## Recent Changes (Apr 27 2026 — Operation Priority Sort)
- **operationExecutor.js (`runMatchingOperations`)**: Sort key is now `(priority ?? 5)` first, `sortOrder` second. Lower priority number runs first. Lets the schedule auto-build (priority 1) finish creating slot occurrences before stamp ops (priority 2) and goal aggregations (priority 3) read them.

## Recent Changes (Apr 26 2026 — LINK_OCCURRENCE_TO_PARENT action)
- **operationActions.js**: New `LINK_OCCURRENCE_TO_PARENT` action — emits a `LINK_OCCURRENCE_TO_PARENT` effect with `{ occurrenceId, parentOccurrenceId }`. Optimistically appends the child id to the parent stub inside `$vars.$allOccurrences` (with `includes` guard) so subsequent steps in the same pipeline pass see the link without waiting for the effect to apply. Used by the auto-build operation in the ELSE of "if Due/slot exists" — the container's date FIELD value (FIND_OCCURRENCE → `cfg.dateFieldId`/`cfg.dateExpr`) stays the source of truth for "exists for active date", and this action separately ensures the matched occurrence is wired into `schedPage.occurrences[]`.

## Recent Changes (Apr 25 2026 — Artifact + Textblock Roles + Optimistic Upload)
- **dropHandlers.js**: `handleModuleDrop` now treats `role: "artifact"` and `role: "textblock"` as leaf-placeable (alongside `instance` / undefined) — see `isLeafRole`. Container drops + grid-cell drilldown both honor the new roles. Grid-cell drilldown now scans `state.modules` (not `state.instances`) so it finds artifact / textblock source modules too. `handleFileDrop` destructures `module` from the upload response and dispatches `createModuleAction` + `createOccurrenceAction` BEFORE updating the container — eliminates the blank-spot delay where the container update referenced an occurrence not yet in local state. Reducer is idempotent so the duplicate dispatch on socket arrival is a no-op.
- **LayoutHelpers.js**: `getContainerItemsWithOccurrences` and `getContainerItems` now take `leafModulesLookup` (a merged map of instances + artifacts + textblocks) instead of `instancesLookup`. Return shape `{ instance, occurrence }` is unchanged for back-compat — the `instance` field is now any leaf module. `copyInstanceToContainer` writes `targetType: "module"` (was `"instance"`) so artifact/textblock occurrences pass autofill role detection correctly.
- **CommitHelpers.js**: New `createTextblockInContainer({ dispatch, socket, gridId, userId, containerOccurrence, label })`. Generates IDs client-side, optimistic-dispatches the role:"textblock", kind:"doc" module + occurrence, emits `create_module` / `create_occurrence`, appends the new occurrence ID to the container's `occurrences[]`. Returns `{ moduleId, occurrenceId }`.

## Recent Changes (Apr 23 2026 — Copy-Drag Operation Triggers Fix)
- **LayoutHelpers.js**: `copyInstanceToContainer` now sets `parentId: toContainer._occurrence?.id` on the created occurrence (enables ancestor walk for HAS_ANCESTOR checks). Accepts optional `toPanelId` param, forwarded to `CommitHelpers.createOccurrence`.
- **CommitHelpers.js**: `createOccurrence` now accepts optional `panelId` param; includes it in the OccurrenceCreateOp so `onCreate`/`onAdd` operations with `panelId` filters (e.g. Schedule Stamp) fire on copy-drag.
- **dropHandlers.js**: Copy-drag path now resolves `toPanelOcc` via `findGridPanelOcc` and passes `toPanelId` to `copyInstanceToContainer`, matching the move-drag path's context resolution.

## Recent Changes (Apr 23 2026 — Optimistic Operation Triggers from CommitHelpers)
- **CommitHelpers.js**: `updateOccurrence` now accepts `triggerField = null` param. When provided, calls `operationsBridge.updateLocalOcc(occurrence)` + fires `MeasureOp` with `fieldId` so onChange operations with `allowedFields` match correctly. `FieldRenderer.jsx` passes `triggerField: { fieldId: field.id, value, instanceId }`.
- **CommitHelpers.js**: `createOccurrence` now calls `updateLocalOcc`, fires `OccurrenceCreateOp`, and per-field `MeasureOp` (with `fieldId`/`value`) for each field on the new occurrence. Triggers onAdd + onChange operations immediately on add.
- **CommitHelpers.js**: `deleteOccurrence`/`removeOccurrence` now fire `OccurrenceDeleteOp` first (with occurrence override so executor can still inspect the deleted occurrence), then rAF-deferred per-field `MeasureOp` (so the aggregation sees the occurrence as already gone).
- **dropHandlers.js**: `handleInstanceDrop` now updates `localOccsById` for both source/destination containers and fires per-field `MeasureOp` after move, so onChange aggregations retrigger when instances are drag-moved between slots.

## Recent Changes (Apr 17 2026 — Per-Operation Run Log)
- **operationExecutor.js**: Module-level `runHistory` Map<opId, RunLog[]> (cap 20, newest first). New exports: `getOpRunHistory(opId)`, `getLastOpLog(opId)` (back-compat), `subscribeToOpLog(opId, fn)`. `recordRunLog` unshifts onto history and notifies subscribers with the full list. `runMatchingOperations` creates a `makeLogger()` per op, adds `start`/`end`/`error` entries, and calls `recordRunLog`. `executePipeline` accepts optional 5th `externalLogger` param; reuses it when called from the batch executor or creates its own. Logger attached to `$vars._log` for nested helpers. `executeSteps` adds per-step entries (`action`/`if`/`loop`) with config + result preview. Source-resolution snapshot logged after `$vars` build.

## Recent Changes (Apr 16 2026 — Ancestry Check Replaces pageOccId)
- **operationExecutor.js**: Removed broken `pageOccId` filter from `gatherLoopItems`. Added `parentByChildId` reverse map built in `executePipeline` from all `occ.occurrences[]` arrays, passed via context as `_parentByChildId`. `gatherLoopItems` now adds `_ancestors` (ordered ancestor ID array, closest first) to every loop item. Time filter's `findDateValue` also uses the reverse map for parent-chain date walk.
- **operationActions.js**: Added `HAS_ANCESTOR` (aliased `ARRAY_INCLUDES`) comparator to `evalRule` — checks if an array (e.g. `$item._ancestors`) contains a given ID. Extended `FIND_OCCURRENCE` action to support `moduleLabel` / `moduleLabelExpr` config — looks up module by label in `$allModules`, uses its ID as `targetId`.
- **DB (test grid)**: "Water Today" and "Tasks Completed Today" operations updated — `pageOccId` removed from loop step, FIND_OCCURRENCE step added before loop to dynamically find schedule page by label, `HAS_ANCESTOR` condition added to loop body.

## Recent Changes (Apr 15 2026 — Delete Fires Operations Optimistically)
- **CommitHelpers.js**: `deleteOccurrence` + `removeOccurrence` now accept optional `occurrence` param. Call `operationsBridge.removeLocalOcc(occurrenceId)` before dispatch (evicts from local cache), then fire `MeasureOp` for each field the occurrence had. Mirrors what `onOccurrenceDeleted` does in bindSocketToStore for other windows. Callers in ModuleInstance.jsx, ModuleContainer.jsx, ContainerPool.jsx updated to pass `occurrence`.

## Recent Changes (Apr 15 2026 — DragMode Per-Occurrence + Drag-Out to Board Fix)
- **dropHandlers.js**: Container drag-out from doc to board now uses `drop.dropTarget.context?.pageOccurrenceId` to target the page occurrence (not the panel occurrence). Board panels store containers in page occurrences — the old code added to the panel occurrence which is only page IDs, causing the container to never render.
- **ModuleContainer.jsx**: `containerDragMode` now reads `containerOccurrence?.dragMode ?? module?.defaultDragMode ?? "move"` — occurrence-level dragMode takes priority over module default. `toggleContainerDragModeQuick` now writes to the occurrence via `updateOccurrence` (when occurrence exists) instead of always writing to the module. Toggling one copy's mode no longer affects other occurrences sharing the same module.

## Recent Changes (Apr 15 2026 — Drag-Out from Doc Embeds)
- **dropHandlers.js**: Both `handleInstanceDrop` and `handleContainerDrop` now handle `payload.context.sourceType === "doc-embed"`. Instance: skips `fromC` check, adds `occurrenceId` to `toCOcc.occurrences`, calls `embedDeleteRegistry.get(occurrenceId)?.()` on move mode. Container: same for panel (`toPanelOcc.occurrences`). Enables dragging embedded instances/containers out of docs back to boards.
- **embedRegistry.js**: (existing) `embedDeleteRegistry` Map imported by dropHandlers — completes the drag-out circuit.

## Recent Changes (Apr 10 2026 — DragProvider Doc Container Skip)
- **DragProvider.jsx**: `handleDrop` instance branch now skips doc containers — checks `baseContainers.find(c => c.id === containerId)?.kind === "doc"` before calling `handleInstanceDrop`. Root cause of 3 bugs: (1) extra occurrence created when dragging instance into doc, (2) pending drop popup not closing reliably, (3) blank embed element left after deleting moduleEmbed. All fixed by preventing DragProvider from processing instance drops on doc containers — Editor.jsx's own Pragmatic DnD drop target handles insertion.

## Recent Changes (Apr 9 2026 — Cursor + Drag Fixes)
- **index.css**: Added `cursor: grab !important` to `.module-drag-handle .radial-handle` — previously overridden by Tailwind `cursor-pointer`. `.page-tree-close-btn` hover CSS no longer uses `!important` since inline `opacity: 0` was removed from the button.

## Recent Changes (Apr 9 2026 — Drag Handle Fix: Boolean Flag)
- **dragSystem.js**: Replaced `document.elementFromPoint(e.clientX, e.clientY)` check in `dragstart` interceptor with a `_dragFromHandle` boolean flag (both `useDraggable` and `useDragDrop`). Root cause: `dragstart` fires at the *current* cursor position after the user has moved, not the `pointerdown` position — so `elementFromPoint` was consistently returning elements outside the handle, causing all drags to be cancelled. Flag is set on `pointerdown` on the handle, cleared on first `dragstart` or `pointerup`/`dragend`/`drop`.

## Recent Changes (Apr 6 2026 — Phase E: File Drops + Iframe Removal)
- **DragProvider.jsx**: Added native file drop fallback — `dragover`/`drop` listeners on `.grid-frame` catch OS file drops that Pragmatic DnD might miss. Calls `handleFileDrop` with parsed file payload. Sticky container highlight still in place from earlier fix.
- **dragSystem.js**: Added `DragType.FILE` + `DragType.EXTERNAL` to `DropAccepts.GRID_CELL` — grid cells now accept native file drops (were only accepting panels/modules/artifacts/folders).

## Recent Changes (Apr 6 2026 — Sticky Container Highlight)
- **DragProvider.jsx**: Fixed container highlight sputtering during instance drags. When `getHoveredIds` returns `containerId = null` (cursor in gaps/margins between instances) but still inside the same panel, keeps the previous `containerId` instead of clearing the highlight. Uses `lastHotRef.current` to compare.

## Recent Changes (Apr 3 2026 — Day Page Duplicate Fix)
- **operationExecutor.js:178**: `case "onNavigation"` no longer matches `transactionType == null`. Was: `return transactionType === "NavigationOp" || transactionType == null` → now: `return transactionType === "NavigationOp"`. Same fix for `onIteration` alias. Root cause of 8 duplicate day pages on every load — `onNavigation` was firing on every `full_state` receive because null transactionType matched it.

## Recent Changes (Apr 2 2026 — operationActions + operationExecutor: Day Page Support)
- **operationActions.js** — `FIND_OCCURRENCE` extended: now filters candidates with `Array.isArray` guard, skips `meta.isTemplate === true` occurrences, and supports optional `dateFieldId` + `dateExpr` for date-field matching (finds occurrence where a date field equals the target date by `toDateString()` comparison).
- **operationActions.js** — 3 new action cases added before `PICK_RANDOM_FROM_POOL`:
  - `COMPUTE_TEXTMAP_FROM_TEMPLATE`: deep-clones a template occurrence's `textmap`, substitutes `[token]` strings using `resolveExpr` values, stores result in `$vars` (default `$computedTextmap`). Pure computation — no effect emitted.
  - `CREATE_OCCURRENCE_FOR_MODULE`: creates an occurrence for an existing module (no new module created). Supports `dateFieldId`/`dateExpr` for seeding an initial date field, and `textmapVar` to pick up a pre-computed textmap from `$vars`. Emits `CREATE_OCCURRENCE_FOR_MODULE` effect. Sets `$lastCreatedOccurrenceId`.
  - `FILL_FROM_TEMPLATE`: applies a substituted textmap clone to an EXISTING occurrence. Use for re-filling already-created pages. Emits `UPDATE_OCCURRENCE` effect.
- **operationExecutor.js** — Two new built-in `$vars` added after `$activeDate`:
  - `$activeDateLabel`: human-readable label for the active filter date (e.g. "Thu, Apr 3"). Defaults to today when no date filter active.
  - `$activeDayOfWeek`: full weekday name for active filter date (e.g. "Thursday"). Defaults to today.

## Recent Changes (Mar 31 2026 — Offline Queue + Optimistic Operations + Highlight Fix)
- **offlineQueue.js** (NEW): Module-level queue buffers `socket.emit` calls when disconnected. `safeEmit(socket, event, data)` is a drop-in replacement — emits immediately when connected, queues when offline. Deduplicates update events per entity (keeps latest). `flushOfflineQueue(socket)` replays all queued mutations in order.
- **CommitHelpers.js**: All `socket?.emit()` calls replaced with `safeEmit(socket, ...)` from offlineQueue.js. Added `import { safeEmit } from "./offlineQueue"`. Mutations now buffer automatically when offline and replay after reconnect + full_state.
- **CommitHelpers.js**: Imported `operationsBridge` from `bindSocketToStore`. `setOccurrenceFieldValue` now calls `operationsBridge.updateLocalOcc(updatedOcc)` + `operationsBridge.fireOperations("MeasureOp", ...)` immediately after local dispatch — operations run instantly without waiting for server echo.
- **DragProvider.jsx**: Fixed container highlight during instance drags. `handleDragMove` now calls `setDropHighlight(containerId)` when hovered target changes (was intentionally skipped, relying on `handleDragOver` which doesn't fire when hovering over instances inside containers — innermost drop target wins in Pragmatic DnD).

## Recent Changes (Mar 30 2026 — Operations Trigger Fixes)
- **operationExecutor.js**: (1) Added 6 missing trigger cases to `matchesTrigger`: `onAdd` (→ OccurrenceCreateOp), `onRemove` (→ OccurrenceDeleteOp), `onReorder` (→ OccurrenceListOp same-container), `onUncomplete` (→ MeasureOp falsy value), `onButton` (→ ButtonOp), `onNodeInput` (→ NodeInputOp). All 14 EVENT_TYPES in OperationsTab.jsx now have matching executor cases. (2) Fixed `scopeContainerId` in `gatherLoopItems` — was reading `scopeMod?.occurrences` (module, always empty). Now scans `occurrencesById` for occurrences targeting the container module and collects their child IDs.

## Recent Changes (Mar 30 2026 — DnD Cleanup)
- **DragProvider.jsx**: (1) Removed doc-container skip (`if (toC.kind === "doc") { clearSession(); return; }`) — doc containers now accept drops normally, Editor.jsx handles insertion as `moduleEmbed`. (2) Fixed `shouldHighlight` to highlight containers for ALL drag types except panel drags (was only instance/external). (3) Removed dead `canvasMeta` commented-out code block.

## Recent Changes (Mar 28 2026 — Dual Sidebar Drag Support)
- **dragSystem.js**: Added `FOLDER: "folder"` to `DragType`. Added `DragType.FOLDER` to `DropAccepts.GRID_CELL`, `PANEL_CONTENT`, `PAGE_CONTENT`.
- **DragProvider.jsx**: Added folder drop handler (lines ~1929-1951) — when `type === "folder"` dropped on panel, iterates `childOccurrenceIds`, creates a page module for each child doc, adds page occurrences to panel. **Bug fix**: used `(state?.modules || []).find(m => m.id === childOcc.targetId)` instead of `state?.modulesById?.[...]` (state has `modules` array, not `modulesById` map). Added `"tree-anchor"` and `"tree-page"` to module sourceType whitelist in the MODULE drop handler condition (line ~1672).

## Recent Changes (Mar 27 2026 — ViewType Rename: artifact→display)
- **DragProvider.jsx**: `isExistingArtifactPanel` check `viewType === "artifact"` → `viewType === "display"`. Both `createView` calls that set `viewType: "artifact"` updated to `viewType: "display"` (OS file drop handler + artifact grid-cell drop handler).

## Recent Changes (Mar 26 2026 — Bug Fixes: OS File Drop + Panel Cycler)
- **DragProvider.jsx**: Bug #13 — OS file drops now upload via `/api/artifacts/upload` (fetch + FormData). Creates new artifact panel at drop location, or switches active doc if dropping on existing artifact panel. FILE type removed from old text-instance handler. Deduplication updated: `__file__` drops deduplicate by payload id alone (ignoring containerId), preventing double uploads when both container-list and panel-content fire.
- **DragProvider.jsx**: Bug #14 — `cyclePanelStack` now cycles N+1 states (N panels + "all hidden"). Accepts `cellKey` param for calling from empty-pocket button. `visibleIdx === -1` treated as "all hidden" state at index N.
- **DragProvider.jsx**: Bug (canvas drag-out) — Added `|| payload?.sourceType === "canvas"` to module drop handler condition so CanvasCard drag-out works.

## Recent Changes (Mar 25 2026 — onLoad Trigger + Time Filter Fix)
- **operationExecutor.js**: `shouldTrigger` — added backward compat for old operations (no `triggerTypes` array) to fire on load. Uses `hasExplicitArray` flag: legacy `triggerType`-only operations auto-fire on load unless manual-only. New operations with explicit `triggerTypes` array are respected literally.
- **operationExecutor.js**: `gatherLoopItems` time filter — now checks occurrence's date-type field values (scheduledDate) in addition to legacy `iteration.timeValue`. Walks up parent chain (instance → container → panel) via `findDateValue()` to find a date when the occurrence itself has none. Uses `$activeDate` from filter nav as the comparison target instead of hardcoded `new Date()`. Occurrences with no date at all treated as persistent (pass any time filter).

## Recent Changes (Mar 23 2026 — Panel Cycler Persistence Fix)
- **DragProvider.jsx**: `cyclePanelStack` now emits `update_module` for ALL panels in the stack (was only emitting for the next visible panel). Hidden panels' `display: "none"` is now persisted to server, fixing position loss on reload.

## Recent Changes (Mar 22 2026 — Dynamic Page Creation via Operations Pipeline)
- **operationActions.js**: Added template string interpolation to `resolveExpr` — `"daypage ${$today}"` resolves vars inside `${...}` patterns. Added `FIND_MODULE` action (searches `$allModules` by name/label, sets `$foundModule`/`$foundModuleId`). Added `FIND_OCCURRENCE` action (searches by targetId, sets `$foundOccurrence`/`$foundOccurrenceId`). Added `CREATE_MODULE` action (creates module + occurrence in one shot, sets `$lastCreatedModuleId`/`$lastCreatedOccurrenceId`). Removed `CREATE_OCCURRENCE_WITH_ITERATION` and `NAVIGATE_DAY_PAGE` action types (replaced by generic pipeline).

## Key Files

| File | Purpose | Last Changed |
|------|---------|--------------|
| `DragProvider.jsx` | Drag state coordinator. Manages `monitorForElements`. Handles all drop logic: move/copy/copylink instances+containers+panels. Skips normal move when target is `kind: "doc"` (DocContainer handles it). Handles field drops from command-center → adds to instance fieldBindings. **Mar 10: Refactored to use draftOccurrences map instead of draftContainers/draftPanels occurrence arrays for live preview. All drop handlers now pass occurrence objects (panelOccurrence, containerOccurrence) to LayoutHelpers.** | Mar 2026 |
| `CommitHelpers.js` | All CRUD operations. **ONLY place that calls socket.emit**. Exports: createInstanceInContainer, deleteOccurrence, updatePanel, deletePanel, updateContainer, deleteContainer, createView, updateView, updateOccurrence, updateGrid, etc. | Stable |
| `CalculationHelpers.js` | All 15 aggregation types. `calculateDerivedField` checks `metric.blockTree` first (evaluateBlockTree via require()), falls back to flat `allowedFields`. | Recent |
| `LayoutHelpers.js` | Occurrence filtering (getPanelContainers, getContainerItems, getContainerItemsWithOccurrences, occurrenceMatchesIteration). Panel duplication/linking/splitting. **Mar 10: Major refactor — occurrence.occurrences is the SOLE source of ordering. All add/remove/reorder/move functions now take `panelOccurrence`/`containerOccurrence` params and call updateOccurrence (not updatePanel/updateContainer). No module.occurrences fallback anywhere.** | Mar 2026 |
| `dragSystem.js` | Pragmatic DnD hooks: useDraggable, useDroppable, useDragDrop. DragType enum (PANEL, CONTAINER, INSTANCE, FIELD, ARTIFACT, EXTERNAL). DropAccepts map. `dragHandleRef` param restricts drag origin to specific element. **Mar 19: Phase A perf — haptic vibrate(15) on drag start, vibrate([8,30,8]) on drop, 80ms hold delay, 32ms hit-test throttle, 4px hit-test cache.** | Mar 19 |
| `StyleHelpers.js` | `resolveContainerStyle`, `resolveInstanceStyle`, `styleToCSS`. Cascading style resolution: panel defaults → container overrides → instance overrides. | Recent |
| `CommitHelpers.js` exports (key): | createInstanceInContainer, deleteOccurrence, deletePanel, deleteContainer, updatePanel, updateContainer, updateOccurrence, updateGrid, createView, updateView, saveTemplate, fillFromTemplate | Stable |
| `blockTypes.js` | **MOVED here from blocks/** — Block type constants for visual operations builder. | Mar 2026 |
| `blockEvaluator.js` | **MOVED here from blocks/** — Recursive block tree evaluator. | Mar 2026 |
| `operationActions.js` | **MOVED here from blocks/** — resolveExpr, evalRule, evalGroup, extractFieldValuesFiltered, executeActionItem. | Mar 2026 |
| `operationExecutor.js` | **MOVED here from blocks/** — executePipeline, runMatchingOperations. Imports operationActions. | Mar 2026 |
| `offlineQueue.js` | **NEW** Offline mutation queue. `safeEmit(socket, event, data)` buffers when disconnected, deduplicates updates. `flushOfflineQueue(socket)` replays after reconnect. | Mar 31 |
| `colorHelpers.js` | `hexToRgba(hex, alpha)`, `lightenHex(hex, amount)` — single authoritative source (was duplicated 3x). | Mar 2026 |
| `useTheme.js` | **NEW** Theme hook. `useTheme()` → `{ theme, setTheme, themes }`. `SYSTEM_THEMES` export (moduli-dark/moduli-light/midnight). Persists to localStorage. Sets `data-theme` attr + `dark` class on `<html>`. Called in App.jsx root. | Mar 2026 |
| `IterationHelpers.js` | Iteration/time helpers (used by LayoutHelpers). | Stable |
| `calculationConstants.js` | **NEW** — Pure data constants extracted from CalculationHelpers.js: AGGREGATIONS (15), COMPARISONS, INPUT_FLOWS, DERIVED_FLOWS, PERSISTENCE_MODES, SCOPES, TIME_FILTERS, TIME_FILTER_MULTIPLIERS. 270 lines. | Mar 16 |
| `TransactionHelpers.js` | **NEW** — Socket wrappers for transaction operations: getTransactions, undoTransaction, redoTransaction, getUndoState. All transaction socket.emit calls go through here. | Mar 16 |

## Architecture Rules
- CommitHelpers is the **contract boundary** — components call CommitHelpers, not socket directly.
- DragProvider reads session refs (not React state) for immediate access during async drop handling.
- LayoutHelpers.normalizeId is a private function (not exported).
- splitPartnerId stored on panel entity to track split relationships.

## Recent Changes (Mar 20 2026 — Post-Review Cleanup)
- **dragSystem.js**: Removed dead `rect` variable in both `useDraggable` (was line 363) and `useDragDrop` (was line 750). Assigned but never read after `offsetX`/`offsetY` were hardcoded.

## Recent Changes (Mar 20 2026 — Phase B DragProvider Performance)
- **DragProvider.jsx**:
  - **B1**: Consolidated 3 `elementsFromPoint` calls into `getHoveredIds(x, y)` — single walk extracts panelId+containerId+instanceId. Individual getters kept for handleDrop fallbacks.
  - **B2**: `lastPreviewRef` caches last preview target — instance/container preview blocks skip draft mutations when same target still hovered.
  - **B3**: `dragConfigRef` holds `activeCell`, `setActiveCell`, `rows`, `cols`, `isMobile`. `handleDragMove` dep array reduced from 13 to 6. `handleDragStart` also uses ref for isMobile.

## Recent Changes (Mar 19 2026 — Phase A Drag Performance)
- **dragSystem.js**: Both `useDraggable` and `useDragDrop` mobile touch handlers:
  - **A1 Haptic**: `navigator.vibrate(15)` on drag start, `navigator.vibrate([8, 30, 8])` on successful drop (double-tap feel).
  - **A2 Hold delay**: `_TOUCH_HOLD_MS = 80` — touchmove returns early if finger held < 80ms. Prevents accidental drags from scrolling.
  - **A3 Throttle**: `_HIT_TEST_INTERVAL = 32` — expensive `_findDropTarget` (elementsFromPoint + DOM walk) runs at most every 32ms. Pill position still updates at 60fps.
  - **A4 Cache**: `_HIT_CACHE_DIST = 4` — skip hit-test if pointer moved < 4px since last check (squared distance comparison, no sqrt).

## Recent Changes (Mar 19 2026 — Mobile Drag + UI Fixes)
- **dragSystem.js**: Both `useDraggable` and `useDragDrop` mobile touch handlers: (1) Removed `e.preventDefault()` from `onStart` — CSS `touch-action:none` on triggerEl handles OS gesture suppression, native click/pointer events now fire for taps. (2) Cache `getBoundingClientRect()` at touchstart (`cachedRect`), not first-move. (3) Only `e.preventDefault()` in `onMove` AFTER threshold crossed (sub-threshold jitter doesn't cancel native click). (4) `document.documentElement.style.touchAction/overscrollBehavior` only set when drag actually starts, cleared on drag end only. (5) Removed synthetic `MouseEvent('click')` dispatch from `onEnd` — no longer needed since touchstart doesn't preventDefault. (6) Removed `touchStartTime` variable.

## Recent Changes (Mar 18 2026 — Mobile Fixes)
- **DragProvider.jsx**: `handleDragStart` now sets `document.documentElement.style.touchAction = 'none'` when `isMobile` — prevents Android split-screen gesture from intercepting drags. `clearSession` restores `touchAction = ''`. Added `isMobile` to `handleDragStart` dependency array.

## Recent Changes (Mar 18 2026 — Mobile Grid Nav)
- **DragProvider.jsx**: Added `activeCell`, `setActiveCell`, `isMobile` props. New `dragEdgeTimerRef` + `dragEdgeIndicatorRef` refs. In `handleDragMove` RAF callback: mobile drag-to-edge detection with 40px edge zones, 600ms dwell timer, and pulsing edge glow indicator (direct DOM). `clearSession` clears timer + removes indicator element.

## Recent Changes (Mar 16 2026 — Cleanup Sprint S2+S3+S6)
- **CommitHelpers.js**: Added `updateGridFilter({ dispatch, socket, gridId, patch, emit })`. Field CRUD functions (createField/updateField/deleteField) were already present.
- **TransactionHelpers.js** (NEW): 4 socket wrapper functions for transaction ops. TransactionHistory.jsx + useUndoRedo.js now use these instead of direct socket.emit.
- **calculationConstants.js** (NEW): All 8 constant blocks extracted from CalculationHelpers.js (270 lines). CalculationHelpers.js now re-exports from here. CalculationHelpers.js: 1210 → 937 lines.
- **LayoutHelpers.js** (unchanged): Imports stay as-is.

## Recent Changes (Mar 14 2026 — Cleanup Sprint)
- **LayoutHelpers.js**: Removed all 7 direct `socket.emit("create_occurrence")` calls. Replaced with `CommitHelpers.createOccurrence({ dispatch, socket, occurrence, emit })`. Architecture violation fixed — CommitHelpers is now the sole socket caller.

## Recent Changes (Mar 2026 — U1 Undo FLIP Animation + Canvas)
- **CommitHelpers.js**: `createInstanceInContainer` now accepts `occurrenceId` + `initialMeta` params, includes them in `create_instance_in_container` socket event.
- **App.jsx uses `useAnimations`** for U1 — see client/src/CLAUDE.md.

## Recent Changes (Mar 14 2026 — D3 Doc Pill Drag)
- **DragProvider.jsx**: Added `|| payload?.sourceType === "doc"` to the `type: "module"` handler condition (line ~1405). Doc-sourced pills (InstancePillNode) now use the same copy-to-container path as CC/pool drags.

## Recent Changes (Mar 13 2026 — Grid Cell Drop: Drilldown + Artifact Panel)
- **dragSystem.js**: Added `DragType.ARTIFACT` to `DropAccepts.GRID_CELL` so ManifestTree artifact nodes can be dropped on empty grid cells.
- **DragProvider.jsx** — 3 new grid-cell drop handlers inside the MODULE CC block:
  - `role === "container" + grid-cell`: creates new Panel via `createPanelInGrid`, then adds the container as its sole child via `createContainerInPanel` (drilldown — container fills the panel).
  - `role === "instance" + grid-cell`: creates new Panel → new Container → places instance inside via `copyInstanceToContainer` (drilldown — single instance panel).
- **DragProvider.jsx** — Artifact grid-cell handler added to existing `DragType.ARTIFACT` block:
  - `type === "artifact" + grid-cell`: creates new Panel via `createPanelInGrid`, creates View (`viewType: "artifact"`, `activeOccurrenceId`), updates panel occurrence with `viewId`.
  - Existing panel-content artifact drop (switch active doc) is unchanged.

## Recent Changes (Mar 13 2026 — Bug 17: Remove hotTarget React state)
- **DragProvider.jsx**: Removed `hotTarget` useState entirely. All `setHotTarget` calls deleted. `hotContextValue` now only contains `panelOverCellId`. Container highlight was already handled by `setDropHighlight` (direct DOM `data-drop-active` attribute) — `hotTarget` was redundant.
- **Panel.jsx**: Removed `useDragHotContext` import, `hotTarget` destructure, `isHotPanel` derived var, and `isHot={...}` prop on Container.
- **Container.jsx**: Removed `isHot` param, dead `highlightDrop` variable (was computed but never used in JSX), and `isHot` passthrough to `DocEditorShell`.
- **Editor.jsx**: Removed `isHot` prop. Outline now driven by `isDropTarget` only. `data-drop-active` CSS on outer container already handles the blue ring during drag.
- **dragSystem.js**: Updated `DragHotContext` default to `{ panelOverCellId: null }` (removed `hotTarget`).
- **Result**: Zero React re-renders during drag hover for container highlight. DOM mutation path (`data-drop-active`) was already in place — this just removes the parallel React state path.

## Recent Changes (Mar 12 2026 — Artifact Drop → Panel View Switch)
- **DragProvider.jsx**: Added handler for `type: "artifact"` drops. When a DocNode dragged from ManifestTree is dropped on a `panel-content` drop zone (and no container is targeted), calls `CommitHelpers.updateView({ activeOccurrenceId: payload.occurrenceId })` to switch the panel's active document. Panel occurrence found via `Object.values(occurrencesById).find(o => o.targetId === panelId)`. View looked up via `state?.viewsById?.[viewId]`.

## Recent Changes (Mar 2026 — cyclePanelStack Click-Twice Fix)
- **DragProvider.jsx**: `cyclePanelStack` — replaced `visibleIdx = stack.findIndex(p => panelDisplay(p) !== "none")` with `currIdx = stack.findIndex(p => p.id === panelId)`. Bug: when 2+ panels both have `display: "block"` (default, no explicit setting), `findIndex` found the FIRST panel as visible even though the user was looking at a DIFFERENT panel (the last-rendered one on top). Now uses the `panelId` from the click handler (always the panel whose button was clicked) as the anchor index. No longer relies on `layout.style.display` to find current position.

## Recent Changes (Mar 2026 — DragType.MODULE Fix — CRITICAL)
- **dragSystem.js**: Added `DragType.MODULE = "module"` to `DragType` enum. Added `DragType.MODULE` to `DropAccepts.GRID_CELL` (panel-role drops), `PANEL_CONTENT` (container/instance-role drops), and `CONTAINER_LIST` (instance-role drops). **Root cause of broken CC drag**: ALL drop zones rejected CC module drags because `"module"` was not in any `accepts` list. Build required for effect.

## Recent Changes (Mar 2026 — CC Module Drop All Roles + Panel Fallback)
- **DragProvider.jsx**: Replaced `payload?.type === "module" && payload?.sourceType === "command-center" && containerId` handler with a full role-based handler:
  - `role === "instance"` (or undefined): drops on container OR panel (panel fallback = first droppable container in panel). Removes `&& containerId` requirement.
  - `role === "container"`: drops on panel → calls `LayoutHelpers.createContainerInPanel`.
  - `role === "panel"`: drops on grid cell → updates occurrence placement to new cell (uses `panelModule._occurrenceId` to find existing occurrence).

## Recent Changes (Mar 2026 — Sortable Wire + DragContext Split)
- **DragProvider.jsx**: Added sortable check before instance reorder — `if (sameContainer && toC?.behaviorMode === "own" && toC?.behavior?.sortable === false) { clearSession(); return; }`. Placed right after `const sameContainer = fromC.id === toC.id`.

## Recent Changes (Mar 2026 — Phase 5.2 Behavior Toggles)
- **LayoutHelpers.js**: Added `resolveBehavior(entity, parent)` — returns `{ sortable, draggable, droppable }`, cascading from parent if `entity.behaviorMode === "inherit"`. Default: all true.
- **DragProvider.jsx**: Added droppable check — if `toC.behaviorMode === "own" && toC.behavior?.droppable === false`, drops onto that container are rejected.

## Recent Changes (Mar 2026 — Operation Drop from Command Center)
- **DragProvider.jsx**: Added handler for `type: "operation"` drops with `sourceType: "command-center"`. When dropped onto an instance, adds to `instance.operationBindings` with `widgetType: "trigger"`. Dedup check prevents duplicate binding.
- **DragProvider.jsx**: Added handler for `type: "module"` drops with `sourceType: "command-center"`. When dropped onto a container, calls `LayoutHelpers.copyInstanceToContainer` (iterationMode: "persistent"). Handler placed between OPERATION and FIELD handlers.

## Recent Changes (Mar 2026 — DragContext Split)
- **dragSystem.js**: Added `DragHotContext` + `useDragHotContext()`. This context only contains `{ hotTarget, panelOverCellId }` — things that change during drag hover. Main `DragContext` no longer includes these.
- **DragProvider.jsx**: `contextValue` (stable) no longer has `hotTarget`/`panelOverCellId` in deps. New `hotContextValue = useMemo(()=>({hotTarget, panelOverCellId}), [...])`. Wraps children with `<DragHotContext.Provider value={hotContextValue}>` inside `<DragContext.Provider>`.
- **Impact**: During drag hover (container crossings), only `DragHotContext` changes. `ModuleContainer`/`ModuleInstance` subscribe only to stable `DragContext` → no re-renders during hover. `ModulePanel` subscribes to `useDragHotContext()` for `hotTarget`.
- **CommitHelpers.js**: Added 3 operation action functions: `setOccurrenceFieldValue`, `moveOccurrence`, `createOccurrenceInContainer`.
- **DragProvider.jsx**: `lastHotRef` deduplication — `setHotTarget` only fires when panel/container/instance actually changes. `clearSession` resets `lastHotRef`.
- **Deleted**: `Panel.jsx`, `SortableContainer.jsx`, `SortableInstance.jsx` — fully replaced by `Module.jsx`.

## Recent Changes (Feb 21)
- LayoutHelpers.js: Added copyPanel, copylinkPanel, splitPanel, unsplitPanel functions
