# Moduli — Developer Overview

A modular, event-driven workspace for habit tracking, scheduling, and data visualization. Calendar + to-do list + habit tracker + budget/workout/nutrition tracker, all in one drag-and-drop interface. Every task can be a simple checkbox or a measurement, and the app can aggregate across any time window and category automatically.

**Common use cases:** daily planning, habit tracking, finance logging, journaling, workout logging, notes/reference, reading/watchlists.

---

## Tech Stack

| Layer | Tools |
|-------|-------|
| Client | React + Vite, Socket.io-client, Pragmatic DnD (@atlaskit), TipTap editor, Tailwind v4, shadcn/ui, Sonner toasts |
| State | Redux-like (useReducer + Context), split into three contexts for performance |
| Server | Node.js + Express, Socket.io, MongoDB + Mongoose |
| Dev | `npm run dev` from root runs both. `cd server && node scripts/resetData.js` to reset sample data |

---

## Folder Map

```
client/src/
  App.jsx                  — Root: socket setup, context providers, state init
  Grid.jsx                 — CSS grid layout, renders panels into cells
  Toolbar.jsx              — Top bar: logo, filter nav, pomodoro, command center toggle

  state/                   — State management
    masterReducer.js       — Single reducer for all state
    useBoardState.js       — useReducer hook
    bindSocketToStore.js   — ONLY socket listener: socket events → dispatch
    selectors.js           — Occurrence resolution helpers
    actions.js             — Action type constants + creators

  modules/                 — Primary rendering: Panel → Container → Instance
    Module.jsx             — Thin router to Panel/Container/Instance
    Panel.jsx, Container.jsx, Instance.jsx, ModuleInstance.jsx
    View.jsx               — Layout routing (artifact sidebar, etc.)
    Artifact.jsx           — File renderer (md/image/pdf/audio/video)
    ManifestTree.jsx       — Sidebar folder tree for artifacts
    containerHelpers.jsx   — Sub-components (DocEditorShell, PoolPill, CanvasCard)

  helpers/                 — Business logic (the important stuff)
    CommitHelpers.js       — SOLE socket emitter: all mutations go here
    DragProvider.jsx       — Drag state + all drop handlers (~1700 lines)
    dragSystem.js          — Pragmatic DnD hooks (useDraggable/useDroppable)
    CalculationHelpers.js  — 15 aggregation types
    LayoutHelpers.js       — Occurrence tree navigation + mutation helpers
    operationExecutor.js   — Pipeline runtime (executePipeline)
    operationActions.js    — Action execution (resolveExpr, evalRule, executeActionItem)
    StyleHelpers.js        — Cascading style resolution
    IterationHelpers.js    — Time/filter helpers

  docs/                    — TipTap rich text editor
    Editor.jsx             — Main editor: @ mentions, block handles, pills
    DocEditor.jsx          — TipTap wrapper
    pills/                 — Pill node renderers (FieldPillNode, InstancePillNode, ExprPillNode)

  ui/                      — UI components
    CommandCenter.jsx      — 11-tab control panel (thin shell)
    commandCenter/         — One file per tab
    FieldRenderer.jsx      — Routes field type → correct input/display component
    Field.jsx              — Unified field display/input (all 8 types)
    ContextMenu.jsx, RadialMenu.jsx, FilterNav.jsx, TransactionHistory.jsx

  mobile/                  — Mobile viewport (Zelda-style cell navigation)

server/
  server.js                — Express + Socket.io bootstrap
  models/                  — Mongoose schemas (Module, Occurrence, Grid, Field, View, Operation, Transaction, Manifest, Folder)
  socketHandlers/          — Domain-separated event handlers (auth, state, crud, occurrences, transactions, templates)
  utils/
    createDefaultUserData.js — Sample data generator (~2000 lines, best reference for wiring)
```

---

## The Data Model

Two records for every piece of content: a **Module** (template) and an **Occurrence** (placement).

### Module — "what something is"

The blueprint. Stores `label`, `fieldBindings[]`, `operationBindings[]`, `fileRef` (for file-backed content), style config. Does NOT store position, order, or any per-session state. One module can have many occurrences in different places.

The `role` and `kind` fields on Module are soft-deprecated. The client infers role from hierarchy position and uses `view.viewType` for rendering behavior.

### Occurrence — "where it appears"

The placement. Points at a Module via `targetId`. Key fields:

- **`occurrences: [ids]`** — ordered list of child occurrence IDs. This is how ordering works. Not on the module.
- **`parentId`** — parent occurrence (or folder ID for artifacts)
- **`fields: { fieldId: { value, flow } }`** — field values for THIS specific placement
- **`textmap`** — TipTap JSON for doc/artifact content
- **`viewId`** — pointer to a View record (render config)
- **`placement: { col, row, colSpan, rowSpan }`** — grid positioning (panel occurrences only)
- **`filterOverride`** — `null` = inherit, `{}` = show all, `{ fieldId: val }` = pinned filter

### View — render configuration

Separate record. Only occurrences that need rendering config have one. Stores `viewType` (list/artifact/canvas/markdown), `hasTree`, `manifestId`, `activeOccurrenceId`, `layout`.

### Field — data schema

Shared templates that instances bind to via `module.fieldBindings`. 8 types: `number`, `text`, `boolean`, `select`, `date`, `rating`, `duration`, `module`. Each field has `inputEnabled` (user can edit) and `displayEnabled` (shows computed value from an operation). Both can be true simultaneously.

### Operation — automation pipeline

Stores `pipeline { sources, steps }` with imperative steps: INIT_VAR, LOOP, IF, ADD_TO_VAR, SHOW_VALUE, etc. All math is explicit. Triggered by field changes, drops, navigation, or load events.

### Grid — the workspace

Stores `namedFilters[]`, `activeFilterId`, `activeFilterValues{}`, `templates[]`, `fieldIds[]`.

### The hierarchy

```
Grid
 └── panel occurrence  (placement: col/row, viewId → View?)
      └── occurrences: [containerOccId, ...]
           └── container occurrence  (textmap for docs, viewId → View?)
                └── occurrences: [instanceOccId, ...]
                     └── instance occurrence  (fields: { fieldId: { value, flow } })
                          └── targetId → Module (fieldBindings, operationBindings)
```

---

## State Management

Central store via `useReducer` in `useBoardState.js`. State lives in `App.jsx` and flows through three contexts, split for performance:

| Context | Contents | Update frequency |
|---------|----------|-----------------|
| **GridActionsContext** | `dispatch`, `socket`, all entity maps (`modulesById`, `occurrencesById`, `fieldsById`, `viewsById`, etc.), mutation helpers | Stable (rarely changes) |
| **GridLiveContext** | `computedValues`, `canUndo/canRedo/undo/redo`, `isMobile/activeCell/zoomedOut` | Frequent (every operation run) |
| **GridDataContext** | Read-only state copy | Rarely used |

The split exists because `computedValues` updates on every operation run. If it lived in GridActionsContext, all 200+ consumers would re-render on every calculation. Only Instance.jsx, FieldRenderer, and doc pills subscribe to GridLiveContext.

**State shape:**

```javascript
{
  userId, grid,
  modulesById: {},      // id → Module
  occurrencesById: {},   // id → Occurrence
  fieldsById: {},        // id → Field
  viewsById: {},         // id → View
  operationsById: {},    // id → Operation
  manifestsById: {},     // id → Manifest
  foldersById: {},       // id → Folder
  computedValues: {},    // "occId:fieldId" → value
}
```

---

## Socket Architecture

Two hard rules:

1. **`CommitHelpers.js` is the ONLY file that calls `socket.emit`**. Components never touch the socket directly.
2. **`bindSocketToStore.js` is the ONLY file that listens to socket events** and dispatches to the store.

**Mutation flow:** Component calls CommitHelper function → dispatches locally (optimistic update) → emits to socket → server persists to MongoDB → server broadcasts to other windows → `bindSocketToStore.js` dispatches for remote clients.

**On connect:** Server sends `full_state` — a flat dump of all modules, occurrences, views, manifests, folders, fields, operations, and computedValues. Client stores these in the Redux maps. After that, incremental updates via individual events.

**Event naming convention:**
- Client to server: `create_X`, `update_X`, `delete_X`
- Server to client: `X_created`, `X_updated`, `X_deleted`
- Special events: `full_state`, `sync_state`, `undo_complete`, `redo_complete`

---

## Rendering Pipeline

`Grid.jsx` renders a CSS grid. Each cell holds a panel occurrence. Rendering cascades downward:

**Grid** → iterates panel occurrences → **Panel.jsx** → iterates `panelOcc.occurrences` → **Container.jsx** → iterates `containerOcc.occurrences` → **Instance.jsx** → renders field renderers from `module.fieldBindings` + `occurrence.fields`.

**ModuleInstance.jsx** wraps Instance with a drag handle (RadialMenu) and context menu.

**Container types** are determined by `view.viewType` on the container's viewId:

| viewType | Renders | Notes |
|----------|---------|-------|
| `list` | Sortable instance cards | Default |
| `doc` | TipTap rich text editor | DocEditorShell in containerHelpers.jsx |
| `canvas` | Freeform canvas | In progress |
| `board` | Kanban columns | Containers-as-columns |

**View.jsx** handles panel-level layout for artifact panels: sidebar (ManifestTree) + main content (Artifact.jsx). Regular panels skip View and render containers directly.

---

## Drag and Drop

Uses `@atlaskit/pragmatic-drag-and-drop` — not HTML5 native drag.

**DragProvider.jsx** wraps the entire app and manages drag state, preview state (`draftOccurrences`), active cell tracking, panel stack cycling, cross-window copy, and mobile edge-navigation.

**dragSystem.js** provides hooks: `useDraggable`, `useDroppable`, `useDragDrop`. Every draggable/droppable element registers through these.

**Drop zones and what they accept:**
- Grid cell → panels, containers (creates drilldown panel), instances (creates drilldown panel+container)
- Panel content → containers, instances, artifacts
- Container list → instances, fields (adds to fieldBindings)
- Doc editor → field/instance pills (inserts TipTap atom node at cursor)

**Drag modes** (per entity, set via `defaultDragMode`):
- `move` — removes from source, adds to target
- `copy` — duplicates to target, source unchanged
- `copylink` — duplicates with `linkedGroupId` (changes propagate to all linked copies)

**Session refs** — a critical pattern. Drop handlers need fresh state during async operations, but React state might be stale in event callbacks. `stateRef` in App.jsx and `dragConfigRef` in DragProvider hold the latest values via refs. You will see this pattern throughout the codebase.

---

## Fields and Values

Fields are shared templates. Instances bind to them via `module.fieldBindings` (an ordered list of `{ fieldId, order, hidden }`). When an instance renders, it reads `module.fieldBindings` to know which fields to show, then `occurrence.fields[fieldId]` for the value.

**Value shape:** `{ value, flow }` where `flow` is `"in"`, `"out"`, or `"replace"`. Flow direction matters for aggregation: `"out"` values are negated. This lets one `amount` field serve both income and expenses in the same operation.

**Field types:** `number` (increment/decrement buttons), `text`, `boolean` (checkbox or toggle), `select` (multi-select, pool-sourced options, removeOnComplete), `date` (with relative "in N days" badge), `rating` (1-5 stars), `duration` (hours+minutes), `module` (reference to another module).

**Rendering chain:** `FieldRenderer.jsx` reads `inputEnabled`/`displayEnabled` and routes to `Field.jsx`, which renders the correct input component. Display fields read from `computedValues` in GridLiveContext.

---

## Operations (Automation Pipelines)

Operations are imperative pipelines that run when events fire.

Each operation has:
- `triggerTypes` — array of event types: `MeasureOp`, `OccurrenceListOp`, `OccurrenceCreateOp`, `NavigationOp`, `onLoad`, `manual`, `ScheduleOp`
- `pipeline.sources` — variable bindings (e.g., `$allInstances = grid instances`)
- `pipeline.steps` — ordered imperative steps

**Execution flow:**
1. `bindSocketToStore.js` catches a transaction event
2. Calls `runMatchingOperations()` with matching trigger type
3. `executePipeline` in `operationExecutor.js` runs the steps, returns effects
4. Effects apply via CommitHelpers (`SET_FIELD_VALUE`) or update `computedValues` (`SHOW_VALUE`)

**Step types:** `INIT_VAR`, `ADD_TO_VAR`, `DIV_VAR`, `MULTIPLY_VAR`, `LOOP`, `IF`, `SHOW_VALUE`, `SET_FIELD_VALUE`, `FIND_MODULE`, `FIND_OCCURRENCE`, `CREATE_MODULE`, `MOVE_OCCURRENCE`, `RESET_RECURRING_TASK`, and more.

A typical pattern — sum a field across a container's instances:

```
INIT_VAR $total = 0
LOOP $item in $containerInstances
  ADD_TO_VAR $total += $item.fields.repsField
SHOW_VALUE $total → displayField on goalInstance
```

`SHOW_VALUE` writes to `computedValues` in state, which `FieldRenderer` reads when `field.displayEnabled` is true.

---

## Filter System

Replaced an older "Iterations" system. Lives on Grid as `namedFilters`.

A **namedFilter** defines: `{ id, name, timeFilter: "daily"|"weekly"|"monthly"|"all", categoryKey? }`.

`grid.activeFilterId` points to the selected filter. `grid.activeFilterValues` holds current values (e.g., `{ scheduledDate: "2026-03-26" }`).

**Visibility logic:** An occurrence is visible if its `fields[dateFieldId].value` matches the active filter value (same day for daily, same week for weekly, etc.). Occurrences with no date field are persistent and always visible.

**FilterNav.jsx** in the toolbar shows filter names and prev/next date buttons.

**Cascading overrides** via `occurrence.filterOverride`:
- `null` — inherit parent's active filter
- `{}` — show everything (ignore filters)
- `{ fieldId: val }` — pin to a specific value regardless of global filter

---

## Rich Text Editor (TipTap)

Lives in `docs/Editor.jsx`. Used in doc containers and artifact content.

**Pill extensions** — TipTap "atom nodes" (cursor treats them as one character):
- **FieldPill** — `@fieldName` displays a field value inline, updates live from `computedValues`
- **InstancePill** — embeds a full instance card inline with label + fields, draggable out
- **ExprPill** — `= expression` evaluates math against computedValues, yellow pill, double-click to edit
- **DocLink** — `[[text]]` links to another doc occurrence
- **ModuleEmbed** — `@:occurrenceId` embeds an entire container inline

All pill content is stored as TipTap JSON in `occurrence.textmap`. Server syncs textmap to `uploads/md/{occurrenceId}.md` on save.

**Block handles** — Notion-style left-side grip per paragraph for dragging blocks, changing type (Text/H1/H2/H3), and block options (duplicate/delete). Only visible when the editor is editable.

---

## Transactions and Undo/Redo

Every change produces a **Transaction** record: `{ type, state, data, timestamp }`.

| Type | What changed |
|------|-------------|
| `MeasureOp` | Field value changed |
| `OccurrenceListOp` | Occurrence moved between containers |
| `EntityOp` | Module created/updated/deleted |
| `DocEditOp` | Textmap changed |

Transaction `state` cycles: `"applied"` → `"undone"` → `"redone"`.

`useUndoRedo.js` tracks `canUndo/canRedo`. Undo emits to the server, which replays the inverse and broadcasts `undo_complete`. `useAnimations.js` captures element positions pre-undo and runs FLIP animations post-render.

---

## Mobile

**MobileGridNav.jsx** implements a Zelda-style viewport. The full grid renders, but a viewport window shows one cell at a time.

Navigation: lip buttons on edges, MiniGridMap in toolbar (toggle zoomed-out mode), drag-to-edge during drag (800ms dwell navigates to adjacent cell).

Mobile drag specifics: 80ms hold delay before drag registers, haptic feedback via `navigator.vibrate`, hit-test throttling at 32ms.

---

## How to Add Things

### New field type
1. Add to `Field.js` type enum (server)
2. Add rendering in `Field.jsx` (client)
3. Add routing in `FieldRenderer.jsx`
4. Add UI in `commandCenter/FieldsTab.jsx`

### New operation action type
1. Add handler in `operationActions.js` → `executeActionItem` switch
2. Add to action type dropdown in `commandCenter/OperationsTab.jsx`

### New socket event
1. Add handler in appropriate `server/socketHandlers/` file
2. Add listener in `client/src/state/bindSocketToStore.js`
3. Add CommitHelper function in `client/src/helpers/CommitHelpers.js`

### New container behavior
1. Add logic to `LayoutHelpers.js`
2. Handle the drop in `DragProvider.jsx`
3. Add UI in the relevant form component

### New Command Center tab
1. Add to `TABS` array in `CommandCenter.jsx`
2. Create `commandCenter/YourTab.jsx`

### New view type (module kind)
1. Add `viewType` to `View.js` enum (server)
2. Add rendering branch in `Container.jsx` or `Artifact.jsx`
3. Handle in `DragProvider.jsx` if drop behavior differs

---

## Architecture Rules

These are load-bearing constraints. Breaking them will cause bugs that are hard to trace.

1. **CommitHelpers.js is the ONLY file that calls `socket.emit`**
2. **bindSocketToStore.js is the ONLY file that listens to socket events**
3. **Components never touch the socket directly** — always through CommitHelpers
4. **Ordering lives in `occurrence.occurrences[]`** — never on module arrays
5. **`role`/`kind` on Module are soft-deprecated** — use hierarchy position + `view.viewType`
6. **DragProvider reads state via stateRef (session ref), not React state** — stale closures will bite you otherwise
7. **computedValues lives in GridLiveContext**, not GridActionsContext — this is a performance boundary
8. **No feature flags or backwards-compat shims** — just change the code directly

---

## Sample Data

`server/utils/createDefaultUserData.js` (~2000 lines) generates everything. It is the single best reference for understanding how modules, occurrences, fields, operations, and views wire together. Run `cd server && node scripts/resetData.js` to reset.

What it creates:
- 4-column grid with panels: Schedule, Toolkit, Goals, Notebook, Freepad
- ~131 instances, ~82 containers, ~26 operations
- Fields across all 8 types (reps, protein, money, steps, mood, muscle group, energy, workout time, etc.)
- Named filters: Daily (by scheduledDate), Weekly, All Time
- Notebook panel with TipTap docs parsed from markdown files

---

## Quick Commands

```bash
npm run dev              # Start client + server
cd server && node scripts/resetData.js   # Reset all data to defaults
```
