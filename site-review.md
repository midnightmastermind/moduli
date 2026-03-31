# Moduli — Full System Review

_Reviewed: 2026-03-30_

**Codebase**: ~44k lines client (164 files), ~8k lines server. React + Socket.io + MongoDB.

---

## 1. Architecture & Data Model

### Rating: Strong

The occurrence-based architecture is sound and well-enforced. Modules are reusable templates, Occurrences are placements. Views are separate records linked via `occurrence.viewId`. This gives genuine flexibility — the same module can appear in multiple places with different field values, different views, and different positions.

**What works well:**
- Clear separation: Module (what), Occurrence (where/how), View (rendering config)
- `CommitHelpers.js` as the sole socket-caller contract is consistently enforced (ManifestTree violations just fixed)
- Optimistic local dispatch + socket emit pattern is clean
- `GridActionsContext` / `GridLiveContext` split prevents unnecessary re-renders from computedValues changes

**Issues found:**
- `lightenHex` is defined in both `ModuleContainer.jsx:61` and `colorHelpers.js`. The one in ModuleContainer should import from colorHelpers.
- `occurrencesById` is rebuilt from an array on every full_state (`Object.fromEntries(arr.map(o=>[o.id,o]))`). With 1000+ occurrences this is noticeable. A `byId` map in the reducer would be more efficient.
- `state.modules` is stored as an array but almost always accessed as a map (`modulesById`). The reducer should store it as a map natively.

---

## 2. Drag & Drop

### Rating: Functional, needs extraction

DragProvider.jsx is 2,151 lines — the single largest file in the codebase. It handles all drag types correctly but is hard to read and maintain.

**What works well:**
- Pragmatic DnD integration is solid — `useDraggable`, `useDroppable`, `useDragDrop` hooks abstract the library cleanly
- `DragType` enum + `DropAccepts` map provide clear type safety for what drops where
- Session refs for immediate state access during async drops
- `DragHotContext` split prevents re-renders during hover
- Highlight now works for all drag types except panel (fixed this session)
- Auto-scroll during drag
- Mobile touch support with haptic feedback, hold delay, and throttled hit-testing

**Issues found:**
- **CC drops into docs now work** (fixed this session) — Editor.jsx falls back to finding existing occurrence when no occurrenceId in payload
- **Doc pill and tree item occurrenceId at root level** — now handled by Editor.jsx checking `sd.occurrenceId`
- DragProvider is a 2,151-line monolith. The plan identified extracting handlers into `dropHandlers.js` — this is still deferred but would significantly improve readability. Each drag type handler (instance, container, module, artifact, file, field, folder) could be a separate function.
- `getHoveredIds` does `document.elementsFromPoint` which is expensive — throttled to 32ms but still the main perf bottleneck during drag

**Missing:**
- No drag-to-reorder within ManifestTree (folders/docs). Items are draggable but only for cross-target drops (folder → folder), not reordering within a folder.
- No undo for drag operations (move is destructive)

---

## 3. ManifestTree (File/Page Sidebar)

### Rating: Functional, minor issues remain

ManifestTree renders folder hierarchies with doc nodes, page nodes, and anchor chips. It supports two modes: root tree (user manifest) and local tree (panel pages only).

**What works well:**
- Folder → doc → anchor chip hierarchy is clean
- Drag artifacts between folders works
- Page tree nodes show container anchors with scroll-to-container on click
- Touch drag to open/close sidebar
- Default page (pin) feature with right-click

**Issues fixed this session:**
- PageTreeNode containers now sorted by `sortOrder`
- `handleNewDoc` and `handleCreateFolder` migrated to CommitHelpers
- FolderNode drop `maxOrder` now considers all child types

**Issues remaining:**
- **O(n) childOccs scan** (`DocNode:53-57`): `Object.values(occurrencesById).filter(o => o.parentId === occ.id)` runs per DocNode per render. Should use a `childrenByParentId` index.
- **No reorder within folder**: You can drag a doc to a different folder, but you can't reorder docs within the same folder by dragging.
- **No folder rename UI**: Folders have a name but no way to rename them (no double-click or context menu for folders).
- **No folder delete UI**: The only way to remove a folder is through the database.
- **Collapsed width is hardcoded**: `width: 24` when collapsed, `170px` when expanded. Not responsive.

---

## 4. Operations Pipeline

### Rating: Powerful, but gaps between UI and executor

The operations system is a full pipeline executor with variables, loops, conditionals, and side-effects. It's essentially a visual programming runtime embedded in the app.

**What works well:**
- Pipeline execution model is clear: sources → vars → steps (action/if/loop)
- `gatherLoopItems` supports many collection types: occurrences, modules, fields, templates, container_items, occurrence_history
- Expression resolution with `$var.field` dot notation and template string interpolation
- Time filtering with parent-chain date walk (instance → container → panel)
- `$activeDate` from filter nav (not hardcoded to today)
- 14 action types: SET_FIELD_VALUE, SHOW_VALUE, AGGREGATE, MOVE_OCCURRENCE, etc.

**Issues fixed this session:**
- 6 missing trigger types added to `matchesTrigger` (onAdd, onRemove, onReorder, onUncomplete, onButton, onNodeInput)
- `scopeContainerId` fixed — was reading module.occurrences (always empty), now reads from occurrence hierarchy

**Issues remaining:**
- **`onButton` and `onNodeInput` have no fire mechanism**: `matchesTrigger` now handles them but nothing in the system actually fires `"ButtonOp"` or `"NodeInputOp"` transaction types. The OperationsTab has a "Run" button but it calls `executePipeline` directly, bypassing the trigger system.
- **`OccurrenceMoveOp` only fires locally** in DragProvider — multi-window `onMove` triggers won't work. Would need a server-side `occurrence_moved` event.
- **`extractFieldValuesFiltered` in operationActions.js still uses legacy `iteration.timeValue`** for time filtering (line 29), while `gatherLoopItems` in operationExecutor.js uses the newer parent-chain date field walk. These two code paths are inconsistent.
- **No operation error reporting to user**: If a pipeline step fails, it's caught silently with `console.warn`. Operations that produce wrong results are very hard to debug.
- **Block system (visual editor) is built but disconnected**: `blocks/` folder has Block.jsx, Slot.jsx, BlockPalette.jsx, OperationsBuilder.jsx, OperationsCanvas.jsx — but the pipeline executor uses the step-based format, not block trees. The block tree path exists (`executeOperation` with `blockTree`) but is rarely used.

---

## 5. Rich Text Editor (TipTap)

### Rating: Feature-rich, well-integrated

Editor.jsx is 979 lines with 7 custom TipTap extensions, block handles, and a drop target for moduleEmbed nodes.

**What works well:**
- 7 extensions: FieldPill, InstancePill, DocLink, ExprPill, ModuleEmbed, PillBackspace, HeadingFocus
- `moduleEmbed` now renders real components (Container/Instance/Artifact) — uniform rendering everywhere
- Block handle (Notion-style ⠿ per-paragraph) with options menu
- `@` mention → field pills, `@:` → embedded module picker, `=` → expression pills
- Command palette for formatting
- Drag anything into a doc → inserts at cursor position
- Sticky toolbar when scrolling
- Export to markdown

**Issues found:**
- **No collaborative editing**: Two users editing the same doc will overwrite each other. TipTap supports Yjs for real-time collab but it's not wired.
- **Expression pill `evalExpr` uses `Function()` constructor** (ExprPillNode.jsx) — this is a potential XSS vector if user-controlled field names contain malicious content. There's a whitelist check but it relies on regex matching.
- **No image resize in editor**: Images can be inserted but not resized within the doc.
- **ModuleEmbed alignment/resize** works via drag handle + toolbar, but there's no way to resize inline embedded instances — only full-width or float left/right/center.

---

## 6. Fields & Calculations

### Rating: Complete and well-designed

8 field types (number, text, boolean, select, date, duration, rating, module) with 15 aggregation functions. The unified `Field.jsx` component handles all display and input modes.

**What works well:**
- `Field.jsx` is a single component for all rendering — no more separate Display/Input/Pill variants
- Flow values (`in`/`out`/`replace`) enable income/expense tracking from one field
- `FieldRenderer.jsx` handles all the orchestration (computedValues, onCommit callbacks, pool-sourced selects)
- Pool-sourced select fields with O(1) lookup map
- Module reference field type for cross-module linking
- Progress bars with scaled targets across time periods

**Issues found:**
- **No field validation**: Number fields accept any text (parsed with `Number()` which returns NaN). No min/max enforcement.
- **Select field `removeOnComplete`** is defined in the schema but I couldn't find where it's actually enforced on the client.
- **Duration field input** only supports hours + minutes. No seconds granularity.
- **Rating stars** are hardcoded to 1-5. No configuration for max rating.

---

## 7. Filter System

### Rating: Functional

Named filters with date navigation replace the old iteration system. Each filter has a `timeScale` and optional field conditions. Occurrences are shown/hidden based on field value matching.

**What works well:**
- `resolveEffectiveFilters` with override chain (inherit/clear/own) per occurrence
- `isOccurrenceVisible` checks field values with type-aware comparison
- FilterNav shows date prev/next for time-scaled filters
- `Ctrl+[` / `Ctrl+]` keyboard shortcut cycles through filters

**Issues found:**
- **No "AND" vs "OR" for multiple conditions**: Multiple conditions on a filter are implicitly AND. No way to say "show if field A = X OR field B = Y".
- **Filter conditions are per-field equality only**: No range filters (e.g., "date > March 1"), no contains/startsWith for text.
- **No filter indicator on items**: When items are hidden by a filter, there's no visual count of "N items hidden" on the container.

---

## 8. Panel/Page System

### Rating: Good, recently overhauled

Panels contain pages, pages contain containers. Pages route content by `kind`: board (container list), canvas (free-form), doc (TipTap), display (artifact viewer).

**What works well:**
- Page tab strip with drag-to-reorder
- Dual sidebar (Root tree + Local tree) in panels
- Page kind routing (board/canvas/doc/display)
- Doc pages render TipTap directly (fixed this session — was going through Artifact)
- Tree view pages (hasTree + manifestId) render Artifact content with sidebar navigation

**Issues found:**
- **No page delete confirmation**: `handleDelete` in ModulePage removes immediately with no undo.
- **Canvas page uses the page occurrence as the container occurrence** — this means canvas items are children of the page, not of a container. Works but breaks the panel → page → container → instance hierarchy assumption.
- **Settings popover is created but never wired**: `settingsOpen` state in ModulePage exists but nothing opens it (the RadialMenu doesn't have an `onSettings` that sets it).

---

## 9. Container System

### Rating: Solid, feature-rich

ModuleContainer.jsx (1,182 lines) handles all container kinds: list, doc, canvas, pool, board. Supports embedded mode for doc containers within artifacts.

**What works well:**
- 5 container kinds with distinct rendering paths
- Embedded container styling with accent colors from `ownStyle.bg`
- Filter override popup for per-container field filtering
- Template save/fill
- Drag handle + RadialMenu + context menu pattern
- `useReducer` consolidates 13 state variables into one

**Issues found:**
- **No container kind switching UI**: Once a container is created as "list", there's no way to change it to "doc" or "canvas" without editing the module directly.
- **Canvas draw mode conflicts with drag**: The draw overlay captures pointer events, and while grip handles have `pointerEvents: "auto"`, it's easy to accidentally draw when trying to drag.
- **Pool container search is client-side only**: With 100+ pool items, performance could degrade. No server-side search.

---

## 10. Instance System

### Rating: Clean

ModuleInstance.jsx (576 lines) wraps InstanceInner with drag/drop + context menu.

**What works well:**
- Collapse/expand for fields
- Per-occurrence drag mode override
- Linked sibling O(1) lookup via `linkedGroupIndex`
- Disabled instances (meta.disabled) render as display-only
- File preview for instances with `fileRef`

**Issues found:**
- **No inline editing of instance label in list view**: You have to open the settings popover to rename. Most list apps allow clicking the label to edit.
- **Operation widget buttons** (`Play` icon) appear for instances with operationBindings but the execution path is unclear — it calls `executeOperation` locally without going through the trigger system.

---

## 11. Mobile Support

### Rating: Functional, needs polish

Mobile detection via `useMobileDetect` hook. MobileGridNav provides viewport navigation with rail buttons and zoomed-out mode.

**What works well:**
- Touch drag with 80ms hold delay prevents accidental drags
- Haptic feedback on drag start and drop
- Rail buttons for cell navigation (avoiding Samsung back-gesture zone)
- Zoomed-out mode for grid overview
- MiniGridMap in toolbar

**Issues found:**
- **No swipe gestures**: Swipe-to-navigate was explicitly removed. Navigation is buttons only.
- **No pull-to-refresh**: Common mobile pattern, not implemented.
- **Command Center on mobile**: Slides up from bottom but takes full width. Tab bar may be cramped with 11 tabs.
- **Touch targets**: Some UI elements (folder add "+", anchor toggle arrows) are very small (8-10px).

---

## 12. State Management

### Rating: Good

Custom Redux-like store with `useBoardState` hook, `masterReducer`, and `bindSocketToStore` for socket → dispatch mapping.

**What works well:**
- `localOccsById` cache in bindSocketToStore fixes race condition between socket events and React renders
- BroadcastChannel for multi-tab sync (same browser)
- Double RAF for deferred operation execution on load (grid renders first)
- `stateRef` gives operations executor immediate access to current state

**Issues found:**
- **No offline support**: If socket disconnects, all mutations are lost. No queue or retry.
- **No conflict resolution**: Two tabs editing the same occurrence → last write wins.
- **Full state on every reconnect**: `request_full_state` dumps everything. No incremental sync.
- **`state.modules` is an array**: Most consumers need `modulesById` (a map). The array→map conversion happens in `createLookupsFromState` on every relevant state change.

---

## 13. Server

### Rating: Functional, single-file monolith

Server is a single Express + Socket.io server with Mongoose models. Socket handlers in `socketHandlers/crud.js`.

**What works well:**
- In-memory cache (`loadUserIntoCache`) with `.lean()` queries for speed
- Cascade delete for occurrences (deletes all descendants)
- Textmap → markdown file sync (`uploads/md/{occId}.md`)
- Copy-linked occurrence sync (fields + textmap propagation)
- Artifact upload with module + occurrence + view creation

**Issues found:**
- **No authentication on socket events**: Socket handlers check `userId` from the connection but don't validate authorization for specific resources. Any authenticated user could theoretically modify another user's data if they guessed IDs.
- **No rate limiting**: Socket events have no throttle. A malicious client could flood the server.
- **`createDefaultUserData.js` is 2,000+ lines**: Sample data generation is a massive function. Hard to maintain.
- **No database indexes on Occurrence**: `Occurrence.find({ userId })` works but `Occurrence.find({ parentId })` (used by ManifestTree childOccs) likely does a collection scan. Missing indexes: `parentId`, `targetId`.

---

## 14. Undo/Redo

### Rating: Partial

Transaction records (MeasureOp, OccurrenceListOp, EntityOp, DocEditOp) provide an audit trail. `useUndoRedo` hook provides undo/redo buttons.

**What works well:**
- Transaction model captures WHO/WHAT/WHERE/WHEN
- FLIP animations on undo
- TransactionHistory UI shows audit trail

**Issues found:**
- **Server undo handlers are partial**: The CLAUDE.md notes this as 88% complete. Undo works for field value changes but not for all occurrence operations.
- **No undo for drag operations**: Moving an instance between containers creates an OccurrenceListOp but undoing it doesn't restore the original container's occurrence list.
- **No undo for delete**: Deleting a module or occurrence is permanent (no trash with restore, despite `trashed` field on Module).

---

## 15. Themes & Styling

### Rating: Good

Three themes (moduli-dark, moduli-light, midnight) via CSS custom properties. `useTheme` hook persists to localStorage.

**What works well:**
- All semantic colors use CSS variables (`--text-primary`, `--accent-blue`, etc.)
- Zero hardcoded `rgba()` in component files (all purged to vars)
- Per-module style overrides with cascading (panel → container → instance)
- Custom CSS token editor in AppearanceTab

**Issues found:**
- **Light theme likely undertested**: The CLAUDE.md mentions a "light theme pass" but the default dark-oriented development means light theme edge cases may exist.
- **`hexToRgba` still duplicated**: Exists in both `colorHelpers.js` (authoritative) and as a local function in ModuleContainer.jsx (the import exists but `lightenHex` is also locally defined).

---

## 16. Performance

### Rating: Adequate for current scale

**Optimizations in place:**
- `React.memo` on Panel, Container, Instance
- `GridLiveContext` split (computedValues don't re-render all consumers)
- `useReducer` in Container (batched state updates)
- `linkedGroupIndex` O(1) lookup
- Pool field O(1) `byTargetId` map
- Throttled hit-testing during drag (32ms)
- Deferred operation execution via double RAF

**Concerns:**
- **DragProvider re-renders**: 2,151 lines with many useState hooks. During drag, multiple state changes trigger re-renders of the entire provider tree.
- **ManifestTree DocNode childOccs scan**: O(n) per node per render.
- **`Object.values(occurrencesById).filter()`** pattern appears in many places (ManifestTree, operationExecutor, FieldRenderer). A pre-built index by `targetId` and `parentId` would help.
- **No virtualization**: Container lists render all instances. With 100+ items in a container, this will be slow.

---

## Summary

| System | Rating | Priority Issues |
|--------|--------|-----------------|
| Architecture | Strong | Array→map for modules/occurrences |
| Drag & Drop | Functional | DragProvider extraction (deferred), CC→doc drops (fixed) |
| ManifestTree | Functional | Reorder within folder, folder rename/delete |
| Operations | Powerful | Wire onButton/onNodeInput fire mechanism, consistent time filtering |
| Rich Text Editor | Feature-rich | No collab editing, Function() XSS concern |
| Fields | Complete | Validation, removeOnComplete enforcement |
| Filters | Functional | AND/OR logic, range filters |
| Panel/Page | Good | Page delete confirmation, settings wiring |
| Containers | Solid | Kind switching UI, canvas draw conflicts |
| Instances | Clean | Inline label editing |
| Mobile | Functional | Touch target sizes, 11-tab CC layout |
| State | Good | Offline support, incremental sync |
| Server | Functional | Auth on socket events, missing DB indexes |
| Undo/Redo | Partial | Server handlers, drag undo, delete undo |
| Themes | Good | Light theme testing, duplicate helpers |
| Performance | Adequate | Virtualization for large lists, pre-built indexes |

### Top 5 Actions (by impact)

1. **Wire `onButton` / `onNodeInput` fire mechanism** — operations UI exposes these triggers but nothing fires them
2. **Add `parentId` and `targetId` indexes** to Occurrence model — many O(n) scans in ManifestTree and operations
3. **Extract DragProvider handlers** into separate functions — 2,151 lines is unmaintainable
4. **Add folder rename/delete/reorder in ManifestTree** — basic file management is incomplete
5. **Add offline queue** for socket mutations — any network hiccup loses changes
