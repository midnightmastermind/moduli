# client/src/modules/ — New Module Rendering System

_Updated: Mar 18 2026. This folder implements occurrence-based view routing._

## Architecture

The new system links views to occurrences (`occurrence.viewId → View`) instead of modules (`module.viewId → View`).

## File Map

| File | Purpose |
|------|---------|
| `Module.jsx` | Thin router — passes occurrence to `<View>` |
| `View.jsx` | Layout + sidebar routing. Reads `viewsById[occurrence.viewId]`. Handles `hasTree` sidebar. Routes to Panel/Container/Instance/Artifact |
| `Panel.jsx` | Panel shell renderer (extracted from `client/src/Module.jsx` `ModulePanel`). Uses `occurrence.viewId || module.viewId` for view lookup |
| `Container.jsx` | Container orchestrator — state, hooks, full render tree. 940 lines. |
| `containerHelpers.jsx` | **DocEditorShell** + **PoolPill** + **CanvasCard** sub-components used by Container.jsx. |
| `containerPopups.jsx` | **FilterOverridePopup** + **TemplatePickerPopup** portal popups used by Container.jsx. |
| `ModuleInstance.jsx` | Instance drag wrapper within Container. Handles DnD, context menu, doc toggle. |
| `Instance.jsx` | Instance inner row (extracted from `client/src/Instance.jsx`). Label + field pills + operation widgets |
| `Artifact.jsx` | File content renderer. `viewType="markdown"` → Editor.jsx (TipTap, auto-saves textmap). `viewType="artifact"` + `artifactType="image|pdf|audio|video"` → file viewer. |
| `PreviewCard.jsx` | Preview view renderer. `viewType="preview"` → thumbnail card + label + "View Full" button. Draggable (type: "module", sourceType: "preview-card"). Click "View Full" → `updateView({ viewType: "artifact" })`. |

## Key Differences from Legacy Module.jsx

- **Panel.jsx**: `resolvedViewId = panelOccurrence?.viewId || module.viewId` — checks occurrence first
- **View.jsx**: `resolvedView = viewsById[occurrence.viewId]` — occurrence is the source of truth
- **Container.jsx**: `isDocContainer` derived from `containerOccurrence?.viewId` (new) falling back to `module.kind === "doc"` (legacy)
- **ManifestTree**: placeholder in View.jsx — renders sidebar when `resolvedView.hasTree && resolvedView.manifestId`

## ModuleEmbed Extension (Mar 2026)
- `client/src/docs/ModuleEmbedExtension.js` — TipTap block node `{ name: "moduleEmbed", group: "block", atom: true }`. Attrs: `occurrenceId`. Renders `<Container embedded>` via ReactNodeViewRenderer(ModuleEmbedNode).
- `client/src/docs/ModuleEmbedNode.jsx` — NodeViewWrapper reads `occurrencesById[occurrenceId]` + `modulesById[occ.targetId]` from GridActionsContext, renders Container.
- `Editor.jsx` extensions now include `ModuleEmbed`.
- `Artifact.jsx`: removed `childOccs.map(<Container>)` — containers are now moduleEmbed TipTap nodes. Filename badge fixed (outer div `overflow:hidden`, inner div `overflowY:auto`).
- `Container.jsx` `DocEditorShell`: adds `is-editing` CSS class to `.doc-container` div. Passes `stickyToolbar={!hideToolbar}` to Editor.
- `Editor.jsx` new prop: `stickyToolbar` — wraps DocToolbar in `.doc-toolbar-sticky` div when true.
- `Instance.jsx`: label `flexShrink:0`, fields container `flex:1` — no wrapping around label.
- `ManifestTree.jsx`: anchor child block `paddingBottom: 6`.

## Recent Changes (Mar 18 2026 — Mobile Fixes)
- **Panel.jsx**: Removed panel cog handle entirely (`.panel-cog-handle` block deleted). Right-click context menu now includes "Show/Hide header" for the same functionality. `onContextMenu` added to panel shell div. ResizeHandle moved from absolute overlay to inline flex bottom bar.

## Recent Changes (Mar 17 2026 — Instance Row CSS Fix)
- **Instance.jsx**: Changed root div class from `dnd-instance` to `instance-row` to deconflict from the legacy inline chip `.dnd-instance` rule (which was applying `display: inline-flex` + `background: #4372ac` to all instance rows).
- **index.css**: Updated selectors `.instance-wrap > .dnd-instance` → `.instance-wrap > .instance-row` + `.dragging .instance-wrap:hover > .dnd-instance` → same. Added `display: block` to `.instance-wrap > .instance-row`. Raised card background opacity from `0.35` to `0.55` so `.instance-pocket` inset shadow doesn't bleed through. Added `instance-row` to the `.hidden` rule and the mobile responsive rule.

## Status (Mar 2026 — Latest Session)

### Changes Applied
- **Container.jsx**: `onInstanceFocus={null}` — drill-down disabled. Embedded header Row 2 padding changed from `"1px 8px 3px 8px"` to `"0px 8px 3px 12px"` (aligns `#` hash with editor body text, removes extra top space).
- **Instance.jsx**: Radial menu handle moved INSIDE the right-side flex div (grouped with label). No longer floats outside as a sibling. `alignSelf: "flex-start"` + `flexShrink: 0`.
- **createDefaultUserData.js**: (1) Documents folder sortOrder → 0, Day Pages → 1. (2) Notes+Phil parent docs consolidated into ONE "Philosopher's Stone" (philParentOccId) — removed notesParentModId/notesParentOccId. (3) morenotes sections now under philParentOccId. (4) phil section sortOrder = notesSectionOccIds.length + i. (5) Added `splitIntoBlocks`+`createBlockInstances` helpers — sections without H2 instances get paragraph-block docInstances. (6) Added root .md files to Notes folder: uses.md, PRAGMATIC.md, aispecs.md, banglespecs.md (sortOrders 1-4). (7) Journal Q&A container body changed from instancePill to direct fieldPill for answer field.

## Status (Mar 2026 — Session 3 Changes)

### Changes Applied
- **ManifestTree.jsx**: Added Pragmatic DnD drag-and-drop. DocNode file rows are draggable (`type: "artifact"`, payload: `{ occurrenceId, parentId }`). FolderNode is a drop target — on drop calls `CommitHelpers.updateOccurrence({ parentId: folder.id, sortOrder: maxOrder+1 })`. Folder header highlights teal (`isDragOver` state) when dragged over. Added `useRef`, `useEffect`, `draggable`, `dropTargetForElements` imports.
- **ManifestTree.jsx**: Anchor chip brightness increased: bg alpha 0.08→0.14, border alpha 0.25→0.42, text alpha 0.75→0.92 (inactive). Fallback colors also brightened.
- **Instance.jsx**: Radial handle (Popover) and label div wrapped in shared `<div flex row>` so they're visually grouped. Fixed radial menu going outside box bounds.
- **createDefaultUserData.js**: Removed `splitIntoBlocks` + `createBlockInstances` helpers. Sections WITH actual H2 instances → instancePill block nodes. Sections WITHOUT → plain markdown via `makeDocContent(entry.extraLines)` directly in textmap. This eliminates empty block instances in the notebook.

## Status (Mar 11 2026 — Session 4 Changes)

### Container.jsx + Panel.jsx — Hideable Header + Cog Handle
- **Container.jsx**: Added `showHeader` state (default `true`). When `false`: header div not rendered, absolute-positioned `.container-cog-handle` div appears (with `ref={containerHandleRef}` — drag still works). Cog has "Show Header" item in RadialMenu. When `true`: header shows "Hide Header" item in RadialMenu.
- **Panel.jsx**: Same pattern. `.panel-cog-handle` class. `dragRef` moved to outer `panel-shell` div (was on header div — was broken when header hidden). `headerDropRef` still on header.
- **RadialMenu.jsx**: Added `Eye`/`EyeOff` imports. Added `onToggleHeader`/`showHeader` props. Adds "Hide Header"/"Show Header" item to default items list when `onToggleHeader` is provided.
- **index.css**: Added `.container-cog-handle`/`.panel-cog-handle` CSS — absolute top-left, opacity 0, reveals on shell hover. Added `.container-cog-handle .radial-menu` show rules. Added ProseMirror `pre`/`code` codeblock styles.

### ManifestTree.jsx — Folder Indent + Anchor Ellipsis
- **Folder children indent**: Changed `depth={depth}` → `depth={depth + 1}` for artifact docs inside FolderNode. Now child docs are 12px more indented than folder label.
- **Anchor overflow**: Added `overflow: "hidden"` to anchor chip outer div and chip inner div. Long labels now truncate with `...`.

## Status (Mar 11 2026 — Session 5 Changes)

### Instance.jsx — Hideable Label
- **Instance.jsx**: Added `showLabel` state (default `true`). `{showLabel && hasLabel && <label>}` and `{showLabel && hasFields && <fields>}`. RadialMenu gets `onToggleHeader`/`showHeader` for non-linked occurrences (adds Eye/EyeOff item to default items). Linked occurrences include toggleLabelItem in custom radialItems array.

### Toolbar.jsx — Hideable Toolbar
- **Toolbar.jsx**: Added `toolbarVisible` state. Added "Hide Toolbar" to `cogRadialItems`. When `!toolbarVisible`: renders fixed-position small RadialMenu cog at top-left with single "Show Toolbar" item.

### index.css — Hash Spacing Collapse
- **index.css**: `.embedded-container-header .embedded-hash` now uses `max-width: 0; overflow: hidden; display: inline-block` (was just opacity 0). Transitions to `max-width: 14px` on hover so the space collapses when hidden.

### ManifestTree.jsx — Anchor Tree + Toggle Arrow
- **ManifestTree.jsx**: Anchor chips now have a ▾/▸ toggle arrow (separate from chip click). Clicking arrow toggles `open` state; clicking chip navigates. Child anchor chips use `parentOccId={occ.id}` (was `parentOccId={parentOccId}`) so child chips navigate to their parent container, not the root doc.

### createDefaultUserData.js — Q&A Fix + Anchor Instance parentId
- **createDefaultUserData.js**: Journal Q&A `containerDocContent` now shows BOTH questionFieldKey fieldPill (display, "Q: ") AND answerFieldKey fieldPill (input, "A: ") in the container body.
- **createDefaultUserData.js**: Instance occurrences inside doc containers (morenotes, phil sections) now have `parentId: contOccId` and `sortOrder: j` — so they appear as child anchor chips under their container anchor chip in ManifestTree.

### tests/e2e/dnd.spec.js — DnD Tests
- **tests/e2e/dnd.spec.js**: NEW file. Tests: handle visibility (panel/container/instance dots), instance intra-container drag, cross-container instance drag, container intra-panel drag, panel drag smoke test, hideable header smoke test, toolbar visibility.

## Status (Mar 2026 — C1-C3 Canvas + U2 File Preview + Pool Fix)

### Changes Applied
- **Container.jsx**: Added `isCanvasContainer = module.kind === "canvas"`. Added `CanvasCard` component (pointer-event drag, saves `occurrence.meta.x/y` on `pointerUp` via `updateOccurrence`). Canvas rendering branch: dot-grid background, double-click creates card at cursor position. Fixed canvas double-click to use `initialMeta: {x,y}`.
- **Instance.jsx**: Added inline file preview — when `instance.fileRef` exists, renders `<img>`/`<video>`/`🎵` (36px height) before the fields area.
- **server/socketHandlers/crud.js**: Added `create_instance_in_container` handler — creates Module + Occurrence, appends to container's `occurrences[]`, broadcasts `module_created`/`occurrence_created`/`occurrence_updated`. Also accepts optional `occurrenceId` + `meta` for canvas positioning. Fixes pool persistence bug (pool items added via UI were previously not persisted to DB).
- **client/src/helpers/CommitHelpers.js**: `createInstanceInContainer` now accepts `occurrenceId` + `initialMeta` params, passes them to socket event.

## Status (Mar 2026 — MP1 Embedded Module Resize + Alignment)

### Changes Applied
- **docs/ModuleEmbedExtension.js**: Added `align` (full/left/center/right, default "full") + `width` (nullable number) attrs to `moduleEmbed` node.
- **docs/ModuleEmbedNode.jsx**: Rewrote to show alignment toolbar (4 buttons: ◧/⊡/◨/⊞) when node is selected. Right-edge drag handle for resize (hidden for full-width). `alignStyle()` helper computes float/margin/width CSS. Positions persist to TipTap node attrs.

## Status (Mar 15 2026 — SL3 timeScale-aware target scaling)
- **Instance.jsx**: `fieldContext.currentIteration` now derived from `grid.activeFilterId → namedFilters.find(id).timeScale`. Was reading dead `grid.iterations[]` (always empty). Now correctly returns "daily"/"weekly"/"monthly" from the active named filter. `Field.jsx` already calls `scaleTarget(target, currentTimeFilter)` — so switching to Weekly filter auto-multiplies targets ×7.

## Status (Mar 14 2026 — R7 Module Disable)
- **modules/Instance.jsx**: Passes `disabled={!!instance?.meta?.disabled}` to FieldRenderer. When `instance.meta.disabled = true`, all fields render as display-only (no inputs).

## Status (Mar 14 2026 — Pool Container SL1)

### Changes Applied
- **Module.js (server)**: Added `"pool"` to kind enum — draggable pill library containers.
- **Container.jsx**: Added `isPoolContainer = module.kind === "pool"` detection. Added `PoolPill` component (draggable via `@atlaskit/pragmatic-drag-and-drop/element/adapter`, payload `{ type: "module", sourceType: "pool", role: "instance", id, data, occurrenceId }`). Added pool rendering branch: search bar + [+ Add] inline input + wrapped flex grid of PoolPill components. State: `poolSearch`, `poolAddLabel`, `isPoolAdding`. `handlePoolAdd` creates new instance via `CommitHelpers.createInstanceInContainer`. Delete on hover via PoolPill delete button.
- **index.css**: Added `.pool-pill:hover .pool-pill-delete { display: flex !important }` rule.
- **DragProvider.jsx**: Pool source handling — added `|| payload?.sourceType === "pool"` to the command-center module handler. Pool drags always copy (same path as CC instance drag).
- **operationActions.js**: Added `ADD_TO_POOL` (emits `{ _effect: "ADD_TO_POOL", poolContainerId, label }`) and `REMOVE_FROM_POOL` (emits `{ _effect: "REMOVE_FROM_POOL", occurrenceId }`) action cases.
- **bindSocketToStore.js**: Added `ADD_TO_POOL` effect handler (calls `createInstanceInContainer`) and `REMOVE_FROM_POOL` handler (calls `deleteOccurrence`). Added `createInstanceInContainer` to imports.
- **createDefaultUserData.js**: Added `movieRating` (rating, 1-5) + `lastWatched` (date) fields. Added `moviePoolInstances` (The Matrix, Parasite, EEAO, Arrival, Dune). Added `moviePool` (`kind: "pool"`) to toolkitContainers. Wires movies into pool in STEP 5. Movie instances use `defaultDragMode: "copy"`, included in `isToolkitInstance` check.

## Status (Mar 12 2026 — Tree DnD to Panel + S6)

### Changes Applied (Mar 12 — late session)
- **DragProvider.jsx**: Added `type: "artifact"` drop handler. Dragging artifact DocNode from ManifestTree onto a panel content area (no container) → calls `updateView({ activeOccurrenceId })` to switch the active document in that panel.
- **ExprPillExtension.js + pills/ExprPillNode.jsx** (NEW in docs/): S6 expression pills. Inline formula nodes in TipTap. `=` key trigger → field picker popup → inserts `exprPill` with formula. Node view evaluates `fieldName` expressions against computedValues + simple arithmetic.

## Status (Mar 13 2026 — Filter Visibility Extended to Panels + Day Pages)

### Panel.jsx — Container Occurrence Filtering
- **Panel.jsx**: Imported `resolveEffectiveFilters` + `isOccurrenceVisible` from `../state/selectors`.
- **Panel.jsx**: `panelEffectiveFilters` = `resolveEffectiveFilters(panelOccurrence, state.grid.activeFilterValues)`. `containersList` filters each container by looking up its occurrence ID from `panelOccurrence.occurrences` and calling `isOccurrenceVisible(containerOcc, panelEffectiveFilters)`. Containers without an occurrence (shouldn't happen but defensive) are treated as visible.
- **Effect**: Day page container occurrences with `scheduledDate` set only show on the matching day. Schedule slot containers (no `scheduledDate`) are always visible (persistent).

### dayPages.js — scheduledDate on New Day Page Occurrences
- **dayPages.js**: Added `findScheduledDateFieldId(uc, gridId)` helper — scans `uc.fieldsById` for `name === "Scheduled Date"`. Added `makeScheduledDateFields(fieldId, dateISO)` — builds `{ [fieldId]: { value: dateISO, flow: "in" } }`.
- **create_day_page_occurrence**: Sets `fields: { ...makeScheduledDateFields(...), ...(fields || {}) }` so new day page occurrences get `scheduledDate` matching their `meta.date`.
- **navigate_day_page**: New day page occurrences get `fields: makeScheduledDateFields(scheduledDateFieldId, dateISO)`. Existing occurrences already have it from creation.

## Status (Mar 13 2026 — Filter Visibility)

### Container.jsx — Occurrence Visibility Filtering
- **Container.jsx**: Imported `resolveEffectiveFilters` + `isOccurrenceVisible` from `../state/selectors`.
- **Container.jsx**: `allItemsWithOccurrences` = full list from `getContainerItemsWithOccurrences`. `effectiveFilters` = `resolveEffectiveFilters(containerOccurrence, ctxState?.grid?.activeFilterValues || {})`. `itemsWithOccurrences` = filtered by `isOccurrenceVisible`. Hidden occurrences (`occurrence.hidden = true`) and filter-mismatched occurrences are skipped. Occurrences with no field value pass (persistent behavior).

## Status (Mar 12 2026 — Latest)

### Changes Applied (Mar 12)
- **Artifact.jsx**: Added `viewType === "code"` → `CodeViewer` component (fetches `/uploads/{fileRef}`, renders `<pre><code>` with lang indicator). Added `viewType === "grid"` → `GridViewer` component (interactive spreadsheet, data stored as `{ type: "grid", cols, rows }` in occurrence.textmap, saves via debounced `updateOccurrence`).
- **server/server.js**: `mimeToViewType(mime, filename)` — now detects code files by extension (.js/.ts/.py/.sh/.json/etc.) and returns `{ viewType: "code" }`.
- **server/models/View.js**: Added `"code"` and `"grid"` to `viewType` enum.
- **createDefaultUserData.js**: Added "Sample Grid" module (viewType: "grid") in Notes folder with 8-column habit tracker example.
- **index.css**: Bug 16 fix — hover cog cascade. All `.panel-shell:hover`, `.container-shell:hover`, `.panel-header:hover`, `.container-header:hover` selectors now use `:not(:has(...))` to prevent showing cog on ancestor shells when a nested child is hovered.

## Status (Mar 11 2026)

### Fixes Applied (current session)
- **Container.jsx** embedded header: restructured to two-row layout: Row 1 = [RadialMenu dot][Link icon], Row 2 = [# Label]. Both embedded and non-embedded use conditional rendering.
- **Container.jsx** `lightenHex(hex, 0.7)` helper added — computes bright text color for embedded labels by blending 70% toward white
- **Container.jsx** `embeddedAccent` = `lightenHex(rawColor, 0.7)` (bright readable text) vs card/header bg which use `hexToRgba(rawColor, 0.18/0.42)`
- **Container.jsx** embedded card: background alpha 0.18, border 0.5, header bg 0.42, header border 0.55 (was 0.1/0.3/0.28/0.35)
- **Container.jsx** LocalIterationNav: `collapsible={embedded}` prop — shows only Link2 icon when collapsed, full nav in popover
- **Artifact.jsx** outer wrapper: applies `docAccentBg` (hexToRgba(module.ownStyle.bg, 0.10)) as background tint
- **LocalIterationNav.jsx**: added `collapsible` prop + `collapsibleOpen` state — when collapsible=true renders Link2 icon as Popover trigger with full nav inside
- **Editor.jsx**: removed `overflow-auto` from `doc-editor-wrapper` — outer containers handle scrolling, fixing sticky toolbar
- **createDefaultUserData.js**: brighter colors for all embedded section containers (green #1ac47a, blue #2a90e8, purple #9b4de0, gold #d4a010, etc.)

## Status (Mar 11 2026)

- All files build cleanly
- Embedded doc container styling complete (Container.jsx `embedded` prop)
- ManifestTree.jsx: compact file row (fontSize 10, `›` instead of 📄)
- Artifact.jsx: passes `embedded={true}` to child Container cards + shows module.label top-right badge

## Embedded Doc Container Pattern (Mar 11 2026)
- `Container.jsx` accepts `embedded` prop — renders teal `#`-prefix heading instead of standard panel header
- When `embedded=true`: header uses `embeddedCardStyle` (dark tinted bg + border), label is 15px/600 mono with color from `module.ownStyle.bg`, contentEditable for inline editing
- `#` hash prefix: always rendered but opacity 0 by default, shows on hover via `.embedded-container-header:hover .embedded-hash` CSS
- LocalIterationNav hidden when `embedded=true`
- Outer shell style: uses `embeddedCardStyle` (not `resolvedContainerCSS`) when embedded
- `Artifact.jsx` passes `embedded={true}` to all child Container cards in markdown view
- `hexToRgba` helper already at top of Container.jsx — no need to re-declare in ManifestTree

## Data Setup (Mar 11 2026 resetData)
- Stan sections: `ownStyle: { bg: "#0e3d32" }, styleMode: "own"` (dark teal)
- Notes sections: `ownStyle: { bg: "#1a2e40" }, styleMode: "own"` (dark navy)
- Gospel sections: `ownStyle: { bg: "#2a1f3d" }, styleMode: "own"` (dark purple)
- Journal Q&A sections: `ownStyle: { bg: "#2d200e" }, styleMode: "own"` (dark amber)
- Stan/Notes/Gospel body textmaps: NO heading nodes (label IS the heading via embedded header)
- Journal Q&A container textmap: just instancePill (no question fieldPill heading)
- Daily Journal parent doc REMOVED — journal Q&A containers live directly under `dayPageDocOccId`
- Parent docs sortOrder: Stan=0, Notes=1, Gospel=2
- `dayPageDocOccId` pre-declared before notebook wiring loop (used as parentId for journal Q&A)
- `activeOccurrenceId` defaults to `dayPageDocOccId` (day page open by default)
- `makeDocContent` now handles `![alt](url)` → TipTap image nodes

## Recent Changes (Mar 17 2026 — BUGS.md Fixes)

### Artifact.jsx — GridViewer Removed
- Removed `GridViewer` component, `defaultGridData()`, `cellStyle`, `headerCellStyle` constants
- Removed `viewType === "grid"` branch — Sample Grid now uses TipTap table in doc textmap
- Removed `useCallback` and `updateOccurrence` imports (only used by GridViewer)

### Container.jsx — Canvas Fix + Duplicate Cleanup
- Moved `isCanvasContainer` check BEFORE `focusedItem` in rendering ternary chain
- Removed duplicate (unreachable) old canvas block that was after `focusedItem`
- Added `module.kind` fallback for `isDocContainer`, `isPoolContainer`, `isCanvasContainer` — fixes Freepad/canvas panels that have no View record

### ManifestTree.jsx — Collapse Cascade + New Doc Button
- Added `collapseGen` prop to DocNode — children reset to collapsed when parent closes
- `toggleOpen` callback bumps `childCollapseGen` when closing, propagated to child DocNode renders
- Added `handleNewDoc` to FolderNode — creates new "Untitled" artifact module + occurrence in folder
- "+" button appears on folder header hover (CSS: `.folder-add-btn`)

### Panel.jsx + Container.jsx — QuickAddMenu (+) Button
- **Panel.jsx**: `<QuickAddMenu targetRole="container">` in panel header after name. `handleQuickAddContainer` creates occurrence of existing container module in panel. "New container" option calls `addContainerToPanel`.
- **Container.jsx**: `<QuickAddMenu targetRole="instance">` in standard container header after label. `handleQuickAddInstance` creates occurrence of existing instance module in container. "New instance" option calls `onAdd`.
- **QuickAddMenu** (ui/QuickAddMenu.jsx): Dropdown with search, role-colored dots, outside-click close. Filters `modulesById` by `targetRole`. Max 20 results.
- **index.css**: `.panel-header:hover .quick-add-btn` and `.container-header:hover .quick-add-btn` reveal on header hover.
