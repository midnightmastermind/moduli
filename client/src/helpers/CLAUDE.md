# client/src/helpers — Helpers CLAUDE.md

_Updated: 2026-03-18. Check this file before re-reading source._

## Key Files

| File | Purpose | Last Changed |
|------|---------|--------------|
| `DragProvider.jsx` | Drag state coordinator. Manages `monitorForElements`. Handles all drop logic: move/copy/copylink instances+containers+panels. Skips normal move when target is `kind: "doc"` (DocContainer handles it). Handles field drops from command-center → adds to instance fieldBindings. **Mar 10: Refactored to use draftOccurrences map instead of draftContainers/draftPanels occurrence arrays for live preview. All drop handlers now pass occurrence objects (panelOccurrence, containerOccurrence) to LayoutHelpers.** | Mar 2026 |
| `CommitHelpers.js` | All CRUD operations. **ONLY place that calls socket.emit**. Exports: createInstanceInContainer, deleteOccurrence, updatePanel, deletePanel, updateContainer, deleteContainer, createView, updateView, updateOccurrence, updateGrid, etc. | Stable |
| `CalculationHelpers.js` | All 15 aggregation types. `calculateDerivedField` checks `metric.blockTree` first (evaluateBlockTree via require()), falls back to flat `allowedFields`. | Recent |
| `LayoutHelpers.js` | Occurrence filtering (getPanelContainers, getContainerItems, getContainerItemsWithOccurrences, occurrenceMatchesIteration). Panel duplication/linking/splitting. **Mar 10: Major refactor — occurrence.occurrences is the SOLE source of ordering. All add/remove/reorder/move functions now take `panelOccurrence`/`containerOccurrence` params and call updateOccurrence (not updatePanel/updateContainer). No module.occurrences fallback anywhere.** | Mar 2026 |
| `dragSystem.js` | Pragmatic DnD hooks: useDraggable, useDroppable, useDragDrop. DragType enum (PANEL, CONTAINER, INSTANCE, FIELD, ARTIFACT, EXTERNAL). DropAccepts map. `dragHandleRef` param restricts drag origin to specific element. | Stable |
| `StyleHelpers.js` | `resolveContainerStyle`, `resolveInstanceStyle`, `styleToCSS`. Cascading style resolution: panel defaults → container overrides → instance overrides. | Recent |
| `CommitHelpers.js` exports (key): | createInstanceInContainer, deleteOccurrence, deletePanel, deleteContainer, updatePanel, updateContainer, updateOccurrence, updateGrid, createView, updateView, saveTemplate, fillFromTemplate | Stable |
| `blockTypes.js` | **MOVED here from blocks/** — Block type constants for visual operations builder. | Mar 2026 |
| `blockEvaluator.js` | **MOVED here from blocks/** — Recursive block tree evaluator. | Mar 2026 |
| `operationActions.js` | **MOVED here from blocks/** — resolveExpr, evalRule, evalGroup, extractFieldValuesFiltered, executeActionItem. | Mar 2026 |
| `operationExecutor.js` | **MOVED here from blocks/** — executePipeline, runMatchingOperations. Imports operationActions. | Mar 2026 |
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
