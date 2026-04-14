# client/src/ui — UI Components CLAUDE.md

_Updated: 2026-04-12. Check this file before re-reading source._

## Recent Changes (Apr 12 2026 — InstanceTextblock Integration + Enter/Shift+Enter)
- **Editor.jsx**: Registered `InstanceTextblock` extension (imported from `docs/InstanceTextblockExtension.js`). Added to `useEditor` extensions array alongside existing pill extensions.
- **Editor.jsx**: Added `onCreate` migration callback — on first open, scans doc for `instancePill` nodes with `pillDisplay: "block"` wrapped in lone paragraphs, replaces them with `instanceTextblock` nodes. Migration marks `skipAutoCreate` + `addToHistory: false` and immediately persists. Lazy DB migration — no server script needed.
- **Editor.jsx**: Fixed Enter/Shift+Enter in `handleKeyDown`. Enter (no shift) + `onExitBlock` prop → exits textblock (moves outer cursor to after node). Shift+Enter → stays inside sub-editor (inserts newline). Previously reversed.
- **Editor.jsx**: Updated 3 references from `instancePill+pillDisplay:block` to `instanceTextblock`: (1) list-merge detection, (2) block handle hide on node exit, (3) "Make mini block" context menu item.
- **Editor.jsx**: Auto-create textblock (`handleAutoCreateTextblock` in DocContent.jsx) now inserts `instanceTextblock` node instead of `instancePill+pillDisplay:block`.

## Recent Changes (Apr 11 2026 — Auto-Create Textblock Instant Response)
- **Editor.jsx**: Reduced `onAutoCreateTextblock` debounce from 300ms to 0ms. Timer now fires on the next event loop tick (still re-reads full paragraph text at fire time, so fast typing is captured). Eliminates the ~300ms lag before a typed paragraph converts to a textblock.

## Recent Changes (Apr 11 2026 — Editor Drop/Click/Embed Fixes)
- **Editor.jsx**: Fixed drop ordering — `onDrop` now uses `location.current.input` from Pragmatic DnD (exact drop coords) instead of `lastNativeEvent` from `dragover`, which could be stale.
- **Editor.jsx**: Fixed cursor reset on click — content sync `setContent` now saves selection before call and restores it after (clamps to new docSize). Prevents server echoes arriving between mousedown and focus event from resetting cursor to position 0.
- **Editor.jsx**: Fixed TipTap v3 `setContent` API — now passes `{ emitUpdate: false }` options object instead of bare `false`.
- **docs/pills/InstancePillNode.jsx**: Fixed "Convert to Embed" leaving both pill and embed — replaced `deleteRange + insertContentAt` chain (inserts block into inline context incorrectly) with a single atomic `replaceWith` on the pill's parent paragraph.

## Recent Changes (Apr 10 2026 — Editor Click Delay + Cursor Placement Fix)
- **Editor.jsx**: Added `draggable={false}` to `doc-editor-wrapper` div AND `draggable: "false"` to ProseMirror element via `editorProps.attributes`. Root cause: Pragmatic DnD sets `draggable="true"` on parent container/page shells, causing browsers to intercept `mousedown` to check for drag initiation. This produced a ~250ms delay before cursor appeared, and placed it at position 0 (beginning) because ProseMirror got focus without a positional mousedown. `draggable="false"` on the editor wrapper explicitly opts out of the drag system, restoring immediate click response and correct cursor placement.

## Recent Changes (Apr 10 2026 — Editor Padding + Click Position Fix)
- **Editor.jsx**: Reduced doc-editor-wrapper top/bottom padding from `py-3` (12px) to 5px via inline style `{ paddingTop: 5, paddingBottom: 5 }`.
- **Editor.jsx**: Fixed "beginning of line" cursor placement bug. Wrapper `onClick` (fires when clicking padding area outside ProseMirror) now calls `editor.commands.focus()` instead of `posAtCoords(nudgedX)`. Root cause: nudging `x` to `pmRect.left + 2` (2px into PM left edge, still left of text) caused `posAtCoords` to return position 0 of the nearest paragraph = beginning of line.

## Recent Changes (Apr 10 2026 — Empty Textblock Fix on Module Drop)
- **Editor.jsx**: Fixed empty textblock appearing after moduleEmbed drops. `insertAtPos` now checks if the inserted node is a block-type (`editor.schema.nodes[type].spec.group.includes("block")`). Block nodes (like `moduleEmbed`) skip the trailing `" "` insertion — inline nodes (fieldPill, instancePill) still get the trailing space.

## Recent Changes (Apr 9 2026 — C2: Make Mini Block + Breadcrumbs + Cursor & Drag Fix)
- **Editor.jsx**: Added "Make mini block" right-click context menu item. When text is selected + dispatch/socket/occurrence available: captures selection range at menu-open time, creates module (role: "instance", kind: "doc") + occurrence with selection content as textmap, then replaces selection with `instancePill` block node. Updated `handleContextMenu` deps: `[..., dispatch, socket, occurrence]`. (C2)
- **Editor.jsx**: Added `handleDOMEvents.dragstart` in TipTap `editorProps` — prevents native text-selection drags from starting inside the editor. Only allows dragstart from elements with `data-dnd-handle` or `.module-drag-handle` classes. Text can be selected/highlighted but never dragged.

## Recent Changes (Apr 6 2026 — RadialMenu Linear Strip + Delete + Editor Drops)
- **RadialMenu.jsx**: Items now render as a linear strip instead of radial arc. Direction determines line orientation (right=horizontal right, down=vertical down, etc.). Items spaced 30px apart. Removed rotary animation (wrapper no longer rotates, icons no longer counter-rotate). Added `Trash2` import, `onDelete` prop — when provided, adds red "Remove" button as last item.
- **Editor.jsx**: Removed `pendingDrop` state and pill/embed choice popup. All module drops (instance, container, artifact) now default to `moduleEmbed` (block embed) — no popup dialog. Content sync useEffect now preserves cursor position across `setContent` calls (saves `from/to`, restores after).

## Recent Changes (Apr 2 2026 — Editor Cursor Fix)
- **Editor.jsx**: Added `useEffect` after `useEditor` initialization to call `editor.setEditable(editable, false)` when `editable` prop changes. TipTap's `useEditor` hook doesn't auto-sync `editable` after mount in some v2 versions, causing the editor to remain read-only even after the prop becomes `true`.

## Recent Changes (Apr 2 2026 — Block Menu Portal + Cursor Fix)
- **Editor.jsx**: Block handle menu now renders via `createPortal` to `document.body` at `position: fixed` using viewport coords from `getBoundingClientRect()`. Fixes menu being clipped by `overflow: auto/hidden` ancestor containers (page-shell). Added `blockMenuPortalRef` + `blockMenuPos` state. `blockHandleBtnRef` added to capture button position. `cancelBlockHide()` called on button `onMouseDown` to prevent hide timer from closing handle. Outside-click handler updated to check both `blockHandleRef` and `blockMenuPortalRef`. Import `createPortal` from `react-dom`.

## Recent Changes (Apr 1 2026 — Instance Drop Pill/Embed Choice)
- **Editor.jsx**: Instance drops into doc now show a small popup with "Pill" (inline `instancePill`) vs "Embed" (block `moduleEmbed`) choice. `pendingDrop` state stores `{ occurrenceId, insertPos, dropX, dropY, label }`. Popup appears at drop coordinates, auto-positioned relative to wrapper. Non-instance drops (container, artifact, module) still go straight to `moduleEmbed`. "Turn into instance" context menu item remains commented out.

## Recent Changes (Mar 30 2026 — Uniform Doc Drops + Remove DropReformatPopup)
- **Editor.jsx**: Drop handler rewritten. Instance/container/artifact/module drops now insert `moduleEmbed` TipTap nodes (same component rendering everywhere). Removed `DropReformatPopup` component and `dropReformat` state entirely. Field drops still insert `fieldPill` as before. `canDrop` filter expanded to accept `"artifact"` and `"module"` types. **Fix**: `occurrenceId` resolution now checks `context?.occurrenceId || data?.occurrenceId || sd.occurrenceId` (root-level, for doc pills and tree items). CC drops with no occurrenceId fall back to finding an existing occurrence of the module via `occurrencesById`.

## Recent Changes (Mar 25 2026 — Module Reference Field Type)
- **Field.jsx**: Added `type: "module"` rendering. Compact input: cyan-tinted Popover pill with Link2 icon, searchable module list. Full input: native `<select>` dropdown from `meta._moduleOptions`. Display: `formattedValue` resolves moduleId → label via `_moduleOptions`, with optional `meta.label` prefix. Compact display: cyan pill with Link2 icon.
- **FieldRenderer.jsx**: Extended `effectiveField` useMemo to handle `type === "module"` — builds `_moduleOptions` from `modulesById` (filtered by optional `meta.roleFilter`).
- **commandCenter/FieldsTab.jsx**: Added `"module"` to type dropdown. Module-specific meta config: Label prefix input (`meta.label`) + optional Role filter select (`meta.roleFilter`). FieldPill cyan color for module-type fields.

## Recent Changes (Mar 25 2026 — onLoad Switch in Operations UI)
- **commandCenter/OperationsTab.jsx**: `handleCreate` now defaults new operations to `triggerType: "onChange", triggerTypes: ["onChange", "onLoad"]` (was `triggerType: "manual"`). `OperationEditor` trigger section now has a separate toggle switch for "Run on load" above the trigger rows — green toggle, defaults ON for new ops. `onLoad` filtered out of the configurable trigger row list and the event type dropdown to avoid duplication.

## Recent Changes (Mar 25 2026 — Escape Key Handlers)
- **RadialMenu.jsx**: Added `keydown` listener for Escape inside outside-click `useEffect`. Calls `e.preventDefault()` so parent handlers know it was consumed. Menu now closable via Escape key.
- **QuickAddMenu.jsx**: Added `keydown` listener for Escape inside outside-click `useEffect`. Same `preventDefault` pattern. Menu now closable via Escape key.

## Recent Changes (Mar 23 2026 — Pool Randomize Button)
- **FieldRenderer.jsx**: Added `handleRandomize` callback — picks random option from pool-sourced select fields. Dice button (&#x1F3B2;) renders inline next to pool-sourced select input fields when `inputEnabled`. Input Field now wrapped in `inline-flex` div with the randomize button.

## Recent Changes (Mar 20 2026 — Editor Block Handle + CSS)
- **Editor.jsx**: Increased left padding on `doc-editor-wrapper` from `p-3` to `py-3 pr-3 pl-10` (40px left) — creates space for the block handle buttons so they don't overlap content. Added "Insert module" item to block menu — triggers the existing `@:` embed container picker, positioned at the block handle location.
- **index.css**: Drag handle ball increased from 7×7 to 24×24px (matches radial menu button size). Stem scaled from 3×5 to 5×8px. `.module-drag-handle` top offset changed from -10px to -20px. `.module-drag-handle .radial-handle` increased from 10×10 to 24×24px — flush with ball position.

## Recent Changes (Mar 20 2026 — Pool Lookup Performance)
- **FieldRenderer.jsx**: Pool-sourced select fields had O(n) `Object.values(occurrencesById).find()` inside a loop over pool IDs. Replaced with O(1) `byTargetId` map built once inside the useMemo (only for pool fields — non-pool fields early-return before map construction).

## Recent Changes (Mar 18 2026 — Mobile Fixes)
- **RadialMenu.jsx**: Arc item viewport clamping — each item's final absolute position is clamped to stay within viewport bounds (prevents off-screen items near edges). Arc spread capped to `min(45, 180/(count-1))` degrees to prevent wraparound with 5+ items.

## Recent Changes (Mar 16 2026 — History + CS6b)
- **TransactionHistory.jsx**: Added `moduleId` prop for per-module filtering. When set, only shows transactions where ops match panelId/containerId/moduleId. Updated title to "Module History" when moduleId provided. Added `transaction_created` socket listener for live updates (auto-refreshes when open).
- **RadialMenu.jsx**: Added `onHistory` prop — when provided adds `{ label: "History", icon: Clock, color: amber }` item to default arc.
- **commandCenter/AppearanceTab.jsx**: Replaced "Custom tokens (coming soon)" stub with real localStorage-persisted token editor. Preset tokens: --text-primary, --accent-blue, --accent-green, --border-default, --input-bg. Add/remove arbitrary custom rows. "Apply" saves to localStorage["moduli-token-overrides"] + injects `<style id="moduli-token-overrides">`. "Reset" clears all. Load on mount wired in App.jsx.
- **NotificationsPanel.jsx**: DELETED — bell icon removed per user request.

## Key Files

| File | Purpose | Last Changed |
|------|---------|--------------|
| `ContextMenu.jsx` | **NEW** Portal-based right-click context menu. Props: `ctx={x,y,items}`, `onClose`. Items: `{label,icon?,onClick,danger?,separator?,disabled?}`. Dismisses on outside click or Escape. Viewport-clamped. | **Feb 21** |
| `CommandCenter.jsx` | **Thin shell** — tab bar + conditional render only. 11 tabs including Grid + Appearance (new). | **Mar 16** |
| `commandCenter/` | **Subfolder** — each tab in its own file. See below. | **Mar 16** |
| `PomodoroTimer.jsx` | **CREATED, NOT WIRED**. 25/5/15min pomodoro cycle with SVG ring, play/pause/reset/skip. Deferred to end Phase 6. | **Feb 20** |
| `LayoutForm.jsx` | Panel settings popover. Layout (display/flex/grid/columns), iteration, drag mode, style overrides, **Panel Actions** (Copy/Link/Split/Merge buttons). | **Feb 21** |
| `ContainerForm.jsx` | Container settings. Layout, iteration, drag mode, style overrides, templates (save/fill). | Recent |
| `InstanceForm.jsx` | Instance settings. Fields (allowedFields config), style overrides, autocheck on drop, siblingLinks. | Recent |
| `Field.jsx` | **NEW** Unified field display (replaces FieldDisplay.jsx + FieldPillDisplay.jsx). One look everywhere — no "pill" variant. Props: field, binding, value, target, state, context, compact, hideName, hidePrefix, hidePostfix. | **Mar 9** |
| `FieldRenderer.jsx` | Routes field to Field.jsx (display) or FieldInput/FieldPillInput (input). Now imports Field.jsx instead of FieldDisplay + FieldPillDisplay. | **Mar 9** |
| `RadialMenu.jsx` | Circular action menu. Props: dragMode, onToggleDragMode, onSettings, onAddChild, addLabel, size. | Stable |
| `LocalIterationNav.jsx` | Local iteration arrows on panels/containers. `alwaysExpanded` prop shows without toggle. | Stable |
| `GridFieldsBank.jsx` | Global field management dialog. | Stable |
| `GridRadialMenu.jsx` | Grid-level cog menu (Undo/Redo/Fields/History). | Stable |
| `TransactionHistory.jsx` | Transaction history dialog. z-index: 1100. | Stable |
| `IterationNav.jsx` | Global iteration navigation (time-based). | Stable |
| `IterationSettings.jsx` | Persistence mode selector (persistent/specific/untilDone). | Stable |

## commandCenter/ Subfolder (Mar 12 2026)
Each tab extracted into its own file. CommandCenter.jsx is now a thin shell (~130 lines) that only renders tab bar + conditionally renders each tab.

| File | Exports |
|------|---------|
| `FieldsTab.jsx` | `FieldsTab`, `FieldPill`, `FieldDetail` |
| `OperationsTab.jsx` | `OperationsTab`, `OperationPill`, `OperationEditor`, `TriggerDataHint`, `OpItem`, `getTriggerVars` |
| `ComponentsTab.jsx` | `ComponentsTab`, `ModulePill`, `TemplatePill` |
| `ConnectionsTab.jsx` | `ConnectionsTab`, `fileIcon`, `formatBytes` |
| `FilesTab.jsx` | `FilesTab`, `ArtifactPill`, `fileIcon`, `formatBytes` |
| `ListsTab.jsx` | `ListsTab` |
| `ShortcutsTab.jsx` | `ShortcutsTab` |
| `UserSettingsTab.jsx` | `UserSettingsTab` — userId + displayName only. ThemePicker moved to AppearanceTab. |
| `GridSettingsTab.jsx` | `GridSettingsTab` — **NEW** grid name/rows/cols/template/delete. Self-contained via GridActionsContext. No props needed. |
| `AppearanceTab.jsx` | `AppearanceTab` — **NEW** theme picker (moved from UserSettingsTab) + CSS token stub section. |
| `EntityTreeTab.jsx` | `EntityTreeTab`, `DraggableInstanceRow`, `DraggableEntityRow` |
| `FiltersTab.jsx` | `FiltersTab` — named filter presets CRUD. FilterRow (name/timeScale/active circle/expand/delete), ConditionRow (field + remove). Reads grid.namedFilters, saves via CommitHelpers.updateGrid, activates via update_grid_filter socket. |

Note: `EntityTreeTab.jsx` imports `TemplatePill` from `ComponentsTab.jsx`.

## Patterns
- Dialog z-index = 1100 (above fullscreen panels at z=1000)
- Context menus: `createPortal(menu, document.body)` — always on top
- Popovers use shadcn `<Popover>` with `align="start" side="right"`
- All buttons use shadcn `<Button>` variants
- CommandCenter: `position: fixed, top: toolbar_height, left: 0, right: 0` — slide down animation

## Recent Changes (Mar 17 2026 — TDZ Crash Fixes + Field.jsx onChange Bug)
- **Editor.jsx**: Fixed 3 TDZ bugs (all same pattern — hooks declared before `const editor = useEditor(...)` but referencing `editor` in deps):
  1. `handleEditorMouseMove` (was at line 156) — moved to after `useEditor` ends
  2. `filteredExprFields` useMemo (was at line 635) — moved to line 115 (after `filteredFields`)
  3. `handleSelectExpr` useCallback (was at line 613) — moved to after `useEditor`
  Root cause: React evaluates `useCallback`/`useMemo` deps synchronously at render time — if a `const` is referenced in deps before its declaration line, JavaScript TDZ fires on every render.
- **Field.jsx**: Fixed compact click-editing `onChange` bug — `onChange={handleChange.bind(null, undefined)}` was wiping `localValue` to `undefined` on every keystroke (fires after `onChangeCapture` in bubble phase). Changed to `onChange={(e) => handleChange(Number(e.target.value))}`. Also fixed `extractValue` to return `undefined` (not the whole object) when an object lacks a `value` key — prevents `value="[object Object]"` in controlled inputs.

## Recent Changes (Mar 14 2026 — D12 Doc Block Handle)
- **Editor.jsx**: Added Notion-style per-block drag handle + options menu. `blockHandle` state `{ top, nodeStart }` tracks hovered block. `handleEditorMouseMove` on outer div: uses `editor.view.posAtCoords` → `$pos.before(1)` to find top-level node start → `editor.view.domAtPos` to find DOM element → computes `top` relative to outer wrapper. Hide timer pattern (200ms) prevents flicker when moving between handle and content. Block handle renders absolutely at `left: 0, top: blockHandle.top` with ⠿ (GripVertical) drag button + ⋮ (MoreVertical) options button. Options menu: Text / H1 / H2 / H3 / Bullet list / Quote / Duplicate / Delete. Each calls `editor.chain().focus().setTextSelection(nodeStart+1).setNode(...)`. Duplicate uses `node.toJSON()` inserted at `nodeStart + node.nodeSize`. Delete uses `deleteRange`. Menu closes on outside click via `useEffect`. Handle only shown when `editable=true`.

## Recent Changes (Mar 16 2026 — CS1+CS2 Color Purge + Light Theme Pass)
- **ALL commandCenter/ tabs**: `labelStyle`/`inputStyle` object colors converted to CSS vars. All `rgba(255,255,255,x)` → `var(--text-primary/muted/faint)`, `var(--input-bg/border)`, `var(--border-default/subtle)`.
- **FieldsTab.jsx**, **OperationsTab.jsx**: Converted labelStyle/inputStyle + all inline `rgba(255,255,255,...)`. Save button → `var(--accent-blue-*)`. Delete button → `var(--danger-*)`. Column hover → `var(--accent-blue-*)`.
- **FiltersTab, EntityTreeTab, ComponentsTab, ListsTab, ShortcutsTab, ConnectionsTab, FilesTab**: Same pattern. All green/purple/blue/danger actions use semantic tokens.
- **Field.jsx**: Star rating, progress bar, toggle pill → CSS vars.
- **ContextMenu.jsx**, **PomodoroTimer.jsx**, **Editor.jsx**: Remaining `rgba(255,255,255,...)` → CSS vars.
- **StyleEditor.jsx**: Selection outline → `var(--accent-blue)`.
- **index.css**: Added `--danger-bg`, `--danger-border`, `--danger-text` tokens to all 3 themes.
- **Result**: 0 hardcoded semantic `rgba()` colors in any component file. Only index.css token definitions and intentional swatch values remain.

## Recent Changes (Mar 16 2026 — Phase 6 UI Restructuring)
- **GridSettingsTab.jsx** (NEW in commandCenter/): Grid name/rows/cols/template/delete self-contained tab. Reads `state.grid` from GridActionsContext, owns its own local state + sync effect. Calls CommitHelpers directly. No props needed. Replaces toolbar cog popover.
- **AppearanceTab.jsx** (NEW in commandCenter/): Theme picker (ThemePicker moved from UserSettingsTab) + stub for CSS token editor. Uses Tailwind classes.
- **UserSettingsTab.jsx**: Removed ThemePicker + `useTheme`/`SYSTEM_THEMES` imports. Converted inline styles to Tailwind. Now shows redirect note pointing to Appearance tab.
- **CommandCenter.jsx**: Added `LayoutGrid` + `Palette` icons. Added `GridSettingsTab` + `AppearanceTab` imports. TABS array now has 11 tabs: `"grid"` (LayoutGrid) and `"appearance"` (Palette) inserted after `"filters"`. Content renders both.
- **Toolbar.jsx**: Removed cog RadialMenu + floating GridLayoutForm popover. Removed `gridSettingsOpen` state + outside-click effect + `cogAreaRef`. Removed grid settings props from signature (gridName, setGridName, rowInput, setRowInput, colInput, setColInput, onDeleteGrid, onCommitGridName, onUpdateRows, onUpdateCols, onSetDefaultDayPageTemplate, canUndo, canRedo, onUndo, onRedo, onHistory). Removed `GridLayoutForm` import. Added inline `PlusSquare` button for Add Panel. Added `EyeOff` hide button on right side.
- **App.jsx**: Removed gridName/rowInput/colInput states + sync useEffect. Removed commitGridName/updateRows/updateCols/setDefaultDayPageTemplate/deleteGridFinal callbacks. Removed all grid settings props from Toolbar call.
- **index.css**: Added semantic tokens to all 3 themes (`--text-primary/muted/faint`, `--input-bg/border`, `--border-default/subtle`, `--accent-blue*`, `--danger`).
- **tailwind.config.js**: Registered semantic tokens as Tailwind color names (`text-text-primary`, `bg-input-bg`, `text-text-muted`, `bg-accent-blue-bg`, etc.).

## Recent Changes (Mar 15 2026 — F3 Day Page Template Picker)
- **GridLayoutForm.jsx**: Added `grid` + `onSetDefaultDayPageTemplate` props. When `grid.templates` has entries, shows "Day page template" section with a `<select>` picker (None + template options). On change calls `onSetDefaultDayPageTemplate(templateId | null)`.
- **Toolbar.jsx**: Added `onSetDefaultDayPageTemplate` prop, passed through to `GridLayoutForm` alongside `grid`.
- **App.jsx**: Added `setDefaultDayPageTemplate` useCallback — calls `CommitHelpers.updateGrid({ defaultDayPageTemplateId })`. Passed as `onSetDefaultDayPageTemplate` to Toolbar.

## Recent Changes (Mar 14 2026 — R6 Field Hide + R7 Module Disable)
- **InstanceForm.jsx**: `FieldBindingRow` header restructured — now has Eye/EyeOff button on right side. Click calls `onUpdateBinding({ hidden: !binding.hidden })`. When hidden, pill is 40% opacity. Import `Eye, EyeOff` from lucide.
- **InstanceForm.jsx**: Added "Disabled" Switch in Settings tab (after Auto-check on drop). Saves `instance.meta.disabled = true/false` via `CommitHelpers.updateModule`.
- **FieldRenderer.jsx**: Added `disabled` prop (default `false`). When `disabled=true`, `inputEnabled` is forced to `false` → all fields render as display-only.
- **modules/Instance.jsx**: Passes `disabled={!!instance?.meta?.disabled}` to every `<FieldRenderer>`.

## Recent Changes (Mar 13 2026 — FiltersTab Added)
- **FiltersTab.jsx** (NEW in commandCenter/): Named filter preset management. FilterRow: active-circle (blue = active, click to activate via `update_grid_filter`), inline name input (onBlur saves), timeScale select (daily/weekly/monthly/yearly/all), expand/collapse for conditions, delete. ConditionRow: field pill + remove. Add condition: dropdown of non-bound fields. Saves via `CommitHelpers.updateGrid({ namedFilters })`. Added `"filters"` tab (Filter icon) to CommandCenter.jsx TABS array.

## Recent Changes (Mar 13 2026 — GridLayoutForm Cleanup)
- **GridLayoutForm.jsx**: Rewrote — removed Iterations section (dead UI, `onCommitIterations` was never being called after filter system rework). Now only has Grid Name + Rows/Cols + Delete. Removed `TIME_FILTER_OPTIONS`, `uid`, `Select*`, `Plus`, `Trash2`, `Input`, `Label` imports.

## Recent Changes (Mar 2026 — Files Tab + Operations Taxonomy)
- **CommandCenter.jsx**: `FilesTab` rewritten — reads artifact modules from `modulesById` (kind="artifact"), flat list, upload button + file input, native drag-drop zone onto tab. `ArtifactPill` draggable as `type: "module"`, `defaultDragMode: "copy"` so DragProvider copies to container.
- **CommandCenter.jsx**: Added `createModuleAction`/`createOccurrenceAction` imports. After upload response, dispatches both actions to update state without waiting for socket.
- **CommandCenter.jsx**: `EVENT_TYPES` (14 items) + `SUBJECT_TYPES` (9 items) + `SOURCE_ENTITY_TYPES` (12 items). Triggers use two-step row (event + subject + role filter). Sources = variable assignments (`$varName = entityType [filter]`).
- **server/server.js**: Artifact upload now creates module with `role: "instance"` (not "container") + `defaultDragMode: "copy"` — lets DragProvider create copy occurrence when dragged to container.
- **client/src/__tests__/LayoutHelpers.test.js**: Fixed `getContainerItemsWithOccurrences` tests — pass separate `containerOcc` object as 5th arg (matching new API).
- **server/__tests__/operationSchema.test.js**: Updated `triggerType` test — now tests that any string is valid (open enum, not restricted).

## Recent Changes (Mar 2026 — Per-Occurrence Display Flags + Drag Mode)
- **FieldRenderer.jsx**: Extracts `hideName`/`hidePrefix`/`hidePostfix` from `occurrence.fields[field.id]` alongside `value`/`flow`. Passes `hideName` to `FieldDisplay`, `hideName`+`hidePrefix`+`hidePostfix` to `FieldPillDisplay`, `hidePrefix`+`hidePostfix` to `FieldPillInput`.
- **FieldDisplay.jsx**: Added `hideName` prop (default: false). Integrated into `showLabel` — `showLabel = !compact && !hideName && binding?.display?.showLabel !== false`.
- **FieldPillDisplay.jsx**: Added `hideName`/`hidePrefix`/`hidePostfix` props. `prefix = hidePrefix ? "" : (field?.meta?.prefix||"")`. Same for postfix. `fieldName = hideName ? null : (rawFieldName||null)`.
- **FieldPillInput.jsx**: Added `hidePrefix`/`hidePostfix` props. Same pattern.
- **Instance.jsx (helpers)**: `entityDragMode = occurrence?.dragMode ?? instance?.defaultDragMode ?? "move"`. `toggleEntityDragMode` writes to occurrence (via `updateOccurrence`) if occurrence has explicit `dragMode`, else updates instance template.
- **dragSystem.js (helpers)**: `mode = data?.occurrence?.dragMode ?? data?.defaultDragMode ?? 'move'` at drag start in `useDragDrop`.

## Recent Changes (Mar 2026 — data-testid + CSS Classes)
- **CommandCenter.jsx**: Added `data-testid="command-center"` to root wrapper div (line 140).
- **RadialMenu.jsx**: Added `data-testid="radial-handle"` to central handle button (line 386).
- **LayoutForm.jsx, ContainerForm.jsx, InstanceForm.jsx**: No changes this session.
- **New CSS classes in index.css** (drop-indicator series, module-header-row, module-grab-zone, empty-placeholder, linked-copy-badge, flex-center, abs-fill, scroll-y, truncate-text).

## Recent Changes (Mar 2026 — RadialMenu handleToggle Batch Fix)
- **RadialMenu.jsx**: Fixed `handleToggle` — moved `updateAnchor()` OUT of the `setIsOpen()` updater. Now called directly before `setIsOpen(prev => !prev)`. Root cause: calling `setState` from inside a `setState` updater creates a separate React batch, so `setOpenDirection` from `updateAnchor` wasn't applied in the same render as `isOpen=true`. Result: arc now opens with correct direction on FIRST render.

## Recent Changes (Mar 2026 — RadialMenu Viewport-Center Direction)
- **RadialMenu.jsx**: Replaced threshold-based edge detection with viewport-center approach. Extracted `calcOpenDirection(centerX, centerY, vw, vh, spread)` as a named export for testability. Left-half handles → open right; right-half → open left; near top/bottom edge → open down/up. No more threshold tuning needed.
- **RadialMenu.test.js (NEW)**: 9 tests covering all direction cases (left column, right column, bottom edge, top edge, corners). Tests caught the previous threshold bug.

## Recent Changes (Mar 2026 — Tabbed Forms + Off-Screen Fix)
- **ContainerForm.jsx**: Redesigned with shadcn `<Tabs>` — 3 tabs: Settings (label+drag+behavior+persistence+iteration), Style (container+child instance style), Templates. Delete is sticky footer outside tabs. Fixed width `w-72` (288px). `max-h-[55vh] overflow-y-auto` per tab content.
- **InstanceForm.jsx**: Redesigned with shadcn `<Tabs>` — 3 tabs: Settings (label+drag+autocheck+sibling links+iteration+behavior), Style, Fields. Delete is sticky footer outside tabs. Same width/scroll pattern.
- **LayoutForm.jsx**: Redesigned with shadcn `<Tabs>` — 4 tabs: Basic (name+viewtype+drag+iteration+persistence+child behavior toggle), Layout (presets+display/flow/wrap+width+height+alignment+grid/gap+scroll), Style (child container/instance defaults+insets/padding/variant), Actions (lock/permissions+panel actions). Delete is sticky footer. Fixed width 320px. Added panel-level **Child Behavior** section in Basic tab — Own/Inherit toggle + sortable/droppable checkboxes; uses existing `onPanelStyleUpdate` prop.
- **Module.jsx**: Added `collisionPadding={8}` and `p-0` to panel + container PopoverContent. Radix avoids viewport edges.
- **Instance.jsx**: Added `collisionPadding={8}` and `p-0` to instance PopoverContent.
- **RadialMenu.jsx**: Improved edge detection — uses actual `s.radius + 14` instead of hardcoded 60. Added `topEdge` check (`dir = 'down'`). Added 4 diagonal corner cases (bottom-left→right, bottom-right→up, top-left→right, top-right→left). Renamed inner `pad` to `clampPad` to avoid variable collision.
- **DragProvider.jsx**: Added sortable check before reorder — if `toC?.behaviorMode === "own" && toC?.behavior?.sortable === false` and same container, `clearSession()` and return.

## Recent Changes (Mar 2026 — Behavior Toggle + Instance Behavior)
- **FieldInput.jsx**: Date type now shows relative badge next to input — "today" (green), "in N days" (yellow/gray), "N days overdue" (red). Uses `useMemo` to compute day diff from today.
- **FieldDisplay.jsx**: Date type now shows "Jun 15 · in 3d" / "Jun 15 · overdue" format instead of plain `toLocaleDateString()`.
- **ContainerForm.jsx**: Added "Behavior" section — `behaviorMode` Own/Inherit toggle + sortable/draggable/droppable checkboxes (Phase 5.2). Calls `onContainerUpdate({ behavior, behaviorMode })`.
- **InstanceForm.jsx**: Added behavior toggle — Own/Inherit toggle + draggable checkbox when Own selected. Uses `CommitHelpers.updateInstance`.

## Recent Changes (Mar 2026 — OperationsTab Category + Preview Run)
- **CommandCenter.jsx**: `OperationsTab` now has `handleCreateCategory` (same as FieldsTab) + `+ Category` toolbar button with `FolderPlus` icon. Toolbar row appears above the columns.
- **CommandCenter.jsx**: `handleRun` changed from executing `executePipeline` to just calling `setPreviewOp(op)`. Removed `executePipeline` + `setComputedValuesAction` imports (no longer needed).
- **CommandCenter.jsx**: Preview panel renders in OperationsTab list view when `previewOp` is set — shows operation name, trigger types with `$trigger.*` property hints (via `TRIGGER_TYPES` lookup), sources list (`$varName(entityType)`), and steps summary (with `if (N rules) → N actions` descriptions). Close with ✕.
- **CommandCenter.jsx**: OperationEditor's Run button relabeled "Preview" (purple styling). Clicking it in the drill-down view calls `setSelectedOpId(null)` + `handleRun(op)` — navigates back to list view and shows preview.
- **CommandCenter.jsx**: Inline Play button in `renderOpColumn` tooltip changed from "Run now" to "Preview operation".

## Recent Changes (Mar 2026 — EntityTreeTab Unsorted + Ancestry + Grid Drop)
- **CommandCenter.jsx**: `DraggableInstanceRow` gains optional `ancestry` prop — renders as muted 9px text below the label (`Panel › Container` breadcrumb). Passed at the tree call site: `ancestry={panelNode.label + " › " + contNode.label}`.
- **CommandCenter.jsx**: `EntityTreeTab` computes `placedInstanceIds` (Set of instance IDs that appear in the grid tree via occurrences). "Unsorted" collapsible section renders all instances NOT in that set — shows count, uses `DraggableInstanceRow` at depth 0.
- **DragProvider.jsx**: Added `MODULE FROM COMMAND CENTER → CONTAINER` handler — when a `type: "module"` drag (sourceType: "command-center") is dropped on a container, calls `LayoutHelpers.copyInstanceToContainer` with `iterationMode: "persistent"` to create a new occurrence of the existing instance.

## Recent Changes (Mar 2026 — CommandCenter Drill-down)
- **CommandCenter.jsx**: FieldsTab + OperationsTab now use **drill-down pattern** — when field/op is selected, entire pane is replaced by FieldDetail/OperationEditor. Sticky "← Fields" / "← Operations" back bar at top of detail view. Removed stacked (columns + editor below) layout.
- **CommandCenter.jsx**: `ChevronLeft` added to lucide imports.
- **Module.jsx**: `ModulePanel` now uses `useDragHotContext()` for `hotTarget` + `useDragHotContext` added to imports. This prevents ModuleContainers from re-rendering during drag hover.
- **Grid.jsx**: `GridCell` uses `useDragHotContext()` for `panelOverCellId`.

## Recent Changes (Mar 2026 — CommandCenter UX + Module Handle CSS)
- **CommandCenter.jsx**: FieldsTab unified drag — removed separate "DRAG TO INSTANCE" pill strip. Category column chips now use `<FieldPill compact>` (Pragmatic DnD draggable). `monitorForElements` tracks dragged fieldId so HTML5 column `onDrop` still works for category reassignment. Single chip drag works for both category reassignment AND instance field binding.
- **CommandCenter.jsx**: Category columns now have `maxHeight: 180, overflowY: "auto"` so long field lists scroll.
- **CommandCenter.jsx**: Entity Tree tab and Components tab merged. "Components" tab removed. `EntityTreeTab` now includes: collapsible tree, `DraggableInstanceRow` components (Pragmatic DnD draggable with `type: "module"` data), templates section below the tree. `DraggableInstanceRow` uses `GripVertical + Box` icon + field count.
- **FieldPill**: Added `compact` prop — renders as flat list-item style (not pill) when `compact=true`. Used in category columns.
- **index.css**: Module handle (cog) now uses `opacity: 0.08` (dot-like indicator) instead of `display: none`. Shows at full opacity via `.panel-header:hover > .module-handle` and `.container-header:hover > .module-handle` (HEADER hover only, not whole shell). Prevents text shift on hover. `.dragging .module-handle` uses `opacity: 0`.

## Recent Changes (Mar 2026 — Field/Operation Categories)
- **CommandCenter.jsx**: FieldsTab redesigned to category-column layout. `categoryFolders` = folders where `folderType === "category"` for current grid. Fields grouped by `field.folderId`. Columns have HTML5 drag/drop for category reassignment (set `dragFieldId` → `handleDropOnFolder` → `updateField({ folderId })`). "DRAG TO INSTANCE →" pill strip below columns keeps existing Pragmatic DnD FieldPill behavior. `renderCategoryColumn` helper renders each column. "+ Category" button creates new Folder (folderType: "category").
- **CommandCenter.jsx**: OperationsTab redesigned same way — `opsByFolder` groups by `op.folderId`. `renderOpColumn` helper with inline Run button. Drag to column → `updateOperation({ folderId })`.
- **CommandCenter.jsx**: `FieldDetail` gets `categoryFolders` prop + Category dropdown (`field.folderId` select). `OperationEditor` gets `categoryFolders` prop + Category dropdown (`op.folderId` select).
- **CommandCenter.jsx**: Added `FolderPlus` to lucide imports.
- **server/models/Field.js**: Added `folderId: { type: String, default: null }`.
- **server/models/Operation.js**: Added `folderId: { type: String, default: null }`.
- **server/models/Folder.js**: Added `"category"` to `folderType` enum.
- **createDefaultUserData.js**: `fitnessFolderId`/`nutritionFolderId` UIDs generated before STEP 1. Fitness fields (workoutReps/Sets/muscleGroup/chestMin-cardioMin) get `folderId: fitnessFolderId`. Nutrition fields (protein/carbs/fats/mealCategory/totalProtein-Fats) get `folderId: nutritionFolderId`. 6 fitness ops + 3 nutrition ops get matching `folderId`. Two Folder records saved in STEP 6. Reset: 7 folders.

## Recent Changes (Mar 2026 — Comprehensive Triggers UI)
- **CommandCenter.jsx**: `TRIGGER_TYPES` expanded to 11 types: onChange, onDrop, onCreate, onDelete, onMove, onComplete, onModuleUpdate, onIteration, onLoad, onWebhook, manual. Each has `triggerData: [...]` listing available `$trigger.*` properties.
- **CommandCenter.jsx**: `TriggerDataHint` component — shows `$trigger: prop1 · prop2 · ...` for the active trigger type. Displayed inline below trigger config sections.
- **CommandCenter.jsx**: New trigger config sections for `onCreate` (container + panel filter), `onDelete` (container filter), `onMove` (from/to container filter), `onComplete` (field filter — boolean fields only).
- **CommandCenter.jsx**: `OperationPill` trigger short-label map updated for all 11 types.
- **CommandCenter.jsx**: Bug fix — `handleCreate` pipeline format changed from `{ sources: [], conditions: [], actions: [] }` to `{ sources: [], steps: [] }`. `PipelineEditor` prop default same fix.

## Recent Changes (Feb 22 Session 2)
- **DocToolbar.jsx**: N15 — `Unlink` button appears when cursor on fieldPill/instancePill; replaces with `#FieldName` / label text. S5 — `MD` download button; `tiptapToMarkdown()` recursive JSON→Markdown converter (headings/lists/marks/pills/hr/blockquote). `Download` + `Unlink` lucide icons added.
- **CommandCenter.jsx**: S2 — `EntityTreeTab` (new "Entity Tree" tab). Grid→Panels→Containers→Instances collapsible tree with search filter and badge counts (Nc/Ni/Nf). Icons: `Network` (tab), `LayoutPanelLeft` (panel), `Layers` (container), `Box` (instance). S7 — `FieldDetail` enhanced: unit field, select options editor (add/remove pills), displayConfig section (aggregation dropdown, targetValue, targetPeriod, showArrows checkbox).
- **FieldInput.jsx**: Bug #5 — boolean fields default to `false` when value is null (`defaultValue = field?.type === "boolean" ? false : undefined`).

## Recent Changes (Feb 22 Late — N12/N14/N16/N17)
- **CommandCenter.jsx**: N14 — In-flow element (no position:fixed). `max-height: (open && !isDragging) ? "50vh" : 0`. Tab bar always visible. Content transitions.
- **PomodoroTimer.jsx**: N13 — Compact ring+time bar. Slide-down panel at fixed position. Outside click + Escape close.
- **FieldPillNode.jsx**: N16 — Pencil/BarChart2 mode icons. PILL_COLORS 4 modes. resolvedMode from live field.inputEnabled/displayEnabled.
- **FieldRenderer.jsx**: Updated for inputEnabled/displayEnabled + computedValues from context.
- SortableContainer.jsx: N12 — Focused view 3-tab layout (Notes/Fields/History). `historyExpanded` → `focusedTab`. History tab shows field values per entry.

## Recent Changes (Feb 22)
- ContextMenu.jsx: CREATED — portal-based right-click menu
- LayoutForm.jsx: Added Panel Actions section (Copy/Link/Split/Merge buttons)
- CommandCenter.jsx: Implemented ListsTab, ShortcutsTab, UserSettingsTab (was stubs)
- CommandCenter.jsx: ConnectionsTab LIVE — GET /api/connections lists file_storage+notebook, browse files, import into manifest via /api/connections/:id/import, upload via /api/upload
- CommandCenter.jsx: FieldDetail updated to inputEnabled/displayEnabled checkboxes (removed legacy mode select)
- Panel.jsx: Focused instance view now includes DocContainer below fields — instance doc notes stored in occurrence.docContent
