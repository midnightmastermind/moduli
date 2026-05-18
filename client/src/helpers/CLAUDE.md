# client/src/helpers — Helpers CLAUDE.md

_Updated: 2026-05-17. Check this file before re-reading source._

## Recent Changes (2026-05-17 — DATE_IN_PERIOD comparator + period-shape filter values)
- **`operationActions.js` (`DATE_IN_PERIOD` case in `evalRule`)**: New comparator. leftVal = date value (ISO string or Date); rightVal accepts either a bare `"YYYY-MM-DD"` (treated as day unit, equivalent to SAME_DAY) OR `{value: "YYYY-MM-DD", unit: "day"|"week"|"month"|"year"}`. Reuses the SAME_WEEK Mon-Sun weekStart helper for week-unit; month/year compare by calendar month/year. Wildcard right (null/""/empty value) passes. Null left fails. Powers tracker period aggregation across the full selected window. 7 regression tests in `operationActions.unified.test.js`.
- **`operationExecutor.js` ($activeDate setup)**: Resolves both bare-string and object-shape filter values. New `$activePeriod` var carries the FULL `{value, unit}` object (or bare string fallback) so tracker pipelines can route DATE_IN_PERIOD off the goal page's effective filter without flattening to a day.

## Recent Changes (2026-05-17 — PUSH_TO_ARRAY pipeline action)
- **`operationActions.js` (`PUSH_TO_ARRAY`)**: New action case. cfg: `{ name, value }`. When `cfg.value` is a plain object, each leaf value is resolved via `resolveExpr` (supports `$var.path` expressions). When `cfg.value` is a primitive, pushes via `resolveExpr`. Creates the array when the variable doesn't exist. Distinct from `PUSH_TO_VAR` which only pushes scalar values via `cfg.expr`. Used by the Books Read tracker to build `[{label, pages}]` rows. 6 unit tests added to `operationActions.unified.test.js`; 615/615 green.

## Recent Changes (2026-05-17 — createLeafInstanceInParent helper)
- **`CommitHelpers.js`**: New exported function `createLeafInstanceInParent({ dispatch, socket, gridId, userId, parentOccurrence, label, initialFields })`. Creates a `role:"instance" kind:"list"` module + occurrence with optional `initialFields`, optimistically dispatches both, emits `create_module` + `create_occurrence`, then appends the new occurrence ID to `parentOccurrence.occurrences[]`. Returns `{ moduleId, occurrenceId }`. Follows `createTextblockInContainer` pattern. Used by `Field.jsx` for occurrence-field add-new.

## Recent Changes (2026-05-17 — optionsResolver $this support)
- **`optionsResolver.js`**: `resolveOptions` now accepts optional third param `ownerOccurrence` (default `null`). When provided, it is passed as `$this` inside the find-mode predicate's `$vars` so predicates like `fields.category.value IS $this.fields.type.value` resolve the owner's field value. Backward-compatible: callers that don't pass it get `{}` for `$vars` (same as before). Also supports flat find shape (`{ mode:"find", over, predicate, ... }` at top level of `optionsSource`) alongside the existing nested shape (`{ find: { over, predicate, ... } }`) via `const cfg = src.find || src`.

## Recent Changes (2026-05-17 — optionsResolver)
- **`optionsResolver.js` (NEW)**: `resolveOptions(field, ctx) → { options: Array<{value, label}>, totalMatched: number }`. Branches on `field.meta.optionsSource.mode`: manual (literal values), range (start/end/step expansion), find (collection walk + predicate filter via `evalGroupAgainstRecord` + `valuePath`/`labelPath` extraction via `resolveRecordPath` + dedupe/sort/limit). Used by `FieldRenderer.jsx` (stamps `meta._resolvedOptions` for runtime), by `SelectOptionsSourceEditor`'s live preview, and by `FilterNavWidgets.derivedOptionsForFilter` (now accepts a `ctx` param).

## Recent Changes (May 15 2026 — COPY_LINK deterministic id + APPLY_TEMPLATE replacements/rootParent + ADD_CHILD)
- **operationActions.js (`COPY_LINK`)**: minted `linkedGroupId` is now DETERMINISTIC `lg-<sourceOccId>` (was `crypto.randomUUID`), in BOTH the fresh-clone path and the migration (`cfg.targetId`) path. Root cause of "Pay monthly bills: complete one, other doesn't tick": Build Day fires several times per load (onLoad + filter-bootstrap onFilterChange); across separate op runs in one batch the source's freshly-minted link isn't visible in the frozen snapshot, so a random id diverged (source in one group, swept/dup copy in another) and the server `update_occurrence` linkedGroupId fan-out never matched. Deterministic derivation makes every COPY_LINK of the same source converge on one group, idempotently. 62 operationActions.unified tests still green.
- **operationActions.js (`APPLY_TEMPLATE`)** — additive, optional cfg (existing callers like Daily Routine byte-for-byte unchanged):
  - `replacements: { "{tok}": expr }` — find-and-replace over every cloned occurrence's textmap text nodes (reuses exported `substituteTextmapTokens` from applyUpdate.js — one impl).
  - Embedded-ref remap: `occRemap`/`modRemap` filled per cloned node (children before parent); a cloned parent's textmap `instanceTextblock`/`moduleEmbed` `occurrenceId`+`instanceId` attrs are rewritten to the clones. Fixes the latent bug where a doc-page template with a textblock child would point clones at the original. Cloned textmaps are now always deep-copied (was shared-by-ref) — strictly safer.
  - `rootParent` (expr → parent id; folder ok) mints a standalone new subtree (no clone-into-target, unwrapRoot ignored). `rootLabel` overrides the root clone's module label. `rootIdVar` binds the cloned root occ id.
  - **Scope**: only the operation-pipeline APPLY_TEMPLATE. The server UI template path (`templates.js`/`cloneSubtree.js`) is untouched (still lacks ref-remap — pre-existing).
- **operationActions.js (new `ADD_CHILD` action)**: cfg `{ parentId, childId }`. Pure occurrences[] append (does NOT touch child.parentId), idempotent, emits existing `UPDATE_OCCURRENCE` effect + patches the in-pipeline overlay. Lets a page live in a folder (tree) AND be a panel's inactive tab (Notes-page pattern). `LINK_OCCURRENCE_TO_PARENT` action/effect no longer exists (stale CLAUDE.md note) — ADD_CHILD is the replacement for pipeline use.
- **applyUpdate.js**: `substituteTextmapTokens` is now `export`ed (was module-private) so APPLY_TEMPLATE shares the one token-substitution impl.

## Recent Changes (May 15 2026 — COPY_LINK recurses into children pairwise)
- **operationActions.js (`case "COPY_LINK"` rewrite)**: When the source has children, each child is recursively COPY_LINKed too — pairwise. `source.occurrences[i]` ↔ `copy.occurrences[i]` share their OWN per-child `linkedGroupId`. Server's `update_occurrence` linked-group fan-out then propagates field/textmap writes within each pair independently, so a doc/container subtree stays fully in sync at every level (mark a sub-textblock done in one copy → ticks across all copies). Body refactored into a `linkOne(src, targetParentId, isRoot, depth)` recursive helper with cycle guard (Set + depth cap 24). Children's CREATE_ITEM emits include `inst.occurrences = childIds` so each parent is created with its child list inlined (matches APPLY_TEMPLATE's pattern, avoids the bindSocketToStore parent.occurrences[] race). cfg.fields / cfg.itemIdVar / cfg.itemVar / cfg.linkedGroupVar / cfg.parent / cfg.insertAtIndex apply to ROOT only (recursing them into children would clobber per-child values; typical caller intent is "stamp date on the root"). cfg.copyFields applies at every level. 2 new regression tests in `__tests__/operationActions.unified.test.js`: "recursively links a 2-level subtree pairwise" + "cfg.fields applies to the ROOT clone only".

## Recent Changes (May 15 2026 — COPY_LINK action + linkedGroupId on CREATE_ITEM)
- **operationActions.js (new `case "COPY_LINK"`)**: Mints a new occurrence sharing both `moduleId` AND `linkedGroupId` with a source occurrence. Server's `update_occurrence` handler (server/socketHandlers/occurrences.js:91-124) propagates field/textmap writes bidirectionally across all occurrences sharing a `linkedGroupId` — so completing one copy marks the source AND every other copy. Distinct from CREATE (mints a new template + independent occurrence) and from a deep-copy. cfg: `{ sourceId, parent?, insertAtIndex?, fields?, copyFields? (default true), linkedGroupVar?, itemIdVar?, itemVar? }`. If source has no `linkedGroupId` yet, mints one + emits an UPDATE_OCCURRENCE on the source so the next field write triggers the linked-group fan-out. Pushes a CREATE_ITEM effect with `template:null` (reusing source.moduleId — no new template). Same optimistic-publish boilerplate as CREATE (overlay parent.occurrences[], _ancestors walk, role-filtered `$all*` slices). 7 regression tests in `__tests__/operationActions.unified.test.js` ("COPY_LINK action").
- **Used by**: `Schedule: Build Day` todo sweep (server/scripts/createTestGrid.js) — swept Due copies are now copy-links, not independent CREATEs. Re-seed required: `node --env-file=.env scripts/createTestGrid.js`.

## Recent Changes (May 15 2026 — grid-subject filter trigger = global filter ONLY)
- **operationExecutor.js (`matchSubjectFilter`)**: A `subjectType:"grid"` trigger on `onFilterChange`/`onNavigation` now matches ONLY a global/toolbar filter change — a NavigationOp with NO `sourceOccurrenceId` and NO `_ancestorIds`. Checked BEFORE the `if (!targetId) return true` shortcut (these triggers use `targetId:""`, so they previously matched every filter change). **Root cause** of "changing the Physical container's date rebuilds the Schedule for the goals' day": `Schedule: Build Day`'s `{onFilterChange, subjectType:"grid", targetId:""}` trigger matched the local Physical-container NavigationOp (which carries `sourceOccurrenceId`+`_ancestorIds` via `CommitHelpers.updateOccurrenceFilterOverride`); Build Day then ran with `$schedDate = $trigger.date` (the goals' date, since `$schedPage._effectiveFilter` was null) and APPLY_TEMPLATE'd the routine into Schedule. Local occurrence filter changes are now handled exclusively by `subjectType:"filterNav"` triggers, scoped by `matchAncestorScope`'s `ancestorLabel`. One shared-function fix — corrects every op with a grid-subject filter trigger, not just Build Day. 3 regression tests in `__tests__/operationExecutor.test.js` ("grid-subject onFilterChange matches global filter changes only"). 559/559 client tests green. Pure client logic — no re-seed needed for this fix.

## Recent Changes (May 15 2026 — effectiveFilterFor + _effectiveFilter walk occurrences[] reverse map)
- **operationExecutor.js (`effectiveFilterFor`)**: Same parentId-only-walk bug as `getEffectiveFilterForOccurrence` — fixed identically. New optional `parentByChildId` param; falls back to the shared `buildParentMap` (dragHitTesting) when not passed; walk step `nextId = pbc[cur.id] ?? cur.parentId`. Exported + covered by `__tests__/operationExecutor.test.js` (all green). Part of the May 15 ancestor-walk consolidation — see state/CLAUDE.md + memory `effective-filter-ancestor-walk`.
- **operationExecutor.js (`executePipeline`)**: The two `getEffectiveFilterForOccurrence(...)` calls (per-`$allItems` `_effectiveFilter` enrichment at ~917, and the `$activeDate` target-occ resolution at ~946) now pass the already-built `parentByChildId` (line 881 `buildParentMap`) so the reverse-map walk costs nothing extra per item. This is what makes `$goalItem._effectiveFilter` resolve the full instance→container→page→grid chain for the goal trackers. See server/CLAUDE.md (May 15) + memory `project-goal-date-page-pattern`.

## Recent Changes (May 13 2026 — Templates v2 client helpers + APPLY_TEMPLATE pipeline action)
- **CommitHelpers.js** — three new helpers: `commitCloneSubtreeAsTemplate(socket, { sourceOccurrenceId, name, parentFolderId })`, `commitApplyTemplate(socket, { templateOccurrenceId, targetOccurrenceId, mode })`, `commitSaveOverTemplate(socket, { sourceOccurrenceId, templateOccurrenceId })`. All three emit via `safeEmit`. Old `saveTemplate` / `fillFromTemplate` removed.
- **templateHelpers.js (NEW)** — pure traversal: `templatesManifestFor(state, gridId)`, `rootFolderForTemplates(state, gridId)`, `templateOccurrencesInFolder(state, folderId)`, `templateKindOf(state, occ)`, `templatesByKind(state, gridId, kindOrRole)`. Used by TemplatesSection / TemplatesTab / QuickAddMenu.
- **operationActions.js** — new `case "APPLY_TEMPLATE"` in `executeActionItem`. Walks template subtree depth-first from `state.modulesById` + `occurrencesById`, mints fresh ids, pushes one `CREATE_ITEM` effect per cloned node + a follow-up `UPDATE_OCCURRENCE` to wire the children list. Mode `replace` clears target's existing children first. Binds `cfg.resultVar` to the array of new occurrence ids (depth-first, leaves first, root last). Optimistic publish into `$vars.$allOccurrences`/`$allItems` so same-pipeline FINDs see the clones.
- **dropHandlers.js** — `handleTemplateDrop` removed; the old payloadType:"template" routing branch deleted. Template drag-out from QuickAddMenu / TemplatesSection / TemplatesTab calls `commitApplyTemplate` directly.

## Recent Changes (May 11 2026 — Canvas-to-container date stamp; QuickAddMenu kind filter)
- **dropHandlers.js (`handleOccurrenceMove` canvas-source MOVE branch)**: After moving a canvas-source leaf into a regular container, the helper now calls `stampPageFilterFields(...)` against the destination container occurrence — same call the regular container-to-container move branch already makes. Before, dragging a Canvas Note into a Schedule slot left the moved occurrence with no `fields[dateFieldId]` value, so `Tracker: Tasks Completed Today` (whose predicate gates on `SAME_DAY $goalDate`) ignored it on completion. The stamp runs BEFORE `fireMoveTrigger`, so the post-move MeasureOp burst sees the freshly-stamped date.

## Recent Changes (May 11 2026 — CREATE preserves hidden bindings; instances drop into grid cells)
- **operationActions.js (`CREATE` → `buildBindings`)**: Existing bindings' `hidden` flag is now preserved unless `cfg.fieldHidden[fid]` explicitly sets it (uses `Object.prototype.hasOwnProperty.call` to distinguish "absent" from "false"). Before: any CREATE that addressed an existing field bound on an existing template by-label silently un-hid it (because `hiddenMap` defaulted to `{}`, `hidden = !!undefined === false`, comparison flipped the stored `true` → `undefined`). Symptom: after the seed op ran, the source "Drink Water" / etc. template modules in Daily Toolkit lost their hidden Date binding and started rendering Date + Time Slot inline. Plus the seed's auto-attached `timeslotFieldId` binding lacked a hidden marker, so every per-day copy showed Time Slot too. Now the seed (and all in-pipeline CREATEs) can carry a `fieldHidden: { ... }` map to mint new bindings hidden and to leave the existing template's user-set visibility untouched.
- **dragSystem.js (`DropAccepts.GRID_CELL`)**: Added `DragType.INSTANCE` so leaf-role drags (notably textblocks dragged from a container) reach empty grid cells. Without it the pragmatic DnD accepts list rejected the drag before any of dropHandlers' leaf-role logic could see it.
- **dropHandlers.js (`handleOccurrenceMove` top branch)**: New early-out — when the drop target is a `GRID_CELL`, mirror handleModuleDrop's leaf-role drilldown: create a new panel + container at `{row,col}` and `copyInstanceToContainer` the dragged module into it. Lets users place a textblock (or any leaf occurrence) anywhere on the grid by dragging from its current container into an empty cell.

## Recent Changes (May 7 2026 — Pre-stamp page-filter date on drag-into-Schedule)
- **dropHandlers.js**: Split `stampPageFilterFields` into a pure `computePageFilterFields` (returns merged fields) plus a thin updater for the post-move case. `handleInstanceDrop` copy mode and `handleModuleDrop` (CC drag) now call `computePageFilterFields` BEFORE `LayoutHelpers.copyInstanceToContainer` and fold the stamp into the synthetic source's fields so the create lands with the destination's date. Post-create `stampPageFilterFields` calls removed from both copy sites. Move case still post-stamps (occurrence already exists), but `stampPageFilterFields` now also calls `operationsBridge.updateLocalOcc` so the per-field MeasureOp loop fired afterwards sees the stamped date in the executor's overlay.
- **Why**: When you dragged a pre-completed water item into a schedule slot, the create fired `OccurrenceCreateOp` + per-field `MeasureOp`s with the source's old date. The post-create stamp then silently fixed the date via `updateOccurrence` (no `triggerField` → no MeasureOp), and trackers (which gate on `fields.<dateFieldId>.value SAME_DAY $goalDate`) had already evaluated the loop before the date was correct. Editing a field afterwards re-fired with the right date, which is why "edit fields after drop" worked. Pre-stamping makes the create's in-flight ops see the right date the first time.

## Recent Changes (May 6 2026 — FIND candidates carry ancestor labels for disambiguation)
- **operationExecutor.js (`collectFindCandidates`)**: Each evaluated candidate now carries `ancestorLabels: string[]` — the candidate's `_ancestors` chain mapped through `$vars.$allItems` and reversed to root-first order, so the OperationLogPanel can render a breadcrumb like `Center Hub › Schedule › 6:00am` next to the candidate label. Unresolved ancestor IDs are dropped so the path has no gaps. Without this, the candidates list for a FIND iterating `$allInstances` (with many same-named "Drink Water" copies seeded into schedule slots) is indistinguishable from a single entry — every row reads "Drink Water · …shortId" and the user can't verify whether the seeded items even made it into the iteration pool.

## Recent Changes (May 6 2026 — $allPages now means role:"page" + new $allPanels + uncapped FIND candidates)
- **operationExecutor.js**: `$allPages` filter changed from `i.role === "panel"` to `i.role === "page"` — the previous filter was a misnomer that matched panel-role grid-cell shells (Panel A/B/C) instead of the actual pages (Schedule, Daily Toolkit, Daily Goals, Todo List). Added a new `$allPanels` slice for the panel role so panels are still iterable. `_SNAPSHOT_SKIP` updated to include both keys.
- **operationActions.js (`CREATE` optimistic publish)**: When a CREATE action runs with `role: "page"` it now appends to `$vars.$allPages`; `role: "panel"` appends to the new `$allPanels`. Was: `role: "panel"` was incorrectly appended to `$allPages` (matching the old misnamed filter).
- **operationExecutor.js (`collectFindCandidates`)**: Removed the `_FIND_CANDIDATE_LIMIT = 25` cap. Every iterated record's per-rule eval now lands in the run log so the user can audit why a FIND failed even on large pools. (Run-log persistence inherits the existing per-op cap of 25 entries from `OperationRunLog`.)
- **scripts/createTestGrid.js (re-seed required)**: All 17 FINDs in the test grid now declare `over` explicitly:
  - Schedule page lookups (5 ops, 5 sites) → `$allPages`
  - "Physical Wellness" / "Task Progress" goal-instance lookups (2 sites) → `$allInstances`
  - "Due" / slot / todo-list container lookups (5 sites) → `$allContainers`
  - Source / dedup / todo-copy instance lookups (3 sites) → `$allInstances`
  - Trigger-by-id lookups (Stamp Date + Clear Date on Move-Out, 2 sites) → kept default `$allOccurrences` because the trigger's role is unknown.
- **Re-seed**: `node --env-file=.env scripts/createTestGrid.js` to push the new pipelines.
- **Regression coverage**: 1 new test in `__tests__/operationExecutor.test.js` (`$allPages filters role:'page'`) confirming the page/panel split + per-collection iteration count.

## Recent Changes (May 6 2026 — FIND log surfaces bound vars + record-resolved predicate values + per-candidate breakdown)
- **operationExecutor.js (`executeSteps`)**: After `executeActionItem` runs, capture a `boundVars` map onto the `action` log entry covering the action's target vars (`cfg.itemVar`, `cfg.itemIdVar`, plus `cfg.name` for the `_VAR_TARGET_ACTIONS` set: INIT_VAR / SET_VAR / *_VAR family). FIND/INIT_VAR don't push effects into `updates`, so the run-history panel had nothing to display — every FIND row rendered "(no match)" even when it bound a record. New `_VAR_TARGET_ACTIONS` set near `_SNAPSHOT_SKIP` distinguishes var-name targets from CREATE's label.
- **operationExecutor.js (`resolveGroupForLog` + `executeSteps` FIND post-resolve)**: The log's predicate `_leftValue` annotations used to come from `resolveExpr(rule.left, $vars)`. For FIND predicates the lefts are bare record paths (`templateId`, `_ancestors`, `fields.<fid>.value`, `meta.scheduleSlot`) — `resolveExpr` returns those unchanged, so the run history showed the path string instead of the matched record's actual value. `resolveGroupForLog` now accepts an optional `record` argument; new `_isBareRecordPath()` helper routes bare paths through `resolveRecordPath` against the record. After a FIND action runs, `resolvedPredicate` is recomputed using the matched record (from `$vars[itemVar]` or `$vars[itemIdVar]` looked up in `$allItems` for id-only seed pipelines).
- **operationExecutor.js (`collectFindCandidates`)**: New helper invoked from `executeSteps` whenever a FIND action runs in log mode. Iterates the same pool the FIND iterated (default `$allOccurrences`), evaluates each leaf rule against each record via `evalRuleAgainstRecord`, and records `{ left, leftValue, comparator, rightValue, matched }` per rule per record. Sort: matched record first, then by score desc, then by id. Cap: `_FIND_CANDIDATE_LIMIT = 25` to keep run logs (esp. DB-persisted) small. Required so the panel can show per-record value breakdowns even when FIND came back empty — the user needs to see which records were close to matching and on which rule they failed.
- **operationActions.js**: Exported `resolveRecordPath` and `evalRuleAgainstRecord` so the executor can mirror FIND's per-record evaluation in the log.
- **Regression coverage**: 6 new tests in `__tests__/operationExecutor.test.js` under `describe("FIND action log entries carry boundVars", ...)` — boundVars on match, null on no-match, predicate left resolves against matched record (`templateId / _ancestors / fields.X.value / meta.X`), id-only fallback via `$allItems`, candidate-by-candidate evaluations on match (matched record first + score), candidate evaluations preserved on no-match.

## Recent Changes (May 5 2026 — CREATE wires parent linkage so HAS_ANCESTOR dedup works across RUN_OPERATION recursion)
- **operationActions.js (`CREATE` action)**: Three additions when publishing a new instance:
  1. Compute `_ancestors` for the new instance by walking the parent chain (preferring `context._parentByChildId` reverse map, falling back to `parentId`) and stamp it onto the instance object placed into `$vars.$allItems` / `$allOccurrences` / role-filtered slices. Same-pipeline FINDs evaluating `_ancestors HAS_ANCESTOR <pageId>` against the new row now match.
  2. Append `instanceId` to `context.occurrencesById[parentId].occurrences` (spread the parent so the cached `localOccsById` ref isn't mutated). The next `executePipeline` rebuild of `parentByChildId` from `.occurrences[]` arrays now picks up the new linkage.
  3. Set `context._parentByChildId[instanceId] = parentId` when the executor passed one in, so any FIND inside the same pipeline that walks the reverse map also sees the link.
- **Why the bug bit:** `Tracker: Tasks Completed Today` and `Tracker: Water Today` self-heal by `RUN_OPERATION`-ing `Schedule: Seed Daily Routine` when no schedule item exists for `$goalDate`. Seed at the end re-`RUN_OPERATION`s the trackers. Each recursive Tracker rebuilt `parentByChildId` from `context.occurrencesById` — and CREATE never updated the parent slot's `occurrences[]` in the overlay. Result: the just-CREATEd rows had empty `_ancestors`, the `_ancestors HAS_ANCESTOR $schedPageId` rule in the dedup FIND failed, the dedup FIND came back empty, and seed re-CREATEd the same items at every recursion level (capped at depth 4 by the recursion guard). User-visible symptoms: marking a schedule task complete spawned duplicate Drink Water / Take Medication / Go to Gym instances, and drag-to-schedule "didn't stick" because the dragged occurrence was buried under newly-seeded duplicates competing for the same template+slot pair.
- **Regression coverage**: 4 new tests in `__tests__/operationActions.unified.test.js` under `describe("CREATE action", ...)` — append-to-parent, ancestors via parentId fallback, ancestors via `_parentByChildId`, end-to-end same-pipeline FIND with `HAS_ANCESTOR` after CREATE.

## Recent Changes (May 4 2026 — RUN_OPERATION action: lookup-by-name + recursion guard)
- **operationActions.js (`RUN_OPERATION` case)**: Action now accepts `cfg.operationName` (looked up via `Object.values(operationsById).find(o => o.name === wanted)`) in addition to `cfg.operationId`. Added a recursion guard via `context._opCallDepth` (cap 4) so an op that calls itself, or a cycle A→B→A, can't blow the stack. The cap only short-circuits the RUN_OPERATION step — subsequent steps in the same frame still run. Effects from the callee bubble up via `updates.push(...)` and merge into the caller's effect list. The callee inherits the same `transaction` (so `$trigger.*` is identical) but its own fresh `$vars`. Regression suite in `__tests__/runOperation.test.js` (4 cases: lookup-by-name, lookup-by-id, recursion cap, missing-op no-op).

## Recent Changes (May 4 2026 — $parentFilter includes trigger occ; run-log persistence)
- **operationExecutor.js (`$parentFilter` setup)**: Walk now starts at `triggerOccId` itself, not its parent. The trigger occurrence's own `filterOverride` is now merged in — required so a page-level NavigationOp (where `transaction.occurrenceId === pageId`) sees the page's NEW override on a filter change. Without this, the source NavigationOp computed against grid filters while the descendant cascade computed against the new override, producing two conflicting writes per filter change (today→tomorrow→today flicker on goal aggregations). Regression test in `__tests__/parentFilterResolution.test.js`.
- **operationExecutor.js (`recordRunLog` site)**: After in-memory `recordRunLog`, now also calls `operationsBridge.persistRunLog?.({ id, operationId, operationName, runAt, durationMs, triggerType, triggerOccurrenceId, transaction, entries })` to mirror the run log to the DB. Best-effort, swallowed errors.
- **bindSocketToStore.js**: `operationsBridge.persistRunLog` wired to `safeEmit(socket, "save_op_run_log", { ...payload, gridId })`. `gridId` pulled from `stateRef.current`. Server stores via `OperationRunLog` (capped at 25 per opId per user).

## Recent Changes (May 3 2026 — Find owns iteration; record-path predicates)
- **operationActions.js (`FIND` action)**: Reads `cfg.over` (default `$allOccurrences`) to obtain the iterable, and evaluates `cfg.predicate` against each record via the new `evalGroupAgainstRecord(group, record, $vars)`. No longer substitutes `$vars.$item` per iteration — the predicate's `rule.left` is interpreted as a dotted record path (`label`, `fields.<fid>.value`, `_ancestors`). New `resolveRecordPath(record, path)` walks the path on the record; tolerates legacy `$item.` prefixes from existing seed data so the runtime accepts both old and new predicate shapes without a migration step.
- **operationActions.js (`CREATE` action)**: Optimistic publish into `$vars.$allItems` extended to keep `$allOccurrences` in sync (alias) and the role-filtered slices ($allContainers / $allPages / $allInstances) when the new instance's role matches. Without this, a FIND step that runs after a CREATE in the same pipeline (using the new $allOccurrences default) wouldn't see the just-created item.
- **operationExecutor.js (`$vars` setup)**: `$allOccurrences`/`$allContainers`/`$allPages`/`$allInstances` are now first-class built-ins, populated alongside `$allItems` and `$allTemplates`/`$allFields`. `$allOccurrences` is an alias of `$allItems`; the others are role-filtered. Lets the editor's collection picker offer all seven without requiring a Source row, and lets the executor resolve them via `resolveExpr` during FIND/Loop.
- **operationExecutor.js (`_SNAPSHOT_SKIP`)**: Expanded to skip the four new built-in collections from per-step var snapshots in the run log.

## Recent Changes (Apr 30 2026 — Ancestor chain walks parent-by-child reverse map)
- **CommitHelpers.js (`_ancestorChain`)**: Now builds a parent-by-child reverse map from each occurrence's `occ.occurrences[]` and walks it as the primary parent source, falling back to `cur.parentId`. Mirrors the executor's `ancestorsFor` so trigger ancestor scoping (`ancestorLabel: "Daily Goals"` etc.) and pipeline `HAS_ANCESTOR` predicates resolve from the same chain. Was a real bug: many seeded grids only set `parentId` on leaf instances; pages and panels track children via `occurrences[]` and have no `parentId`, so the previous `cur.parentId`-only walk stopped after one hop and ancestor-scoped triggers silently failed to match (Tracker: Water Today / Tracker: Tasks Completed Today on Daily Goals navigation).

## Recent Changes (Apr 30 2026 — Local-filter NavigationOp wiring fix + descendant cascade)
- **CommitHelpers.js (`updateOccurrenceFilterOverride`)**: Now calls `operationsBridge.updateLocalOcc({ ...prevOcc, filterOverride })` BEFORE firing NavigationOp. Without this the executor read a stale `filterOverride` from the cached `localOccsById` overlay, so `$schedPage._effectiveFilter` resolved to the old date and "Schedule: Build Day" / "Schedule: Seed Daily Routine" built for the previous day (and their idempotency guards thought the work was already done — symptom: empty schedule when navigating to a fresh day). Function signature also accepts optional `navFieldId` + `date` and forwards them on the NavigationOp transaction so trigger sources binding `$trigger.fieldId` / `$trigger.date` work as a fallback.
- **CommitHelpers.js (descendant cascade)**: After firing NavigationOp for the source occurrence, the helper now walks `occ.occurrences[]` recursively and fires one additional NavigationOp per descendant whose effective filter actually moved. Walk semantics: `filterOverride: null` means "still inheriting, all changed keys propagate, recurse"; `filterOverride: {}` blocks inheritance entirely (descendants under a cleared override are unaffected); a partial override only blocks the keys it owns and propagates the rest. Each descendant fire carries that descendant's own `_ancestorIds` / `_ancestorLabels` chain so `matchAncestorScope` resolves correctly. Two new module-level helpers: `_changedFilterKeys(prev, next)` (diff treats null/undefined as `{}`) and `_walkInheritingDescendants(rootId, changedKeys, occurrencesById)`.
- **Why the cascade exists at all:** When a parent's `filterOverride` changes, descendants' stored data is byte-identical before and after — only their *derived* effective filter shifts. Nothing in Redux/sockets/the executor can detect that by diffing state, so `NavigationOp` has to be enumerated explicitly. This matches the per-affected-occurrence contract every other trigger already follows (`MeasureOp` etc.). Side-effect: page-level filter changes now fire 1 + N NavigationOps where N is the count of inheriting descendants. Existing ops are idempotent so this is correctness-preserving; if it becomes a perf concern, restructure the schedule ops to per-slot scope so they only fire on the slot trigger and not on the page trigger.
- **Why the cache update is BEFORE NavigationOp:** Direct dispatch updates Redux but `localOccsById` is the executor's source of truth for occurrence reads (see bindSocketToStore.js:838). Operations fire from `fireOperations` synchronously after the override write, so the cache must be ahead of the next Redux render.

## Recent Changes (Apr 30 2026 — Operations editor overhaul)
- **operationExecutor.js**: Exported `effectiveFilterFor(occurrenceId, { occurrencesById, gridFilters })` — walks ancestor chain, merges `filterOverride` maps with closer ancestors winning; `gridFilters` acts as the floor; empty override clears merged keys per the existing `getEffectiveFilterForOccurrence` semantics. 5 unit tests cover the merge, override, floor, missing-id, and clear paths.
- **operationExecutor.js (source resolution)**: New entityType branches for `allOccurrences` / `allContainers` / `allPages` / `allInstances` / `allTemplates` (slices of `allItems` / `allTemplates`), `parentFilter` (alias of pre-built `$parentFilter`), and `effectiveFilter` (binds by `targetId` first, falls back to `targetLabel`). (B5, B6, B15)
- **operationExecutor.js (`$trigger`)**: The enrichment loop now filters out any key starting with `iteration` and `_iterationTimeValue` / `_iterationCategoryValue` so legacy transactions don't pollute the trigger snapshot. The panel source no longer copies `iterationTimeValue` / `iterationCategoryValue`. The occurrence source no longer copies `_iterationTimeValue` / `_iterationCategoryValue`. (B14)
- **operationExecutor.js (run-log source snapshot)**: Stopped coercing `$all*` / `$grid` to `[Array(N)]` / `[Object]` strings. Pass the raw values through — `OperationLogPanel.JsonNode` makes everything expandable. (B13)
- **operationExecutor.js (`matchesTrigger`)**: New `matchAncestorScope(to, eventType, transaction)` — when an `onFilterChange` / `onNavigation` trigger has `ancestorId` or `ancestorLabel`, only matches when the changed-filter source is the chosen ancestor or one of its own ancestors. Grid-level `activeFilterValues` changes carry no ancestor data, so any ancestor-scoped trigger ignores them. 4 unit tests cover the new matching semantics. (B16)
- **operationActions.js (`FIND`)**: Removed the `cfg.scope?.dateFieldId` branch. Date filtering belongs in the predicate rules (e.g. `$item.fields.date.value SAME_DAY $today`) — the editor no longer surfaces a separate scope row either. (B8)
- **operationActions.js (`CREATE`)**: Date-typed field writes now validate the resolved value via `isDateValue()`. If the value isn't a `Date` or YYYY-MM-DD-prefixed parseable string, the executor falls back to `$today` rather than stamping a literal string (e.g. the field name `"date"`) into a date field. (B20)
- **CommitHelpers.js (`updateOccurrenceFilterOverride`)**: When called with `occurrencesById` and `modulesById`, fires a `NavigationOp` with `sourceOccurrenceId` plus the source's `_ancestorIds` and `_ancestorLabels` chain — lets `matchesTrigger` ancestor scoping decide which ops to fire. Grid-level filter changes still fire a NavigationOp without ancestor data. (B16)

## Recent Changes (Apr 29 2026 — $today / nav defaults use local-tz day)
- **operationExecutor.js (`executePipeline $vars`)**: `$today` and `$currentDate` now derive from `getFullYear / getMonth / getDate` (local tz), not `_nowDate.toISOString().slice(0, 10)` (UTC). The UTC variant rolls over to "tomorrow" anywhere west of UTC after local-evening — that was the "today is showing tomorrow" bug. New `_localDayString` helper.
- **state/bindSocketToStore.js (`onFullState`)**: filter-nav default resolver (`"today"` / `"startOfWeek"` / `"startOfMonth"`) now uses the same local-tz `localDay()` helper instead of `toISOString().slice(0, 10)`.
- **App.jsx (`handleFilterNav`)**: prev/next date arrows now produce a local-tz `YYYY-MM-DD` string for the same reason — pressing "next day" near midnight no longer skips ahead by the UTC offset.

## Recent Changes (Apr 29 2026 — Iteration vars retired + json: literal)
- **operationExecutor.js (`executePipeline $vars`)**: Removed `$iterationId` / `$iterationValue` / `$iterationFilter` / `$iterationDefinitions` / `$templates` and the `_activeIteration` lookup that fed them. The iteration system was retired in favour of named filters; these vars were dead weight cluttering the run log and the path picker. Saved grid layouts (`grid.templates`) are still reachable via `$grid.templates` if anyone ever needs them. `_SNAPSHOT_SKIP` updated.
- **operationActions.js (`resolveExpr`)**: New `json:` prefix. Anything starting with `json:` is JSON-parsed once and returned as the literal value — used by `ExprOrPath`'s new array mode so users can hand-write a list inline (e.g. `json:["a","b","c"]`). Distinct from `literal:` which is for scalars.

## Recent Changes (Apr 28 2026 — Run-log resolved values + per-iteration loop entries)
- **operationExecutor.js (`executeSteps`)**: Each `action` / `if` log entry now carries `varsBefore` (snapshot of user-facing `$vars` taken just before the step ran), `resolvedConfig` (action `cfg` exprs walked through `resolveExpr`), and `resolvedPredicate` (predicate `rules[]` annotated with `_leftValue` / `_rightValue` per rule). New `loop_iter` entry logged once per iteration with `{ as, index, total, item }` so the run history can show `$preset = {moduleLabel: "Drink Water", slotLabel: "6:00am"}` for each pass instead of just "4 items". Helpers `snapshotVars` / `resolveGroupForLog` / `resolveConfigForLog` added at module top. `_SNAPSHOT_SKIP` excludes `$allItems`/`$allTemplates`/`$allFields`/`$grid` and the executor internals so log payloads stay small.

## Recent Changes (Apr 27 2026 — Operation Priority Sort)
- **operationExecutor.js (`runMatchingOperations`)**: Sort key is now `(priority ?? 5)` first, `sortOrder` second. Lower priority number runs first. Lets the schedule auto-build (priority 1) finish creating slot occurrences before stamp ops (priority 2) and goal aggregations (priority 3) read them.

## Recent Changes (Apr 26 2026 — LINK_OCCURRENCE_TO_PARENT action)
- **operationActions.js**: New `LINK_OCCURRENCE_TO_PARENT` action — emits a `LINK_OCCURRENCE_TO_PARENT` effect with `{ occurrenceId, parentOccurrenceId }`. Optimistically appends the child id to the parent stub inside `$vars.$allOccurrences` (with `includes` guard) so subsequent steps in the same pipeline pass see the link without waiting for the effect to apply. Used by the auto-build operation in the ELSE of "if Due/slot exists" — the container's date FIELD value (FIND_OCCURRENCE → `cfg.dateFieldId`/`cfg.dateExpr`) stays the source of truth for "exists for active date", and this action separately ensures the matched occurrence is wired into `schedPage.occurrences[]`.

## Recent Changes (Apr 25 2026 — Artifact + Textblock Roles + Optimistic Upload)
- **dropHandlers.js**: `handleModuleDrop` now treats `role: "artifact"` and `role: "textblock"` as leaf-placeable (alongside `instance` / undefined) — see `isLeafRole`. Container drops + grid-cell drilldown both honor the new roles. Grid-cell drilldown now scans `state.modules` (not `state.instances`) so it finds artifact / textblock source modules too. `handleFileDrop` destructures `module` from the upload response and dispatches `createModuleAction` + `createOccurrenceAction` BEFORE updating the container — eliminates the blank-spot delay where the container update referenced an occurrence not yet in local state. Reducer is idempotent so the duplicate dispatch on socket arrival is a no-op.
- **LayoutHelpers.js**: `getContainerItemsWithOccurrences` and `getContainerItems` now take `leafModulesLookup` (a merged map of instances + artifacts + textblocks) instead of `instancesLookup`. Return shape `{ instance, occurrence }` is unchanged for back-compat — the `instance` field is now any leaf module. `copyInstanceToContainer` writes `targetType: "module"` (was `"instance"`) so artifact/textblock occurrences pass autofill role detection correctly.
- **CommitHelpers.js**: New `createTextblockInContainer({ dispatch, socket, gridId, userId, containerOccurrence, label })`. Generates IDs client-side, optimistic-dispatches the role:"textblock", kind:"doc" module + occurrence, emits `create_module` / `create_occurrence`, appends the new occurrence ID to the container's `occurrences[]`. Returns `{ moduleId, occurrenceId }`.

## Recent Changes (Apr 23 2026 — Copy-Drag Operation Triggers Fix)
- **LayoutHelpers.js**: `copyInstanceToContainer` now sets `parentId: toContainer._occurrence?.id` on the created occurrence (enables ancestor walk for HAS_ANCESTOR checks). Accepts optional `toPanelId` param, forwarded to `CommitHelpers.createOccurrence`.
- **CommitHelpers.js**: `createOccurrence` now accepts optional `panelId` param; includes it in the OccurrenceCreateOp so `onCreate`/`onAdd` operations with `panelId` filters (e.g. Schedule Stamp) fire on copy-drag.
- **dropHandlers.js**: Copy-drag path now resolves `toPanelOcc` via `findGridPanelOcc` and passes `toPanelId` to `copyInstanceToContainer`, matching the move-drag path's context resolution.

## Recent Changes (Apr 23 2026 — Optimistic Operation Triggers from CommitHelpers)
- **CommitHelpers.js**: `updateOccurrence` now accepts `triggerField = null` param. When provided, calls `operationsBridge.updateLocalOcc(occurrence)` + fires `MeasureOp` with `fieldId` so onChange operations with `allowedFields` match correctly. `FieldRenderer.jsx` passes `triggerField: { fieldId: field.id, value, instanceId }`.
- **CommitHelpers.js**: `createOccurrence` now calls `updateLocalOcc`, fires `OccurrenceCreateOp`, and per-field `MeasureOp` (with `fieldId`/`value`) for each field on the new occurrence. Triggers onAdd + onChange operations immediately on add.
- **CommitHelpers.js**: `deleteOccurrence`/`removeOccurrence` now fire `OccurrenceDeleteOp` first (with occurrence override so executor can still inspect the deleted occurrence), then rAF-deferred per-field `MeasureOp` (so the aggregation sees the occurrence as already gone).
- **dropHandlers.js**: `handleInstanceDrop` now updates `localOccsById` for both source/destination containers and fires per-field `MeasureOp` after move, so onChange aggregations retrigger when instances are drag-moved between slots.

## Recent Changes (Apr 17 2026 — Per-Operation Run Log)
- **operationExecutor.js**: Module-level `runHistory` Map<opId, RunLog[]> (cap 20, newest first). New exports: `getOpRunHistory(opId)`, `getLastOpLog(opId)` (back-compat), `subscribeToOpLog(opId, fn)`. `recordRunLog` unshifts onto history and notifies subscribers with the full list. `runMatchingOperations` creates a `makeLogger()` per op, adds `start`/`end`/`error` entries, and calls `recordRunLog`. `executePipeline` accepts optional 5th `externalLogger` param; reuses it when called from the batch executor or creates its own. Logger attached to `$vars._log` for nested helpers. `executeSteps` adds per-step entries (`action`/`if`/`loop`) with config + result preview. Source-resolution snapshot logged after `$vars` build.

## Recent Changes (Apr 16 2026 — Ancestry Check Replaces pageOccId)
- **operationExecutor.js**: Removed broken `pageOccId` filter from `gatherLoopItems`. Added `parentByChildId` reverse map built in `executePipeline` from all `occ.occurrences[]` arrays, passed via context as `_parentByChildId`. `gatherLoopItems` now adds `_ancestors` (ordered ancestor ID array, closest first) to every loop item. Time filter's `findDateValue` also uses the reverse map for parent-chain date walk.
- **operationActions.js**: Added `HAS_ANCESTOR` (aliased `ARRAY_INCLUDES`) comparator to `evalRule` — checks if an array (e.g. `$item._ancestors`) contains a given ID. Extended `FIND_OCCURRENCE` action to support `moduleLabel` / `moduleLabelExpr` config — looks up module by label in `$allModules`, uses its ID as `targetId`.
- **DB (test grid)**: "Water Today" and "Tasks Completed Today" operations updated — `pageOccId` removed from loop step, FIND_OCCURRENCE step added before loop to dynamically find schedule page by label, `HAS_ANCESTOR` condition added to loop body.

## Recent Changes (Apr 15 2026 — Delete Fires Operations Optimistically)
- **CommitHelpers.js**: `deleteOccurrence` + `removeOccurrence` now accept optional `occurrence` param. Call `operationsBridge.removeLocalOcc(occurrenceId)` before dispatch (evicts from local cache), then fire `MeasureOp` for each field the occurrence had. Mirrors what `onOccurrenceDeleted` does in bindSocketToStore for other windows. Callers in ModuleInstance.jsx, ModuleContainer.jsx, ContainerPool.jsx updated to pass `occurrence`.

## Recent Changes (Apr 15 2026 — DragMode Per-Occurrence + Drag-Out to Board Fix)
- **dropHandlers.js**: Container drag-out from doc to board now uses `drop.dropTarget.context?.pageOccurrenceId` to target the page occurrence (not the panel occurrence). Board panels store containers in page occurrences — the old code added to the panel occurrence which is only page IDs, causing the container to never render.
- **ModuleContainer.jsx**: `containerDragMode` now reads `containerOccurrence?.dragMode ?? module?.defaultDragMode ?? "move"` — occurrence-level dragMode takes priority over module default. `toggleContainerDragModeQuick` now writes to the occurrence via `updateOccurrence` (when occurrence exists) instead of always writing to the module. Toggling one copy's mode no longer affects other occurrences sharing the same module.

## Recent Changes (Apr 15 2026 — Drag-Out from Doc Embeds)
- **dropHandlers.js**: Both `handleInstanceDrop` and `handleContainerDrop` now handle `payload.context.sourceType === "doc-embed"`. Instance: skips `fromC` check, adds `occurrenceId` to `toCOcc.occurrences`, calls `embedDeleteRegistry.get(occurrenceId)?.()` on move mode. Container: same for panel (`toPanelOcc.occurrences`). Enables dragging embedded instances/containers out of docs back to boards.
- **embedRegistry.js**: (existing) `embedDeleteRegistry` Map imported by dropHandlers — completes the drag-out circuit.

## Recent Changes (Apr 10 2026 — DragProvider Doc Container Skip)
- **DragProvider.jsx**: `handleDrop` instance branch now skips doc containers — checks `baseContainers.find(c => c.id === containerId)?.kind === "doc"` before calling `handleInstanceDrop`. Root cause of 3 bugs: (1) extra occurrence created when dragging instance into doc, (2) pending drop popup not closing reliably, (3) blank embed element left after deleting moduleEmbed. All fixed by preventing DragProvider from processing instance drops on doc containers — Editor.jsx's own Pragmatic DnD drop target handles insertion.

## Recent Changes (Apr 9 2026 — Cursor + Drag Fixes)
- **index.css**: Added `cursor: grab !important` to `.module-drag-handle .radial-handle` — previously overridden by Tailwind `cursor-pointer`. `.page-tree-close-btn` hover CSS no longer uses `!important` since inline `opacity: 0` was removed from the button.

## Recent Changes (Apr 9 2026 — Drag Handle Fix: Boolean Flag)
- **dragSystem.js**: Replaced `document.elementFromPoint(e.clientX, e.clientY)` check in `dragstart` interceptor with a `_dragFromHandle` boolean flag (both `useDraggable` and `useDragDrop`). Root cause: `dragstart` fires at the *current* cursor position after the user has moved, not the `pointerdown` position — so `elementFromPoint` was consistently returning elements outside the handle, causing all drags to be cancelled. Flag is set on `pointerdown` on the handle, cleared on first `dragstart` or `pointerup`/`dragend`/`drop`.

## Recent Changes (Apr 6 2026 — Phase E: File Drops + Iframe Removal)
- **DragProvider.jsx**: Added native file drop fallback — `dragover`/`drop` listeners on `.grid-frame` catch OS file drops that Pragmatic DnD might miss. Calls `handleFileDrop` with parsed file payload. Sticky container highlight still in place from earlier fix.
- **dragSystem.js**: Added `DragType.FILE` + `DragType.EXTERNAL` to `DropAccepts.GRID_CELL` — grid cells now accept native file drops (were only accepting panels/modules/artifacts/folders).

## Recent Changes (Apr 6 2026 — Sticky Container Highlight)
- **DragProvider.jsx**: Fixed container highlight sputtering during instance drags. When `getHoveredIds` returns `containerId = null` (cursor in gaps/margins between instances) but still inside the same panel, keeps the previous `containerId` instead of clearing the highlight. Uses `lastHotRef.current` to compare.

## Recent Changes (Apr 3 2026 — Day Page Duplicate Fix)
- **operationExecutor.js:178**: `case "onNavigation"` no longer matches `transactionType == null`. Was: `return transactionType === "NavigationOp" || transactionType == null` → now: `return transactionType === "NavigationOp"`. Same fix for `onIteration` alias. Root cause of 8 duplicate day pages on every load — `onNavigation` was firing on every `full_state` receive because null transactionType matched it.

## Recent Changes (Apr 2 2026 — operationActions + operationExecutor: Day Page Support)
- **operationActions.js** — `FIND_OCCURRENCE` extended: now filters candidates with `Array.isArray` guard, skips `meta.isTemplate === true` occurrences, and supports optional `dateFieldId` + `dateExpr` for date-field matching (finds occurrence where a date field equals the target date by `toDateString()` comparison).
- **operationActions.js** — 3 new action cases added before `PICK_RANDOM_FROM_POOL`:
  - `COMPUTE_TEXTMAP_FROM_TEMPLATE`: deep-clones a template occurrence's `textmap`, substitutes `[token]` strings using `resolveExpr` values, stores result in `$vars` (default `$computedTextmap`). Pure computation — no effect emitted.
  - `CREATE_OCCURRENCE_FOR_MODULE`: creates an occurrence for an existing module (no new module created). Supports `dateFieldId`/`dateExpr` for seeding an initial date field, and `textmapVar` to pick up a pre-computed textmap from `$vars`. Emits `CREATE_OCCURRENCE_FOR_MODULE` effect. Sets `$lastCreatedOccurrenceId`.
  - `FILL_FROM_TEMPLATE`: applies a substituted textmap clone to an EXISTING occurrence. Use for re-filling already-created pages. Emits `UPDATE_OCCURRENCE` effect.
- **operationExecutor.js** — Two new built-in `$vars` added after `$activeDate`:
  - `$activeDateLabel`: human-readable label for the active filter date (e.g. "Thu, Apr 3"). Defaults to today when no date filter active.
  - `$activeDayOfWeek`: full weekday name for active filter date (e.g. "Thursday"). Defaults to today.

## Recent Changes (Mar 31 2026 — Offline Queue + Optimistic Operations + Highlight Fix)
- **offlineQueue.js** (NEW): Module-level queue buffers `socket.emit` calls when disconnected. `safeEmit(socket, event, data)` is a drop-in replacement — emits immediately when connected, queues when offline. Deduplicates update events per entity (keeps latest). `flushOfflineQueue(socket)` replays all queued mutations in order.
- **CommitHelpers.js**: All `socket?.emit()` calls replaced with `safeEmit(socket, ...)` from offlineQueue.js. Added `import { safeEmit } from "./offlineQueue"`. Mutations now buffer automatically when offline and replay after reconnect + full_state.
- **CommitHelpers.js**: Imported `operationsBridge` from `bindSocketToStore`. `setOccurrenceFieldValue` now calls `operationsBridge.updateLocalOcc(updatedOcc)` + `operationsBridge.fireOperations("MeasureOp", ...)` immediately after local dispatch — operations run instantly without waiting for server echo.
- **DragProvider.jsx**: Fixed container highlight during instance drags. `handleDragMove` now calls `setDropHighlight(containerId)` when hovered target changes (was intentionally skipped, relying on `handleDragOver` which doesn't fire when hovering over instances inside containers — innermost drop target wins in Pragmatic DnD).

## Recent Changes (Mar 30 2026 — Operations Trigger Fixes)
- **operationExecutor.js**: (1) Added 6 missing trigger cases to `matchesTrigger`: `onAdd` (→ OccurrenceCreateOp), `onRemove` (→ OccurrenceDeleteOp), `onReorder` (→ OccurrenceListOp same-container), `onUncomplete` (→ MeasureOp falsy value), `onButton` (→ ButtonOp), `onNodeInput` (→ NodeInputOp). All 14 EVENT_TYPES in OperationsTab.jsx now have matching executor cases. (2) Fixed `scopeContainerId` in `gatherLoopItems` — was reading `scopeMod?.occurrences` (module, always empty). Now scans `occurrencesById` for occurrences targeting the container module and collects their child IDs.

## Recent Changes (Mar 30 2026 — DnD Cleanup)
- **DragProvider.jsx**: (1) Removed doc-container skip (`if (toC.kind === "doc") { clearSession(); return; }`) — doc containers now accept drops normally, Editor.jsx handles insertion as `moduleEmbed`. (2) Fixed `shouldHighlight` to highlight containers for ALL drag types except panel drags (was only instance/external). (3) Removed dead `canvasMeta` commented-out code block.

## Recent Changes (Mar 28 2026 — Dual Sidebar Drag Support)
- **dragSystem.js**: Added `FOLDER: "folder"` to `DragType`. Added `DragType.FOLDER` to `DropAccepts.GRID_CELL`, `PANEL_CONTENT`, `PAGE_CONTENT`.
- **DragProvider.jsx**: Added folder drop handler (lines ~1929-1951) — when `type === "folder"` dropped on panel, iterates `childOccurrenceIds`, creates a page module for each child doc, adds page occurrences to panel. **Bug fix**: used `(state?.modules || []).find(m => m.id === childOcc.targetId)` instead of `state?.modulesById?.[...]` (state has `modules` array, not `modulesById` map). Added `"tree-anchor"` and `"tree-page"` to module sourceType whitelist in the MODULE drop handler condition (line ~1672).

## Recent Changes (Mar 27 2026 — ViewType Rename: artifact→display)
- **DragProvider.jsx**: `isExistingArtifactPanel` check `viewType === "artifact"` → `viewType === "display"`. Both `createView` calls that set `viewType: "artifact"` updated to `viewType: "display"` (OS file drop handler + artifact grid-cell drop handler).

## Recent Changes (Mar 26 2026 — Bug Fixes: OS File Drop + Panel Cycler)
- **DragProvider.jsx**: Bug #13 — OS file drops now upload via `/api/artifacts/upload` (fetch + FormData). Creates new artifact panel at drop location, or switches active doc if dropping on existing artifact panel. FILE type removed from old text-instance handler. Deduplication updated: `__file__` drops deduplicate by payload id alone (ignoring containerId), preventing double uploads when both container-list and panel-content fire.
- **DragProvider.jsx**: Bug #14 — `cyclePanelStack` now cycles N+1 states (N panels + "all hidden"). Accepts `cellKey` param for calling from empty-pocket button. `visibleIdx === -1` treated as "all hidden" state at index N.
- **DragProvider.jsx**: Bug (canvas drag-out) — Added `|| payload?.sourceType === "canvas"` to module drop handler condition so CanvasCard drag-out works.

## Recent Changes (Mar 25 2026 — onLoad Trigger + Time Filter Fix)
- **operationExecutor.js**: `shouldTrigger` — added backward compat for old operations (no `triggerTypes` array) to fire on load. Uses `hasExplicitArray` flag: legacy `triggerType`-only operations auto-fire on load unless manual-only. New operations with explicit `triggerTypes` array are respected literally.
- **operationExecutor.js**: `gatherLoopItems` time filter — now checks occurrence's date-type field values (scheduledDate) in addition to legacy `iteration.timeValue`. Walks up parent chain (instance → container → panel) via `findDateValue()` to find a date when the occurrence itself has none. Uses `$activeDate` from filter nav as the comparison target instead of hardcoded `new Date()`. Occurrences with no date at all treated as persistent (pass any time filter).

## Recent Changes (Mar 23 2026 — Panel Cycler Persistence Fix)
- **DragProvider.jsx**: `cyclePanelStack` now emits `update_module` for ALL panels in the stack (was only emitting for the next visible panel). Hidden panels' `display: "none"` is now persisted to server, fixing position loss on reload.

## Recent Changes (Mar 22 2026 — Dynamic Page Creation via Operations Pipeline)
- **operationActions.js**: Added template string interpolation to `resolveExpr` — `"daypage ${$today}"` resolves vars inside `${...}` patterns. Added `FIND_MODULE` action (searches `$allModules` by name/label, sets `$foundModule`/`$foundModuleId`). Added `FIND_OCCURRENCE` action (searches by targetId, sets `$foundOccurrence`/`$foundOccurrenceId`). Added `CREATE_MODULE` action (creates module + occurrence in one shot, sets `$lastCreatedModuleId`/`$lastCreatedOccurrenceId`). Removed `CREATE_OCCURRENCE_WITH_ITERATION` and `NAVIGATE_DAY_PAGE` action types (replaced by generic pipeline).

## Key Files

| File | Purpose | Last Changed |
|------|---------|--------------|
| `DragProvider.jsx` | Drag state coordinator. Manages `monitorForElements`. Handles all drop logic: move/copy/copylink instances+containers+panels. Skips normal move when target is `kind: "doc"` (DocContainer handles it). Handles field drops from command-center → adds to instance fieldBindings. **Mar 10: Refactored to use draftOccurrences map instead of draftContainers/draftPanels occurrence arrays for live preview. All drop handlers now pass occurrence objects (panelOccurrence, containerOccurrence) to LayoutHelpers.** | Mar 2026 |
| `CommitHelpers.js` | All CRUD operations. **ONLY place that calls socket.emit**. Exports: createInstanceInContainer, deleteOccurrence, updatePanel, deletePanel, updateContainer, deleteContainer, createView, updateView, updateOccurrence, updateGrid, etc. | Stable |
| `CalculationHelpers.js` | All 15 aggregation types. `calculateDerivedField` checks `metric.blockTree` first (evaluateBlockTree via require()), falls back to flat `allowedFields`. | Recent |
| `LayoutHelpers.js` | Occurrence filtering (getPanelContainers, getContainerItems, getContainerItemsWithOccurrences, occurrenceMatchesIteration). Panel duplication/linking/splitting. **Mar 10: Major refactor — occurrence.occurrences is the SOLE source of ordering. All add/remove/reorder/move functions now take `panelOccurrence`/`containerOccurrence` params and call updateOccurrence (not updatePanel/updateContainer). No module.occurrences fallback anywhere.** | Mar 2026 |
| `dragSystem.js` | Pragmatic DnD hooks: useDraggable, useDroppable, useDragDrop. DragType enum (PANEL, CONTAINER, INSTANCE, FIELD, ARTIFACT, EXTERNAL). DropAccepts map. `dragHandleRef` param restricts drag origin to specific element. **Mar 19: Phase A perf — haptic vibrate(15) on drag start, vibrate([8,30,8]) on drop, 80ms hold delay, 32ms hit-test throttle, 4px hit-test cache.** | Mar 19 |
| `StyleHelpers.js` | `resolveContainerStyle`, `resolveInstanceStyle`, `styleToCSS`. Cascading style resolution: panel defaults → container overrides → instance overrides. | Recent |
| `CommitHelpers.js` exports (key): | createInstanceInContainer, deleteOccurrence, deletePanel, deleteContainer, updatePanel, updateContainer, updateOccurrence, updateGrid, createView, updateView, saveTemplate, fillFromTemplate | Stable |
| `blockTypes.js` | **MOVED here from blocks/** — Block type constants for visual operations builder. | Mar 2026 |
| `blockEvaluator.js` | **MOVED here from blocks/** — Recursive block tree evaluator. | Mar 2026 |
| `operationActions.js` | **MOVED here from blocks/** — resolveExpr, evalRule, evalGroup, extractFieldValuesFiltered, executeActionItem. | Mar 2026 |
| `operationExecutor.js` | **MOVED here from blocks/** — executePipeline, runMatchingOperations. Imports operationActions. | Mar 2026 |
| `offlineQueue.js` | **NEW** Offline mutation queue. `safeEmit(socket, event, data)` buffers when disconnected, deduplicates updates. `flushOfflineQueue(socket)` replays after reconnect. | Mar 31 |
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

## Recent Changes (Mar 20 2026 — Post-Review Cleanup)
- **dragSystem.js**: Removed dead `rect` variable in both `useDraggable` (was line 363) and `useDragDrop` (was line 750). Assigned but never read after `offsetX`/`offsetY` were hardcoded.

## Recent Changes (Mar 20 2026 — Phase B DragProvider Performance)
- **DragProvider.jsx**:
  - **B1**: Consolidated 3 `elementsFromPoint` calls into `getHoveredIds(x, y)` — single walk extracts panelId+containerId+instanceId. Individual getters kept for handleDrop fallbacks.
  - **B2**: `lastPreviewRef` caches last preview target — instance/container preview blocks skip draft mutations when same target still hovered.
  - **B3**: `dragConfigRef` holds `activeCell`, `setActiveCell`, `rows`, `cols`, `isMobile`. `handleDragMove` dep array reduced from 13 to 6. `handleDragStart` also uses ref for isMobile.

## Recent Changes (Mar 19 2026 — Phase A Drag Performance)
- **dragSystem.js**: Both `useDraggable` and `useDragDrop` mobile touch handlers:
  - **A1 Haptic**: `navigator.vibrate(15)` on drag start, `navigator.vibrate([8, 30, 8])` on successful drop (double-tap feel).
  - **A2 Hold delay**: `_TOUCH_HOLD_MS = 80` — touchmove returns early if finger held < 80ms. Prevents accidental drags from scrolling.
  - **A3 Throttle**: `_HIT_TEST_INTERVAL = 32` — expensive `_findDropTarget` (elementsFromPoint + DOM walk) runs at most every 32ms. Pill position still updates at 60fps.
  - **A4 Cache**: `_HIT_CACHE_DIST = 4` — skip hit-test if pointer moved < 4px since last check (squared distance comparison, no sqrt).

## Recent Changes (Mar 19 2026 — Mobile Drag + UI Fixes)
- **dragSystem.js**: Both `useDraggable` and `useDragDrop` mobile touch handlers: (1) Removed `e.preventDefault()` from `onStart` — CSS `touch-action:none` on triggerEl handles OS gesture suppression, native click/pointer events now fire for taps. (2) Cache `getBoundingClientRect()` at touchstart (`cachedRect`), not first-move. (3) Only `e.preventDefault()` in `onMove` AFTER threshold crossed (sub-threshold jitter doesn't cancel native click). (4) `document.documentElement.style.touchAction/overscrollBehavior` only set when drag actually starts, cleared on drag end only. (5) Removed synthetic `MouseEvent('click')` dispatch from `onEnd` — no longer needed since touchstart doesn't preventDefault. (6) Removed `touchStartTime` variable.

## Recent Changes (Mar 18 2026 — Mobile Fixes)
- **DragProvider.jsx**: `handleDragStart` now sets `document.documentElement.style.touchAction = 'none'` when `isMobile` — prevents Android split-screen gesture from intercepting drags. `clearSession` restores `touchAction = ''`. Added `isMobile` to `handleDragStart` dependency array.

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
