# client/src — Source Root CLAUDE.md

_Updated: 2026-04-06. Check this file before re-reading source._

## Recent Changes (Apr 6 2026 — Phase E: Iframe Removal + Dead Code Cleanup)
- **main.jsx**: Removed `previewOcc` URL param check and `PagePreviewApp` dynamic import. Always loads `App` directly. Removed dynamic import pattern.
- **PagePreviewApp.jsx**: DELETED — was the iframe preview app entry point creating extra socket connections.
- **helpers/thumbnailCache.js**: DELETED — iframe pool manager for preview thumbnails.

## Recent Changes (Mar 26 2026 — Panel Cycler Empty State)
- **Grid.jsx**: `GridCell` now accepts `hasHiddenStack` prop. When `!hasPanel && hasHiddenStack`, shows a "show" button (Layers icon) in the pocket that calls `cyclePanelStack({ cellKey, dir: 1 })`. Pocket `pointerEvents: "auto"` when hasHiddenStack. `cellsData` now computes `hasHiddenStack = !hasPanel && cellPanels.length > 1`.

## Key Files

| File | Purpose | Last Changed |
|------|---------|--------------|
| `App.jsx` | Root component. Socket.io setup, GridActionsContext/GridDataContext providers, undo/redo lifted here. Filter handlers. **Mobile: isMobile + activeCell + zoomedOut state lifted here, passed via actionsValue context.** | Mar 18 |
| `Grid.jsx` | Main grid layout. Panel placement via CSS grid. **Mobile: wraps GridRender in MobileGridNav, hides resize handles, clamps activeCell on dimension change. StackOverlay component renders AFTER panels for z-index stacking.** | Mar 18 |
| `modules/Module.jsx` | **PRIMARY RENDERING COMPONENT.** Unified Panel/Container/Instance/Canvas in one file. Replaces old Panel.jsx, SortableContainer.jsx, SortableInstance.jsx. Has context menus (right-click) for all entity types. | Mar 2026 |
| `modules/` | Module.jsx + supporting files. Active rendering system for all entity types. | Mar 2026 |
| `ResizeHandle.jsx` | Panel resize corner handle | Stable |
| `Toolbar.jsx` | Top toolbar: logo, `+Panel` button, grid select, filter nav, Pomodoro, Clock (history), CC button, EyeOff hide, account avatar. **Mobile: MiniGridMap SVG in left section — click toggles zoomed-out mode.** | Mar 18 |
| `GridActionsContext.js` | Context: dispatch, socket, all entity maps (modulesById, occurrencesById, fieldsById, manifestsById, viewsById, operationsById, foldersById, computedValues) | Mar 2026 |
| `GridDataContext.js` | Context: read-only state for components that don't dispatch | Stable |
| `index.css` | Global CSS. Semantic tokens. **Section 14: Mobile Grid Nav CSS (viewport, slider, lip buttons, edge glow, zoom-out overlay). Section 15: Responsive (was 13).** | Mar 18 |
| `hooks/useMobileDetect.js` | **NEW** — `useMobileDetect()` hook. Returns `{ isMobile }` via `matchMedia(max-width: 600px)`. Exports `MOBILE_BREAKPOINT`. | Mar 18 |
| `mobile/MobileGridNav.jsx` | **NEW** — Zelda-style viewport wrapper. Transform-based cell navigation with lip buttons. **Zoomed-out mode**: scales grid to fit viewport with CellOverlay for selection, animated transition. Desktop passthrough. | Mar 18 |
| `mobile/MiniGridMap.jsx` | **NEW** — Tiny SVG grid indicator for toolbar. Click toggles zoomed-out mode. Returns null for 1x1. | Mar 18 |
| `ui/FilterNav.jsx` | Named filter dropdown + conditional date nav. Replaces old IterationNav.jsx. compact=true for toolbar. | Mar 2026 |
| `ui/CommandCenter.jsx` | **11-tab** command center: Fields/Operations/Filters/Grid/Appearance/Components/Files/Connections/Lists/UserSettings/Shortcuts. | Mar 16 |
| `ui/ContextMenu.jsx` | Right-click context menu portal. Pattern: `useState(null)` + `onContextMenu` + `<ContextMenu ctx={...} onClose={...} />` | Mar 2026 |
| `ui/Editor.jsx` | General-purpose TipTap editor. FieldPill/InstancePill/DocLink/ExprPill/ModuleEmbed extensions. Drop reformat dialog. Block handles. Click-to-focus. | Mar 14 |

## Architecture Rules
- **modules/Module.jsx** is the primary rendering component — NOT the old Panel.jsx/SortableContainer.jsx/SortableInstance.jsx (those files are DELETED).
- Panel/Container/Instance drag handles = the RadialMenu wrapper div (ref=handleRef). NOT separate GripVertical for panels/containers.
- Instance drag handle = GripVertical at `left: 0` inside `.instance-wrap`. Shows on hover via CSS, hidden during `.dragging`.
- Context menus use `<ContextMenu>` portal. Pattern: `useState(null)` + `onContextMenu` + `<ContextMenu ctx={ctxMenu} onClose={() => setCtxMenu(null)} />`.
- No component calls socket directly — all mutations go through CommitHelpers.
- Filter system (not iteration): `grid.namedFilters`, `grid.activeFilterId`, `grid.activeFilterValues`. FilterNav.jsx is the nav component.

## Recent Changes (Mar 25 2026 — Batch 3: Escape + Default Page + Tree Thumb)
- **App.jsx**: Added global Escape key `useEffect` — closes history dialog first (if open), then CommandCenter. Checks `e.defaultPrevented` so inner menus (RadialMenu, QuickAddMenu) get priority. Skips when focus is in input/textarea/contentEditable.

## Recent Changes (Mar 20 2026 — C4 Context Split + Post-Review Fixes)
- **GridLiveContext.js** (NEW): Frequently-changing values split from GridActionsContext: `computedValues`, `canUndo/canRedo/undo/redo/isProcessing`, `isMobile/activeCell/setActiveCell/zoomedOut/setZoomedOut`.
- **App.jsx**: `actionsValue` dep array uses granular state subfields (`state.grid`, `state.occurrences`, etc.) instead of full `state` — deliberately excludes `state.computedValues` so computedValues changes don't force all GridActionsContext consumers to re-render. `liveValue` useMemo provides the live values. `GridLiveContext.Provider` wraps children alongside existing providers.
- **GridActionsContext.js**: Removed `computedValues`, undo/redo, mobile state from defaults.
- **Grid.jsx**: Split context consumption — stable values from GridActionsContext, live values from GridLiveContext.
- **docs/pills/ExprPillNode.jsx**: Migrated `computedValues` read from GridActionsContext → GridLiveContext (was broken — reading empty default).
- **docs/hooks/useDocFieldValues.js**: Same migration for both `useDocFieldValues()` and `useFieldValue()` hooks.
- **Impact**: When `computedValues` changes (every operation run), only Instance.jsx + FieldRenderer.jsx + doc pills re-render — not all 200+ context consumers.

## Recent Changes (Mar 19 2026 — Mobile Drag + UI Fixes)
- **dragSystem.js**: Fixed 3 mobile touch issues: (1) Removed `e.preventDefault()` from `onStart` — native click/pointer events now fire for taps (fixes RadialMenu/Popover). (2) Cache `getBoundingClientRect()` at touchstart (fixes clone stuck at top-left). (3) Only `preventDefault` in `onMove` after threshold. Removed synthetic click dispatch. Removed `touchStartTime`.
- **Panel.jsx, Container.jsx, Instance.jsx**: `.module-handle` + `.module-dot` replaced with `.module-drag-handle` + `.drag-handle-stem` + `.drag-handle-ball` (knob-on-stem). All RadialMenu `forceDirection` set to `"down"`.
- **App.jsx**: Removed `cc-drawer-handle` div (Terminal button in Toolbar already toggles CC).
- **MobileGridNav.jsx**: `LipButton` replaced with `RailButton` — full-height/width edge rails, inset 4px from screen edges (avoids Samsung back-gesture zone).
- **index.css**: (1) `.module-handle`/`.module-dot` → `.module-drag-handle`/`.drag-handle-stem`/`.drag-handle-ball` with updated hover selectors. (2) `.cc-drawer-handle` removed. (3) `.mobile-lip-btn` replaced with `.mobile-rail-btn` (full-length, fixed, inset from edges). (4) Cog handle now shows stem+ball at rest, radial on hover.

## Recent Changes (Mar 18 2026 — Mobile UX Fixes v4)
- **Panel.jsx**: Stack cycler button added INSIDE panel header, left of QuickAddMenu (+). Uses `dragCtx.getStackForPanel(module)` for count. Only renders when `stack.length > 1`. Added `Layers` import. Added `forceDirection="right"` to panel RadialMenu. Label span gets `minWidth: 0` for proper truncation.
- **Grid.jsx**: StackOverlay component REMOVED entirely. GridCell empty pocket now shows `.panel-stack-btn-inline` button (same style as panel header button) with `isEmpty: true` for correct cycling. Button positioned top-right of pocket (`justifyContent: flex-end`).
- **DragProvider.jsx**: `cyclePanelStack` speed fix — `emit: idx === stack.length - 1` (only emits on last panel, cutting N socket calls to 1).
- **index.css**: Replaced `.panel-stack-btn` (absolute positioned overlay) with `.panel-stack-btn-inline` (inline flex button, 20px height, used in both panel header and empty cell pocket).

## Recent Changes (Mar 18 2026 — Mobile UX Fixes v3)
- **RadialMenu.jsx**: `calcOpenDirection` now ALWAYS returns 'right' (handles are on left wall). Default direction state changed from 'left' to 'right'. Removed viewport clamping code (was squishing items). Spread stays at 45°. Removed "Add" button from default menu items.
- **DragProvider.jsx**: 3-layer Android split-screen prevention: `dragover`/`dragenter` + `touchmove` (all `passive:false`). `cyclePanelStack` now accepts `isEmpty` flag for proper empty-slot cycling.

## Recent Changes (Mar 18 2026 — Mobile UX Fixes v2)
- **Grid.jsx**: StackOverlay extracted as separate component rendered AFTER panels in CSS grid (z-index: 80, pointer-events: none wrapper, pointer-events: auto on buttons). Removed z-index: 65 from GridCell (was blocking all panel interaction). GridRadialMenu conditionally hidden on mobile (`{!isMobile && <GridRadialMenu>}`).
- **index.css**: Removed `.module-handle .module-dot { display: none !important; }` from mobile media query — was breaking drag handles. Down lip button CSS retained (safe-area offset + 24px height).
- **DragProvider.jsx**: `touch-action: none` on `document.documentElement` during drags (mobile only) to prevent Android split-screen interception.
- **RadialMenu.jsx**: Arc item viewport clamping (per-item position clamped to viewport bounds). Spread capped to prevent 360-degree wraparound.
- **E2E tests**: `tests/e2e/mobile-fixes.spec.js` — verifies no z-index blocking, drag handles visible, GridRadialMenu hidden on mobile, stack overlay z-index/pointer-events, down lip button.

## Recent Changes (Mar 18 2026 — Mobile UX Refinements)
- **MobileGridNav.jsx**: Removed swipe-to-navigate (swipe now scrolls cell content). Navigation is now lip buttons + minigridmap + drag-to-edge only. Lip button icons shrunk from `size={14}` to `size={10}`.
- **ModuleInstance.jsx**: Changed `touchAction: "none"` → `touchAction: "manipulation"` on `.instance-wrap` — allows normal scrolling through instance elements.
- **index.css**: Lip buttons shrunk from 28x72px to 16x40px. Added `.panel-stack-overlay` CSS (absolute bottom-right, two small prev/next arrows). Removed mobile rules that hid radial menus. Removed duplicate `.panel-scroll` bottom padding, bumped `.panel-content` to 48px. Added `.mobile-lip-btn-down` safe-area offset + bigger tap target. Added `.mobile-grid-viewport` safe-area padding.
- **Panel.jsx**: Panel cog handle removed entirely — right-click context menu has "Show/Hide header" option instead. `onContextMenu` added to panel shell div. ResizeHandle now in a flex bottom bar (inline flow, not overlayed).
- **ResizeHandle.jsx**: Changed from `position: absolute` to inline flow (`flexShrink: 0`, `marginLeft: auto`). No longer overlays panel content.
- **Panel.jsx**: Removed stack nav from header (moved to Grid overlay). Removed `showStackHint` state + useEffect.
- **App.jsx**: CC drawer handle height same on mobile/desktop (14px, was 24px on mobile). Grid-frame `onTouchStart` — swipe up (dy < -30) closes CC when open.

## Recent Changes (Mar 13-14 2026 — Filter System Cleanup)
- **App.jsx**: Removed all old iteration state/handlers (selectedIterationId, currentIterationValue, iterations, categoryDimensions, etc.). Added `handleSelectFilter` + `handleFilterValueChange` to actionsValue.
- **Toolbar.jsx**: Added `useEffect` for `Ctrl+[` / `Ctrl+]` — cycles through `grid.namedFilters` by index. Skips when focus is in input/textarea/contentEditable. Removed dead `selectedDim`/`categoryValueOpts` lines.
- **GridLayoutForm.jsx**: Rewrote — removed entire Iterations section. Now only: Grid Name + Rows/Cols + Delete + Day Page Template picker.
- **ui/Editor.jsx**: `doc-editor-wrapper` onClick calls `editor.commands.focus("end")` when clicking empty space below content (D8 — click & type anywhere).

## Recent Changes (Mar 2026 — U1 Undo Animations)
- **App.jsx**: Added `useAnimations` import. `captureAllPositions()` called before `_undo()` via wrapped `undo` function. `onUndoAnimation` callback passed to `useUndoRedo` → calls `animateToNewPositions + flashElement` after 100ms (waits for sync_state re-render). Duplicate Grid.jsx `undo_result` listener removed.
- **Grid.jsx**: Removed `useAnimations` import + `socket.on("undo_result")` duplicate handler. Now a comment: "Animation hook moved to App.jsx".

## Recent Changes (Mar 14 2026 — F5 + D8)
- **Toolbar.jsx**: Added `useEffect` for `Ctrl+[` / `Ctrl+]` keyboard shortcut — cycles through `grid.namedFilters` by index, calls `onSelectFilter`. Skips when focus is in an input/textarea/contentEditable. Dependency on `grid.namedFilters`, `grid.activeFilterId`, `onSelectFilter`.
- **ui/Editor.jsx**: `doc-editor-wrapper` div now has `onClick` handler — when `e.target === e.currentTarget` (clicked empty space below content) and editor is editable, calls `editor.commands.focus("end")`. Enables clicking anywhere in the doc area to position cursor.

## Recent Changes (Mar 2026 — Toolbar + Font + EntityTree)
- **Toolbar.jsx**: Removed `ButtonPopover` + separate `toolbarRadialItems` RadialMenu. Settings cog is now a `RadialMenu` handle with 5 items: Grid Settings, Add Panel, Undo, History, Redo. Grid Settings item opens a floating `<div>` with `GridLayoutForm` (absolute positioned, outside-click to close via `useEffect`). Removed right-side PlusSquare RadialMenu. Removed `ButtonPopover` import.
- **index.css**: `body` font-family changed from `system-ui, -apple-system...` to `var(--font-mono)` (JetBrains Mono, matches site name).
- **CommandCenter.jsx**: Added `DraggableEntityRow` component (before `EntityTreeTab`). Panels and containers in EntityTreeTab now use `DraggableEntityRow` — when collapsed: renders as draggable pill (same style as `DraggableInstanceRow`), when open: renders as tree header. Collapsed panels/containers are draggable via Pragmatic DnD (type: "module", role: "panel"|"container", sourceType: "command-center"). DragProvider already handles all three roles.

## Recent Changes (Mar 2026 — CSS Organization + data-testid)
- **App.jsx**: Added `data-testid="app-root"` to grid-frame root div (line 788).
- **Toolbar.jsx**: Added `data-testid="toolbar"` to toolbar wrapper div (line 121).
- **Module.jsx**: Added `data-testid="panel-shell"`, `"container-shell"`, `"instance-wrap"`. Replaced 10 drop indicator inline styles with CSS classes (`drop-indicator drop-indicator-top/bottom/left/right`, inst variants, `drop-indicator-insert`). Replaced `module-handle` grab zones with `module-grab-zone`. Replaced empty placeholders with `empty-placeholder` / `empty-placeholder-inline`. Replaced linked-copy badge style with `linked-copy-badge`.
- **index.css**: Fully reorganized into 14 numbered sections. Dead `App.css` deleted. New classes: `drop-indicator` series, `module-header-row`, `module-grab-zone`, `empty-placeholder`, `empty-placeholder-inline`, `linked-copy-badge`, `flex-center`, `flex-center-gap`, `abs-fill`, `scroll-y`, `truncate-text`.

## Recent Changes (Mar 17 2026 — Instance Collapse/Expand + Doc Anchor Fix)
- **Instance.jsx**: Added `isExpanded` (default `true`) + `onToggleExpand` (default `null`) props. ChevronRight/ChevronDown before label when collapsible. Fields + ops wrapped with `(isExpanded || !onToggleExpand)`. Collapsed shows `···` placeholder; fields area click-to-expand.
- **ModuleInstance.jsx**: Added `isDocContainer = false` prop + `isExpanded` state (default `false`). Doc container instances always expanded (no toggle). List instances start collapsed, click chevron or `···` to reveal fields.
- **Container.jsx**: Added `occurrenceOverride` prop → `containerOccurrence` uses it directly when provided. Passes `isDocContainer` to `ModuleInstance`.
- **ModuleEmbedNode.jsx**: Passes `occurrenceOverride={occurrence}` to `<Container>` so embedded containers use their specific occurrence (not first-found by targetId).
- **ManifestTree.jsx**: Fixed anchor chip `parentOccId` propagation bug. Nested anchors were passing `parentOccId={occ.id}` (wrong — container occ) to children. Now passes `parentOccId={parentOccId}` (root doc occ) at all depths. Fixes "opens as new thing" — clicking nested anchor now scrolls to embedded container in parent doc instead of switching active doc.

## Recent Changes (Mar 13 2026 — Filter System Cleanup)
- **App.jsx**: Removed all old iteration state/handlers (`selectedIterationId`, `currentIterationValue`, `iterations`, `categoryDimensions`, `selectedCategoryId`, `currentCategoryValue`, `handleCommitIterations`, `handleSelectIteration`, `handleIterationValueChange`, `handleSelectCategory`, `handleCategoryValueChange`, `handleCommitCategoryDimensions`) from `dataValue` and `actionsValue` useMemos and their dependency arrays. Added `handleSelectFilter` + `handleFilterValueChange` to `actionsValue`.
- **Toolbar.jsx**: Removed dead `selectedDim`/`categoryValueOpts` lines (referenced old `categoryDimensions` prop). Removed `onCommitIterations` prop passed to `GridLayoutForm`.
- **GridLayoutForm.jsx**: Rewrote — removed entire Iterations section (old UI). Now only shows Grid Name + Rows/Cols + Delete. No more iteration CRUD.

## Recent Changes (Mar 12 2026 — E2E State Exposure)
- **App.jsx**: Added `window.__moduli_state__ = state` (inline after stateRef.current update). Exposes Redux state to Playwright E2E tests for data verification. Does NOT affect production behavior — only sets a window property.

## Recent Changes (Mar 2026 — CommandCenter Auto-Collapse on Drag)
- **App.jsx**: Added `monitorForElements` (Pragmatic DnD) at app level — `onDragStart` sets `commandCenterOpen(false)`. CC auto-collapses when any drag starts, revealing the grid as drop target.
- **App.jsx**: Added `commandCenterEverOpened` flag. CommandCenter stays mounted once opened (`{commandCenterEverOpened && <CC>}` instead of `{commandCenterOpen && ...}`). This enables the slide-up animation on close because CC stays in DOM with `maxHeight` transition.

## Recent Changes (Feb 22 Session 3 — Toolbar redesign + loading fix)
- **Toolbar.jsx**: Complete redesign. Left: Logo+gear+GridSelect+inline[+]. Center: IterationNav+CategoryFilter. Right: Pomodoro+Terminal+RadialMenu(AddPanel/Undo/History/Redo). Removed separate +Panel, +Grid, Undo/History/Redo buttons. Uses `RadialMenu` with `items` prop + `forceDirection="down"`.
- **App.jsx**: Loading state redesigned — logo+spinner inside the bordered grid-frame box (no more absolute SpinnerOverlay). DrawerHandle redesigned to pill-style (36px horizontal pill, blue when CC open). Removed ChevronDown import.
- **DocEditor.jsx**: TDZ fix applied — `handleContextMenu` moved to AFTER `const editor = useEditor(...)` (line 218).

## Recent Changes (Feb 22 Late — Bug Fixes)
- Module.jsx: Removed `display: "flex"` from inline styles on module-handle divs (panel + container). CSS now controls display fully.
- index.css: Changed `.module-handle` from `opacity: 0` to `display: none`; hover shows `display: flex`. No layout space when hidden.
- ui/RadialMenu.jsx: Changed `action?.()` → `action?.(e)` in `handleAction`. Event is now passed to onAddChild/onSettings/onToggleDragMode so they can use getBoundingClientRect() for positioning.

## Recent Changes (Feb 22 — Operations Pipeline)
- App.jsx: Added stateRef (useRef), passed to bindSocketToStore as 3rd arg
- App.jsx: computedValues exposed in GridActionsContext.Provider value
- GridActionsContext.js: computedValues: Object.create(null) added to context defaults
- FieldRenderer.jsx: Rewritten to use inputEnabled/displayEnabled + reads computedValues from context
- FieldDisplay.jsx: Updated displayValue to handle new displayEnabled schema + displayConfig target support
- FieldPillDisplay.jsx: Updated to accept `value` prop (executor-computed) + displayConfig target support
