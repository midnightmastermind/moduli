# Moduli — Authoritative Phase Plan
_Updated: 2026-03-16. This supersedes PHASE_PLAN_2.md (deleted). See PRAGMATIC.md for code philosophy. See REVIEW.md for architecture audit._

> **Philosophy**: Bugs and cleanup before features. DRY before clever. Ship working slices before polishing.

---

## System Status (March 2026)

| Layer | Status |
|-------|--------|
| Occurrence-based architecture | ✅ Complete |
| Module unification (Panel/Container/Instance → Module) | ✅ Complete |
| DnD (Pragmatic DnD, all drop zones, drilldown) | ✅ Complete |
| Fields & Calculations (all 15 agg types) | ✅ Complete |
| Operations pipeline (LOOP/IF/action steps) | ✅ Complete |
| Block system (visual editor) | ✅ Complete |
| Transactions & undo/redo | ✅ Complete |
| Rich editor (TipTap, pills, embeds) | ✅ Complete |
| Artifact system (file tree, markdown/image/pdf/audio/video) | ✅ Complete |
| Cascading styles | ✅ Complete |
| Cascading behavior toggles (sortable/draggable/droppable) | ✅ Complete |
| Filter system (replaces iteration entirely) | ✅ Complete |
| Command center (9 tabs) | ✅ Complete |
| Code cleanup (CommitHelpers, action types, schema) | ✅ Complete |
| Tests: 323 client + 63 server | ✅ Passing |
| E2E: 9 Playwright specs | ✅ Setup |

---

## Phase 0 — Filter System (Replaces Iteration System Entirely) ✅ COMPLETE

> **No legacy code.** The old `occurrence.iteration`, `grid.iterations[]`, `grid.selectedIterationId`, `grid.currentIterationValue`, `grid.categoryDimensions` are all deleted. Clean break.

### Design Summary

**Core principle**: Occurrence visibility is driven by field values matching active filter conditions. Time is not special — the date nav in the toolbar just updates `activeFilterValues[dateFieldId]`. If a named filter contains a date-type field, the date nav appears; otherwise it grays out.

**Three pieces:**
```
grid.namedFilters[]          — user-created filter presets (defined via condition builder)
grid.activeFilterId          — which named filter is selected
grid.activeFilterValues      — live field→value map, changes as user navigates

occurrence.filterOverride    — per-panel/container: null = inherit parent, else own values
occurrence.hidden            — set by HIDE_OCCURRENCE operation effect
```

**Visibility rule** for an instance occurrence:
```
For each condition in active named filter:
  - If occurrence has no value for that fieldId → PASS (persistent/universal item)
  - If occurrence has value matching condition → PASS
  - If occurrence has value not matching → HIDDEN
```

**Top-down inheritance:**
```
Grid: activeFilterId = "daily-work"
  └── Panel: filterOverride = null     → inherits grid filter
  └── Panel: filterOverride = { fieldId: "...", value: "fitness" }  → own filter
       └── Container: filterOverride = null  → inherits panel filter
       └── Container: filterOverride = {}    → clears all filters (show everything)
```

**untilDone → operations:**
- Replaced by `HIDE_OCCURRENCE` / `SHOW_OCCURRENCE` operation effects
- Operation: `onChange(completionField)` → `IF completionField IS true → HIDE_OCCURRENCE`
- `occurrence.hidden = true` persisted to DB, checked during Container render

### Implementation ✅ All Done
- **Grid.js**: `namedFilters[]`, `activeFilterId`, `activeFilterValues {}`, `defaultDayPageTemplateId`
- **Occurrence.js**: `filterOverride` + `hidden` (replaced entire iteration block)
- **Server handlers**: `update_grid_filter`, `update_grid_named_filters`, `update_occurrence_filter_override`, `update_occurrence_hidden`
- **Operations**: `HIDE_OCCURRENCE` / `SHOW_OCCURRENCE` effect types; `onIteration` → `onNavigation` everywhere
- **Client state**: initialState, actions, masterReducer, bindSocketToStore, selectors all updated
- **FilterNav.jsx**: replaces IterationNav.jsx — named filter dropdown + conditional date nav
- **Container.jsx + Panel.jsx**: filter children via `isOccurrenceVisible` + skip `hidden` occurrences
- **createDefaultUserData.js**: `scheduledDate` field, `namedFilters` (Daily/Weekly/All), `activeFilterId: "filter_all"`, no more iteration blocks

---

## Phase 1 — Bug Fixes

| # | Bug | Notes | Status |
|---|-----|-------|--------|
| B1 | **RadialMenu direction wrong** | `calcOpenDirection` left half → 'right', right half → 'left'. `handleToggle` calls `updateAnchor()` before `setIsOpen`. | ✅ Done |
| B2 | **React forwardRef child error** | Lucide icons in RadialMenu — fixed with `React.createElement` instead of JSX for forwardRef icons. | ✅ Done |
| B3 | **Zone.Identifier files in git** | Committed 2026-03-16. `.gitignore` has `*.Zone.Identifier`. | ✅ Done |
| B4 | **Playwright E2E timeout on `[data-panel-id]`** | Always start `npm run dev` + resetData before E2E. Known limitation. | 🟡 Known |
| B5 | **Stack nav not discoverable** | Stack hint banner on first load — implemented, localStorage flag prevents repeat. | ✅ Done |

---

## Phase 2 — Code Cleanup ✅ COMPLETE

> **Why**: Dual action type system and CommitHelper duplication caused confusion every session. Deleted while system was stable.

| # | Task | Status |
|---|------|--------|
| 2.1 | **CommitHelpers Consolidation** — role-specific CRUD removed; all use `createModule`/`updateModule`/`deleteModule` | ✅ Done |
| 2.2 | **Action Types Consolidation** — removed `CREATE_PANEL`, `UPDATE_PANEL`, `DELETE_PANEL`, `CREATE_CONTAINER`, etc. | ✅ Done |
| 2.3 | **Legacy Socket Handlers** — removed `create_panel`, `delete_panel`, `create_container`, `delete_container`, `update_instance`, `delete_instance` from server.js | ✅ Done |
| 2.4 | **Schema Cleanup** — Module.js dead fields (`doc`, `childIds`, `fieldIds`) removed; `gridId` index added; Grid.js `toJSON` transform added | ✅ Done |
| 2.5 | **State Shape Cleanup** — `state.panels`, `state.containers`, `state.instances` removed from initialState + masterReducer | ✅ Done |
| 2.6 | **File Organization** — `operationExecutor.js`, `operationActions.js`, `blockEvaluator.js`, `blockTypes.js` moved to `client/src/helpers/`; `colorHelpers.js` extracted (hexToRgba deduplicated) | ✅ Done |
| 2.7 | **Zone.Identifier Files** — staged and committed (B3) | ✅ Done |

---

## Phase 3 — Small Features & Polish ✅ COMPLETE

### 3.1 Doc & Editor Polish
| # | Task | Status |
|---|------|--------|
| D1 | **Expr pill multi-field formula** | ✅ Done |
| D2 | **ModuleEmbed universal embed** | ✅ Done — `@:` triggers embed picker popup. Also `/embed` in CommandPalette. |
| D3 | **Doc pill drag out** | ✅ Done — InstancePillNode payload changed to `{ type: "module", sourceType: "doc", role: "instance" }`. DragProvider handles `sourceType === "doc"`. |
| D4 | **Backspace into pill** | ✅ Done — PillBackspaceExtension rewritten. Inline pills → text on backspace. `moduleEmbed` block: cursor moves before node, does not delete. |
| D5 | **Question cycling from sibling list** | ✅ Done — `CYCLE_FIELD_VALUE` action type. Rotates through select field options by day-of-year. "Daily Question Cycle" operation in createDefaultUserData.js. |
| D6 | **@ tag wired for modules AND fields** | ✅ Done — Popup multiselect search with "Modules" + "Fields" sections. Enter/click inserts pill or embed. |
| D7 | **Code blocks, tables, standard markdown blocks** | ✅ Done — Table extension, `/table` command, table CSS. |
| D8 | **Click & type anywhere in doc** | ✅ Done — `onClick` on `doc-editor-wrapper` calls `editor.commands.focus("end")` when clicking empty space. |
| D9 | **Drop text/module into doc → reformat dialog** | ✅ Done — `DropReformatPopup` in Editor.jsx. Pill/Embed/Text options. |
| D10 | **Highlight text → right-click menu** | ✅ Done — "Turn into instance" in right-click context menu. |
| D11 | **"Convert to module" popup** | ✅ Done — 2s timer after typing heading/list, bottom banner. localStorage flag suppresses repeat. |
| D12 | **Doc block handle (line options)** | ✅ Done — hover block → ⠿ + ⋮ handle. Options: Text/H1/H2/H3/Bullet/Quote/Duplicate/Delete. |

### 3.2 Filter System Polish
| # | Task | Status |
|---|------|--------|
| F1 | **onSchedule trigger** | ✅ Done — time picker UI in OperationsTab. Server cron reads `triggerConfig.onSchedule.{hour,minute}`. |
| F2 | **Recurring task reset** | ✅ Done — `RESET_RECURRING_TASK` action type. Resets completionField + advances dueDate by recurrenceDays. |
| F3 | **Day page default template** | ✅ Done — `grid.defaultDayPageTemplateId`. `navigate_day_page` server handler auto-fills from template. GridLayoutForm has template picker. |
| F4 | **`daysUntil(fieldId)` in resolveExpr** | ✅ Done — `daysUntil:expr` prefix. Computes days from today to date value. |
| F5 | **Filter presets quick-switch** | ✅ Done — `Ctrl+[` / `Ctrl+]` in Toolbar.jsx cycles `grid.namedFilters`. Skips if cursor is in input/textarea. |

### 3.3 DnD Remaining
| # | Task | Status |
|---|------|--------|
| N1 | **Drag files/text from outside → instance pill** | ✅ Done — `handleFileDrop` in Editor.jsx handles `text/plain`/`text/uri-list`. Pre-generates UUID, calls `createModule`, inserts instancePill. |
| N2 | **Files become instances when dragged to board** | ✅ Done — `type: "artifact"` drop on list container calls `copyInstanceToContainer`. |

### 3.4 UI Polish
| # | Task | Status |
|---|------|--------|
| U1 | **Undo slide-back animations** | ✅ Done — `captureAllPositions()` before `_undo()`. `animateToNewPositions` + `flashElement` after 100ms. |
| U2 | **File upload inline preview** | ✅ Done — inline `<img>`/`<video>`/`🎵` preview when `instance.fileRef` exists. 36px thumbnail. |
| U3 | **ConnectionsTab live** | ✅ Done — `/api/connections` lists paths, files browse, import, direct upload. |

### 3.5 Toolbar Redesign ✅ COMPLETE
| # | Task | Status |
|---|------|--------|
| TB1 | **Toolbar height reduction** | ✅ Done — padding 2px 8px, items 26px |
| TB2 | **Account button (avatar) in toolbar** | ✅ Done — circular avatar, Popover with Add Grid / User Settings / Logout |
| TB3 | **Filter UI styling** | ✅ Done — FilterNav compact=true, right zone |
| TB4 | **Keep drawer button and Pomodoro placement** | ✅ Done |

### 3.6 Radial Menu & Module Controls
| # | Task | Status |
|---|------|--------|
| R1 | **Filter button in RadialMenu** | ✅ Done — `onFilter` prop, opens FilterOverridePopup (Inherit/ShowAll/UseActive) |
| R2 | **Template button in RadialMenu** | ✅ Done — `onTemplate` prop, opens TemplatePickerPopup |
| R3 | **Lock document from editing** | ✅ Done — `occurrence.locked` flag. Lock/Unlock button in DocEditorShell. |
| R4 | **Lock list ordering** | ✅ Done — `container.behavior.sortable` toggle in ContainerForm. |
| R5 | **Lock individual items from being moved** | ✅ Done — `instance.behavior.draggable` toggle in InstanceForm. |
| R6 | **Per-field disable option** | ✅ Done — Eye/EyeOff toggle in FieldBindingRow (InstanceForm.jsx). Saves `binding.hidden`. |
| R7 | **Per-module disable option** | ✅ Done — "Disabled" Switch in InstanceForm Settings tab. `instance.meta.disabled`. |

### 3.7 Smart/Filtered Lists
| # | Task | Status |
|---|------|--------|
| SL1 | **Pool containers (`kind: "pool"`)** | ✅ Done — pulls occurrences by filter conditions, not explicit parent.occurrences |
| SL2 | **Goals per specific day** | ✅ Done — `fieldContext.iterationDate` scopes aggregations to active filter date |
| SL3 | **Goals and totals adapting day → week** | ✅ Done — `currentIteration` derived from `grid.activeFilterId → namedFilters[id].timeScale`. `scaleTarget()` adapts target ×7 for weekly. |

### 3.8 Module Positioning in Docs
| # | Task | Status |
|---|------|--------|
| MP1 | **Embedded module resize + alignment** | ✅ Done — ModuleEmbedExtension: `align` (full/left/center/right) + `width` attrs. Alignment toolbar + right-edge drag handle. |

---

## Phase 4 — Whiteboard & Canvas

| # | Task | Status |
|---|------|--------|
| C1 | **Canvas module kind** | ✅ Done — `isCanvasContainer = module.kind === "canvas"` in Container.jsx. Dot-grid background. |
| C2 | **Canvas DnD** | ✅ Done — `CanvasCard`: `onPointerDown`/`Move`/`Up`. Saves `occurrence.meta.x/y` via `updateOccurrence` on `pointerup`. |
| C3 | **Canvas instances** | ✅ Done — Double-click canvas → new card at click position. `create_instance_in_container` server handler. |
| C4 | **Canvas arrows** | Connect instances with directed edges. (Future) |

## Phase 4.5 — Artifact View: Preview Mode

> From additions.md. New `viewType: "preview"` for artifact occurrences. Not limited to artifacts long-term — will generalize to other module types.

| # | Task | Status |
|---|------|--------|
| PV1 | **Preview view type** | ✅ Done — `viewType: "preview"` added to View.js enum. View.jsx routes to PreviewCard before all other checks. |
| PV2 | **Thumbnail rendering** | ✅ Done — image: `<img objectFit:cover>`. video: `<video muted preload="metadata">`. pdf/audio/markdown/doc/code/grid: icon fallback (40px emoji). |
| PV3 | **Drilldown from preview** | ✅ Done — "View Full" button calls `updateView({ viewType: fullViewType })` to switch in-place to artifact/markdown view. |
| PV4 | **Embed from preview** | ✅ Done — card is Pragmatic DnD draggable (type: "module", sourceType: "preview-card"). Drop on a doc container inserts as moduleEmbed (DragProvider handles via existing module drop path). |
| PV5 | **Preview view in CC / tree** | ManifestTree and Files tab show preview cards (not just names) when in preview mode. (Future) |

---

## Phase 4.6 — Theme System ✅ COMPLETE

> CSS variable–driven theming. Three system themes. Dark/light mode toggle. Persisted to localStorage.

### Architecture
- **`data-theme` attribute** on `<html>` drives all CSS variable sets. `dark` class stays for color-scheme + Tailwind compatibility.
- **`useTheme()` hook** (`client/src/helpers/useTheme.js`) — reads localStorage, applies `data-theme` + `dark` class on mount and on change. Exported from helpers alongside `SYSTEM_THEMES` definition array.
- **Three system themes** defined with label, dark flag, description, and color swatches:

| ID | Label | Mode | Description |
|----|-------|------|-------------|
| `moduli-dark` | Moduli Dark | Dark | Deep navy/slate blue (default) |
| `moduli-light` | Moduli Light | Light | Clean bright workspace |
| `midnight` | Midnight | Dark | Pure black with violet accents |

- Each theme defines: `--background-0/1/2`, `--surface-0/1/2`, `--border-0/1/2`, `--foreground-0/1/2`, `--input-*`, `--overlay-*`, `--popover-*`, `--body-bg`, `--body-color`, `--grid-cell-border`.
- `body` background + color now use `var(--body-bg)` and `var(--body-color)` (no hardcoded `#101318`).
- `.grid-cell` border now uses `var(--grid-cell-border)`.

| # | Task | Status |
|---|------|--------|
| TH1 | **CSS variable theme tokens** | ✅ Done — moduli-dark, moduli-light, midnight theme sets in index.css |
| TH2 | **useTheme hook** | ✅ Done — `client/src/helpers/useTheme.js`. Persists to `localStorage("moduli-theme")`. |
| TH3 | **App.jsx integration** | ✅ Done — `useTheme()` called in App root, applies theme on mount |
| TH4 | **Theme picker in User Settings** | ✅ Done — `ThemePicker` component in UserSettingsTab with color swatches + active state |
| TH5 | **User-defined custom themes** | (Future) — allow user to add custom CSS variable sets |

---

## Phase 5 — Operations & Automation

| # | Task | Status |
|---|------|--------|
| O1 | **onSchedule trigger UI** | ✅ Done |
| O2 | **UPDATE_STYLE end-to-end** | ✅ Done — fixed deep-merge bug in bindSocketToStore.js applyOperationEffect. |
| O3 | **Duplicate operation detection** | ✅ Done — `duplicateOpIds` useMemo in OperationsTab. ⚠ badge on OpItem pill + orange warning banner in OperationEditor. |
| O4 | **Operation preview / dry-run** | ✅ Done — Preview panel in OperationsTab shows op without running. All ops are transaction-backed and reversible anyway. |
| O5 | **OperationsBuilder DnD fully wired** | ✅ Done — `DraggableStepWrapper` wraps every step with Pragmatic DnD draggable + drop target. Edge indicator (2px blue line). GripVertical handle. `arrayMove` reorder. Depth-scoped so nested steps don't mix. |
| O6 | **Move occurrences with operations** | ✅ Done — MOVE_OCCURRENCE config UI now has static/expr toggle for target container. `toContainerIdExpr` exposed alongside `toContainerId` dropdown. |
| O7 | **Undo/redo tightly integrated with transactions** | ✅ Done — `undo-flash` CSS keyframe (yellow→transparent, 900ms). `flashElement` applies class after FLIP + removes on animationend. Existing FLIP + triggerPostMoveFlash still fires. |

---

## Phase 6 — CSS & Notification Overhaul

> Full visual polish pass. Tailwind semantic token migration. Every hardcoded color → CSS variable. Light theme fully usable. Notification/transaction feedback elevated to first-class.

### 6.0 UI Restructuring ✅ COMPLETE
| # | Task | Status |
|---|------|--------|
| R1 | **Grid Settings → CC tab** | ✅ `commandCenter/GridSettingsTab.jsx` — self-contained, reads from context |
| R2 | **Appearance → CC tab** | ✅ `commandCenter/AppearanceTab.jsx` — theme picker moved here from UserSettingsTab |
| R3 | **Toolbar cog removed** | ✅ Replaced with inline `+ Panel` button. Hide toolbar as `EyeOff` button |
| R4 | **Semantic CSS tokens** | ✅ `--text-primary/muted/faint`, `--input-bg/border`, `--accent-blue-*`, etc. added to all 3 themes + registered in tailwind.config.js |

### 6.1 CSS Token Audit (Tailwind Migration)
| # | Task | Notes |
|---|------|-------|
| CS1 | **Hardcoded color purge** ✅ | **COMPLETE.** All `rgba(255,255,255,...)` eliminated from entire `client/src/` (was 140+ occurrences → 0). All commandCenter/ tabs, modules/, UI components, docs/pills, helpers all converted. CSS vars: `--text-primary/muted/faint`, `--input-bg/border`, `--border-default/subtle`, `--accent-blue-*`. |
| CS2 | **Light theme full pass** | Test every panel, container, instance, form, popover in `moduli-light`. Fix anything unreadable. |
| CS3 | **Midnight theme full pass** | Same for midnight theme. |
| CS4 | **Shadow system** | Box shadows adapt per theme — dark themes keep deep shadows, light uses softer elevation. |
| CS5 | **Spacing & sizing tokens** | `--spacing-xs/sm/md/lg`, `--radius-sm/md/lg` — stop hardcoding `6px`, `8px`, `10px`. |
| CS6 | **TH5 Custom user themes** | CSS variable editor in AppearanceTab — user tweaks accent + surface colors, saves as named theme. |

### 6.2 Transaction & Notification Overhaul
| # | Task | Notes |
|---|------|-------|
| CN1 | **Notification center** | Persistent notification log (not just ephemeral toasts). Bell icon in toolbar. Unread badge. |
| CN2 | **Operation result toasts** | When an operation fires, toast shows what changed: "Updated 3 occurrences · field:score → 42". |
| CN3 | **Transaction history UI polish** | Richer TransactionHistory.jsx — grouping by day, color-coded by type (MeasureOp/EntityOp/DocEditOp), "jump to" button that highlights the changed item. |
| CN4 | **Undo feedback** | Flash the affected elements on undo (already has FLIP position animation — add color flash). "Undid: [description]" toast. |
| CN5 | **Error boundary toasts** | ErrorBoundary.jsx catches component crashes → shows toast instead of blank panel. Logs to notification center. |

---

## Phase 7 — System Audit

> **Stop and verify.** Before building integrations, confirm every feature actually works end-to-end. One full pass through every component type.

### 7.1 Component Verification Checklist
| # | Component | Verify |
|---|-----------|--------|
| SA1 | **Panel** | Create, rename, resize, delete, split, merge, stack nav, copy, link |
| SA2 | **Container (list)** | Create, rename, sort, drag instances in/out, filter override, template save/fill |
| SA3 | **Container (doc)** | TipTap editing, field pills, instance pills, moduleEmbed, image upload, lock/unlock |
| SA4 | **Container (board)** | Kanban columns, drag between columns |
| SA5 | **Container (canvas)** | Free placement, double-click to add, drag cards |
| SA6 | **Container (pool)** | Filter conditions pull correct occurrences |
| SA7 | **Instance** | Field inputs (all 7 types), drag move/copy, collapse/expand, disable, field hide |
| SA8 | **Artifact panel** | File tree, click to view, markdown edit + save, image/PDF/audio/video render |
| SA9 | **Fields** | All 15 aggregations, scope/time filtering, progress bar, display vs input mode |
| SA10 | **Operations** | All trigger types, LOOP/IF/variable steps, UPDATE_STYLE, HIDE_OCCURRENCE, onSchedule |
| SA11 | **Filter system** | Named filters, date nav, filter override per panel/container |
| SA12 | **DnD** | All drop zones, copy vs move, drag from CC, drag to doc, external file drop |
| SA13 | **Themes** | All 3 themes render correctly, persists across reload |
| SA14 | **Command Center** | All 9 tabs functional, draggable rows, shortcuts work |
| SA15 | **Undo/redo** | Across field edits, moves, deletes — FLIP animation fires |

### 7.2 Testing Coverage
| # | Task | Status |
|---|------|--------|
| T1 | **bindSocketToStore.js tests** | ✅ Done — 24 tests |
| T2 | **socketHandlers/crud.js integration tests** | ⬜ Socket event → DB persist → correct response |
| T3 | **CommitHelpers tests** | ⬜ Post-Phase-2 consolidation verification |
| T4 | **E2E: DnD flows** | ⬜ Drag instance from CC → drops in container → appears in UI |
| T5 | **E2E: Operations pipeline** | ⬜ Field change → operation fires → computed value updates |
| T6 | **E2E: Filter system** | ⬜ Select named filter → occurrences filter correctly |
| T7 | **GET /health endpoint** | ✅ Done |
| T8 | **CI/CD: GitHub Actions** | ⬜ Run unit tests on push (low priority) |

---

## Phase 8 — API, Integrations & Sharing

| # | Task | Notes |
|---|------|-------|
| A1 | **Import/Export JSON** | Full grid → JSON. Import grid from JSON. |
| A2 | **Export Markdown** | Already partial (DocToolbar MD export). Extend to full page/section. |
| A3 | **Export PDF** | Day page or doc → printable PDF. |
| A4 | **Calendar sync** | iCal export of dates + due dates. |
| A5 | **Email trigger** | Operation action: SEND_EMAIL with field values. |
| A6 | **Bangle device** | Real-time wearable sync. See banglespecs.md. |
| A7 | **Spotify / Raindrop integration** | See site_review.md. |
| A8 | **AI Profile Builder** | Conversational grid setup — after stable data model. See aispecs.md (Frog Jeeves / Ollama). |
| A9 | **Watch local filesystem** | ConnectionsTab partial implementation. Watch directory → auto-create artifact occurrences for new/changed files. |

---

## Phase 9 — Performance

> Only address when data grows or lag is measurable.

| # | Task | Notes |
|---|------|-------|
| P1 | **Operation trigger index** | `fieldId → [operationIds]` map for O(1) lookup. Needed when operations > 50. |
| P2 | **computedValues selector memoization** | Components subscribe to `computedValues[fieldId:occId]` directly. |
| P3 | **Lazy-load Blocks editor** | `OperationsBuilder.jsx` is heavy — use `React.lazy`. |
| P4 | **Paginated/incremental full_state** | Send panel list first, load containers/instances on demand. |

---

## Phase 10 — Mobile & Cross-Platform

| # | Task | Notes |
|---|------|-------|
| M1 | **Touch gesture optimization** | DnD is touch-compatible but UX needs tuning. |
| M2 | **Responsive grid** | Grid adapts to narrow screens (1-col mobile layout). |
| M3 | **PWA install** | Service worker + manifest for home screen install. |
| M4 | **Offline support** | Queue mutations when offline, sync on reconnect. |

---

## Completed Work (Full History)

<details>
<summary>Phase 1 — Occurrences & Core DnD (100% ✅)</summary>

- Module/Occurrence/View three-concept architecture
- Pragmatic DnD: useDraggable/useDroppable, drop indicators, auto-scroll
- DragHotContext split (zero re-renders during hover)
- Session ref for sync drop handling
- Copy vs Move vs Copylink modes
- Multi-window sync (BroadcastChannel)
- Socket.IO real-time sync
- Panel stacking + stack nav
- Sorting within containers
- Live preview during drag
- Touch/mobile drag support
- Drilldown: container/instance drop to grid cell → creates new panel
- Artifact drop to grid cell → creates new artifact panel
</details>

<details>
<summary>Phase 2 — Fields & Calculations (100% ✅)</summary>

- Field types: number, text, boolean, select, date, rating, duration
- All 15 aggregations (sum, count, countTrue, avg, median, mode, min, max, first, last, random, range, variance, stddev, quartiles)
- Flow-based (in/out/replace) aggregation
- Scope + time filtering
- Target scaling across time periods
- FieldRenderer routing
- Select multi-select, quick-add, removeOnComplete
- Emotion wheel mood selector
- Date relative display ("in 3 days", "2 days overdue")
- DATE_DIFF, COUNT_DATE_OVERDUE, COUNT_DATE_UPCOMING action types
- DATE_BEFORE/IS/AFTER/WITHIN_DAYS comparators
- $now/$today/$currentDate/$currentHour/$currentTime built-ins
- Planning & Deadlines container (5 milestone instances with due dates)
</details>

<details>
<summary>Phase 3 — Transactions & Block System (100% ✅)</summary>

- Transaction model (MeasureOp, OccurrenceListOp, EntityOp, DocEditOp)
- Undo/redo (client + server)
- Block types, evaluator, visual editor (OperationsBuilder)
- Operations pipeline (LOOP/IF/variable steps)
- Sonner toast notifications
- FLIP animations hook
</details>

<details>
<summary>Phase 4 — Rich Editor, Artifacts, Filter System (100% ✅)</summary>

- TipTap editor with FieldPill, InstancePill, DocLink, ExprPill, ModuleEmbed extensions
- DocToolbar (formatting, Unlink, MD export)
- Artifact system (ManifestTree, Folder, Manifest, View)
- View types: markdown, artifact, code, grid, canvas
- Occurrence.textmap replaces docContent
- Textmap → uploads/md/{occurrenceId}.md sync
- POST /api/artifacts/upload
- ModuleEmbed TipTap extension (embedded containers, @: trigger)
- Expression pills with keyboard nav + multi-field formulas
- Day page auto-creation (NAVIGATE_DAY_PAGE operation action + navigate_day_page server handler)
- Notebook structure (Stan/Gospel/Phil/Notes with embedded containers, per-section colors)
</details>

<details>
<summary>Phase 5 — Styles, Module Unification, Polish (100% ✅)</summary>

- Cascading style overrides (StyleHelpers.js, resolveContainerStyle/resolveInstanceStyle)
- Behavior toggles: sortable/draggable/droppable (resolveBehavior)
- Module.jsx unified component (replaces Panel+Container+Instance)
- DragHotContext split
- Context menus (right-click on all entities)
- Panel copy/link/split/merge
- Command center 9 tabs (Fields, Operations, Components, EntityTree, Files, Lists, Shortcuts, Connections, UserSettings)
- Instance collapse/expand
- Stack hint banner
- Artifact drilldown drag to grid cell
- Canvas module (C1-C3)
</details>

<details>
<summary>Phase 0 — Filter System (Mar 2026, 100% ✅)</summary>

- Grid schema: namedFilters[], activeFilterId, activeFilterValues {}
- Occurrence schema: filterOverride + hidden (removed occurrence.iteration entirely)
- Server handlers: update_grid_filter, update_grid_named_filters, update_occurrence_filter_override, update_occurrence_hidden
- Client selectors: resolveEffectiveFilters + isOccurrenceVisible (same-day date comparison)
- FilterNav.jsx replacing IterationNav.jsx
- Container.jsx + Panel.jsx filter children via isOccurrenceVisible
- bindSocketToStore.js fires NavigationOp on activeFilterValues change
- createDefaultUserData.js: scheduledDate field, namedFilters (Daily/Weekly/All), no more iteration blocks
- HIDE_OCCURRENCE / SHOW_OCCURRENCE effect types added
- onIteration → onNavigation trigger rename everywhere
</details>

<details>
<summary>Phase 2 — Code Cleanup (Mar 2026, 100% ✅)</summary>

- CommitHelpers: role-specific CRUD removed, unified createModule/updateModule/deleteModule
- actions.js: CREATE_PANEL, UPDATE_PANEL, DELETE_PANEL, CREATE_CONTAINER, etc. removed
- masterReducer.js: all legacy case branches removed
- server.js: create_panel, delete_panel, create_container, delete_container, update_instance, delete_instance removed
- Module.js: doc, childIds, fieldIds dead fields removed; gridId index added
- Grid.js: toJSON transform added
- initialState.js: panels/containers/instances arrays removed
- Operations runtime moved: operationExecutor.js, operationActions.js, blockEvaluator.js, blockTypes.js → client/src/helpers/
- colorHelpers.js extracted (hexToRgba deduped from 3 locations)
- operationActions.js extracted from operationExecutor.js (circular dep solved via context._executors)
</details>

---

## Immediate Tasks

> **In order. Do not skip ahead.**

1. **✅ B3 committed** — Zone.Identifier files deleted from git (2026-03-16)
2. **Phase 5 — O2**: Verify `UPDATE_STYLE` end-to-end (resolves style via resolveExpr → UPDATE_MODULE effect)
3. **Phase 7 — T1**: Write `bindSocketToStore.js` tests — biggest untested gap (socket event → dispatch → state)
4. **Phase 7 — T7**: Add `GET /health` endpoint to server.js
5. **Phase 5 — O5**: Wire OperationsBuilder drag-and-drop for block reordering
