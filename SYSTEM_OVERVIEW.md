# Moduli — System Overview

**Last updated**: 2026-02-22
**Version**: Phases 1–6 in progress (Module Unification complete, Operations Pipeline active)

---

## What Moduli Is

A **drag-and-drop daily command center** built on an **occurrence-based, module-unified architecture**. Everything is a reusable template — tasks, lists, panels — and when you place something, you create an *occurrence* (a placement reference) rather than moving the original. This means the same task can live in multiple places, accumulating data independently per context.

Think: **calendar + to-do list + habit tracker + budget/nutrition/workout tracker + notebook + file manager + visual programming workspace**, all in one draggable workspace.

The app runs as a **React + Vite** client with a **Node/Express + MongoDB + Socket.io** server. All changes are real-time via websockets with optimistic local updates.

---

## The Core Idea

A normal planner: "I did laundry"

Moduli:
- "I ran **for 25 minutes**" → duration field, flow: in
- "I ate **42g protein**" → number field, flow: in
- "I saved **$20**" → number field, flow: in
- "I studied **2 pomodoros**" → number field, flow: in

Every task can be just a checkbox **or** a checkbox plus any number of typed measurements. Those measurements aggregate automatically across any time window (today, this week, this month) and any category filter (work, personal, health).

---

## The Module-Unified Architecture

### Key Design Decision: Modules

Panels, containers, and instances are **all stored in a single `Module` collection** in MongoDB. They are distinguished by `role` and further sub-typed by `kind`.

```
Module (role: "panel")
  └── occurrence → Module (role: "container")
                    └── occurrence → Module (role: "instance")
```

**Why**: Unified CRUD, uniform drag-and-drop, single schema update for style/iteration/layout properties, clean socket event: `update_module` handles all three.

### Module Fields

| Field | Purpose |
|-------|---------|
| `role` | `"panel"` \| `"container"` \| `"instance"` |
| `kind` | panel: `"board"` \| `"artifact-viewer"` \| `"canvas"` \| `"notebook"` / container: `"list"` \| `"doc"` \| `"log"` / instance: `"list"` \| `"doc"` |
| `label` | Display name |
| `userId`, `gridId` | Owner + workspace |
| `occurrences[]` | Child occurrence IDs (containers for panels; instances for containers) |
| `fieldBindings[]` | `{ fieldId, role: "input"\|"display", order, hidden }` — which fields this module uses |
| `defaultDragMode` | `"move"` \| `"copy"` \| `"copylink"` |
| `iteration` | `{ mode: "inherit"\|"own", timeFilter, categoryKey, categoryValue }` |
| `layout` | Display config: flex/grid, gap, scroll, padding, wrap |
| `styleMode` | `"inherit"` \| `"own"` |
| `ownStyle` | `{ bg, textColor, borderColor, opacity, borderRadius }` |
| `viewId` | → View model (panels with notebook/artifact-viewer render via a View) |
| `siblingLinks[]` | Related module IDs (Q&A pairs, split panels, copylinks) |
| `childIds[]` | Nested child module IDs (for recursive drill-down) |
| `placement` | `{ row, col, width, height }` — grid placement (stored on Occurrence for panels) |
| `meta` | Misc per-type config |

---

## The 14 Models

Moduli has 14 database models that compose into a flexible workspace system.

### Hierarchy Models (The Spine)

```
GRID (root workspace)
 │
 ├──→ MODULE/panel (via Occurrence)      — workspace sections
 │     │
 │     ├──→ MODULE/container (via Occ)   — lists/boards/docs
 │     │     │
 │     │     └──→ MODULE/instance (via Occ) — tasks/habits/data points
 │     │
 │     └──→ VIEW                          — display configuration for panel
 │
 ├──→ OCCURRENCE                          — the spine connecting everything
 │
 └──→ FIELD                               — grid-level measurement definitions
```

### Content Models (Files & Documents)

```
MANIFEST (root of a file tree)
 │
 └──→ FOLDER (recursive tree nodes)
       │
       ├──→ DOC (rich text documents with pills)
       │
       └──→ ARTIFACT (uploaded files: images, PDFs, etc.)
```

### System Models

```
TRANSACTION    — audit trail (WHO changed WHAT WHERE WHEN)
OPERATION      — visual block programs (Snap!-style) + pipeline editor
ITERATION      — time + category filter definitions
```

### Auth

```
USER           — email/password authentication
```

---

## Model Details

### Grid
The root workspace. A user can have multiple grids (e.g., "Work Planner", "Health Tracker").

| Key Fields | Purpose |
|------------|---------|
| rows, cols | Grid layout dimensions |
| occurrences[] | Panel occurrence IDs (what panels are placed in this grid) |
| iterations[] | Time filter definitions (daily, weekly, monthly) |
| categoryDimensions[] | Compound iteration categories (work, personal, health) |
| selectedIterationId | Currently active time filter |
| currentIterationValue | Current date/time being viewed |
| selectedCategoryId | Currently active category filter |
| currentCategoryValue | Current category value (or null = all) |
| fieldIds[] | Registry of all fields in this grid |
| templates[] | Saved container content snapshots |

### Module (Panel / Container / Instance)

The unified entity. Differentiated by `role`. See Module Fields table above.

**Panels** (`role: "panel"`):
- Workspace sections rendered in grid cells via CSS Grid
- Panel kinds: `board` (default container list), `artifact-viewer` (tree + content viewer), `canvas` (future)
- Can stack: multiple panels occupy the same grid cell, user cycles with nav arrows

**Containers** (`role: "container"`):
- List or board holding instances
- Container kinds: `list` (default), `doc` (rich text editor instead of instance list), `log` (append-only)
- Iteration mode: inherit (from panel) or own (independent time/category)

**Instances** (`role: "instance"`):
- Task, habit, or data point template
- Can appear in multiple containers simultaneously via occurrences
- fieldBindings determine which fields are shown and in what order
- `hidden: true` bindings (like category) inject without rendering in UI

### Occurrence (The Spine)
The most important model. Nothing is placed directly — all relationships are via occurrences.

| Key Fields | Purpose |
|------------|---------|
| targetType | `"module"` (current) — also accepts legacy `"panel"`, `"container"`, `"instance"`, `"doc"` |
| targetId | ID of the entity this occurrence wraps |
| parentId, parentType | Parent module's occurrence (for traversal) |
| placement | `{ row, col, width, height }` — for panels in grid cells |
| fields | `{ fieldId: { value, flow, timestamp } }` — field value snapshot per placement |
| docContent | ProseMirror JSON — per-occurrence doc content (different day pages) |
| iteration.timeValue | What date this occurrence belongs to |
| iteration.timeFilter | daily, weekly, monthly, yearly, all |
| iteration.mode | persistent (always), specific (date-locked), untilDone |
| linkedGroupId | Copylink mode — field edits propagate to all siblings |

**Why this matters**: The same instance "Exercise" can have:
- An occurrence in the Morning slot with duration=30min, flow: in
- An occurrence in the Evening slot with duration=45min, flow: in
- An occurrence in the Goals panel showing its aggregate via display field
- Each occurrence has its own field values, iteration context, and doc content

### Field
Grid-level measurement definitions. Two modes:

**Input fields** (`inputEnabled: true`) — user enters values:
- Types: number, text, boolean, select, date, rating, duration
- `meta.flow`: in (positive), out (negative), replace (overwrite)
- Select fields: multi-select, quickAdd, removeOnComplete, randomize, emotion wheel

**Display fields** (`displayEnabled: true`) — auto-calculated by Operations:
- Written by the operationExecutor when triggered
- `displayConfig`: `{ showArrows, arrowColor, targetValue, targetPeriod }`
- Progress bars when targetValue is set
- Stored in `state.computedValues` on client (not in occurrence.fields)

**Note**: Field no longer has `mode: "derived"` — all computation goes through Operations. A field can have both `inputEnabled: true` AND `displayEnabled: true` simultaneously.

### Operation
Visual block programs + pipeline definitions for calculations.

| Key Fields | Purpose |
|------------|---------|
| blockTree | Recursive block structure (FIELD, LITERAL, AGGREGATION, ACTION, CONDITION, etc.) |
| pipeline | `{ trigger, sources[], conditions[], actions[] }` — 4-stage pipeline definition |
| targetFieldId | Which display field this operation writes to |
| triggerType | `"manual"` \| `"onDrop"` \| `"onFieldChange"` \| `"onIteration"` \| `"onLoad"` |
| enabled | Whether this operation fires |

**Block system (Snap!-style)**:
- REPORTER blocks (oval): produce values — FIELD, LITERAL, AGGREGATION, VARIABLE
- ACTION blocks (rect): trigger side effects — SEND_TO_DISPLAY, NOTIFY, SET_VALUE
- HAT blocks: triggers — ON_LOAD, ON_ITERATION, ON_MANUAL
- Evaluator: `blockEvaluator.js` recursively evaluates; `operationExecutor.js` fires matching ops

**Pipeline system** (4-stage):
1. **Sources** — select entity (grid/container/instance), assign `$variableName`
2. **Conditions** — AND/OR rules: `$var.fieldId` compared to literal or another `$var.fieldId`
3. **Actions** — SHOW_VALUE, SET_VALUE, NOTIFY, MOVE, RUN_OPERATION, HTTP_REQUEST
4. **Trigger** — manual, onFieldChange, onDrop, onIteration

### View
Display configuration for panels with special rendering needs.

| viewType | Renders As |
|----------|-----------|
| notebook | Tree sidebar + doc editor (for Day Page / Profile panels) |
| artifact-viewer | Content viewer (no tree) |
| doc-viewer | Single document editor |
| file-manager | Tree + folder grid with uploads |
| canvas | (Future — whiteboard) |

### Field (Schema)
_See above. Old `mode/metric/conditions/triggers/display` removed. Current schema: `inputEnabled`, `displayEnabled`, `displayConfig`._

### Manifest
Root of a file tree. Each grid has one manifest.

| Key Fields | Purpose |
|------------|---------|
| manifestType | files, day-pages |
| rootFolderId → Folder | Top of the tree |

### Doc
Rich text document with embedded pills. Content stored as ProseMirror JSON.

| Key Fields | Purpose |
|------------|---------|
| content | ProseMirror JSON |
| docType | normal, day-page, journal |
| dayPageDate | For auto-created daily pages |
| folderId → Folder | Location in tree |

**Doc content is stored on the occurrence** (not the Doc model itself, for per-day content). The Doc model stores a master copy; occurrences store date-specific versions.

### Artifact
Uploaded file (image, PDF, video, etc.).

| Key Fields | Purpose |
|------------|---------|
| mimeType, extension, size | File metadata |
| storageType | local, s3, url |
| folderId → Folder | Location in tree |

### Transaction
Audit trail capturing every change.

| Key Fields | Purpose |
|------------|---------|
| operations[] | Batched: MeasureOp, OccurrenceListOp, EntityOp, DocEditOp |
| state | applied, undone, redone |
| sequence | Position in undo chain |

**Op types**:
- **MeasureOp**: WHO (instance) changed WHAT (field) WHERE (container) with previousValue
- **OccurrenceListOp**: MOVED from A to B with field snapshot
- **EntityOp**: Created/Updated/Deleted entity with previousData
- **DocEditOp**: ProseMirror steps with previous content

### Iteration
Standalone iteration definition (time + category filters).

| Key Fields | Purpose |
|------------|---------|
| timeFilter | daily, weekly, monthly, yearly, all |
| categoryKey | "context", "project", etc. |
| categoryOptions[] | Available values for this category |
| mode | persistent, specific, untilDone |

---

## How Drag & Drop Works

### The Three Modes

Every module has a `defaultDragMode`:

| Mode | What Happens | Use Case |
|------|-------------|----------|
| **Move** | Occurrence transfers from source to destination | Reorganizing your day |
| **Copy** | New occurrence of same entity created (date-specific) | Dragging template task into schedule |
| **Copylink** | New linked occurrence (field edits propagate to all copies) | Task that should sync values everywhere |

### What Can Go Where

| Source | Target | Move | Copy | Copylink |
|--------|--------|------|------|----------|
| **Module/panel** | Grid Cell | Repositions in grid | Cross-window: deep-copies entire panel tree | — |
| **Module/container** | Panel | Reorders/moves between panels | Clones container + instances | — |
| **Module/instance** | Container | Reorders/moves between containers | New occurrence (date-specific) | Linked occurrence (shared field updates) |
| **Module/instance** | Doc Editor | — | Inserts instance pill at cursor | — |
| **Field** | Doc Editor | — | Inserts field pill at cursor | — |
| **External File/URL** | Container | Creates new instance + artifact | — | — |
| **External File/URL** | Doc Editor | — | Creates artifact pill | — |

### Live Preview
- Instance drags show reorder position in real-time (edge detection above/below midpoint)
- Auto-scroll when dragging near panel edges
- Session ref pattern: immediate state access during async operations (no stale closure)

### Copylink Propagation
When fields update on an occurrence with `linkedGroupId`:
1. Server finds all occurrences with same linkedGroupId
2. Applies same field changes to every sibling
3. Broadcasts to all windows

### Panel Stacking
Multiple panels can occupy the same grid cell. Stack navigation arrows cycle between them.

---

## Iteration System

### Time-Based
Grid defines iteration types (Daily, Weekly, Monthly). Toolbar shows date navigation. All occurrences filtered by `iteration.timeValue` matching current date.

### Category-Based (Compound)
Grid defines category dimensions (e.g., "Context": work, personal, health, finance). Toolbar shows category selector. Occurrences can be filtered by BOTH time AND category simultaneously.

### Persistence Modes

| Mode | Behavior |
|------|----------|
| **persistent** | Always visible (templates, containers, structural items) |
| **specific** | Only visible on the specific date it was created (schedule items, day pages) |
| **untilDone** | Visible until completed, locked to completion date (todo items) |

### Inheritance
```
Grid: Daily + All Categories
  └─ Panel (inherit): Daily + All Categories
      └─ Container (own: Work only): Daily + Work
          └─ Instance (inherit): Daily + Work
  └─ Panel (own: Weekly): Weekly + All Categories
```

---

## Calculation System

### How It Works
1. Define input fields on a grid (number, boolean, duration, etc.)
2. Bind fields to instances via `fieldBindings`
3. Users fill in values on occurrences → stored in `occurrence.fields[fieldId]`
4. Operations fire (onLoad/onIteration/onFieldChange) → `operationExecutor.js` evaluates block trees or pipelines → writes to `state.computedValues`
5. Display fields read from `computedValues` and render progress bars, arrows, etc.

### Flow-Based Aggregation
Values carry a flow direction:
- `in`: positive contribution (time spent, income, calories)
- `out`: negative contribution (expenses, time wasted)
- `replace`: overwrites previous value

Aggregations can filter by flow: `sum(steps, flowFilter: "in", timeFilter: "daily")`

### 15 Aggregation Types
`sum`, `count`, `countTrue`, `avg`, `median`, `mode`, `min`, `max`, `first`, `last`, `range`, `stdDev`, `product`, `concat`, `unique`

---

## Operations System

### Command Center
Command Center (`/` key or toolbar button) has tabs:
- **Fields** — create/edit grid fields
- **Operations** — create/edit operations (block tree or pipeline)
- **Lists** — manage templates
- **Shortcuts** — keyboard shortcut reference
- **Connections** — external integrations (Phase 9)
- **Settings** — user preferences

### Operations Builder
Two editing modes:
- **Block Canvas** — Snap!-style visual block editor for display aggregations
- **Pipeline Editor** — 4-stage form UI (Sources → Conditions → Actions)

Operations fire via `operationExecutor.js` → writes `SET_COMPUTED_VALUES` to Redux store → `FieldRenderer` reads from `computedValues` context.

---

## Rich Text Editor

### Tiptap/ProseMirror
Custom extensions:
- **FieldPill**: Inline display of computed field value (reads from `computedValues`)
- **InstancePill**: Inline reference to an instance (block or inline display)
- **DocLink**: `[[bracket]]` links between documents

### @ Mention System
Type `@` → search fields and instances → inserts pill

### Doc Storage
Doc content stored on **occurrence** (not container). Same "Daily Journal" container shows different content per day.

### Toolbar
Bold, italic, strikethrough, code, H1/H2/H3, bullet/numbered, blockquote, HR, undo/redo, @ insert. Sticky header, solid background.

---

## File System

### Structure
```
Grid
└── Manifest ("Files")
    └── Root Folder
        ├── Day Pages/ (folderType: day-pages)
        │   └── 2026-02-22 (docType: day-page)
        ├── Documents/
        │   ├── Welcome to Moduli
        │   └── Stan — Eminem (instance-pill doc example)
        ├── Profile/
        │   └── 8 interest category docs
        └── Quick Notes/
            └── 6 raw note files
```

### File Upload
- `POST /api/upload` (multer) — supports images, PDFs, audio, video, archives
- Drag files from OS desktop into file manager panel
- Connections API: `/api/connections/:id/files` for linked local folders

---

## Transaction System

### Audit Trail
Every change creates a Transaction (batched ops):
- `MeasureOp` → field value change + previousValue
- `OccurrenceListOp` → occurrence moved/added/removed
- `EntityOp` → entity created/updated/deleted
- `DocEditOp` → ProseMirror steps

### Undo/Redo
- Ctrl+Z / Ctrl+Y
- Toolbar buttons + TransactionHistory modal
- Server reversal: restores previousValue, moves occurrences back, un-deletes entities

---

## Template System

### Container Templates (Grid.templates[])
```js
template = {
  id, name,
  items: [{ instanceId, fieldDefaults: { fieldId: value } }]
}
```
"Fill from Template" creates new occurrences with field defaults in target container.

### Morning Routine Example
6 instances (Morning Workout, Stretching, Drink Water, Take Vitamins, Meditation, Mood Check-in) bundled as a template.

---

## Real-Time Sync

### Socket.io Architecture
- **Optimistic updates**: Client dispatches locally, emits to server
- **No-echo**: Server broadcasts to all OTHER clients (sender already updated)
- **BroadcastChannel**: Same-origin tab sync (non-socket actions broadcast via BroadcastChannel API)
- **Exception**: Copylink propagation broadcasts to ALL windows

### Socket Events
All entities follow the pattern: `create_X` / `update_X` / `delete_X` → `X_created` / `X_updated` / `X_deleted`

Modules use the unified event: `create_module` / `update_module` / `delete_module`

Legacy events (`update_panel`, `update_container`, `update_instance`) are still handled server-side for backwards-compat, but all new client code emits `update_module`.

---

## State Architecture

```
state.modules[]              ← CANONICAL (write here)
state.panels[]               ← derived via deriveRoleArrays() — READ ONLY
state.containers[]           ← derived — READ ONLY
state.instances[]            ← derived — READ ONLY
state.occurrences[]          ← occurrence array
state.fields[]               ← field definitions
state.operations[]           ← operations
state.computedValues         ← { [fieldId]: value } — written by operationExecutor
```

**Rule**: Never write directly to `state.panels/containers/instances`. Always write to `state.modules` and call `deriveRoleArrays()`.

**Context**:
- `GridActionsContext`: dispatch, socket, panelsById, containersById, instancesById, occurrencesById, fieldsById, modulesById, operationsById, computedValues
- `GridDataContext`: read-only state for components that don't dispatch

---

## Sample Data Layout (Reset Data)

A fresh reset creates a **4-column × 2-row** grid:

```
┌─────────────────┬──────────────────────┬──────────────┬────────────────┐
│ Daily Toolkit    │ Schedule (48 slots)  │ Daily Goals  │ Profile        │
│ (copy mode)      │  /  Day Page (stack) │ (8 dims)     │ (notebook)     │
│ 8 wellness dims  │    (spans 2 rows)    │ display flds │ 8 interest docs│
│ 35+ instances    │ 7 habits pre-wired   │ progress bars│ quick notes    │
├─────────────────┤                      ├──────────────┤                │
│ Todo List        │                      │ Accounts     │                │
│ (move mode)      │                      │ (lifetime)   │                │
│ 4 categories     │                      │ 8 aggregates │                │
└─────────────────┴──────────────────────┴──────────────┴────────────────┘
```

**Totals**: 7 panels, 80+ containers, 65+ instances, 40+ fields (input + display), 200+ occurrences, 2 views, 1 manifest, 5+ folders, 13+ docs (Welcome + DayPage + Stan + 8 Profile + 6 QuickNotes), 5 iterations, 2 operations (Count Completed + Budget Alert pipeline), 1 template.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Client | React 18 + Vite |
| Styling | Tailwind CSS v4 + shadcn/ui components |
| Drag & Drop | @atlaskit/pragmatic-drag-and-drop |
| Rich Text | Tiptap (ProseMirror) |
| State | useReducer + Context (no Redux) |
| Real-time | Socket.io |
| Testing | Vitest (172 tests across 4 test files) |
| Server | Node.js + Express |
| Database | MongoDB + Mongoose |
| Auth | JWT + bcrypt |
| File Upload | multer |

---

## Running the App

```bash
# Development (runs client + server)
npm run dev

# Reset sample data (WSL)
wsl -d Ubuntu-24.04 -e bash -c "cd ~/dndtest2/server && node scripts/resetData.js"

# Run tests
npm run test

# Build for production
npm run build
```

---

## Phase Status (Feb 22, 2026)

| Phase | Focus | Status | % |
|-------|-------|--------|---|
| 1 | Occurrences & Core DnD | ✅ Complete | 100% |
| 2 | Fields & Calculations | ✅ Complete | 100% |
| 3 | Transactions & Block System | ✅ Complete | 100% |
| 4 | Docs, Artifacts & Rich Editor | ✅ Nearly Complete | 95% |
| 5 | Cascading Styles, Module Unification & Polish | 🟡 In Progress | 65% |
| 6 | Operations Editor, Command Center & Performance | 🟡 In Progress | 45% |
| 7 | Code Integrity & Architecture Overhaul | ⬜ Not Started | 0% |
| 8 | Automated Testing & Logging | 🟡 Foundation done | 10% |
| 9 | API, Connections & Sharing | ⬜ Not Started | 0% |
| 10+ | Canvas, Automation, Mobile, Data, AI | ⬜ Not Started | 0% |
