# Moduli -- Full System Audit
_Date: 2026-03-16 | Audited by: Claude Opus_

---

## 1. System Overview

Moduli is a modular, event-driven personal workspace built as a React + Node.js web application backed by MongoDB. It functions as a drag-and-drop command center where users can plan schedules, track habits, manage to-do lists, take notes, and visualize data -- all from a single configurable grid interface. Every task or item can carry measurable fields (numbers, durations, ratings, dates), and a programmable operations pipeline can compute aggregations, trigger automations, and display derived values in real time.

The core data model is a three-concept architecture: **Modules** (reusable templates defining what something is), **Occurrences** (placements defining where and when something appears), and **Views** (rendering configurations attached to occurrences). This separation enables the same module to appear in multiple places with different field values, filter contexts, and visual configurations. The client uses a Redux-style reducer with Socket.IO for real-time sync, Pragmatic Drag and Drop for all DnD interactions, and TipTap for rich text editing with embedded field/instance/expression pills.

The system is at a late prototype stage. Core architecture is solid and well-tested (323 client + 63 server unit tests passing). The codebase has gone through several major refactors (Module unification, iteration-to-filter migration, action type consolidation) and is cleaner than many projects at this stage. The primary technical debt is around file size in a few key components, some lingering legacy iteration code that survived the filter system migration, and a 3,829-line seed data file that could benefit from decomposition.

---

## 2. Architecture Assessment

### Module/Occurrence/View Model: Strong

The three-concept split is the right abstraction. Module = template, Occurrence = placement, View = rendering config. This is well-documented and consistently enforced across the codebase. Key strengths:

- `Occurrence.occurrences[]` is the sole source of child ordering (no parallel arrays on modules)
- `occurrence.viewId` points to a separate View model (not embedded)
- `occurrence.textmap` replaces the deleted `docContent` -- single source for TipTap JSON
- `occurrence.filterOverride` provides clean inheritance chain: Grid -> Panel -> Container -> Instance

**Inconsistency found**: Module.js still has `role` and `kind` fields marked as "deprecated" in comments, but `createDefaultUserData.js` actively sets `role: "panel"/"container"/"instance"` and `kind: "list"/"doc"/"board"/"pool"/"canvas"` on every module it creates. The client uses both `module.kind` (Container.jsx line 465 comment says "never from module.kind" but View.jsx line 42 calls it "legacy fallback") and `view.viewType` for rendering decisions. This dual-source for rendering type is a broken window -- either `module.kind` is the source or `view.viewType` is, but both paths exist.

### Operation Pipeline: Well-Designed

The LOOP/IF/variable step model is clean and expressive. `operationExecutor.js` (774 lines) and `operationActions.js` (738 lines) are large but well-organized. The `resolveExpr` function handles variables, built-in refs ($now, $today), field lookups, and `daysUntil:` prefixes. Trigger matching supports 11+ event types with optional config filters.

**Concern**: The `operationActions.js` was extracted from `operationExecutor.js` to solve a circular dependency (via `context._executors`). This works but is architecturally fragile -- a context-injected function table is essentially manual dependency injection without a framework.

### Transaction System: Functional But Underused

The Transaction model (Transaction.js, 237 lines) is well-designed with 4 operation types (MeasureOp, OccurrenceListOp, EntityOp, DocEditOp) and a clean undo/redo state machine. However, the transaction system appears lightly used in practice -- the `transactions.js` socket handler exists but the main data flow goes through direct CRUD handlers. Transactions are more of an audit log than a true event-sourced system.

### Filter System: Clean Replacement

The filter system (Phase 0) cleanly replaced the old iteration system. `grid.namedFilters[]` + `grid.activeFilterId` + `grid.activeFilterValues` is a good design. `resolveEffectiveFilters` and `isOccurrenceVisible` in selectors.js are concise and correct.

**Concern**: The old iteration system is not fully removed. `Module.js` still has `iteration: { mode, timeFilter }` fields. `IterationSettings.jsx`, `IterationNav.jsx`, and `LocalIterationNav.jsx` still exist and are imported by Container.jsx, Panel.jsx, LayoutForm.jsx, ContainerForm.jsx, and InstanceForm.jsx. These are zombie files from the pre-filter era.

---

## 3. Phase Completion Status

| Phase | Name | PHASE_PLAN.md Claim | Audit Estimate | Notes |
|-------|------|---------------------|----------------|-------|
| 0 | Filter System | 100% | **100%** | Clean implementation, fully replaces iteration. |
| 1 | Occurrences & Core DnD | 100% | **100%** | Solid. All drag types working. |
| 2 (old) | Fields & Calculations | 100% | **98%** | 15 aggregations, all field types. Missing: allowedFields UI (per CLAUDE.md). |
| 2 (new) | Code Cleanup | 100% | **95%** | CommitHelpers consolidated, action types cleaned. But `IterationSettings`/`IterationNav`/`LocalIterationNav` files survive. Module.kind/role still dual-sourced. |
| 3 (old) | Transactions & Block System | 100% | **95%** | Block system and operations pipeline complete. Server undo handlers partially implemented. |
| 3 (new) | Small Features & Polish | 100% | **100%** | All D1-D12, F1-F5, N1-N2, U1-U3, TB1-TB4, R1-R7, SL1-SL3, MP1 marked done. |
| 4 | Whiteboard & Canvas | C1-C3 done | **75%** | Canvas cards work. Canvas arrows (C4) not started. |
| 4.5 | Preview Mode | PV1-PV4 done | **90%** | PV5 (CC/tree preview) not started. |
| 4.6 | Theme System | 100% | **100%** | 3 themes, CSS variables, persisted. |
| 5 | Operations & Automation | O1-O7 done | **100%** | onSchedule, UPDATE_STYLE, duplicate detection, preview, DnD steps, move occ, undo integration. |
| 6 | CSS & Notification | Partial | **60%** | CS1 (color purge) done. R1-R4 (UI restructuring) done. CS2-CS6 (light/midnight passes, shadows, spacing, custom themes) not done. CN1-CN5 (notification overhaul) partially done (history panel + toasts done, but no notification center or error boundary toasts). |
| 7 | System Audit | Phase defined | **10%** | Verification checklist defined but not executed. T1 (bindSocketToStore tests) done. T2-T6 not started. |
| 8-10 | API/Mobile/Integrations | Not started | **0%** | Future phases. |

---

## 4. Code Organization & Structure

### File Sizes (Lines of Code)

**Large files (>500 lines) -- candidates for decomposition:**

| File | Lines | Assessment |
|------|-------|------------|
| `server/utils/createDefaultUserData.js` | 3,829 | Largest file in codebase. Seed data. Well-organized but monolithic. Already partially decomposed (imports from `operationBuilders.js`, `docBuilders.js`, `mdParsers.js`). |
| `client/src/helpers/DragProvider.jsx` | 1,837 | Very large. Handles ALL drop logic for every entity type. Would benefit from splitting per-entity-type handlers into separate files. |
| `client/src/modules/Container.jsx` | 1,350 | Large but justified -- handles list/doc/board/canvas/pool rendering modes. Each mode is a distinct branch. |
| `client/src/index.css` | 1,291 | Well-organized into 14 numbered sections. Reasonable for a CSS-variable-driven design system. |
| `client/src/helpers/LayoutHelpers.js` | 1,002 | Occurrence ordering, panel operations, container operations. Could split panel ops (copy/split/merge) into PanelHelpers.js. |
| `client/src/ui/Editor.jsx` | 1,008 | TipTap editor with many extensions. Dense but functional. |
| `client/src/ui/commandCenter/OperationsTab.jsx` | 916 | The operations editor + trigger config + node input calculator. Justifiably large. |
| `client/src/helpers/operationExecutor.js` | 774 | Pipeline executor. Well-structured switch statement. |
| `client/src/modules/Panel.jsx` | 737 | Panel shell with stacking, resize, view routing. |
| `client/src/helpers/operationActions.js` | 738 | Action implementations. Clean per-action functions. |
| `client/src/state/bindSocketToStore.js` | 707 | Socket event -> dispatch mappings. Large but unavoidable. |

### Folder Structure

The folder structure is good:
```
client/src/
  modules/          -- Panel, Container, Instance, View, Artifact, ManifestTree, PreviewCard
  ui/               -- Forms, menus, overlays, editor
    commandCenter/  -- 12 tab files, well-decomposed
  helpers/          -- DragProvider, CommitHelpers, LayoutHelpers, operations, calculations
  state/            -- reducer, actions, selectors, bindSocketToStore
  blocks/           -- Visual block editor (Block, Slot, Palette, Canvas)
  docs/             -- TipTap extensions + pills
  hooks/            -- useUndoRedo, useAnimations, useKeyboardShortcuts
  components/ui/    -- Shadcn primitives
  __tests__/        -- 7 test files

server/
  models/           -- 10 Mongoose models (clean)
  socketHandlers/   -- 7 handler files (well-decomposed)
  utils/            -- Seed data, helpers
  __tests__/        -- 6 test files
```

Total source files: ~137 client + ~25 server = ~162 files. Manageable.

### Naming Conventions

Generally consistent. Module IDs use `uid()` (nanoid-based), occurrence IDs use `occ_` prefix or `uid()`. Field IDs use `uid()`. Grid IDs are MongoDB ObjectIds.

**Issue**: `server/package.json` still has scripts for deleted files: `"migrate": "node scripts/migrateToOccurrences.js"`, `"clean-migrate": "node scripts/cleanAndMigrate.js"`, `"randomize": "node scripts/randomizeTestData.js"`. These scripts were deleted per MEMORY.md but the npm scripts were not cleaned up.

---

## 5. Dead Code & Cleanup Opportunities

### Files That Can Be Deleted

| File | Reason |
|------|--------|
| `client/src/ui/IterationNav.jsx` | Replaced by `FilterNav.jsx`. Not imported by App.jsx or Toolbar.jsx. Only referenced by CLAUDE.md docs. |
| `client/src/ui/IterationSettings.jsx` | Legacy iteration UI. Still imported by LayoutForm.jsx, ContainerForm.jsx, InstanceForm.jsx -- but the iteration settings it renders are dead since the filter system replaced iterations. |
| `client/src/ui/LocalIterationNav.jsx` | Still imported by Container.jsx and Panel.jsx. Renders local iteration arrows, but the iteration system is supposed to be deleted. Needs investigation: is it wired to the filter system or is it truly dead? |
| `client/src/ui/GridFieldsBank.jsx` | Imported by Grid.jsx. Verify whether it's still rendered or just imported but unused. |
| `client/src/ui/GridRadialMenu.jsx` | Imported by Grid.jsx. Same question. |

### Dead Fields on Models

| Model | Field | Reason |
|-------|-------|--------|
| `Module.js` | `iteration: { mode, timeFilter }` | Legacy iteration. Filter system replaced this. |
| `Module.js` | `role` (partially dead) | Comments say "deprecated" but `createDefaultUserData.js` actively sets it. The client has `computeRoleByModuleId` for hierarchy inference but falls back to `module.role`. Not dead yet, but should be either fully deprecated or fully used. |
| `Module.js` | `kind` (partially dead) | Same situation. View.viewType is supposed to be canonical, but `module.kind` is still set in seed data and checked in Container.jsx. |
| `Operation.js` | `triggerObjects`, `triggerTypes` | Parallel to `triggerType`. Three trigger fields for one concept. |
| `Operation.js` | `intervalMs` | Only used for hypothetical onInterval trigger. No code reads it. |
| `Grid.js` | `fieldIds[]` | Grid-level field registry. Never queried -- fields are fetched by userId, not by grid.fieldIds. |

### Dead Socket Event Patterns

The `create_field` handler in `crud.js` still references old Field schema fields: `mode`, `metric`, `conditions`, `triggers`, `display`. These were removed from Field.js months ago. The handler will silently ignore them but the code is misleading.

### Dead CSS

The `grid-cell` empty pocket in Grid.jsx (lines 61-83) still uses hardcoded `rgba()` colors instead of CSS variables, violating the CS1 color purge that was marked complete.

---

## 6. DRY / Pragmatic Violations

### 6.1 module.kind vs view.viewType (Broken Window)

Container rendering type is determined by checking `view.viewType` first, then falling back to `module.kind`. This means every container needs BOTH a module.kind and a view.viewType to be reliable. The seed data sets `module.kind` on every module but does not always create corresponding View records. This dual-source violates DRY and creates confusion about which is canonical.

**Fix**: Either remove `module.kind` entirely and require View records for all containers, or make `module.kind` the canonical source and stop using view.viewType for container routing.

### 6.2 socket.emit Calls Outside CommitHelpers

The PRAGMATIC.md rule is "CommitHelpers is the ONLY place that calls socket.emit." The audit found `socket.emit` in 7 files:

- `client/src/helpers/CommitHelpers.js` -- correct
- `client/src/state/bindSocketToStore.js` -- correct (operation effects need socket)
- `client/src/App.jsx` -- `socket.emit("request_full_state")` on connect. Acceptable bootstrap.
- `client/src/ui/TransactionHistory.jsx` -- `socket.emit("get_transactions")`. Violation.
- `client/src/socket.js` -- Socket setup, no business logic.
- `client/src/LoginScreen.jsx` -- Auth socket calls. Acceptable (not CRUD).
- `client/src/hooks/useUndoRedo.js` -- `socket.emit("undo"/"redo")`. Violation.

TransactionHistory.jsx and useUndoRedo.js should route through CommitHelpers.

### 6.3 buildLookup Called Repeatedly

`App.jsx` calls `buildLookup()` separately for modules, instances, occurrences, containers, fields, manifests, views, folders, and operations -- 9 separate `useMemo` calls. Many of these are derived from `state.modules` via `deriveRoleArrays`. The `createLookupsFromState` function in selectors.js already builds most of these maps in one pass. Consolidating to a single `useMemo` calling `createLookupsFromState` would reduce both code and re-computation.

### 6.4 masterReducer Still Has Legacy Comments

Lines 1-13 of masterReducer.js contain comments about "HYDRATE + PATCH_* + ADD_*" that were removed. The file header says "Removed legacy" but the actual code still has `state.panels`, `state.containers`, `state.instances` as first-class state arrays maintained in parallel with `state.modules` via `deriveRoleArrays()`. This is working but adds overhead -- every module mutation triggers 4 state updates (modules + panels + containers + instances).

### 6.5 selectors.js Legacy Role Arrays (Line 54-56)

```js
(state.panels || []).forEach(p => { if (p.id && !panelsById[p.id]) panelsById[p.id] = p; });
(state.containers || []).forEach(c => { if (c.id && !containersById[c.id]) containersById[c.id] = c; });
(state.instances || []).forEach(i => { if (i.id && !instancesById[i.id]) instancesById[i.id] = i; });
```

The comment says "Legacy role arrays (backward compat)" -- this is the exact type of fallback PRAGMATIC.md says to delete. Since `deriveRoleArrays` in the reducer already populates these arrays from modules, these lines are redundant.

---

## 7. Performance Review

### 7.1 State Shape: Array-Based Entity Storage

All entities are stored as arrays in state (`state.modules: []`, `state.occurrences: []`, etc.). Every lookup requires calling `buildLookup()` in a `useMemo`, and every create/update/delete triggers a full array scan (`.some()` + `.map()` or `.filter()`). For the current data size (~130 instances, ~80 containers, ~260 occurrences from seed data), this is fine. At 1000+ entities it will be slow.

**Recommendation**: When data grows, migrate to byId maps as the primary state shape (objects, not arrays). This is a Phase 9 concern, not urgent.

### 7.2 DragProvider Re-render Surface

DragProvider.jsx (1,837 lines) uses a split context pattern (`DragContext` for stable data, `DragHotContext` for hover data). This is good -- it prevents most re-renders during drag hover. The `lastHotRef` deduplication prevents redundant `setHotTarget` calls.

### 7.3 Container.jsx Rendering Branches

Container.jsx (1,350 lines) handles 5 container kinds in one component. Each branch has its own rendering logic, but they share the same React component lifecycle. This means a doc container re-renders when unrelated container state changes. Not a problem now but worth monitoring.

### 7.4 createDefaultUserData.js Performance

At 3,829 lines, `createDefaultUserData.js` creates hundreds of DB records. It already uses `bulkWrite` patterns (saves all modules, then all occurrences, etc.). The main performance risk is sequential `await` calls -- many could be parallelized with `Promise.all`.

---

## 8. Server Models Review

### Grid.js (57 lines) -- Clean
- `namedFilters`, `activeFilterId`, `activeFilterValues` -- well-designed filter system.
- `fieldIds[]` is likely dead -- fields are queried by userId/gridId, not by this array.
- `templates[]` stores saved workspace snapshots. Good.

### Module.js (124 lines) -- Has Dead Weight
- `role` and `kind` marked deprecated but actively used. Pick a direction.
- `iteration.mode` and `iteration.timeFilter` are legacy -- filter system replaced this.
- `customCss` (CS6a) is an interesting feature but potentially dangerous (CSS injection).
- Schema is otherwise clean and well-commented.

### Occurrence.js (97 lines) -- Clean
- No iteration fields (correctly removed during filter migration).
- `filterOverride`, `hidden`, `locked` are clean additions.
- Good compound indexes for common query patterns.
- `targetType` enum is `["module"]` only -- legacy types fully removed.

### Field.js (74 lines) -- Clean
- `inputEnabled`/`displayEnabled` split is correct (replaces old `mode` field).
- `displayConfig` is well-scoped.
- `folderId` for category grouping is a nice touch.

### Operation.js (51 lines) -- Has Redundancy
- Three trigger fields: `triggerType` (string), `triggerTypes` (array), `triggerObjects` (mixed). Pick one.
- `intervalMs` appears unused -- no code reads it.
- `blockTree` and `pipeline` coexist -- the executor checks blockTree first, pipeline second. Should pick one as canonical and migrate.

### View.js (78 lines) -- Clean
- 12 viewType options is a lot but well-documented.
- `artifactType` correctly scoped to viewType === "artifact".
- `scrollAnchor` field is present but usage unclear.

### Transaction.js (237 lines) -- Well-Designed
- Sub-schemas for each operation type is clean.
- Undo/redo state machine (applied/undone/redone) is correct.
- `sequence` field for ordering is good.

### Folder.js (64 lines) -- Clean
- `folderType` enum covers all use cases: normal, trash, templates, day-pages, category.
- No issues found.

---

## 9. Package Audit

### Root package.json
- `playwright` and `@playwright/test` both listed (one in dependencies, one in devDependencies). Should be devDependencies only.
- `socket.io-client` in root devDependencies is redundant with the one in client/package.json.
- `@tailwindcss/postcss` in root devDependencies is redundant with client's.

### Client package.json
- `web-vitals` -- likely unused. Was part of Create React App template but Vite does not use it.
- `@testing-library/dom` and `@testing-library/jest-dom` -- listed in dependencies (should be devDependencies).
- `@testing-library/react` and `@testing-library/user-event` -- correctly in devDependencies.
- `date-fns` -- imported somewhere but audit should verify usage. Heavy library.
- `class-variance-authority` + `clsx` + `tailwind-merge` -- Shadcn UI dependencies. Correct.
- **No unused major packages found** -- the dependency list is reasonable for the feature set.

### Server package.json
- `nanoid` version `^3.3.7` -- server uses ESM (`"type": "module"`) so nanoid v5+ would work. Not urgent.
- Dead npm scripts: `"migrate"`, `"clean-migrate"`, `"randomize"` reference deleted files.
- `bcryptjs` -- used for auth. Correct.
- **No unused packages found.**

### Version Concerns
- `mongoose: ^9.0.1` -- very recent. Watch for breaking changes.
- `react: ^19.2.3` -- React 19 is new. TipTap compatibility should be monitored.
- `vitest` versions differ: client uses `^4.0.18`, server uses `^2.1.9`. Should align.

---

## 10. Testing System Review

### Test Count & Results
- **Client**: 7 test files, 323 tests, all passing (verified 2026-03-16)
- **Server**: 6 test files, 63 tests, all passing (verified 2026-03-16)
- **Total**: 386 tests passing

### Test Quality Assessment

**Strong coverage:**
- `operationExecutor.test.js` (1,667 lines, 110 tests) -- thorough. Covers shouldTrigger, executePipeline, LOOP/IF steps, variable actions, date operations, all trigger types.
- `masterReducer.test.js` (708 lines) -- covers all action types including edge cases.
- `bindSocketToStore.test.js` (264 lines, 24 tests) -- covers socket event -> dispatch mapping.
- `LayoutHelpers.test.js` (333 lines) -- covers occurrence ordering and container operations.

**Adequate coverage:**
- `CalculationHelpers.test.js` (164 lines) -- covers all 15 aggregation types.
- `CommitHelpers.test.js` (227 lines) -- covers dispatch + emit patterns.
- `RadialMenu.test.js` (56 lines, 9 tests) -- covers direction calculation.

**Server tests:** Schema validation tests (Field, Module, Occurrence, Operation) + helper tests (gridHelpers, occurrenceHelpers). All pure functions, no integration tests.

### What's Missing

| Gap | Priority | Notes |
|-----|----------|-------|
| **selectors.js tests** | High | `createLookupsFromState`, `computeRoleByModuleId`, `isOccurrenceVisible`, `resolveEffectiveFilters` are all untested. These are critical for correct rendering. |
| **DragProvider tests** | Medium | 1,837 lines of complex drop logic with zero tests. Would catch regression in drop behavior. |
| **Server CRUD integration tests** | Medium | Socket handler -> DB persistence -> correct broadcast. Currently no tests for the actual socket handlers. |
| **E2E tests** | Low | 9 Playwright specs exist but require running dev server. Known timeout issue (BUGS.md B4). |
| **Container.jsx rendering tests** | Low | 5 rendering modes (list/doc/board/canvas/pool) untested. React Testing Library could verify each branch. |

### Known Broken Test
- DATE_DIFF date drift test (pre-existing, per MEMORY.md): uses hardcoded relative dates that drift over time. Should use a fixed test date.

---

## 11. createDefaultUserData.js Review

### Overview
At 3,829 lines, this is the largest single file. It creates a comprehensive demo workspace with:
- 6 panels (Daily Toolkit, Todo List, Schedule, Daily Goals, Accounts, Notebook)
- ~80 containers across all panels
- ~130 instances with field bindings
- ~60 fields (7 types: number, text, boolean, select, date, rating, duration)
- ~26 operations (loop-based aggregations, countdown timers, completion rates)
- Manifest + folder tree for artifact panel
- Notebook with embedded doc containers from parsed markdown files

### Architecture
Good decomposition into imported helpers:
- `operationBuilders.js` -- `makeLoopSumOp`, `makeLoopCountOp`, etc.
- `docBuilders.js` -- `inlineToTipTap`, `makeDocContent`, `buildMergedDocTextmap`
- `mdParsers.js` -- `parseSections`, `parseSectionsWithInstances`
- `createProfileData.js` -- Profile panel creation

### Issues Found

1. **Pre-generated IDs are error-prone**: The file pre-generates dozens of UIDs at the top (`const scheduledDateFieldId = uid()`, `const fitnessFolderId = uid()`, etc.) and references them throughout. This makes the file hard to follow -- you must scroll back to find where an ID was declared.

2. **No validation**: Fields, modules, and occurrences are created with hardcoded data. If a field name changes or a fieldId reference is wrong, the only feedback is a broken UI at runtime. No schema validation step after creation.

3. **Sequential saves**: Many `await` calls are sequential where they could be parallel. Not a correctness issue but makes `resetData` slower than necessary.

4. **Correctness**: The seed data creates `role: "panel"/"container"/"instance"` and `kind: "list"/"doc"/"board"` on modules, despite these being "deprecated" per the Module.js comments. This is fine for now since the client falls back to these values, but it means the "deprecated" fields are actually required for the app to work.

---

## 12. Known Bugs & Issues

### From BUGS.md (Active)
1. **React forwardRef child error** -- Lucide icons in RadialMenu. Intermittent, hard to reproduce.
2. **Playwright E2E timeout** -- Grid data doesn't load in 15s. Known limitation, not a code bug.

### Discovered in Audit

3. **Grid.jsx hardcoded colors** -- Lines 61-83 still use `rgba(69, 72, 74, 0.4)` and `rgba(0, 0, 0, 0.5)` in the empty cell pocket, despite CS1 color purge being marked complete.

4. **create_field handler uses dead schema fields** -- `crud.js` line 290-296 references `mode`, `metric`, `conditions`, `triggers`, `display` which were removed from Field.js. The data is silently dropped but the code is misleading.

5. **Operation trigger field confusion** -- `Operation.js` has `triggerType` (string), `triggerTypes` (array), and `triggerObjects` (mixed). `operationExecutor.js` checks both `triggerTypes` and `triggerType`. The `triggerObjects` field appears entirely unused.

6. **Iteration UI still exists** -- `IterationSettings.jsx` is imported by LayoutForm.jsx, ContainerForm.jsx, and InstanceForm.jsx. `LocalIterationNav.jsx` is imported by Container.jsx and Panel.jsx. If the filter system fully replaced iterations, these should be removed or converted.

7. **server/package.json dead scripts** -- `migrate`, `clean-migrate`, `randomize` reference deleted files.

8. **Vitest version mismatch** -- Client uses vitest `^4.0.18`, server uses `^2.1.9`. Could cause subtle test behavior differences.

---

## 13. Recommended Cleanup Sprint

In priority order -- do these before adding features:

### Tier 1: Fix Broken Windows (1-2 hours)

1. **Remove dead server npm scripts** from `server/package.json` (migrate, clean-migrate, randomize).

2. **Fix Grid.jsx hardcoded colors** (lines 61-83) -- replace with CSS variables.

3. **Clean up create_field handler** in `crud.js` -- remove references to dead Field schema fields (mode, metric, conditions, triggers, display).

4. **Move `web-vitals`** from client dependencies to devDependencies (or remove if unused).

5. **Move `@testing-library/dom`** and `@testing-library/jest-dom`** from dependencies to devDependencies.

6. **Align vitest versions** between client and server.

### Tier 2: Resolve Architectural Ambiguity (2-4 hours)

7. **Decide on module.kind vs view.viewType**: Either create View records for all containers in `createDefaultUserData.js` and stop reading `module.kind`, OR keep `module.kind` as canonical and mark view.viewType as "optional override." Document the decision.

8. **Decide on module.role**: Either remove the "deprecated" comment and keep it as a required field (since seed data and client fallback both use it), or stop setting it in seed data and remove all fallback reads from client code.

9. **Consolidate Operation trigger fields**: Pick `triggerTypes` (array) as the single source. Remove `triggerType` (string) and `triggerObjects` (mixed). Update `shouldTrigger` and `createDefaultUserData.js`.

10. **Remove Module.iteration**: The filter system replaced iterations. Remove `iteration: { mode, timeFilter }` from Module.js schema.

### Tier 3: Remove Dead UI Code (2-3 hours)

11. **Audit IterationSettings/LocalIterationNav usage**: If they render dead iteration UI, remove the imports and delete the files. If LocalIterationNav has been repurposed for the filter system, update its name and comments.

12. **Delete IterationNav.jsx** if truly unused (FilterNav.jsx replaced it).

13. **Remove legacy role array fallback** from selectors.js lines 54-56.

14. **Route TransactionHistory.jsx and useUndoRedo.js socket calls through CommitHelpers**.

### Tier 4: Improve Testability (4-6 hours)

15. **Add selectors.js tests** -- `createLookupsFromState`, `computeRoleByModuleId`, `isOccurrenceVisible`, `resolveEffectiveFilters`.

16. **Fix DATE_DIFF test** -- use a mocked date instead of relative dates.

17. **Add DragProvider unit tests** for key drop handlers (module CC -> container, artifact -> panel, field -> instance).

---

## 14. What Can Be Deleted Right Now

These deletions are safe and require no code changes elsewhere:

| Item | Path | Reason |
|------|------|--------|
| Dead npm scripts | `server/package.json` lines 12-14 | Reference deleted files |
| `Grid.fieldIds` | `server/models/Grid.js` line 37 | Never queried |
| `Operation.intervalMs` | `server/models/Operation.js` line 33 | Never read |
| `Operation.triggerObjects` | `server/models/Operation.js` line 22 | Never read |
| Legacy role array fallback | `client/src/state/selectors.js` lines 53-56 | Redundant with hierarchy inference |
| `IterationNav.jsx` | `client/src/ui/IterationNav.jsx` | Replaced by FilterNav.jsx, no direct imports |

These require verifying import usage first:

| Item | Path | Reason |
|------|------|--------|
| `IterationSettings.jsx` | `client/src/ui/IterationSettings.jsx` | Likely dead UI from iteration era |
| `GridFieldsBank.jsx` | `client/src/ui/GridFieldsBank.jsx` | Verify if still rendered |
| `GridRadialMenu.jsx` | `client/src/ui/GridRadialMenu.jsx` | Verify if still rendered |

---

## 15. Next Feature Priorities

After cleanup, in order of impact:

1. **Phase 7: Component Verification Checklist (SA1-SA15)** -- Manually verify every component type works end-to-end. This is the most impactful thing to do before adding features. The system has grown fast and needs a full walkthrough.

2. **Phase 6: Light Theme Full Pass (CS2)** -- The color purge is done but light theme has not been manually verified. Run through every panel type, form, popover, and command center tab in `moduli-light` theme.

3. **Phase 6: Notification Center (CN1-CN2)** -- History panel and toasts are done. A persistent notification log with bell icon would make operation feedback more discoverable.

4. **Canvas Arrows (Phase 4 C4)** -- Connecting instances with directed edges would make the canvas mode useful for mind mapping and flow diagrams.

5. **DragProvider Decomposition** -- Split the 1,837-line file into per-entity-type handlers. This is not a feature but makes every future DnD change safer.

---

## Appendix: File Size Summary

### Client Source (Top 20 by line count)

| File | Lines |
|------|-------|
| helpers/DragProvider.jsx | 1,837 |
| modules/Container.jsx | 1,350 |
| index.css | 1,291 |
| helpers/LayoutHelpers.js | 1,002 |
| ui/Editor.jsx | 1,008 |
| ui/commandCenter/OperationsTab.jsx | 916 |
| helpers/operationExecutor.js | 774 |
| helpers/operationActions.js | 738 |
| modules/Panel.jsx | 737 |
| state/bindSocketToStore.js | 707 |
| state/masterReducer.js | 405 |
| App.jsx | 571 |
| Grid.jsx | 574 |
| ui/commandCenter/FieldsTab.jsx | 504 |
| modules/Instance.jsx | 430 |
| ui/commandCenter/EntityTreeTab.jsx | 431 |
| modules/ManifestTree.jsx | 411 |
| ui/commandCenter/FiltersTab.jsx | 361 |

### Server Source

| File | Lines |
|------|-------|
| utils/createDefaultUserData.js | 3,829 |
| socketHandlers/crud.js | 556 |
| server.js | 437 |

### Test Files

| File | Lines |
|------|-------|
| client operationExecutor.test.js | 1,667 |
| client masterReducer.test.js | 708 |
| client LayoutHelpers.test.js | 333 |
| client bindSocketToStore.test.js | 264 |
| client CommitHelpers.test.js | 227 |
| server occurrenceHelpers.test.js | 170 |
| client CalculationHelpers.test.js | 164 |
| All tests total | ~3,971 |
