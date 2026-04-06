# Moduli — Architecture & Code Review
_Updated: April 2, 2026 — Ongoing audit + feature tracking_

---

## Recent Session Changes (Apr 1–2, 2026)

### Server / Data (createDefaultUserData.js)
- **0a — Data structure fix**: Parent doc modules (Stan, Gospel, Phil, flat notes, etc.) changed from `role: "container", kind: "artifact"` to `role: "page", kind: "doc"`. They now appear as page items in the manifest tree with sections nested as anchors. Removed per-section page wrapper loop.
- **0b — Day Page fix**: "Day Page" wrapper module+occurrence removed. Yesterday's day page changed to `role: "page", kind: "doc"` with readable date label (e.g., "Tue, Mar 31"). Pinned directly to centerHub. Older past day pages (2–3 days back) removed — only yesterday kept.
- **Folder page modules**: Created `role: "page", kind: "folder"` module + occurrence for each non-root folder (Day Pages, Documents, Notes, Trackers, Drawing) with `parentId = folderId`. Enables folder click → open page.

### Client / ManifestTree
- **0b — Click handler fix (ManifestTree.jsx)**: `handleSelect` simplified — uses `activePageView || view` as target, removes `isPagePanel` check. Added `emit: true` to `updateView` calls in both `handleSelect` and `handleScrollTo`. `PageTreeNode.containerOccs` now merges explicit `occurrences[]` with implicit `childrenByParentId` children (deduped) — fixes pages whose children use parentId linkage.
- **Root tree anchors**: FolderNode `showAnchors={false}` → `showAnchors={true}` — anchors now nest under parent docs.

### Client / NodePill + PreviewNode + Drilldown (New Features)
- **0c — NodePill.jsx**: Added `variant` prop: `"entity"` (default, DraggableEntityRow look) and `"compact"` (tight sidebar). Entity variant: `padding: "5px 8px"`, `borderRadius: 6`, `border: var(--border-default)`, `background: var(--input-bg)`. Depth indent: `depth * 12 + 8` for entity, `depth * 4 + 4` for compact.
- **Part 1 — PreviewNode.jsx** (NEW): Preview card for folder pages — shows text excerpt, child dots, or icon fallback. Double-click triggers drilldown. Draggable via Pragmatic DnD.
- **Part 2 — useDrilldown.js** (NEW hook): Windows 7 date-picker-style zoom animation. Navigation stack for nested drill-in/drill-out. `getCardAnimStyle()` helper for per-card transform/opacity.
- **Part 3 — ModulePage.jsx (FolderContent)**: New `FolderContent` component with `<PreviewNode>` CSS grid + `useDrilldown` hook. Back button when drilled in. Board page horizontal padding reduced from 28px to 6px on mobile.
- **Part 4 — CSS classes (index.css)**: `.preview-node-grid`, `.preview-node-card`, `.preview-node-preview`, `.preview-node-title` added.

### Client / Editor (Part 6)
- **Instance drop pill/embed choice (Editor.jsx)**: When an instance is dropped into a doc, a popup appears at drop coordinates with "Pill" (inserts `instancePill` inline) and "Embed" (inserts `moduleEmbed` block). `pendingDrop` state stores `{ occurrenceId, insertPos, dropX, dropY, label }`. Non-instance drops (containers, artifacts, modules) still go straight to `moduleEmbed`.

### Misc
- **ModulePanel.jsx**: Removed stray `console.log(activePageLabel)`.

---

## Known Active Bugs (as of Apr 2, 2026)

### Critical
- [x] **Doc editor cursor placement** (FIXED Apr 2): Removed `isEditing` state from `DocContent` which caused unnecessary re-renders on click. Wrapper now always shows `cursor: text` when not locked (was `default` arrow cursor, making it look non-interactive). Doc toolbar now shown via `showToolbar={!hideToolbar && !isLocked}`.
- [x] **Block handle menu clipped** (FIXED Apr 2): Block handle menu rendered via `createPortal` to `document.body` with `position: fixed` at button viewport coords. Previously the menu was clipped by `overflow: auto` on the page content container. Added `blockMenuPos` state, `cancelBlockHide()` on button mousedown, and `blockMenuPortalRef` for outside-click detection.

### Priority 2 — Polish
- [ ] Touch gesture optimization for mobile
- [ ] Performance optimization for 100+ items
- [ ] React child error: forwardRef icon components (intermittent)

---

## 6 Major Functionality Priorities

These are the core pillars of the system. Every session should assess and improve each.

### F1 — Drag and Drop + Modules
**Status: 98% complete.**
- Panel/container/instance DnD, copy vs move, sorting, external drops, mobile — all solid.
- Multi-window sync (broadcast when copy/move across tabs) — still unstarted.
- Example data: demo data has draggable toolkit instances, workout/nutrition items — works well.

### F2 — Views (Docs, Boards, Canvases, NodeViews, Module Versions)
**Status: 85% — bugs present.**
- **Docs**: TipTap editor with block handles, field pills, instance pills, module embeds. Two active bugs: cursor placement + block handle click (see above).
- **Boards**: Container-as-column layout — working.
- **Canvas**: Freepad drawing — working.
- **NodeViews (PreviewNode + Drilldown)**: Just implemented (Apr 1). PreviewNode grid for folder pages, zoom-in animation via `useDrilldown`. Needs testing.
- **Module Versions**: Not started.
- **TODO**: Fix cursor + handle bugs. Test drilldown. Consider per-view toolbar customization.

### F3 — Filters / Time-based + Day Pages
**Status: 92% — Template model implemented.**
- Named filters (daily/weekly/monthly) with `namedFilters` on Grid — working.
- FilterNav.jsx for navigation — working.
- **Day Pages (IMPLEMENTED Apr 2)**: Single template module model:
  - One `dayPageTemplateModuleId` module with a `dayDate` date field bound to it
  - Template occurrence (`meta.isTemplate: true`) holds TipTap textmap with `[Date]` / `[DayOfWeek]` tokens
  - Operation pipeline (fully atomized lego steps): `FIND_OCCURRENCE` (by dateFieldId+date) → `IF` missing: `COMPUTE_TEXTMAP_FROM_TEMPLATE` + `CREATE_OCCURRENCE_FOR_MODULE` → `UPDATE_VIEW`
  - Yesterday pre-seeded with full journal content for demo
- **New pipeline actions**: `COMPUTE_TEXTMAP_FROM_TEMPLATE`, `CREATE_OCCURRENCE_FOR_MODULE`, `FILL_FROM_TEMPLATE`, extended `FIND_OCCURRENCE` with dateFieldId support + template skipping
- **TODO**: Test full flow (navigate to tomorrow → auto-creates page). Add more template tokens (protein total, task count, etc.) via field pills once fields are configured.

### F4 — Operations + Fields + Transactions
**Status: 97% complete.**
- All 15 aggregation types, LOOP/IF/variable pipeline, computedValues, triggers — working.
- Undo/redo: client side complete, server-side handlers partial.
- Transactions: recorded on all changes (MeasureOp, OccurrenceListOp, EntityOp, DocEditOp).
- **TODO**: Complete server-side undo handler. Wire `undo_complete` to trigger operation recalculations. Add slide-back FLIP animation on undo.

### F5 — ManifestTree + Modules
**Status: 90% — recent major fixes.**
- Folder tree with nested anchors, page types, drag-to-sort — working.
- Folder pages (click folder → open page) — just added (Apr 1).
- DocNode / PageTreeNode / FolderNode / AnchorChip hierarchy — working after Apr 1 fixes.
- PreviewNode drilldown for folder content — just added (Apr 1).
- **TODO**: Test folder-page click flow end-to-end. Verify ManifestTree `childrenByParentId` merge is correct for all page types. Add keyboard navigation to tree.

### F6 — Lists + Templates
**Status: 90% complete.**
- Save/fill template from container — working.
- Drag template from Command Center → container — working.
- EntityTreeTab "Unsorted" section shows unplaced instances — working.
- **TODO**: Template browser UI (visual preview before filling). Day page template in F3. `allowedFields` UI on containers/instances (lets you restrict which fields show in a panel view).

---

## Original Audit Content (March 2026)

---

## Overall Assessment

The system is structurally sound. The three-concept model (Module + Occurrence + View) is clean and the right abstraction. The Pragmatic DnD integration is solid. Operations pipeline is well-designed. The **main problem is accumulated legacy code from the migration period** — old action types, redundant CommitHelper functions, dead fields on models, and stale comments — all of which violate the DRY and No-Legacy-Fallbacks rules from PRAGMATIC.md.

---

## 1. Critical Broken Windows (Fix First)

### 1.1 Dual Action Type System — DRY Violation
`actions.js` and `masterReducer.js` have TWO parallel sets of actions for the same entities:

**Legacy (pre-unification):**
- `CREATE_PANEL`, `UPDATE_PANEL`, `DELETE_PANEL`
- `CREATE_CONTAINER`, `UPDATE_CONTAINER`, `DELETE_CONTAINER`, `UPDATE_CONTAINER_OCCURRENCES`
- `CREATE_INSTANCE`, `UPDATE_INSTANCE`, `DELETE_INSTANCE`, `CREATE_INSTANCE_IN_CONTAINER`

**New (post-unification):**
- `CREATE_MODULE`, `UPDATE_MODULE`, `DELETE_MODULE`

Only ONE should exist. Everything is a Module. `UPDATE_PANEL` dispatches `UPDATE_MODULE` under the hood — the panel actions are pure wrappers with no value. **Delete all `_PANEL`, `_CONTAINER`, `_INSTANCE` action types and their creators.**

### 1.2 CommitHelpers Legacy Functions — ACTUAL BUG + DRY Violation
`CommitHelpers.js` exports both:
- `createPanel`, `updatePanel`, `deletePanel` → emit `create_panel`, `update_module`, `delete_panel`
- `createContainer`, `updateContainer`, `deleteContainer` → emit `create_container`, `update_module`, `delete_container`
- `createInstance`, `updateInstance`, `deleteInstance` → emit `update_instance`, `delete_instance`
- `createModule`, `updateModule`, `deleteModule` → emit `create_module`, `update_module`, `delete_module`

The role-specific functions are wrappers over the module functions. **Agent audit confirmed server does NOT handle `create_panel`, `delete_panel`, `create_container`, `delete_container`, `create_instance` — only `create_module`/`delete_module` are registered.** Calling `createPanel()` or `deleteContainer()` optimistically updates local state but the server ignores the emit, so the change never persists to DB. **These are live bugs if those functions are called anywhere.**

Check call sites: if nothing calls `createPanel()` directly anymore (LayoutHelpers uses `createModule`), the functions are just dead code. If something does call them, it's a data loss bug. **Consolidate to `createModule`/`updateModule`/`deleteModule` only.**

### 1.3 Occurrence.js Legacy Iteration Fields
```js
iteration: {
  key: { type: String, default: "time" },    // LEGACY — never used in queries
  value: { type: mongoose.Schema.Types.Mixed }, // LEGACY — superseded by timeValue
  range: { type: mongoose.Schema.Types.Mixed }, // LEGACY — unused
  // ↑ These 3 are dead weight. timeValue + timeFilter are the real fields.
}
```
The code comment says "Legacy single-key format (backwards compatible)" — this is a PRAGMATIC.md violation. Delete them.

### 1.4 Module.js Dead Fields
- `doc: { type, content }` — instance-level doc content embedded in Module. **Dead.** Replaced by `occurrence.textmap`. The comment says "For instance-level doc content embedded in the module itself" but this path is never used — textmap lives on the occurrence.
- `childIds: [String]` — ordered children in Module. **Dead.** Replaced by `occurrence.occurrences` for ordering. All code now reads `occ.occurrences`.
- `fieldIds: [String]` on Module — seems to duplicate the Grid-level `fieldIds`. Check if used anywhere — if not, delete.

### 1.5 `.Zone.Identifier` Files
Multiple files have Windows WSL zone identifier artifacts tracked in git:
```
20260209_083212.jpg:Zone.Identifier
client/dist/banner.jpg:Zone.Identifier
client/src/DragProvider.jsx:Zone.Identifier
... (20+ more)
```
These should be gitignored and deleted from git tracking.

---

## 2. Naming Convention Audit

### 2.1 Models (Server) — Good
| Model | Assessment |
|-------|-----------|
| `Module` | ✅ Clean — `role` + `kind` pattern is right |
| `Occurrence` | ✅ Clean — but has legacy fields (see 1.3) |
| `View` | ✅ Clean |
| `Field` | ✅ Clean |
| `Grid` | ✅ Clean |
| `Folder` | ✅ Clean |
| `Manifest` | ✅ Clean |
| `Operation` | ✅ Clean |
| `Transaction` | ✅ Clean |
| `Iteration` | ⚠️ Unclear — is this used? `iteration` is a sub-object on Module and Occurrence. Is there a standalone `Iteration` model/collection? If so, why? |

### 2.2 Socket Events — Inconsistent
Current socket events mix old and new naming:

| Event | Status |
|-------|--------|
| `create_module`, `update_module`, `delete_module` | ✅ Canonical |
| `create_panel`, `delete_panel` | ❌ Legacy — maps to same module operation |
| `create_container`, `delete_container` | ❌ Legacy |
| `update_instance` | ❌ Legacy — should be `update_module` |
| `delete_instance` | ❌ Legacy |
| `create_instance_in_container` | ❌ Legacy shortcut — create_occurrence covers this |
| `move_occurrence` | ❓ Unclear — does server handle this? CommitHelpers emits it |
| `create_occurrence_with_iteration` | ✅ Specific enough, keep |
| `navigate_day_page` | ✅ Named for intent, keep |

**Rule**: All module CRUD should go through `create_module`/`update_module`/`delete_module`. No exceptions.

### 2.3 Components (Client) — Good
| Area | Assessment |
|------|-----------|
| `modules/Panel.jsx`, `modules/Container.jsx`, `modules/Instance.jsx` | ✅ Clear role names |
| `modules/Module.jsx` | ⚠️ Confusing — this is the router/shell, not a "Module". Consider `ModuleShell.jsx` or keep as `Module.jsx` (acceptable if documented) |
| `modules/View.jsx` | ✅ Renders view-type panels (artifact/markdown/etc.) |
| `modules/Artifact.jsx` | ✅ Content renderer |
| `modules/ManifestTree.jsx` | ✅ |
| `ui/commandCenter/*.jsx` — `*Tab.jsx` naming | ✅ Consistent |
| `ui/GridFieldsBank.jsx` | ⚠️ "Bank" is vague — consider `GridFieldsPanel.jsx` or `FieldsRegistry.jsx` |
| `ui/GridRadialMenu.jsx` | ✅ |
| `ui/ButtonPopover.jsx` | ⚠️ Only used in one place? If so, inline it |
| `ui/MultiSelectPills.jsx` | ✅ |
| `ui/StyleEditor.jsx` | ✅ |
| `ui/FieldBindingEditor.jsx` | ✅ |

### 2.4 Helpers — Good
| File | Assessment |
|------|-----------|
| `CommitHelpers.js` | ✅ Good name — but has DRY issues (section 1.2) |
| `LayoutHelpers.js` | ✅ Good — manages occurrence layout, panel/container creation |
| `CalculationHelpers.js` | ✅ Good |
| `dragSystem.js` | ✅ Good |
| `DragProvider.jsx` | ✅ Good |
| `colorHelpers.js` | ✅ Good |
| `IterationHelpers.js` | ✅ Good |
| `StyleHelpers.js` | ✅ Good |

### 2.5 State — Mixed
| File | Assessment |
|------|-----------|
| `actions.js` | ❌ Has duplicate action types (see 1.1) |
| `masterReducer.js` | ⚠️ Handles both legacy + new action types — complex |
| `initialState.js` | ⚠️ Has `panels: []`, `containers: []`, `instances: []` — are these still needed or just `modules: []`? Comment says "backward compat" |
| `bindSocketToStore.js` | ✅ Good — maps socket events to dispatch |
| `selectors.js` | ✅ Good |
| `useBoardState.js` | ⚠️ Hooks in state/ folder — consider `hooks/` folder |
| `useBroadcastSync.js` | ⚠️ Same — should be in `hooks/` |

### 2.6 Blocks / Operations — Misplaced Files
`client/src/blocks/` mixes two distinct concerns:
1. **Visual block editor UI**: `Block.jsx`, `Slot.jsx`, `BlockPalette.jsx`, `OperationsBuilder.jsx`, `OperationsCanvas.jsx`, `useBlockDnD.jsx`
2. **Operation runtime engine**: `operationExecutor.js`, `operationActions.js`, `blockEvaluator.js`, `blockTypes.js`

The runtime files are imported by `bindSocketToStore.js` — they run on every field change, not just when the editor is open. They belong in `helpers/` or a dedicated `operations/` folder.

**Proposed reorganization**:
```
client/src/blocks/           → Visual block editor (UI only)
client/src/helpers/operationExecutor.js  → Runtime (already imported from state layer)
client/src/helpers/operationActions.js   → Runtime actions
client/src/helpers/blockEvaluator.js     → Block evaluation runtime
```

---

## 3. Architecture Observations

### 3.1 State Shape: `modules` vs `panels/containers/instances`
`initialState.js` has:
```js
modules: [],        // source of truth
panels: [],         // derived cache
containers: [],     // derived cache
instances: [],      // derived cache
```
The derived arrays say "backward compat" in the comment. If anything still reads `state.panels` directly (not via `state.modules`), that's the issue. Check `masterReducer.js` — does `deriveRoleArrays()` still get called? Are `panels/containers/instances` arrays still read anywhere?

If everything reads `modulesById` from `GridActionsContext`, the derived arrays can be eliminated. If some old components still use `state.panels`, those need updating.

### 3.2 `Iteration` Model — Possibly Unused
There's an `Iteration.js` model imported in `createDefaultUserData.js`. But iterations are sub-objects on `Occurrence` and `Module`, not separate records. Is the standalone `Iteration` model actually persisted to DB? If not — dead model.

### 3.3 `Grid.js` Missing `toJSON` Transform
Every other model has the standard `toJSON` transform to stringify `_id`. `Grid.js` doesn't. This means Grid documents returned from Mongoose will have ObjectId `_id` instead of a string. Probably not causing bugs since `id` (custom) is used, but it's inconsistent.

### 3.4 `scrollAnchor` on View
`View.js` has `scrollAnchor: { type: String }` — this appears to be for scrolling to a specific section in a markdown view. It's unclear if this is used or was planned. Either wire it up or remove it.

### 3.5 `Occurrence.targetType` Has `"doc"` Enum
```js
targetType: { enum: ["module", "doc"] }
```
But `Doc.js` was deleted. All docs are now Modules with `kind: "doc"` or artifact modules with textmap. So `targetType: "doc"` should never appear in new data. This enum value can be removed.

### 3.6 `createInstanceInContainer` vs `createOccurrence`
`CommitHelpers` has `createInstanceInContainer` that emits `create_instance_in_container`. But creating an instance in a container is just:
1. `createModule` (create the instance module)
2. `createOccurrence` (place it in the container)

The `create_instance_in_container` shortcut event does both server-side. This is acceptable as a performance optimization (single round-trip), but it should be clearly documented as such, and the function name should reflect what it actually does.

---

## 4. Performance Observations

### 4.1 DragProvider Re-renders — Solved
The `hotTarget` removal (Bug 17 this session) was the main hover re-render issue. Direct DOM mutation via `data-drop-active` is the right pattern. **Already fixed.**

### 4.2 Full State on Connect
On socket connect, server sends `full_state` with ALL modules, occurrences, views, fields, etc. for the grid. For the current data size (test data), this is fine. When data grows large, this will become a bottleneck. **Future concern, not urgent.**

### 4.3 `operationExecutor` Runs on Every Field Change
`bindSocketToStore.js` calls `runMatchingOperations` on every `transaction_created` event. The executor scans all operations to find matching triggers. With 26+ operations in sample data, this is O(n) per change. Fine for now. When operations grow to 100+, a trigger index (keyed by `fieldId → [operationIds]`) would help.

### 4.4 `computedValues` Re-renders
`computedValues` in context is updated via `SET_COMPUTED_VALUES` dispatch, which re-renders everything subscribed to context. Components that only need one computed value re-render when any computed value changes. Mitigated by `useMemo` in selectors, but worth tracking.

### 4.5 `createDefaultUserData.js` (3331 lines after split)
Still very large. The main function is ~3300 lines of sequential Mongoose creates. This is acceptable for seed data (runs once), not a runtime performance concern.

### 4.6 No DB Indexes on `Module.gridId`
`Module.js` indexes `id` and `userId` but NOT `gridId`. Queries like "get all modules for grid X" would do a full collection scan. Add `{ gridId: 1 }` index.

### 4.7 Occurrence Compound Indexes
`Occurrence.js` has good compound indexes. Module.js is missing them.

---

## 5. Test Coverage Assessment

| Layer | Tests | Status |
|-------|-------|--------|
| `CalculationHelpers` | 58 client unit tests | ✅ Good |
| `masterReducer` | 40 client unit tests | ✅ Good |
| `CommitHelpers` | 35 client unit tests | ✅ Good |
| `operationExecutor` | 85 client unit tests | ✅ Good |
| `LayoutHelpers` | ✅ | ✅ Good |
| `RadialMenu` | Some | ✅ |
| Server models (Field, Module, Occurrence, Operation) | 63 server tests | ✅ Good |
| Server `gridHelpers` | 8 tests | ✅ Good |
| E2E (`tests/e2e/`) | 9 spec files | 🟡 Playwright — require running server |
| **Not tested** | DragProvider, bindSocketToStore, socket handlers | ❌ Gap |

**Biggest gap**: `bindSocketToStore.js` has zero tests. It's the bridge between socket events and state — any bug there silently breaks the entire app. Also `server/socketHandlers/*.js` have no direct tests.

---

## 6. Dead Code & Bloat

| Item | Location | Action |
|------|----------|--------|
| `Zone.Identifier` files (20+) | Root, client/src, client/public | Delete from git, add to .gitignore |
| `CREATE_PANEL/CONTAINER/INSTANCE` action types | `actions.js` | Delete |
| `createPanel/updatePanel/deletePanel` | `CommitHelpers.js` | Delete (use createModule) |
| `createContainer/updateContainer/deleteContainer` | `CommitHelpers.js` | Delete |
| `createInstance/updateInstance/deleteInstance` | `CommitHelpers.js` | Delete |
| `iteration.key`, `iteration.value`, `iteration.range` | `Occurrence.js` | Delete |
| `Module.doc` field | `Module.js` | Delete (replaced by occurrence.textmap) |
| `Module.childIds` field | `Module.js` | Delete (replaced by occurrence.occurrences) |
| `Occurrence.targetType = "doc"` enum value | `Occurrence.js` | Remove enum value |
| `state.panels/containers/instances` arrays | `initialState.js` | Remove if unused |
| `SET_PANELS/CONTAINERS/INSTANCES` action types | `actions.js` | Remove if unused |
| `Iteration.js` model | `server/models/` | Verify if used; if not, delete |
| `ButtonPopover.jsx` | `client/src/ui/` | Verify usage; likely dead |
| `useBoardState.js` | `client/src/state/` | Verify usage |
| Legacy server handlers for `create_panel`, `delete_panel`, `create_container`, `delete_container`, `update_instance`, `delete_instance` | `server/server.js` or `socketHandlers/crud.js` | Delete after CommitHelper consolidation |
| `server/utils/createProfileDataold.js` | `server/utils/` | Dead old generator — delete |
| `Operation.js`: `blockTree`, `triggerTypes[]`, `triggerConfig` fields | `server/models/Operation.js` | Legacy alongside `pipeline` — delete after migration |
| `state.docs[]`, `state.artifacts[]` in initialState | `client/src/state/initialState.js` | Never populated post-unification — delete |

---

## 7. Summary Scores

| Category | Score | Notes |
|----------|-------|-------|
| Architecture | 8/10 | Three-concept model is clean. DnD is solid. |
| Naming | 7/10 | Good overall. Broken by legacy action type duplication. |
| DRY | 5/10 | CommitHelpers dual-naming is a major violation. |
| Test Coverage | 7/10 | Core helpers well-tested. State/socket layer not covered. |
| Performance | 8/10 | Good for current scale. Some optimization opportunities. |
| Debt Level | Medium | Manageable. One cleanup sprint fixes most issues. |

---

## 8. Immediate Action Items (see PHASE_PLAN_2.md)

Priority cleanup order:
1. Delete `Zone.Identifier` files from git + add to `.gitignore`
2. Consolidate CommitHelpers: delete role-specific CRUD (createPanel, createContainer, createInstance, etc.)
3. Consolidate action types: delete legacy PANEL/CONTAINER/INSTANCE actions
4. Clean Occurrence schema: delete legacy `iteration.key/value/range`
5. Clean Module schema: delete dead `doc` and `childIds` fields
6. Clean `Occurrence.targetType` enum: remove `"doc"` value
7. Add `gridId` index to Module schema
8. Move operation runtime files out of `blocks/` into `helpers/`
9. Add `toJSON` transform to Grid model
10. Verify `Iteration.js` model usage and delete if dead
