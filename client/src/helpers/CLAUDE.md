# client/src/helpers — Helpers CLAUDE.md

_Updated: 2026-03-31. Check this file before re-reading source._

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
